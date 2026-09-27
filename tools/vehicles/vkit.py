"""vkit - geometry kit for the procedural Harare vehicles (Blender 5.0 bpy/bmesh, no GUI).

Coordinates (Blender): x = lateral (+ = vehicle's right), y = forward (+ = front), z = up, metres.
The glTF exporter turns Blender +Y into glTF -Z, so exported models face -Z (three.js forward) with y up.

The body shell is a loft of cross-sections ("sections") along y. Each section is ten ring keys K0..K9
(lateral x, height z) for the right half, bottom centre to top centre:

    K0 bottom centre        K5 glass bottom (belt seal)
    K1 underside edge       K6 glass top / A- and C-pillar outer edge
    K2 rocker corner        K7 roof edge / pillar inner edge (windscreen and back-light corner)
    K3 max width            K8 roof (or hood/deck) mid
    K4 shoulder / belt      K9 top centre

Keys are interpolated along y with monotone cubic (PCHIP) curves and between keys with Hermite
splines, so a vehicle is a handful of keyframed sections instead of hand-placed vertices. Segment s is
the strip between K[s] and K[s+1]; material rules address faces by (y range, segment range, side).
"""
import bisect
import math
import os

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

NK = 10
MATS = ['paint', 'glass', 'chrome', 'trim', 'tyre', 'rim', 'light_front', 'light_rear', 'indicator',
        'plate', 'interior', 'livery', 'beacon_blue', 'beacon_red']
MI = {m: i for i, m in enumerate(MATS)}

SEG_LOD0 = (3, 1, 3, 3, 1, 4, 2, 2, 3)
SEG_LOD1 = (1, 1, 1, 1, 1, 1, 1, 1, 1)

# UV layout of the body shell (paint / detail texture):
#   right side  u in [0, U_SIDE], v in [0.02, 0.49]      left side  u in [0, U_SIDE], v in [0.51, 0.98]
#   front cap   u in [0.86, 0.99], v in [0.51, 0.98]     rear cap   u in [0.86, 0.99], v in [0.02, 0.49]
U_SIDE = 0.84
V_R = (0.02, 0.49)
V_L = (0.51, 0.98)
# v position of each ring key inside a side band (same for every LOD, so LOD1 can share the textures)
KV = (0.0, 0.10, 0.15, 0.36, 0.56, 0.58, 0.76, 0.81, 0.90, 1.0)


def key_v(kf):
    k = min(int(kf), NK - 2)
    fr = kf - k
    return KV[k] + (KV[k + 1] - KV[k]) * fr


# ---------------------------------------------------------------------------------------------------
# interpolation
# ---------------------------------------------------------------------------------------------------

def pchip(xs, ys):
    """Monotone piecewise cubic (Fritsch-Carlson). Flat where neighbouring keys are equal."""
    n = len(xs)
    if n == 1:
        return lambda x: ys[0]
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    if n > 2:
        # one-sided shape-preserving ends
        m[0] = 0.0 if d[0] == 0 else d[0] * 0.5 if d[0] * d[1] <= 0 else d[0]
        m[-1] = 0.0 if d[-1] == 0 else d[-1] * 0.5 if d[-1] * d[-2] <= 0 else d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = min(bisect.bisect_right(xs, x) - 1, n - 2)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    return f


def lin(xs, ys):
    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = min(bisect.bisect_right(xs, x) - 1, len(xs) - 2)
        t = (x - xs[i]) / (xs[i + 1] - xs[i])
        return ys[i] * (1 - t) + ys[i + 1] * t
    return f


def hermite(p0, p1, t0, t1, t):
    t2, t3 = t * t, t * t * t
    return (p0 * (2 * t3 - 3 * t2 + 1) + t0 * (t3 - 2 * t2 + t) + p1 * (-2 * t3 + 3 * t2) + t1 * (t3 - t2))


# ---------------------------------------------------------------------------------------------------
# section helpers
# ---------------------------------------------------------------------------------------------------

def sec(y, *, W, zb, zbelt, wbelt=None, zmax=None, top, rb=0.07, dy=None, tuck=0.035):
    """Build one section.

    W      half width at the widest point (K3), zmax its height (default 55% up the body side)
    zb     bottom of the body (sill / bumper bottom), rb rocker corner radius
    zbelt  shoulder (K4) height, wbelt its half width (default W - 0.03)
    top    ('glass', zg, wg, ztop)       side glass up to zg at half width wg, roof centre ztop
           ('deck', zc)                  hood / boot lid / cowl: crowned surface up to centre height zc
           ('deck', zc, f6, f7, f8)      ... with custom lateral fractions of K6..K8
           ('flat', zc)                  bus / box roof: nearly flat, square shoulders
    dy     optional per-key forward offsets (list of 10, or dict {key: offset})
    """
    wbelt = W - 0.03 if wbelt is None else wbelt
    zmax = zb + 0.55 * (zbelt - zb) if zmax is None else zmax
    k = [None] * NK
    k[0] = (0.0, zb)
    k[1] = (max(0.05, W - rb * 1.25), zb)
    k[2] = (W - rb * 0.3, zb + rb * 0.8)
    k[3] = (W, zmax)
    k[4] = (wbelt, zbelt)
    kind = top[0]
    if kind == 'glass':
        _, zg, wg, ztop = top[:4]
        k[5] = (wbelt - tuck * 0.6, zbelt + 0.02)
        k[6] = (wg, zg)
        k[7] = (wg - 0.05, zg + 0.04)
        k[8] = ((wg - 0.05) * 0.55, ztop - (ztop - zg - 0.04) * 0.18)
        k[9] = (0.0, ztop)
    elif kind in ('deck', 'flat'):
        zc = top[1]
        f6, f7, f8 = (top[2], top[3], top[4]) if len(top) >= 5 else (0.93, 0.84, 0.45)
        if kind == 'flat':
            f6, f7, f8 = 0.97, 0.9, 0.5

        def hz(fr):
            return zc - (zc - zbelt) * fr ** (2.0 if kind == 'deck' else 6.0)
        k[5] = (wbelt * 0.985, zbelt + (zc - zbelt) * 0.04 + 0.004)
        k[6] = (wbelt * f6, hz(f6))
        k[7] = (wbelt * f7, hz(f7))
        k[8] = (wbelt * f8, hz(f8))
        k[9] = (0.0, zc)
        # keep K5 on/under the surface
        k[5] = (k[5][0], min(k[5][1], hz(0.985) + 0.004))
    else:
        raise ValueError(kind)
    d = [0.0] * NK
    if isinstance(dy, dict):
        for i, v in dy.items():
            d[i] = v
    elif dy is not None:
        d = list(dy)
    return {'y': y, 'k': k, 'dy': d}


