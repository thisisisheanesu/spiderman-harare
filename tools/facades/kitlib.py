"""Mesh-building helpers for the Harare facade kit (runs inside Blender's Python, bpy 4.2+/5).

Module space (Blender, Z up): x = along the wall to the right seen from the street, z = up, y = INTO the
building. The wall plane (footprint line) is y = 0; outward projections have y < 0, recesses y > 0. The glTF
exporter turns this into the kit convention: x right, y up, +z outward (towards the street).

Every face gets UV0 in metres (world-aligned box projection, so tiling PBR materials from public/textures
line up across faces) unless the caller passes explicit UVs. Glass faces also get UV1 = room coordinates for
interior mapping (u = room index * 2 + 0..1 across the room, v = 0..1 floor to ceiling).
"""
import math

# Material roles. Tintable roles are re-coloured per building (kit.json -> types[t].materials).
ROLES = ['wall', 'trim', 'accent', 'plinth', 'frame', 'glass', 'glass_spandrel', 'metal', 'roof_sheet', 'sign']
TINTABLE = {'wall': 0, 'trim': 1, 'accent': 2}  # -> channel of the atlas mask texture


class MB:
    """Accumulates polygons (with per-corner UVs and a material role) and turns them into a Blender mesh."""

    def __init__(self):
        self.verts = []
        self.vindex = {}
        self.faces = []  # (vertex ids, role, uv0 list, uv1 list or None, smooth)

    def _v(self, p):
        key = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
        i = self.vindex.get(key)
        if i is None:
            i = len(self.verts)
            self.verts.append(key)
            self.vindex[key] = i
        return i

    @staticmethod
    def normal(pts):
        nx = ny = nz = 0.0
        n = len(pts)
        for i in range(n):
            x0, y0, z0 = pts[i]
            x1, y1, z1 = pts[(i + 1) % n]
            nx += (y0 - y1) * (z0 + z1)
            ny += (z0 - z1) * (x0 + x1)
            nz += (x0 - x1) * (y0 + y1)
        ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        return (nx / ln, ny / ln, nz / ln)

    @staticmethod
    def auto_uv(pts, n):
        ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
        if ay >= ax and ay >= az:
            return [((p[0] if n[1] < 0 else -p[0]), p[2]) for p in pts]
        if ax >= ay and ax >= az:
            return [((-p[1] if n[0] < 0 else p[1]), p[2]) for p in pts]
        return [(p[0], (-p[1] if n[2] > 0 else p[1])) for p in pts]

    def poly(self, pts, role, uv0=None, uv1=None, smooth=False):
        if len(pts) < 3:
            return
        n = self.normal(pts)
        if uv0 is None:
            uv0 = self.auto_uv(pts, n)
        ids = [self._v(p) for p in pts]
        # drop degenerate (repeated) corners
        seen, keep = set(), []
        for k, i in enumerate(ids):
            if i not in seen:
                seen.add(i)
                keep.append(k)
        if len(keep) < 3:
            return
        self.faces.append(([ids[k] for k in keep], role, [uv0[k] for k in keep], [uv1[k] for k in keep] if uv1 else None, smooth))

    # --- boxes -------------------------------------------------------------------------------------------
    def box(self, x0, x1, y0, y1, z0, z1, role, faces='fblrtd', uv_off=(0.0, 0.0)):
        """Axis-aligned box. y0 < y1 (y0 is the street side). faces: f=front(-y) b=back l r t=top d=bottom."""
        if x1 - x0 < 1e-5 or y1 - y0 < 1e-5 or z1 - z0 < 1e-5:
            return
        F = {
            'f': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            'b': [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
            'l': [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
            'r': [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
            't': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
            'd': [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
        }
        for k in faces:
            self.poly(F[k], role)

    def prism(self, base, z0, z1, role, caps=True, smooth=False):
        """Vertical prism from a polygon base [(x, y)] (either winding; made CCW seen from above)."""
        area = sum(base[i][0] * base[(i + 1) % len(base)][1] - base[(i + 1) % len(base)][0] * base[i][1] for i in range(len(base)))
        if area < 0:
            base = list(reversed(base))
        n = len(base)
        for i in range(n):
            (ax, ay), (bx, by) = base[i], base[(i + 1) % n]
            self.poly([(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)], role, smooth=smooth)
        if caps:
            self.poly([(x, y, z1) for x, y in base], role)
            self.poly([(x, y, z0) for x, y in reversed(base)], role)

    def cyl(self, cx, cy, z0, z1, r, n, role, caps=True, smooth=True):
        base = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        # cylinder UVs: u around the circumference (metres), v = z
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            p = [(cx + r * math.cos(a0), cy + r * math.sin(a0)), (cx + r * math.cos(a1), cy + r * math.sin(a1))]
            u0, u1 = r * a0, r * a1
            self.poly([(p[0][0], p[0][1], z0), (p[1][0], p[1][1], z0), (p[1][0], p[1][1], z1), (p[0][0], p[0][1], z1)],
                      role, uv0=[(u0, z0), (u1, z0), (u1, z1), (u0, z1)], smooth=smooth)
        if caps:
            self.poly([(x, y, z1) for x, y in base], role)
            self.poly([(x, y, z0) for x, y in reversed(base)], role)

    def lathe(self, cx, cy, profile, n, role, cap_top=True, cap_bottom=False):
        """Surface of revolution about a vertical axis: profile = [(radius, z)] from bottom to top."""
        rings = []
        for r, z in profile:
            rings.append([(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), z) for i in range(n)])
        acc = [0.0]
        for k in range(1, len(profile)):
            dr = profile[k][0] - profile[k - 1][0]
            dz = profile[k][1] - profile[k - 1][1]
            acc.append(acc[-1] + math.hypot(dr, dz))
        for k in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                a0 = 2 * math.pi * i / n
                a1 = 2 * math.pi * (i + 1) / n
                r0, r1 = max(profile[k][0], 0.02), max(profile[k + 1][0], 0.02)
                uv = [(r0 * a0, acc[k]), (r0 * a1, acc[k]), (r1 * a1, acc[k + 1]), (r1 * a0, acc[k + 1])]
                self.poly([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], role, uv0=uv, smooth=True)
        if cap_top:
            self.poly(rings[-1], role)
        if cap_bottom:
            self.poly(list(reversed(rings[0])), role)

    # --- walls, openings, windows --------------------------------------------------------------------------
    def wall(self, x0, x1, z0, z1, y, holes, role):
        """Front-facing (normal -y) rectangle at depth y with rectangular holes [(hx0, hx1, hz0, hz1)]."""
        xs = sorted({x0, x1, *[h[0] for h in holes], *[h[1] for h in holes]})
        zs = sorted({z0, z1, *[h[2] for h in holes], *[h[3] for h in holes]})
        xs = [x for x in xs if x0 - 1e-6 <= x <= x1 + 1e-6]
        zs = [z for z in zs if z0 - 1e-6 <= z <= z1 + 1e-6]
        for j in range(len(zs) - 1):
            za, zb = zs[j], zs[j + 1]
            run = None
            for i in range(len(xs) - 1):
                xa, xb = xs[i], xs[i + 1]
                cx, cz = (xa + xb) / 2, (za + zb) / 2
                inside = any(h[0] < cx < h[1] and h[2] < cz < h[3] for h in holes)
                if not inside:
                    run = (run[0], xb) if run else (xa, xb)
                if inside or i == len(xs) - 2:
                    if run:
                        self.poly([(run[0], y, za), (run[1], y, za), (run[1], y, zb), (run[0], y, zb)], role)
                        run = None

    def reveal(self, x0, x1, z0, z1, yf, yb, role, sides='lrtb', sill_role=None):
        """Inner faces of a rectangular opening from the wall face yf back to yb (yb > yf)."""
        if yb - yf < 1e-5:
            return
        if 'l' in sides:
            self.poly([(x0, yf, z0), (x0, yb, z0), (x0, yb, z1), (x0, yf, z1)], role)
        if 'r' in sides:
            self.poly([(x1, yb, z0), (x1, yf, z0), (x1, yf, z1), (x1, yb, z1)], role)
        if 't' in sides:
            self.poly([(x0, yb, z1), (x1, yb, z1), (x1, yf, z1), (x0, yf, z1)], role)
        if 'b' in sides:
            self.poly([(x0, yf, z0), (x1, yf, z0), (x1, yb, z0), (x0, yb, z0)], sill_role or role)

    def glass(self, x0, x1, z0, z1, y, room, role='glass'):
        """Glass pane facing the street. room = (rx0, rw, rz0, rh, index): the room rectangle behind it."""
        rx0, rw, rz0, rh, idx = room
        pts = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
        uv1 = [(idx * 2 + (p[0] - rx0) / rw, (p[2] - rz0) / rh) for p in pts]
        self.poly(pts, role, uv1=uv1 if role == 'glass' else None)

    def frame(self, x0, x1, z0, z1, y, t=0.05, d=0.06, mull=(), trans=(), role='frame', outer=True, bar=None):
        """Window frame in front of glass at depth y: perimeter (outer) + mullions (x) + transoms (z).
        Bars are boxes of face width t (bar for glazing bars) and depth d, front at y - d."""
        bar = bar or t
        yf = y - d
        if outer:
            self.box(x0, x1, yf, y, z0, z0 + t, role, 'ft')        # bottom rail
            self.box(x0, x1, yf, y, z1 - t, z1, role, 'fd')        # head
            self.box(x0, x0 + t, yf, y, z0 + t, z1 - t, role, 'fr')  # left jamb
            self.box(x1 - t, x1, yf, y, z0 + t, z1 - t, role, 'fl')  # right jamb
        zi0, zi1 = z0 + (t if outer else 0), z1 - (t if outer else 0)
        xi0, xi1 = x0 + (t if outer else 0), x1 - (t if outer else 0)
        for mx in mull:
            self.box(mx - bar / 2, mx + bar / 2, yf, y, zi0, zi1, role, 'flr')
        for tz in trans:
            self.box(xi0, xi1, yf + 0.004, y, tz - bar / 2, tz + bar / 2, role, 'ftd')

    def window(self, x0, x1, z0, z1, wall_y, glass_y, room, wall_role, frame_role='frame', t=0.05, d=0.05,
               mull=(), trans=(), sill=None, reveal_sides='lrtb', sill_role=None, bar=None):
        """A punched opening: reveal (wall_y -> glass_y), frame and glass. sill = (proj, thick, ext, role)."""
        self.reveal(x0, x1, z0, z1, wall_y, glass_y, wall_role, reveal_sides, sill_role=sill_role)
        self.frame(x0, x1, z0, z1, glass_y, t, d, mull, trans, frame_role, bar=bar)
        self.glass(x0, x1, z0, z1, glass_y, room)
        if sill:
            proj, thick, ext, srole = sill
            self.box(x0 - ext, x1 + ext, wall_y - proj, wall_y + 0.001, z0 - thick, z0, srole, 'fltrd')

    # --- output --------------------------------------------------------------------------------------------
    def to_mesh(self, name, materials):
        """materials: dict role -> bpy material. Returns a bpy mesh with UVMap (metres) and 'room' UV layers."""
        import bmesh
        import bpy
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bv = [bm.verts.new(v) for v in self.verts]
        uv0 = bm.loops.layers.uv.new('UVMap')
        uv1 = bm.loops.layers.uv.new('room')
        roles = []
        for ids, role, u0, u1, smooth in self.faces:
            try:
                f = bm.faces.new([bv[i] for i in ids])
            except ValueError:
                # duplicate face (same vertex set twice): offset-free fallback, keep going
                continue
            if role not in roles:
                roles.append(role)
            f.material_index = roles.index(role)
            f.smooth = smooth
            for k, loop in enumerate(f.loops):
                loop[uv0].uv = u0[k]
                loop[uv1].uv = u1[k] if u1 else (0.0, 0.0)
        bm.to_mesh(me)
        bm.free()
        for r in roles:
            me.materials.append(materials[r])
        return me

    def tris(self):
        return sum(len(f[0]) - 2 for f in self.faces)


def arch_points(cx, z_spring, r, n=10, start=math.pi, end=0.0):
    """Points of a semicircular arch (x, z) from angle start to end."""
    return [(cx + r * math.cos(start + (end - start) * i / n), z_spring + r * math.sin(start + (end - start) * i / n)) for i in range(n + 1)]