def edit(s, **keys):
    """Override keys of a section: edit(s, k6=(x, z), k9=(0, z), dy5=0.02)."""
    for name, v in keys.items():
        if name.startswith('dy'):
            s['dy'][int(name[2:])] = v
        else:
            s['k'][int(name[1:])] = v
    return s


# ---------------------------------------------------------------------------------------------------
# lofted body
# ---------------------------------------------------------------------------------------------------

class Body:
    def __init__(self, sections, *, sharp=(), round_front=0.25, round_rear=0.25, front_bulge=0.0,
                 rear_bulge=0.0, interp='pchip', round_front_z=None, round_rear_z=None):
        secs = sorted(sections, key=lambda s: s['y'])
        self.ys = [s['y'] for s in secs]
        for a, b in zip(self.ys, self.ys[1:]):
            assert b > a + 1e-6, f'sections must have distinct y ({a}, {b})'
        self.y0, self.y1 = self.ys[0], self.ys[-1]
        fn = pchip if interp == 'pchip' else lin
        self.fx, self.fz, self.fd = [], [], []
        for i in range(NK):
            self.fx.append(fn(self.ys, [s['k'][i][0] for s in secs]))
            self.fz.append(fn(self.ys, [s['k'][i][1] for s in secs]))
            self.fd.append(fn(self.ys, [s['dy'][i] for s in secs]))
        self.sharp = set(sharp)
        self.rf, self.rr = round_front, round_rear
        # rounding only below a height (e.g. a van nose is round in plan at bumper level only): None = all
        self.rfz, self.rrz = round_front_z, round_rear_z
        self.front_bulge, self.rear_bulge = front_bulge, rear_bulge

    # plan-view corner rounding: fraction of the half width kept at station y
    def _scale(self, y, W):
        s = 1.0
        if self.rf > 0 and y > self.y1 - self.rf:
            t = (y - (self.y1 - self.rf))
            d = self.rf - math.sqrt(max(0.0, self.rf ** 2 - t * t))
            s = min(s, (W - d) / W)
        if self.rr > 0 and y < self.y0 + self.rr:
            t = ((self.y0 + self.rr) - y)
            d = self.rr - math.sqrt(max(0.0, self.rr ** 2 - t * t))
            s = min(s, (W - d) / W)
        return max(s, 0.05)

    def keys(self, y):
        pts = []
        W = max(0.1, self.fx[3](y))
        sc = self._scale(y, W)
        for i in range(NK):
            x = self.fx[i](y) * sc
            pts.append(Vector((x, y + self.fd[i](y), self.fz[i](y))))
        return pts

    def ring(self, y, seg):
        K = self.keys(y)
        tang = []
        for i in range(NK):
            if i == 0:
                tang.append((Vector((1, 0, 0)), Vector((1, 0, 0))))
            elif i == NK - 1:
                tang.append((Vector((-1, 0, 0)), Vector((-1, 0, 0))))
            elif i in self.sharp:
                a = (K[i] - K[i - 1]).normalized() if (K[i] - K[i - 1]).length > 1e-6 else Vector((0, 0, 1))
                b = (K[i + 1] - K[i]).normalized() if (K[i + 1] - K[i]).length > 1e-6 else a
                tang.append((a, b))
            else:
                t = K[i + 1] - K[i - 1]
                t = t.normalized() if t.length > 1e-6 else Vector((0, 0, 1))
                tang.append((t, t))
        pts = []
        for s in range(NK - 1):
            p0, p1 = K[s], K[s + 1]
            d = (p1 - p0).length
            t0 = tang[s][1] * d
            t1 = tang[s + 1][0] * d
            n = seg[s]
            for j in range(n):
                pts.append(hermite(p0, p1, t0, t1, j / n))
        pts.append(K[-1].copy())
        # centre points exactly on the mirror plane
        pts[0].x = 0.0
        pts[-1].x = 0.0
        return pts

    def stations(self, ds, breaks=(), n_end=6, min_gap=0.012):
        y0, y1 = self.y0, self.y1
        must = {y0, y1}
        for b in breaks:
            if y0 + min_gap < b < y1 - min_gap:
                must.add(b)
        extra = set()
        for r, sign, yend in ((self.rf, -1, y1), (self.rr, 1, y0)):
            if r > 0:
                for i in range(1, n_end):
                    th = i / n_end * math.pi / 2
                    extra.add(yend + sign * (r - r * math.sin(th)))
        pts = sorted(must | extra)
        # drop extra points too close to a must point
        out = []
        for p in pts:
            if p in must or all(abs(p - m) > min_gap * 2 for m in must):
                out.append(p)
        out = sorted(out)
        # fill gaps
        res = [out[0]]
        for a, b in zip(out, out[1:]):
            n = max(1, math.ceil((b - a) / ds - 1e-6))
            for i in range(1, n):
                res.append(a + (b - a) * i / n)
            res.append(b)
        return res

    def build(self, *, seg=SEG_LOD0, ds=0.07, breaks=(), n_end=6, cap_rings=3):
        """Returns (bmesh, info). Faces carry int layers sj (station interval), sk (segment), sd (side)."""
        ys = self.stations(ds, breaks, n_end)
        self.last_ys = ys
        rings = [self.ring(y, seg) for y in ys]
        N = len(rings[0])
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        lj = bm.faces.layers.int.new('sj')
        lk = bm.faces.layers.int.new('sk')
        ld = bm.faces.layers.int.new('sd')
        segk = []
        for s in range(NK - 1):
            segk += [s] * seg[s]
        # vertex grid: full ring index m in 0..M-1: 0..N-1 right side (bottom centre -> top centre),
        # then N..M-1 = left side from top-1 down to bottom+1
        M = 2 * (N - 1)
        grid = []
        for j, R in enumerate(rings):
            row = [bm.verts.new(p) for p in R]
            for i in range(N - 2, 0, -1):
                p = R[i]
                row.append(bm.verts.new((-p.x, p.y, p.z)))
            grid.append(row)
        yspan = ys[-1] - ys[0]

        def ring_index(m):
            # -> (i along half ring, side)
            if m < N:
                return m, 1
            return M - m, -1

        # fractional key position of every half-ring sample
        kpos = []
        for sgi in range(NK - 1):
            for q in range(seg[sgi]):
                kpos.append(sgi + q / seg[sgi])
        kpos.append(NK - 1.0)

        def uv_of(j, m):
            i, side = ring_index(m % M)
            u = (ys[j] - ys[0]) / yspan * U_SIDE
            v0, v1 = V_R if side > 0 else V_L
            return (u, v0 + (v1 - v0) * key_v(kpos[i]))

        for j in range(len(ys) - 1):
            for m in range(M):
                m2 = (m + 1) % M
                vs = [grid[j][m], grid[j + 1][m], grid[j + 1][m2], grid[j][m2]]
                f = bm.faces.new(vs)
                i, side = ring_index(m)
                i2, _ = ring_index(m2)
                seg_i = min(i, i2)
                if m == N - 1:  # top centre -> left
                    side = -1
                f[lj] = j
                f[lk] = segk[seg_i]
                f[ld] = side
                # UVs: avoid wrap at the seam between sides
                uvs = [uv_of(j, m), uv_of(j + 1, m), uv_of(j + 1, m2), uv_of(j, m2)]
                if side < 0:
                    # vertices at the centre line (i == 0 or N-1) must use the left-side v range
                    for q, (jj, mm) in enumerate([(j, m), (j + 1, m), (j + 1, m2), (j, m2)]):
                        ii, _ = ring_index(mm % M)
                        if ii in (0, N - 1):
                            u = (ys[jj] - ys[0]) / yspan * U_SIDE
                            uvs[q] = (u, V_L[0] + (V_L[1] - V_L[0]) * key_v(kpos[ii]))
                for loop, uv in zip(f.loops, uvs):
                    loop[uvl].uv = uv
        # caps
        self.cap_bbox = {}
        self._cap(bm, grid[-1], +1, cap_rings, uvl, lj, lk, ld, len(ys) - 1, seg)
        self._cap(bm, grid[0], -1, cap_rings, uvl, lj, lk, ld, -1, seg)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return bm, {'ys': ys, 'N': N, 'seg': seg, 'cap_bbox': dict(self.cap_bbox)}

    def _cap(self, bm, ring, sign, nr, uvl, lj, lk, ld, jtag, seg=SEG_LOD0):
        """Close an end ring with a Coons patch (quad grid). Bottom edge = underside keys up to K2,
        top edge = the same number of samples down from the top centre, sides = the rest."""
        M = len(ring)
        N = M // 2 + 1
        c1 = sum(seg[:2])
        c2 = N - 1 - c1
        if c2 <= c1:
            c1 = max(1, (N - 1) // 3)
            c2 = N - 1 - c1

        def R(i):
            return ring[i]

        def Lf(i):
            return ring[0] if i == 0 else ring[N - 1] if i == N - 1 else ring[M - i]
        B = [Lf(i) for i in range(c1, 0, -1)] + [R(i) for i in range(0, c1 + 1)]
        T = [Lf(i) for i in range(c2, N - 1)] + [R(N - 1)] + [R(i) for i in range(N - 2, c2 - 1, -1)]
        Lc = [Lf(i) for i in range(c1, c2 + 1)]
        Rc = [R(i) for i in range(c1, c2 + 1)]
        na, nb = len(B) - 1, len(Lc) - 1
        bulge = self.front_bulge if sign > 0 else self.rear_bulge
        P = [[None] * (nb + 1) for _ in range(na + 1)]
        for a_ in range(na + 1):
            P[a_][0] = B[a_]
            P[a_][nb] = T[a_]
        for b_ in range(nb + 1):
            P[0][b_] = Lc[b_]
            P[na][b_] = Rc[b_]
        b0, b1, t0, t1 = B[0].co, B[na].co, T[0].co, T[na].co
        for a_ in range(1, na):
            s = a_ / na
            for b_ in range(1, nb):
                t = b_ / nb
                p = ((1 - t) * B[a_].co + t * T[a_].co + (1 - s) * Lc[b_].co + s * Rc[b_].co
                     - ((1 - s) * (1 - t) * b0 + s * (1 - t) * b1 + (1 - s) * t * t0 + s * t * t1))
                p = p.copy()
                p.y += sign * bulge * math.sin(math.pi * s) * math.sin(math.pi * t)
                P[a_][b_] = bm.verts.new(p)
        xs = [v.co.x for v in ring]
        zs = [v.co.z for v in ring]
        xmin, xmax, zmin, zmax = min(xs), max(xs), min(zs), max(zs)
        vr = V_L if sign > 0 else V_R
        self.cap_bbox['front' if sign > 0 else 'rear'] = (xmin, xmax, zmin, zmax)

        def uvp(p):
            u = 0.86 + 0.13 * (p.x - xmin) / max(1e-6, xmax - xmin)
            v = vr[0] + (vr[1] - vr[0]) * (p.z - zmin) / max(1e-6, zmax - zmin)
            return (u, v)
        for a_ in range(na):
            for b_ in range(nb):
                vs = [P[a_][b_], P[a_ + 1][b_], P[a_ + 1][b_ + 1], P[a_][b_ + 1]]
                try:
                    f = bm.faces.new(vs)
                except ValueError:
                    continue
                f[lj], f[lk], f[ld] = jtag, -1, 0
                for loop in f.loops:
                    loop[uvl].uv = uvp(loop.vert.co)

    # UV of a surface position given as (y, fractional key index, side) - for painting textures
    def cap_uv(self, x, z, which, info):
        xmin, xmax, zmin, zmax = info['cap_bbox'][which]
        vr = V_L if which == 'front' else V_R
        return (0.86 + 0.13 * (x - xmin) / max(1e-6, xmax - xmin),
                vr[0] + (vr[1] - vr[0]) * (z - zmin) / max(1e-6, zmax - zmin))

    def uv(self, y, kf, side, info):
        ys = info['ys']
        u = (y - ys[0]) / (ys[-1] - ys[0]) * U_SIDE
        v0, v1 = V_R if side > 0 else V_L
        return (u, v0 + (v1 - v0) * key_v(kf))


def apply_rules(bm, info, rules):
    """rules: list of dicts {mat, y0, y1, k0, k1, side(0|1|-1), tag}; later rules win.
    Caps (sk == -1) can be addressed with k0 = k1 = -1 plus zmin/zmax."""
    ys = info['ys']
    lj = bm.faces.layers.int['sj']
    lk = bm.faces.layers.int['sk']
    ld = bm.faces.layers.int['sd']
    tags = {}
    for f in bm.faces:
        f.material_index = MI['paint']
    for r in rules:
        for f in bm.faces:
            k = f[lk]
            j = f[lj]
            if k == -1:
                if r.get('k0', 0) != -1:
                    continue
                if j == -1 and r.get('cap', 'front') != 'rear':
                    continue
                if j != -1 and r.get('cap', 'front') != 'front':
                    continue
                cz = f.calc_center_median().z
                cx = f.calc_center_median().x
                if not (r.get('zmin', -9) <= cz <= r.get('zmax', 9)):
                    continue
                if not (r.get('xmin', -9) <= abs(cx) <= r.get('xmax', 9)):
                    continue
            else:
                if r.get('k0', 0) == -1:
                    continue
                ym = 0.5 * (ys[j] + ys[j + 1])
                if not (r.get('y0', -99) <= ym <= r.get('y1', 99)):
                    continue
                if not (r.get('k0', 0) <= k <= r.get('k1', 8)):
                    continue
                sd = r.get('side', 0)
                if sd and f[ld] != sd:
                    continue
                if 'zmin' in r or 'zmax' in r:
                    cz = f.calc_center_median().z
                    if not (r.get('zmin', -9) <= cz <= r.get('zmax', 9)):
                        continue
            f.material_index = MI[r['mat']]
            if r.get('tag'):
                tags.setdefault(r['tag'], set()).add(f)
            else:
                for s in tags.values():
                    s.discard(f)
    return tags


def inset_faces(bm, faces, thickness=0.012, depth=-0.008, rim_mat='trim'):
    faces = [f for f in faces if f.is_valid]
    if not faces:
        return
    res = bmesh.ops.inset_region(bm, faces=faces, thickness=thickness, depth=depth, use_even_offset=True,
                                 use_boundary=True)
    for f in res['faces']:
        f.material_index = MI[rim_mat]


# ---------------------------------------------------------------------------------------------------
# generic mesh builder for parts
# ---------------------------------------------------------------------------------------------------

class MB:
    """Accumulates polygons with material and UVs, then becomes a Blender object."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')

    def face(self, pts, mat, uvs=None, facing=None):
        vs = [self.bm.verts.new(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = MI[mat]
        if uvs:
            for v, uv in zip(vs, uvs):
                for loop in f.loops:
                    if loop.vert is v:
                        loop[self.uv].uv = uv
        if facing is not None:
            f.normal_update()
            if f.normal.dot(Vector(facing)) < 0:
                f.normal_flip()
        return f

    def grid(self, G, mat, UV=None, close_u=False, flip=False, facing=None):
        """G[i][j] points (i along u rows, j along v); quads between neighbours. facing: vector or
        callable(center) -> vector the face normals should point along."""
        vs = [[self.bm.verts.new(p) for p in row] for row in G]
        nu, nv = len(G), len(G[0])
        faces = []
        iu = nu if close_u else nu - 1
        for i in range(iu):
            i2 = (i + 1) % nu
            for j in range(nv - 1):
                q = [vs[i][j], vs[i2][j], vs[i2][j + 1], vs[i][j + 1]]
                if flip:
                    q = q[::-1]
                try:
                    f = self.bm.faces.new(q)
                except ValueError:
                    continue
                f.material_index = MI[mat]
                if UV:
                    uvq = [UV[i][j], UV[i2][j], UV[i2][j + 1], UV[i][j + 1]]
                    if close_u and i2 == 0:
                        du = UV[1][j][0] - UV[0][j][0]
                        uvq[1] = (UV[i][j][0] + du, UV[0][j][1])
                        uvq[2] = (UV[i][j + 1][0] + du, UV[0][j + 1][1])
                    if flip:
                        uvq = uvq[::-1]
                    for loop, uv in zip(f.loops, uvq):
                        loop[self.uv].uv = uv
                if facing is not None:
                    f.normal_update()
                    fc = facing(f.calc_center_median()) if callable(facing) else facing
                    if f.normal.dot(Vector(fc)) < 0:
                        f.normal_flip()
                faces.append(f)
        return faces

    def add_bm(self, other_bm, matrix=None):
        """Append another bmesh (keeps material indices and UVs)."""
        me = bpy.data.meshes.new('_tmp')
        other_bm.to_mesh(me)
        if matrix is not None:
            me.transform(matrix)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def to_object(self, name, collection=None, smooth_angle=35.0, merge=1e-5):
        if merge:
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=merge)
        return bm_to_object(self.bm, name, collection, smooth_angle)


def mark_sharp(bm, smooth_angle=35.0):
    """Smooth faces; edges sharper than smooth_angle and material boundaries become hard edges."""
    lim = math.radians(smooth_angle) if smooth_angle is not None else 10.0
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = True
            continue
        a, b = e.link_faces
        sharp = a.material_index != b.material_index
        if not sharp:
            try:
                sharp = e.calc_face_angle() > lim
            except ValueError:
                sharp = False
        e.smooth = not sharp


def resharpen(ob, smooth_angle=35.0):
    """Re-run mark_sharp on an object's mesh (after booleans added new faces)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    mark_sharp(bm, smooth_angle)
    bm.to_mesh(ob.data)
    bm.free()


def bm_to_object(bm, name, collection=None, smooth_angle=35.0):
    """bmesh -> object with all MATS slots, with mark_sharp() applied (the glTF exporter splits normals
    at hard edges)."""
    mark_sharp(bm, smooth_angle)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    for m in MATS:
        me.materials.append(get_material(m))
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def get_material(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    return m


# ---------------------------------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------------------------------

def box(mb, c, size, mat, uv=None):
    """Axis-aligned box centred at c with size (sx, sy, sz)."""
    cx, cy, cz = c
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    P = [Vector((cx + sx * hx, cy + sy * hy, cz + sz * hz)) for sx, sy, sz in
         [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
    F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]
    for f in F:
        mb.face([P[i] for i in f], mat, [uv] * 4 if uv else None)


def oriented_box(mb, c, ax, ay, az, size, mat, uv=None):
    """Box with local axes ax, ay, az (unit Vectors) and size along them."""
    c = Vector(c)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    P = [c + ax * (sx * hx) + ay * (sy * hy) + az * (sz * hz) for sx, sy, sz in
         [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
    F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]
    for f in F:
        mb.face([P[i] for i in f], mat, [uv] * 4 if uv else None)


def rounded_box(mb, c, size, r, mat, n=2, uv=None):
    """Box with rounded vertical edges only (plan view), cheap: loft of a rounded rectangle."""
    cx, cy, cz = c
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    r = min(r, hx * 0.99, hy * 0.99)
    outline = []
    for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ccx, ccy = cx + qx * (hx - r), cy + qy * (hy - r)
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            outline.append(Vector((ccx + r * math.cos(a), ccy + r * math.sin(a), 0)))
    bot = [Vector((p.x, p.y, cz - hz)) for p in outline]
    top = [Vector((p.x, p.y, cz + hz)) for p in outline]
    mb.grid([[b, t] for b, t in zip(bot, top)], mat, close_u=True,
            UV=[[uv or (0, 0), uv or (0, 0)] for _ in bot] if uv else None)
    mb.face(top, mat, [uv] * len(top) if uv else None)
    mb.face(bot[::-1], mat, [uv] * len(bot) if uv else None)


def cylinder(mb, c, axis, r, length, mat, segs=12, caps=True, uv=None, r2=None):
    """Cylinder (or cone with r2) centred at c along axis ('x','y','z' or Vector)."""
    c = Vector(c)
    a = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}.get(axis, axis)
    a = Vector(a).normalized()
    t = a.orthogonal().normalized()
    b = a.cross(t)
    r2 = r if r2 is None else r2
    ring0, ring1 = [], []
    for i in range(segs):
        ang = 2 * math.pi * i / segs
        d = t * math.cos(ang) + b * math.sin(ang)
        ring0.append(c - a * (length / 2) + d * r)
        ring1.append(c + a * (length / 2) + d * r2)
    G = [[p0, p1] for p0, p1 in zip(ring0, ring1)]
    mb.grid(G, mat, close_u=True, UV=[[uv, uv] for _ in G] if uv else None)
    if caps:
        mb.face(ring1, mat, [uv] * segs if uv else None)
        mb.face(ring0[::-1], mat, [uv] * segs if uv else None)


def sweep(mb, path, profile, mat, up=Vector((0, 0, 1)), closed_profile=True, caps=True, uv=None,
          closed_path=False):
    """Sweep a 2D profile [(a, b)] along a 3D path; a is along the path-normal (side), b along 'up'."""
    path = [Vector(p) for p in path]
    frames = []
    n = len(path)
    for i in range(n):
        if closed_path:
            t = path[(i + 1) % n] - path[i - 1]
        elif i == 0:
            t = path[1] - path[0]
        elif i == n - 1:
            t = path[-1] - path[-2]
        else:
            t = path[i + 1] - path[i - 1]
        t.normalize()
        side = t.cross(Vector(up))
        if side.length < 1e-6:
            side = t.orthogonal()
        side.normalize()
        u2 = side.cross(t).normalized()
        frames.append((side, u2))
    G = []
    for i, p in enumerate(path):
        s, u2 = frames[i]
        G.append([p + s * a + u2 * b for a, b in profile])
    rows = [list(r) for r in G]
    if closed_profile:
        rows = [r + [r[0]] for r in rows]
    mb.grid(rows, mat, close_u=closed_path, UV=[[uv] * len(rows[0]) for _ in rows] if uv else None)
    if caps and closed_profile and not closed_path:
        mb.face(G[-1], mat, [uv] * len(G[-1]) if uv else None)
        mb.face(G[0][::-1], mat, [uv] * len(G[0]) if uv else None)


def circle_profile(r, n=6):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rect_profile(w, h, cx=0.0, cy=0.0):
    return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]


# ---------------------------------------------------------------------------------------------------
# projection of flat patches onto the body (lights, plates, decals, handles, grilles)
# ---------------------------------------------------------------------------------------------------

class Projector:
    def __init__(self, bm):
        self.bvh = BVHTree.FromBMesh(bm)

    def hit(self, p, d, back=1.5):
        d = Vector(d).normalized()
        loc, nor, idx, dist = self.bvh.ray_cast(Vector(p) - d * back, d)
        if loc is None:
            return None, None
        return loc, nor

    def clearance(self, tris, step=0.02):
        """Smallest signed distance above the body surface over a barycentric grid of sample points
        (about every `step` metres) on each of the given triangles."""
        worst = 1e9
        for t in tris:
            e = max((t[0] - t[1]).length, (t[1] - t[2]).length, (t[2] - t[0]).length)
            k = max(2, min(10, math.ceil(e / step)))
            for i in range(k + 1):
                for j in range(k + 1 - i):
                    w0, w1 = i / k, j / k
                    p = t[0] * w0 + t[1] * w1 + t[2] * (1 - w0 - w1)
                    loc, nor, _i, _dist = self.bvh.find_nearest(p)
                    if loc is not None:
                        worst = min(worst, (p - loc).dot(nor))
        return worst

    def patch(self, mb, origin, ax, ay, d, outline, mat, *, offset=0.004, uv_rect=(0, 0, 1, 1), rings=2,
              depth=0.0, bezel=None, flat=0.0, side_mat=None, max_edge=0.12, conform=False, flat_ref=None):
        """Project polygon `outline` [(a, b)] given in the plane (origin, ax, ay) along direction d onto the
        body; builds a filled patch (concentric rings -> centre fan) facing -d. UVs map the outline bbox to
        uv_rect. depth > 0 adds a side wall (lamp body) back into the surface. bezel=(mat, width) adds a
        rim around it. flat in 0..1 flattens the patch towards its mean plane (a lens instead of a decal).
        flat_ref: a body-surface point; with flat, the plane is placed `offset` in front of it instead of in
        front of the patch's own front-most point, so several stacked panes (backing, sticker, glass) share
        one reference and keep their separation."""
        origin, ax, ay, d = Vector(origin), Vector(ax), Vector(ay), Vector(d).normalized()
        facing = -d
        outline0 = outline

        def proj(a, b, off):
            p = origin + ax * a + ay * b
            loc, nor = self.hit(p, d)
            if loc is None:
                return None
            return loc - d * off
        # conform (flat decals only): the patch is a few big triangles between points projected onto a
        # faceted body, so on curved corners a body ridge can pass above a triangle and hide part of the
        # decal (bow-tie fog lamps / vents, torn grille ends). Re-mesh finer (at most twice) until every
        # triangle clears the surface by min(40% of the offset, 1.5 mm); keep the finer mesh only if it clearly helps,
        # then lift what is still buried by at most 2 x offset.
        attempts = 3 if (conform and flat == 0) else 1
        need = min(0.4 * offset, 0.0015)      # >= 1.5 mm above the panel is enough; negative = buried
        best = None
        for attempt in range(attempts):
            ol = resample(outline0, max_edge)
            A = [a for a, b in ol]
            B = [b for a, b in ol]
            c_a, c_b = sum(A) / len(A), sum(B) / len(B)
            r_ab = []
            for r in range(rings + 1):
                s = 1 - r / (rings + 0.5)
                r_ab.append([(c_a + (a - c_a) * s, c_b + (b - c_b) * s) for a, b in ol])
            PP = [[proj(a, b, offset) for a, b in ring] for ring in r_ab]
            cc = proj(c_a, c_b, offset)
            if cc is None or any(p is None for ring in PP for p in ring):
                if best is None:
                    return False
                break
            worst = 1e9
            if attempts > 1:
                nn = len(ol)
                tris = []
                for r in range(rings):
                    for m in range(nn):
                        m2 = (m + 1) % nn
                        tris += [(PP[r][m], PP[r][m2], PP[r + 1][m2]), (PP[r][m], PP[r + 1][m2], PP[r + 1][m])]
                tris += [(PP[rings][m], PP[rings][(m + 1) % nn], cc) for m in range(nn)]
                worst = self.clearance(tris)
                if os.environ.get('VEH_DEBUG_CONFORM'):
                    print(f'conform {mat} attempt {attempt} worst {worst * 1000:.1f} mm n={nn} rings={rings}')
            cand = (worst, ol, r_ab, PP, cc, rings)
            if best is None or worst > best[0] + 0.003:     # finer mesh must gain > 3 mm to be kept
                best = cand
            if worst >= need:
                best = cand
                break
            max_edge = max(0.012, max_edge * 0.5)
            rings = min(5, rings * 2 + 1)
        worst, outline, rings_ab, P, cP, rings = best
        A = [a for a, b in outline]
        B = [b for a, b in outline]
        amin, amax, bmin, bmax = min(A), max(A), min(B), max(B)
        ca, cb = sum(A) / len(A), sum(B) / len(B)
        if attempts > 1 and worst < need:
            nor = self.bvh.find_nearest(cP)[1]
            cosang = abs(facing.dot(nor)) if nor is not None else 1.0
            lift = min(2 * offset, (need - worst) / max(0.3, cosang))
            P = [[p + facing * lift for p in ring] for ring in P]
            cP = cP + facing * lift

        def uvf(a, b):
            u0, v0, u1, v1 = uv_rect
            return (u0 + (u1 - u0) * (a - amin) / max(1e-6, amax - amin),
                    v0 + (v1 - v0) * (b - bmin) / max(1e-6, bmax - bmin))
        if flat > 0:
            allp = [p for ring in P for p in ring] + [cP]
            far = min((p - origin).dot(d) for p in allp)  # front-most point along d
            if flat_ref is not None:
                far = (Vector(flat_ref) - origin).dot(d) - offset
            P = [[p - d * (((p - origin).dot(d) - far) * flat) for p in ring] for ring in P]
            cP = cP - d * (((cP - origin).dot(d) - far) * flat)
        n = len(outline)
        for r in range(rings):
            for m in range(n):
                m2 = (m + 1) % n
                q = [P[r][m], P[r][m2], P[r + 1][m2], P[r + 1][m]]
                uvq = [uvf(*rings_ab[r][m]), uvf(*rings_ab[r][m2]), uvf(*rings_ab[r + 1][m2]), uvf(*rings_ab[r + 1][m])]
                mb.face(q, mat, uvq, facing=facing)
        for m in range(n):
            m2 = (m + 1) % n
            mb.face([P[rings][m], P[rings][m2], cP], mat,
                    [uvf(*rings_ab[rings][m]), uvf(*rings_ab[rings][m2]), uvf(ca, cb)], facing=facing)
        if depth > 0:
            back = [p + d * (depth + offset) for p in P[0]]
            wm = side_mat or (bezel[0] if bezel else mat)
            for m in range(n):
                m2 = (m + 1) % n
                c = sum((P[0][m], P[0][m2]), Vector()) / 2
                cen = sum(P[0], Vector()) / n
                out_dir = (c - cen).normalized()
                mb.face([P[0][m], P[0][m2], back[m2], back[m]], wm, [uvf(*outline[m])] * 4, facing=out_dir)
        if bezel:
            bmat, bw = bezel
            outer = []
            for a, b in outline:
                va, vb = a - ca, b - cb
                ln = math.hypot(va, vb) or 1
                outer.append(proj(a + va / ln * bw, b + vb / ln * bw, offset * 0.5))
            if all(p is not None for p in outer):
                for m in range(n):
                    m2 = (m + 1) % n
                    mb.face([outer[m], outer[m2], P[0][m2], P[0][m]], bmat, facing=facing)
        return True

    def strip(self, mb, pts_ab, origin, ax, ay, d, width, mat, *, offset=0.005, uv_v=(0, 1), uv_u=(0, 1),
              thick=0.0, max_seg=0.25, max_across=0.05):
        """Project a polyline (a, b) as a ribbon of the given width, e.g. chrome strips, slats, livery bands.
        Long segments are resampled (max_seg) and wide ribbons split across (max_across) so the ribbon
        follows curved panels instead of cutting into them."""
        origin, ax, ay, d = Vector(origin), Vector(ax), Vector(ay), Vector(d).normalized()
        facing = -d
        pts_ab = resample(pts_ab, max_seg, closed=False)
        L = [0.0]
        for (a0, b0), (a1, b1) in zip(pts_ab, pts_ab[1:]):
            L.append(L[-1] + math.hypot(a1 - a0, b1 - b0))
        tot = L[-1] or 1
        nx = max(1, math.ceil(width / max_across - 1e-6))
        rows, uvs = [], []
        for i, (a, b) in enumerate(pts_ab):
            if i == 0:
                ta, tb = pts_ab[1][0] - a, pts_ab[1][1] - b
            elif i == len(pts_ab) - 1:
                ta, tb = a - pts_ab[i - 1][0], b - pts_ab[i - 1][1]
            else:
                ta, tb = pts_ab[i + 1][0] - pts_ab[i - 1][0], pts_ab[i + 1][1] - pts_ab[i - 1][1]
            ln = math.hypot(ta, tb) or 1
            na, nb = -tb / ln, ta / ln
            row = []
            u = uv_u[0] + (uv_u[1] - uv_u[0]) * L[i] / tot
            uvrow = []
            for k in range(nx + 1):
                s = -0.5 + k / nx
                p = origin + ax * (a + na * width * s) + ay * (b + nb * width * s)
                loc, nor = self.hit(p, d)
                if loc is None:
                    return False
                row.append(loc - d * offset)
                uvrow.append((u, uv_v[0] + (uv_v[1] - uv_v[0]) * k / nx))
            rows.append(row)
            uvs.append(uvrow)
        top = [[p - d * thick for p in r] for r in rows] if thick > 0 else rows
        for i in range(len(rows) - 1):
            for k in range(nx):
                mb.face([top[i][k], top[i + 1][k], top[i + 1][k + 1], top[i][k + 1]], mat,
                        [uvs[i][k], uvs[i + 1][k], uvs[i + 1][k + 1], uvs[i][k + 1]], facing=facing)
            if thick > 0:
                for k in (0, nx):
                    mid = (rows[i][k] + rows[i + 1][k]) / 2
                    other = (rows[i][nx - k] + rows[i + 1][nx - k]) / 2
                    mb.face([rows[i][k], rows[i + 1][k], top[i + 1][k], top[i][k]], mat, facing=(mid - other))
        return True


def resample(pts, max_len, closed=True):
    """Insert points so that no edge of the polyline/polygon is longer than max_len."""
    if not max_len or len(pts) < 2:
        return list(pts)
    out = []
    n = len(pts)
    m = n if closed else n - 1
    for i in range(m):
        a0, b0 = pts[i]
        a1, b1 = pts[(i + 1) % n]
        k = max(1, math.ceil(math.hypot(a1 - a0, b1 - b0) / max_len - 1e-9))
        for j in range(k):
            t = j / k
            out.append((a0 + (a1 - a0) * t, b0 + (b1 - b0) * t))
    if not closed:
        out.append(tuple(pts[-1]))
    return out


# ---------------------------------------------------------------------------------------------------
# wheels
# ---------------------------------------------------------------------------------------------------

def wheel_mesh(name, *, R, width, rim_r, style='alloy5', segs=32, lod=0, dual=False, collection=None):
    """Wheel centred at the origin, axle along +x (outer face towards +x). Returns object.
    style: alloy5 | alloy6 | alloy10 | steel | steel_cap | truck"""
    mb = MB()
    if lod >= 1:
        segs = 12
    h = R - rim_r
    w2 = width / 2

    def ring_pts(r, x, n=segs):
        return [Vector((x, r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n))) for i in range(n)]
    # tyre profile (radius, x) outer face -> tread -> inner face ; v coordinate for the tyre texture
    if lod == 0:
        prof = [(rim_r - 0.005, w2 * 0.80, 0.0), (rim_r + h * 0.18, w2 * 0.90, 0.06), (rim_r + h * 0.55, w2 * 1.0, 0.16),
                (R - h * 0.16, w2 * 0.97, 0.26), (R - h * 0.03, w2 * 0.88, 0.32), (R, w2 * 0.74, 0.36),
                (R, 0.0, 0.5), (R, -w2 * 0.74, 0.64), (R - h * 0.03, -w2 * 0.88, 0.68), (R - h * 0.16, -w2 * 0.97, 0.74),
                (rim_r + h * 0.55, -w2 * 1.0, 0.84), (rim_r + h * 0.18, -w2 * 0.9, 0.94), (rim_r - 0.005, -w2 * 0.8, 1.0)]
    else:
        prof = [(rim_r, w2 * 0.85, 0.0), (R - h * 0.12, w2, 0.2), (R, w2 * 0.8, 0.35), (R, -w2 * 0.8, 0.65),
                (R - h * 0.12, -w2, 0.8), (rim_r, -w2 * 0.85, 1.0)]
    reps = 12
    G, UV = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ca, sa = math.cos(a), math.sin(a)
        G.append([Vector((x, r * ca, r * sa)) for r, x, v in prof])
        UV.append([(i / segs * reps, v) for r, x, v in prof])
    # Winding: angle a runs counter-clockwise seen from +x, so a quad (a -> a+da, then along the profile)
    # faces +x on a flat ring and INWARD on the tread; flip=True makes the tyre face outwards.
    # (Reviewer fix: the tyre, rim face, lip and barrel were all inside-out, so three.js back-face culling
    # showed the inside of the far tyre wall and an empty black wheel.)
    mb.grid(G, 'tyre', UV=UV, close_u=True, flip=True)

    def dual_tyre():
        # inner dual tyre directly behind (towards -x)
        G2 = [[p - Vector((width * 1.05, 0, 0)) for p in row] for row in G]
        mb.grid(G2, 'tyre', UV=UV, close_u=True, flip=True)
    # rim
    xr = w2 * 0.80  # outer bead plane
    face_x = xr - 0.025 if style.startswith('alloy') else xr - 0.045
    if lod >= 1:
        # simple dished disc
        outer = ring_pts(rim_r - 0.005, xr)
        inner = ring_pts(rim_r * 0.9, face_x)
        mb.grid([[o, n] for o, n in zip(outer, inner)], 'rim', close_u=True)
        mb.face(inner, 'rim')                      # faces +x (outwards)
        back = ring_pts(rim_r - 0.005, -w2 * 0.8)
        mb.face(back[::-1], 'trim')                # closes the inner side, faces -x (towards the car)
        if dual:
            dual_tyre()
        ob = mb.to_object(name, collection, smooth_angle=50)
        return ob
    # lip + barrel
    lip_o = ring_pts(rim_r + 0.012, xr + 0.004)
    lip_i = ring_pts(rim_r - 0.008, xr + 0.006)
    barrel = ring_pts(rim_r - 0.012, xr - 0.02)
    mb.grid([[a, b, c] for a, b, c in zip(lip_o, lip_i, barrel)], 'rim', close_u=True)   # lip +x, barrel inwards
    # dark back disc (brake / inside of the wheel)
    back_r = ring_pts(rim_r - 0.012, face_x - 0.07)
    mb.grid([[a, b] for a, b in zip(barrel, back_r)], 'trim', close_u=True)              # inner barrel, inwards
    mb.face(back_r, 'trim')                                                               # faces +x
    # close the inner bead opening (seen from under / across the car), faces -x
    mb.face(ring_pts(rim_r - 0.005, -w2 * 0.8)[::-1], 'trim')
    # face with spokes: polar grid, windows removed
    nsp = {'alloy5': 5, 'alloy6': 6, 'alloy10': 10, 'steel': 8, 'steel_cap': 8, 'truck': 10}[style]
    fsegs = nsp * (6 if nsp <= 6 else 3)
    radii = [0.0, rim_r * 0.18, rim_r * 0.30, rim_r * 0.55, rim_r * 0.80, rim_r - 0.012]
    if style.startswith('steel') or style == 'truck':
        # steel disc: dish depth profile, small round-ish vent holes near the rim
        dish = [0.012, 0.012, 0.0, -0.02, -0.035, -0.02]
    else:
        dish = [0.004, 0.004, 0.0, -0.008, -0.015, -0.02]
    rows = []
    for ri, r in enumerate(radii):
        row = []
        for i in range(fsegs):
            a = 2 * math.pi * (i + 0.5) / fsegs
            row.append(Vector((face_x + dish[ri], r * math.cos(a), r * math.sin(a))))
        rows.append(row)
    vs = [[mb.bm.verts.new(p) for p in row] for row in rows[1:]]
    centre = mb.bm.verts.new(Vector((face_x + dish[0] + 0.004, 0, 0)))
    per = fsegs // nsp
    for i in range(fsegs):
        i2 = (i + 1) % fsegs
        f = mb.bm.faces.new([centre, vs[0][i], vs[0][i2]])
        f.material_index = MI['chrome' if style == 'steel_cap' else 'rim']
        for ri in range(len(vs) - 1):
            # window region: middle ring bands, between spokes
            pos = i % per
            if style.startswith('alloy'):
                window = ri in (2, 3) and pos not in (0, per - 1) if per >= 3 else (ri in (2, 3) and pos == 1)
                if nsp >= 10:
                    window = ri in (2, 3) and pos == 1
            else:
                window = ri == 3 and pos == 1
            if window:
                continue
            q = [vs[ri][i], vs[ri + 1][i], vs[ri + 1][i2], vs[ri][i2]]
            f = mb.bm.faces.new(q)                # counter-clockwise seen from +x: faces outwards
            f.material_index = MI['rim']
            if style == 'steel_cap' and ri <= 2:
                f.material_index = MI['chrome']
    # connect face outer ring to barrel
    outer = vs[-1]
    bar = [mb.bm.verts.new(Vector((xr - 0.02, (rim_r - 0.012) * math.cos(2 * math.pi * (i + 0.5) / fsegs),
                                   (rim_r - 0.012) * math.sin(2 * math.pi * (i + 0.5) / fsegs)))) for i in range(fsegs)]
    for i in range(fsegs):
        i2 = (i + 1) % fsegs
        f = mb.bm.faces.new([outer[i], outer[i2], bar[i2], bar[i]][::-1])
        f.material_index = MI['rim']
    # lug nuts / centre cap
    if style != 'steel_cap':
        nl = 5 if style.startswith('alloy') else 6
        for i in range(nl):
            a = 2 * math.pi * i / nl
            cylinder(mb, (face_x + 0.012, rim_r * 0.24 * math.cos(a), rim_r * 0.24 * math.sin(a)), 'x', 0.011, 0.02,
                     'chrome', segs=6)
        cylinder(mb, (face_x + 0.01, 0, 0), 'x', rim_r * 0.12, 0.02, 'chrome' if style.startswith('alloy') else 'trim', segs=10)
    if dual:
        dual_tyre()
    ob = mb.to_object(name, collection, smooth_angle=40)
    return ob


# ---------------------------------------------------------------------------------------------------
# misc
# ---------------------------------------------------------------------------------------------------

def boolean(ob, cutter, op='DIFFERENCE'):
    mod = ob.modifiers.new('bool', 'BOOLEAN')
    mod.operation = op
    mod.object = cutter
    mod.solver = 'EXACT'
    try:
        mod.material_mode = 'TRANSFER'
    except Exception:
        pass
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    ob.modifiers.remove(mod)
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
