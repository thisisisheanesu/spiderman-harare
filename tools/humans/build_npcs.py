# Builds the NPC variants (npc_variants.py): MakeHuman bodies + CC0/CC-BY clothes via MPFB with the
# game_engine rig, recoloured with the streetlife.js palettes, decimated, joined into one mesh with
# a single 1K texture atlas, exported as npc_<id>.glb (LOD0) and npc_<id>_lod1.glb.
#
#   python build_npcs.py [variant_id ...]
import sys, os, math, time, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
import mh_common as C
import npc_atlas as NA
import uvraster as UR
from npc_variants import VARIANTS, LAYER_Z

OUT = os.path.join(C.SCRATCH, 'npcs')
os.makedirs(OUT, exist_ok=True)
UD = os.path.expanduser('~/.config/blender/5.0/extensions/.user/user_default/mpfb/data')
ATLAS = int(os.environ.get('NPC_ATLAS', '1024'))
LOD1_TRIS = 2000
LOD0_CAP = 9800   # (+ up to ~900 for a head wrap)
LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)

BUDGET = dict(body=4300, clothes=2600, shoes=700, hat=900, hair=1600, eyes=400, headwrap=900)


def asset_rel(kind, name):
    fs = sorted(glob.glob(os.path.join(UD, kind, name, '*.mhclo')))
    if not fs:
        raise FileNotFoundError(f'{kind}/{name}')
    return os.path.relpath(fs[0], os.path.join(UD, kind))


def mhmat_diffuse(kind, asset):
    for mm in sorted(glob.glob(os.path.join(UD, kind, asset, '*.mhmat'))):
        for line in open(mm, encoding='utf-8', errors='ignore'):
            parts = line.split()
            if len(parts) >= 2 and parts[0] == 'diffuseTexture':
                p = os.path.join(os.path.dirname(mm), os.path.basename(parts[1]))
                if os.path.exists(p):
                    return p
    return None


def zdepth(o):
    tag = o.name.split('.', 1)[1]
    if tag in LAYER_Z:
        return float(LAYER_Z[tag])
    for f in glob.glob(os.path.join(UD, 'clothes', '*', tag + '.mhclo')):
        for line in open(f, encoding='utf-8', errors='ignore'):
            if line.startswith('z_depth'):
                return float(line.split()[1])
    return 50.0


def white_img():
    a = np.ones((4, 4, 4), np.float32)
    return a


def decimate(o, target):
    tris = C.mesh_tris(o)
    if tris <= target:
        return
    md = o.modifiers.new('dec', 'DECIMATE')
    md.ratio = target / tris
    md.use_collapse_triangulate = True
    with bpy.context.temp_override(object=o, active_object=o):
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
    C._apply_modifier(o, 'dec')


def vg_weights(o, names):
    idx = {o.vertex_groups[n].index for n in names if n in o.vertex_groups}
    w = np.zeros(len(o.data.vertices), np.float32)
    for v in o.data.vertices:
        for g in v.groups:
            if g.group in idx:
                w[v.index] += g.weight
    return np.clip(w, 0, 1)


# ------------------------------------------------------------------ recolour rules
def lum(rgb):
    return rgb @ LUMW


def detail_from(src, flat_lum=None, k=0.85):
    L = lum(src[:, :3]) if flat_lum is None else flat_lum
    m = max(float(np.mean(L)), 1e-4)
    return np.clip((L / m) ** k, 0.25, 1.8)[:, None]


def kmeans_classes(rgb, k, iters=10):
    L = lum(rgb)
    qs = np.quantile(L, np.linspace(0.1, 0.9, k))
    cent = np.array([rgb[np.argmin(np.abs(L - q))] for q in qs])
    for _ in range(iters):
        d = ((rgb[:, None, :] - cent[None]) ** 2).sum(2)
        lab = d.argmin(1)
        for j in range(k):
            if (lab == j).any():
                cent[j] = rgb[lab == j].mean(0)
    order = np.argsort(lum(cent))
    rank = np.empty(k, int); rank[order] = np.arange(k)
    return rank[lab], cent


def hash_noise(P, scale):
    q = np.floor(P / scale).astype(np.int64)
    h = (q[:, 0] * 73856093) ^ (q[:, 1] * 19349663) ^ (q[:, 2] * 83492791)
    return ((h & 0xffff) / 65535.0).astype(np.float32)


def pattern(kind, cols, uv, P=None, cell=0.11):
    cols = [NA.hex2lin(c) for c in cols]
    if P is not None:
        # 3D cylindrical coordinates around the body axis: motif size constant in metres
        ang = np.arctan2(P[:, 0], P[:, 1])
        u, v = ang * 0.17 / cell, P[:, 2] / cell
    else:
        u, v = uv[:, 0] * 9.0, uv[:, 1] * 9.0
    if kind == 'check':
        a = (np.floor(u * 2) % 2); b = (np.floor(v * 2) % 2)
        t = (a + b) / 2
        return np.outer(1 - t, cols[0]) + np.outer(t, cols[1])
    if kind == 'stripe':
        t = (np.floor(u * 3) % 2)
        return np.outer(1 - t, cols[0]) + np.outer(t, cols[1])
    # 'wax': bold circles-and-diamonds wax print, 3 colours
    fu, fv = u % 1.0 - 0.5, v % 1.0 - 0.5
    r = np.sqrt(fu * fu + fv * fv)
    ring = (np.abs(r - 0.32) < 0.07)
    dot = r < 0.13
    dia = (np.abs(fu) + np.abs(fv)) > 0.62
    out = np.tile(cols[0], (len(u), 1))
    out[ring | dia] = cols[1]
    out[dot] = cols[2]
    return out


def make_rule(spec, part, env):
    kind = spec[0]
    if kind == 'keep':
        return lambda c: c['src'][:, :3]
    if kind == 'tint':
        target = NA.hex2lin(spec[1]); flat = len(spec) > 2 and spec[2]
        def r(c):
            fl = NA.sample(part['blur'], c['uv'])[:, 0] if flat else None
            return target[None] * detail_from(c['src'], fl)
        return r
    if kind == 'classes':
        targets = [NA.hex2lin(h) for h in spec[1]]
        def r(c):
            lab, cent = kmeans_classes(c['src'][:, :3], len(targets))
            L = lum(c['src'][:, :3])
            out = np.zeros((len(L), 3), np.float32)
            for j, t in enumerate(targets):
                m = lab == j
                if m.any():
                    d = np.clip((L[m] / max(L[m].mean(), 1e-4)) ** 0.85, 0.3, 1.7)
                    out[m] = t[None] * d[:, None]
            return out
        return r
    if kind == 'split':
        zc = spec[1] * env['height']
        ra = make_rule(spec[2], part, env); rb = make_rule(spec[3], part, env)
        def r(c):
            a = c['P'][:, 2] >= zc
            out = np.zeros((len(a), 3), np.float32)
            for m, rr in ((a, ra), (~a, rb)):
                if m.any():
                    sub = {k: (v[m] if isinstance(v, np.ndarray) else v) for k, v in c.items()}
                    out[m] = rr(sub)
            return out
        return r
    if kind == 'tie':
        shirt = make_rule(('tint', spec[1], True), part, env)
        tie = NA.hex2lin(spec[2]); H = env['height']
        def r(c):
            out = shirt(c)
            P = c['P']
            z0, z1 = 0.815 * H, 0.585 * H
            t = np.clip((z0 - P[:, 2]) / (z0 - z1), 0, 1)
            hw = 0.011 + 0.028 * np.sqrt(t)
            tipw = np.clip((P[:, 2] - z1) / 0.04, 0, 1)   # pointed tip
            m = (P[:, 1] > 0.03) & (P[:, 2] < z0 + 0.005) & (P[:, 2] > z1) & (np.abs(P[:, 0]) < hw * np.maximum(tipw, 0.15))
            out[m] = tie[None] * detail_from(c['src'][m], None, 0.4)
            return out
        return r
    if kind == 'pattern':
        def r(c):
            base = pattern(spec[1], spec[2], c['uv'], c['P'])
            return base * detail_from(c['src'], None, 0.35)
        return r
    raise ValueError(kind)


def body_rule(v, part, env):
    skin_hex = v['skin'][1]
    target = NA.hex2lin(skin_hex)
    hair = v.get('hair', ('crop', '#0e0b0a'))
    beard = v.get('beard')
    socks = v.get('socks')
    eyes = env['eyes']
    ez = float(np.mean([e[2] for e in eyes])); ey = float(np.mean([e[1] for e in eyes]))

    def r(c):
        src = c['src'][:, :3]
        scalp = c['V'][:, 0]; headw = c['V'][:, 1]
        P = c['P']
        skin_m = (scalp < 0.2)
        mean = src[skin_m].mean(0) if skin_m.any() else src.mean(0)
        out = src * (target / np.maximum(mean, 1e-4))[None]
        # hair painted on the scalp
        style, hcol = hair
        if style not in ('bald', 'none') and hcol:
            hc = NA.hex2lin(hcol)
            n1 = hash_noise(P, 0.0025); n2 = hash_noise(P + 7.0, 0.006)
            tone = (0.75 + 0.35 * n1 + 0.2 * n2)[:, None]
            m = np.clip((scalp - 0.2) / 0.45, 0, 1)
            if style == 'shaved':
                m = m * 0.5
            elif style == 'cornrows':
                rows = 0.5 + 0.5 * np.cos(2 * np.pi * P[:, 0] / 0.017)
                m = m * np.clip(0.35 + 0.75 * rows, 0, 1)
            else:
                m = m * 0.95
            out = out * (1 - m[:, None]) + hc[None] * tone * m[:, None]
        if beard:
            style, bcol = beard
            bc = NA.hex2lin(bcol)
            front = P[:, 1] > ey - 0.075
            zlo, zhi = ez - 0.135, ez - 0.035
            band = np.clip((P[:, 2] - zlo) / 0.015, 0, 1) * np.clip((zhi - P[:, 2]) / 0.02, 0, 1)
            side = np.clip((np.abs(P[:, 0]) - 0.0) / 0.01, 0, 1)
            lips = (np.abs(P[:, 0]) < 0.026) & (np.abs(P[:, 2] - (ez - 0.072)) < 0.011) & (P[:, 1] > ey - 0.01)
            m = band * front * (headw > 0.3) * (~lips)
            n1 = hash_noise(P, 0.0018)
            a = (0.45 if style == 'stubble' else 0.92) * (0.6 + 0.6 * n1)
            m = np.clip(m * a, 0, 1)
            out = out * (1 - m[:, None]) + bc[None] * m[:, None]
        if socks:
            scol, top = socks
            sc = NA.hex2lin(scol)
            m = np.clip((top * env['height'] - P[:, 2]) / 0.01, 0, 1) * (P[:, 2] > 0.02)
            out = out * (1 - m[:, None]) + sc[None] * detail_from(c['src'], None, 0.3) * m[:, None]
        return out
    return r


def headwrap_rule(spec):
    kind, cols = spec
    def r(c):
        P = c['P']
        # fold shading: low-frequency ridges around the head
        folds = 0.85 + 0.15 * np.sin(P[:, 2] * 180 + np.sin(P[:, 0] * 60) * 2)
        if kind == 'solid':
            base = np.tile(NA.hex2lin(cols[0]), (len(P), 1))
        else:
            base = pattern('wax', cols, c['uv'], c['P'] * np.array([1, 1, 1.0]) + np.array([0, 0.09, 0]), cell=0.045)
        return base * folds[:, None]
    return r


# ------------------------------------------------------------------ head wrap geometry
def make_headwrap(body, arm, eyes):
    """dhuku: a shell over the upper head (forehead to nape) with a knot on the top-back."""
    me = body.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(n * 3, np.float32); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    headw = vg_weights(body, ['head'])
    ez = float(np.mean([e[2] for e in eyes])); ey = float(np.mean([e[1] for e in eyes]))
    # cut plane: 2.2 cm above the eyes at the forehead, dropping to 5 cm below eye level at the nape
    zcut = lambda y: ez + 0.024 - (ey - y) * 0.42
    keep = (headw > 0.6) & (co[:, 2] > zcut(co[:, 1]))
    bm = bmesh.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    faces = [f for f in bm.faces if all(keep[v.index] for v in f.verts)]
    geom_del = [f for f in bm.faces if f not in set(faces)]
    bmesh.ops.delete(bm, geom=geom_del, context='FACES')
    top = np.array([0.0, ey - 0.075, ez + 0.10])
    bm.verts.ensure_lookup_table(); bm.verts.index_update()
    edge = {v.index for e in bm.edges if e.is_boundary for v in e.verts}
    # distance (in rings) from the open edge: the fabric is tucked tight at the edge
    ring = {i: 0 for i in edge}
    frontier = set(edge)
    for k in range(1, 4):
        nxt = set()
        for vi in frontier:
            for e in bm.verts[vi].link_edges:
                o = e.other_vert(bm.verts[vi]).index
                if o not in ring:
                    ring[o] = k; nxt.add(o)
        frontier = nxt
    for v in bm.verts:
        p = np.array(v.co)
        nn = np.array(v.normal)
        d = np.linalg.norm(p - top)
        bump = 0.05 * math.exp(-(d / 0.055) ** 2)
        puff = 0.03 * min(max((p[2] - ez) / 0.12, 0.0), 1.0)
        tuck = min(ring.get(v.index, 4), 4) / 4.0
        v.co = Vector(p + nn * (0.003 + tuck * (0.010 + bump + puff)))
    for _ in range(3):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for lay in list(bm.verts.layers.deform.values()):
        bm.verts.layers.deform.remove(lay)
    wrap = bpy.data.meshes.new('headwrap')
    bm.to_mesh(wrap); bm.free()
    o = bpy.data.objects.new(body.name.split('.')[0] + '.headwrap', wrap)
    bpy.context.scene.collection.objects.link(o)
    # simple cylindrical UVs
    while len(wrap.uv_layers):
        wrap.uv_layers.remove(wrap.uv_layers[0])
    wrap.uv_layers.new(name='UVMap')
    uvl = wrap.uv_layers[0]
    for lp in wrap.loops:
        p = wrap.vertices[lp.vertex_index].co
        a = math.atan2(p.x, p.y - (ey - 0.09))
        uvl.data[lp.index].uv = (a / (2 * math.pi) + 0.5, (p.z - ez) * 4 + 0.5)
    # rig: follow the head bone
    for vg in list(o.vertex_groups):
        o.vertex_groups.remove(vg)
    g = o.vertex_groups.new(name='head')
    g.add(list(range(len(wrap.vertices))), 1.0, 'REPLACE')
    o.parent = arm
    mod = o.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    for p in wrap.polygons:
        p.use_smooth = True
    return o


def bone_segments(arm):
    """(B,2,3) deform-bone segments in armature space (head -> tail)"""
    return np.array([[tuple(b.head_local), tuple(b.tail_local)] for b in arm.data.bones], np.float64)


def nearest_bone(co, segs):
    """index of the geometrically nearest bone segment for each point"""
    A, B = segs[:, 0], segs[:, 1]
    AB = B - A
    out = np.empty(len(co), np.int64)
    for s0 in range(0, len(co), 4096):
        P = co[s0:s0 + 4096]
        t = np.clip(((P[:, None, :] - A[None]) * AB[None]).sum(2) / np.maximum((AB * AB).sum(1), 1e-9)[None], 0, 1)
        d2 = ((P[:, None, :] - (A[None] + t[..., None] * AB[None])) ** 2).sum(2)
        out[s0:s0 + 4096] = d2.argmin(1)
    return out


def bone_related(arm):
    """(B,B) bool: may a vertex near bone i be tucked under / re-skinned to an outer surface near
    bone j? Anything within the torso, anything within one limb, a limb with its root (clavicle for
    an arm, pelvis / spine_01 for a thigh) and thigh with thigh (skirts span both legs). Never an
    arm into the torso or into the other arm."""
    bones = [b.name for b in arm.data.bones]
    FING = ('thumb', 'index', 'middle', 'ring', 'pinky')

    def limb(nm):
        base, _, sd = nm.rpartition('_')
        if sd in ('l', 'r'):
            b0 = base.split('_')[0]
            if b0 in ('upperarm', 'lowerarm', 'hand') or b0 in FING:
                return 'arm_' + sd
            if b0 in ('thigh', 'calf', 'foot', 'ball'):
                return 'leg_' + sd
        return 'torso'
    L = [limb(b) for b in bones]
    n = len(bones)
    R = np.zeros((n, n), bool)
    for i in range(n):
        for j in range(n):
            a, b = L[i], L[j]
            if a == b:
                R[i, j] = True
            elif {a, b} == {'leg_l', 'leg_r'}:
                R[i, j] = bones[i].startswith('thigh') and bones[j].startswith('thigh')
            elif 'torso' in (a, b):
                limb_b, tor_b = (bones[i], bones[j]) if a != 'torso' else (bones[j], bones[i])
                lim = a if a != 'torso' else b
                if lim.startswith('arm'):
                    R[i, j] = limb_b.startswith('upperarm') and tor_b == 'clavicle_' + lim[-1]
                else:
                    R[i, j] = limb_b.startswith('thigh') and tor_b in ('pelvis', 'spine_01')
    return R


def outward(co, nr, segs):
    """Orient vertex normals away from the skeleton: garments are not guaranteed to have consistent
    normals, the direction from the nearest bone segment is."""
    A, B = segs[:, 0], segs[:, 1]
    AB = B - A
    out = nr.copy()
    for s0 in range(0, len(co), 4096):
        P = co[s0:s0 + 4096]
        t = np.clip(((P[:, None, :] - A[None]) * AB[None]).sum(2) / np.maximum((AB * AB).sum(1), 1e-9)[None], 0, 1)
        Q = A[None] + t[..., None] * AB[None]
        d2 = ((P[:, None, :] - Q) ** 2).sum(2)
        j = d2.argmin(1)
        rad = P - Q[np.arange(len(P)), j]
        flip = (rad * nr[s0:s0 + 4096]).sum(1) < 0
        out[s0:s0 + 4096][flip] *= -1
    return out


def resolve_layers(obj, arm, layer, margin=0.005, reach=0.06, body_reach=0.06, match_weights=True):
    """Layered clothes on a single (joined, decimated) mesh: `layer` (V,) is each vertex's stacking
    rank (-1 = ignore, e.g. eyes; body 0; garments by LAYER_Z). Every vertex of an inner layer that
    pokes through an outer layer, or lies less than `margin` under it, is pulled back under it along
    its own outward normal (ray cast from `reach` inside the vertex). Decimating each part separately
    (and MakeHuman's tied z_depth values) otherwise leaves shirts poking through trousers, legs
    through skirts, etc."""
    from mathutils.bvhtree import BVHTree
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(n * 3); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    nr = outward(co, nr, bone_segments(arm))
    pv = [tuple(p.vertices) for p in me.polygons]
    ranks = sorted(set(int(r) for r in np.unique(layer) if r >= 0))
    segs = bone_segments(arm)
    vbone = nearest_bone(co, segs)
    related = bone_related(arm)
    moved = 0
    cover_face = np.full(n, -1, np.int64)
    cover_loc = np.zeros((n, 3))
    for r in reversed(ranks[1:]):
        pidx = [k for k, f in enumerate(pv) if all(layer[i] == r for i in f)]
        polys = [pv[k] for k in pidx]
        if not polys:
            continue
        bvh = BVHTree.FromPolygons([Vector(c) for c in co], polys, all_triangles=False)
        # outward face normals of the outer layer (for the nearest-point test)
        fc = np.array([co[list(f)].mean(0) for f in polys])
        fn = np.array([np.cross(co[f[1]] - co[f[0]], co[f[-1]] - co[f[0]]) for f in polys])
        fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
        fn = outward(fc, fn, segs)
        fbone = nearest_bone(fc, segs)
        idx = np.nonzero((layer >= 0) & (layer < r))[0]
        for i in idx:
            p = Vector(co[i]); d = Vector(nr[i])
            new = None
            rch = reach if layer[i] > 0 else body_reach
            # 1) along the vertex's own normal: the outer surface must be at least `margin` further out.
            #    Hits on the far side of a thin limb (outer normal facing away from the ray) are skipped.
            o = p - d * rch
            left = rch + margin
            for _ in range(4):
                hit = bvh.ray_cast(o, d, left)
                if hit[0] is None:
                    break
                if Vector(fn[hit[2]]).dot(d) > 0.2 and related[vbone[i], fbone[hit[2]]]:
                    t = (hit[0] - p).dot(d)
                    if t < margin:
                        new = p + d * (t - margin)
                        p = new
                    break
                step = (hit[0] - o).dot(d) + 1e-4
                o = o + d * step; left -= step
                if left <= 0:
                    break
            # 2) nearest point on the outer layer (catches waistband rims, cuffs and folds whose
            #    normals run along the outer surface): if p is in front of it, or less than `margin`
            #    behind it, and the offset is mostly along its normal (not past a hem), tuck it under
            loc, _, fi, dist = bvh.find_nearest(p, rch)
            if loc is not None and related[vbone[i], fbone[fi]]:
                no = Vector(fn[fi])
                sd = (p - loc).dot(no)
                if sd > -margin and (dist < 1e-4 or abs(sd) > 0.7 * dist):
                    new = p + no * (-margin - sd)
                    sd = -margin
                # covered: under the outer surface, straight below it. The outermost cover wins.
                if cover_face[i] < 0 and sd < 0 and (dist < 1e-4 or abs(sd) > 0.7 * dist):
                    cover_face[i] = pidx[fi]
                    cover_loc[i] = np.array(loc)
            if new is not None:
                co[i] = np.array(new)
                moved += 1
    me.vertices.foreach_set('co', co.ravel()); me.update()
    print('resolve_layers: moved', moved, 'vertices over', len(ranks), 'layers;', int((cover_face >= 0).sum()), 'covered')
    if match_weights:
        match_cover_weights(obj, cover_face, cover_loc, pv)
    return moved


def match_cover_weights(obj, cover_face, cover_loc, pv, rings=3):
    """Skin every covered inner-layer vertex like the outer surface right above it, so the layers
    deform together and a thigh cannot swing out through a pencil skirt, or trousers through a
    polo hem, while walking. Blended in over `rings` edge rings from the uncovered border."""
    me = obj.data
    n = len(me.vertices)
    cov = cover_face >= 0
    if not cov.any():
        return
    ev = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get('vertices', ev); ev = ev.reshape(-1, 2)
    ring = np.where(cov, rings, 0).astype(np.int32)
    front = ~cov
    for k in range(1, rings):
        nb = np.zeros(n, bool)
        nb[ev[front[ev[:, 1]], 0]] = True
        nb[ev[front[ev[:, 0]], 1]] = True
        new = nb & cov & (ring == rings)
        ring[new] = k
        front = new
    alpha = ring / float(rings)
    G = len(obj.vertex_groups)
    W = np.zeros((n, G), np.float32)
    for v in me.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    out = W.copy()
    for i in np.nonzero(cov)[0]:
        f = pv[cover_face[i]]
        d = np.linalg.norm(co[list(f)] - cover_loc[i], axis=1)
        iw = 1.0 / np.maximum(d, 1e-4); iw /= iw.sum()
        src = (W[list(f)] * iw[:, None]).sum(0)
        out[i] = (1 - alpha[i]) * W[i] + alpha[i] * src
    # keep the 4 strongest influences, normalised (what glTF gets anyway)
    for i in np.nonzero(cov)[0]:
        row = out[i]
        keep = np.argsort(row)[-4:]
        m = np.zeros(G, bool); m[keep] = True
        row[~m] = 0
        row /= max(row.sum(), 1e-6)
        out[i] = row
    vgs = list(obj.vertex_groups)
    for i in np.nonzero(cov)[0]:
        for g in range(G):
            if out[i, g] > 1e-4:
                vgs[g].add([int(i)], float(out[i, g]), 'REPLACE')
            elif W[i, g] > 0:
                vgs[g].remove([int(i)])
    print('match_cover_weights:', int(cov.sum()), 'vertices re-skinned to their cover')


def layer_of(obj):
    me = obj.data
    a = np.empty(len(me.vertices), np.float32)
    me.attributes['layer'].data.foreach_get('value', a)
    return np.round(a).astype(np.int32)


def cut_garment(o, arm, spec):
    """Shorten a garment along a limb (e.g. trousers -> shorts, long -> short sleeves) with a clean
    planar cut. spec: {'thigh': f} cuts both legs at fraction f of the thigh (hip joint 0 -> knee 1),
    {'upperarm': f} does the same for sleeves (shoulder 0 -> elbow 1). Only faces whose vertices are
    all skinned mainly to that limb are cut, so the plane never touches the torso."""
    chains = {'thigh': ('thigh', 'calf', 'foot', 'ball'),
              'upperarm': ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')}
    me = o.data
    bone_names = [b.name for b in arm.data.bones]
    bidx = {n: i for i, n in enumerate(bone_names)}
    names = {g.index: g.name for g in o.vertex_groups}
    bones = arm.data.bones
    bm = bmesh.new(); bm.from_mesh(me)
    lay = bm.verts.layers.int.new('dom_bone')
    bm.verts.ensure_lookup_table()
    for v in me.vertices:
        best = max((g for g in v.groups if names[g.group] in bidx), key=lambda g: g.weight, default=None)
        bm.verts[v.index][lay] = bidx[names[best.group]] if best is not None else -1
    removed = 0
    for key, f in spec.items():
        seg = chains[key]
        child = 'calf' if key == 'thigh' else 'lowerarm'
        for sd in ('l', 'r'):
            limb = {f'{b}_{sd}' for b in seg} | {f'{b}_0{k}_{sd}' for b in seg for k in (1, 2, 3)}
            limb = {bidx[n] for n in limb if n in bidx}
            a = Vector(bones[f'{key}_{sd}'].head_local); c = Vector(bones[f'{child}_{sd}'].head_local)
            nrm = (c - a).normalized()
            n0 = len(bm.faces)
            faces = [fc for fc in bm.faces if all(v[lay] in limb for v in fc.verts)]
            if not faces:
                continue
            geom = list({e for fc in faces for e in fc.edges}) + faces + list({v for fc in faces for v in fc.verts})
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=a + (c - a) * f, plane_no=nrm,
                                   clear_outer=True, clear_inner=False)
            removed += n0 - len(bm.faces)
    bm.verts.layers.int.remove(lay)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(me); bm.free(); me.update()
    print('cut', o.name, spec, 'faces removed (net)', removed)


def remove_hidden_body(body, covers, erode=2):
    """Delete body faces fully hidden under clothes (ray along the vertex normal hits a garment
    within 5 cm), keeping a margin of `erode` vertex rings around every visible area."""
    from mathutils.bvhtree import BVHTree
    if not covers:
        return
    verts, polys, off = [], [], 0
    for o in covers:
        me = o.data
        verts.extend([o.matrix_world @ v.co for v in me.vertices])
        polys.extend([[i + off for i in p.vertices] for p in me.polygons])
        off += len(me.vertices)
    bvh = BVHTree.FromPolygons(verts, polys)
    me = body.data
    n = len(me.vertices)
    cov = np.zeros(n, bool)
    for v in me.vertices:
        p = body.matrix_world @ v.co
        nn = (body.matrix_world.to_3x3() @ v.normal).normalized()
        def inside_hit(d):
            # hit a garment from the inside (its outward normal faces along the ray)
            h = bvh.ray_cast(p - nn * 0.004, d, 0.3)
            return h[0] is not None and h[1].dot(d) > 0.0
        if inside_hit(nn):
            t = nn.orthogonal().normalized(); t2 = nn.cross(t)
            cov[v.index] = all(inside_hit((nn + a * 0.45).normalized()) for a in (t, -t, t2, -t2))
    ev = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get('vertices', ev); ev = ev.reshape(-1, 2)
    for _ in range(erode):
        bad = ~cov
        nb_bad = np.zeros(n, bool)
        nb_bad[ev[bad[ev[:, 1]], 0]] = True
        nb_bad[ev[bad[ev[:, 0]], 1]] = True
        cov = cov & ~nb_bad
    bm = bmesh.new(); bm.from_mesh(me)
    dead = [f for f in bm.faces if all(cov[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(me); bm.free(); me.validate(clean_customdata=False); me.update()
    print('hidden body faces removed:', len(dead))


# ------------------------------------------------------------------ build one variant
def build_variant(v):
    t0 = time.time()
    C.enable_mpfb(); C.clear_scene()
    hair = v.get('hair', ('crop', '#0e0b0a'))
    hair_asset = hair[0] if hair[0] in ('bob02', 'afro01', 'bob01', 'braid01', 'short04') else ''
    spec = dict(name=v['id'], phenotype=v['phenotype'], race={'african': 1.0, 'asian': 0.0, 'caucasian': 0.0},
                eyes='low-poly/low-poly.mhclo', skin=f"{v['skin'][0]}/{v['skin'][0]}.mhmat",
                hair=asset_rel('hair', hair_asset) if hair_asset else '',
                clothes=[asset_rel('clothes', a) for a, _ in v['clothes']])
    arm, bm = C.build_human(spec)
    C.bake_shape_keys(bm)
    cuts = v.get('cut', {})
    for m in list(bm.modifiers):
        # a shortened garment must not delete the body under the part that was cut away;
        # remove_hidden_body() takes care of what stays covered
        if m.type == 'MASK' and m.name.startswith('Delete.') and m.name[len('Delete.'):] in cuts:
            bm.modifiers.remove(m)
    me = bm.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    eyes = [co[vg_weights(bm, [g]) > 0.5].mean(0) for g in ('helper-l-eye', 'helper-r-eye')]
    meshes = C.finalize(arm)
    # same rest orientations as the animation rig (Spider-Man) so shared clips pose identically
    C.normalize_rest(arm, json.load(open(os.path.join(C.SCRATCH, 'spiderman', 'ref_rest.json'))))
    R = Matrix.Rotation(math.pi, 3, 'Z')
    eyes = [np.array(R @ Vector(e)) for e in eyes]
    height = max(max(vv.co.z for vv in o.data.vertices) for o in meshes if o.name.endswith('.body'))
    env = dict(height=height, eyes=eyes)
    parts = []   # (object, part dict)
    body = [o for o in meshes if o.name.endswith('.body')][0]
    garments = [o for o in meshes if o is not body and not o.name.endswith('.low-poly') and not o.name.endswith('.' + hair_asset)]
    for g in garments:
        tag = g.name.split('.', 1)[1]
        if tag in cuts:
            cut_garment(g, arm, cuts[tag])
    remove_hidden_body(body, garments)
    zd = {o: zdepth(o) for o in garments}
    for g in garments:
        outer = [o for o in garments if zd[o] > zd[g] + 1e-6]
        if outer:
            remove_hidden_body(g, outer, erode=1)
    for o in meshes:
        tag = o.name.split('.', 1)[1] if '.' in o.name else o.name
        if o is body:
            decimate(o, BUDGET['body'])
            img = NA.load_image(NA.diffuse_path(o))
            part = dict(img=img, kind='body')
            part['rule'] = body_rule(v, part, env)
        elif tag == 'low-poly':
            decimate(o, BUDGET['eyes'])
            part = dict(img=NA.load_image(NA.diffuse_path(o), 256), kind='eyes')
            part['rule'] = make_rule(('keep',), part, env)
        elif tag == hair_asset:
            decimate(o, BUDGET['hair'])
            part = dict(img=NA.load_image(NA.diffuse_path(o), 512), kind='hair')
            hc = NA.hex2lin(hair[1] or '#0e0b0a')
            part['rule'] = (lambda hc: (lambda c: hc[None] * detail_from(c['src'], None, 0.9)))(hc)
        else:
            rule = None
            for a, rs in v['clothes']:
                if tag == a or tag.startswith(a[:20]) or a in tag:
                    rule = rs
            if rule is None:
                # asset object names come from the .mhclo file name, match by lookup
                for a, rs in v['clothes']:
                    if os.path.basename(asset_rel('clothes', a)).replace('.mhclo', '') == tag:
                        rule = rs
            if rule is None:
                print('WARN no rule for', o.name); rule = ('keep',)
            is_shoe = any(k in tag for k in ('shoe', 'sneaker', 'flats', 'boot'))
            is_hat = any(k in tag for k in ('hat', 'cap'))
            decimate(o, BUDGET['shoes'] if is_shoe else BUDGET['hat'] if is_hat else BUDGET['clothes'])
            asset = next((a for a, rs in v['clothes'] if rs is rule), None)
            dp = (mhmat_diffuse('clothes', asset) if asset else None) or NA.diffuse_path(o)
            img = NA.load_image(dp) if dp else white_img()
            part = dict(img=img, kind='clothes')
            # blur only inside the garment's UV islands: the padding/background of many MakeHuman
            # textures is white or black and would bleed into the flattened colour as blotches
            part['blur'] = NA.blurred_lum(img, 16, mask=NA.uv_mask(o, img.shape[:2]))[..., None]
            part['rule'] = make_rule(rule, part, env)
        parts.append((o, part))
    # overall LOD0 cap: shave clothes proportionally if the character is over budget
    total = sum(C.mesh_tris(o) for o, _ in parts)
    if total > LOD0_CAP:
        cl = [(o, p) for o, p in parts if p['kind'] == 'clothes']
        ctot = sum(C.mesh_tris(o) for o, _ in cl)
        keep = max(ctot - (total - LOD0_CAP), ctot * 0.5)
        for o, _ in cl:
            decimate(o, int(C.mesh_tris(o) * keep / ctot))
    if v.get('headwrap'):
        hw = make_headwrap(body, arm, eyes)
        decimate(hw, BUDGET['headwrap'])
        part = dict(img=None, kind='headwrap', rule=headwrap_rule(v['headwrap']))
        parts.append((hw, part))
    # per-vertex extras for the body rule (scalp weight, head weight), zeros elsewhere
    for o, part in parts:
        if part['kind'] == 'body':
            sc = vg_weights(o, ['scalp']); hw_ = vg_weights(o, ['head', 'neck_01'])
        else:
            sc = np.zeros(len(o.data.vertices), np.float32); hw_ = sc
        a = o.data.attributes.new('extra', 'FLOAT2', 'POINT')
        a.data.foreach_set('vector', np.stack([sc, hw_], 1).ravel())
        # stacking rank for resolve_layers: body 0, garments by LAYER_Z / z_depth, eyes ignored
        rank = {'body': 0.0, 'eyes': -1.0, 'hair': float(LAYER_Z['__hair__']),
                'headwrap': float(LAYER_Z['__headwrap__'])}.get(part['kind'])
        if rank is None:
            rank = zdepth(o)
        la = o.data.attributes.new('layer', 'FLOAT', 'POINT')
        la.data.foreach_set('value', np.full(len(o.data.vertices), rank, np.float32))
    objs = [o for o, _ in parts]
    joined = NA.join(objs, 'npc_' + v['id'])
    plist = [p for _, p in parts]
    me = joined.data
    ex = np.empty(len(me.vertices) * 2, np.float32); me.attributes['extra'].data.foreach_get('vector', ex); ex = ex.reshape(-1, 2)
    me.attributes.remove(me.attributes['extra'])
    resolve_layers(joined, arm, layer_of(joined))
    # atlas: faces (head of the body) and hands get more texels
    mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', mi)
    boost = np.ones(len(me.polygons), np.float32)
    head_poly = np.array([ex[list(p.vertices), 1].mean() for p in me.polygons])
    body_idx = [i for i, (_, p) in enumerate(parts) if p['kind'] == 'body'][0]
    boost[(mi == body_idx) & (head_poly > 0.5)] = 1.9
    NA.pack_atlas(joined, boost)
    img, mask = NA.bake(joined, plist, ATLAS, extra_vertex_attrs=ex)
    tex0 = NA.save_png(img, os.path.join(OUT, f'npc_{v["id"]}.png'))
    tex1 = NA.save_png(img, os.path.join(OUT, f'npc_{v["id"]}_lod1.png'), 256)
    NA.finish_uvs(joined)
    for vg in list(joined.vertex_groups):
        if vg.name not in arm.data.bones:
            joined.vertex_groups.remove(vg)
    for p in joined.data.polygons:
        p.use_smooth = True
    for k in list(joined.keys()):
        del joined[k]
    mat = NA.make_material('npc_' + v['id'], tex0)
    joined.data.materials.append(mat)
    arm.name = 'npc_' + v['id'] + '_rig'
    arm['hipHeight'] = float(arm.data.bones['pelvis'].head_local[2])
    arm['height'] = float(height)
    arm['npcId'] = v['id']
    arm['gender'] = v['gender']
    arm['roles'] = ','.join(v['roles'])
    tris0 = C.mesh_tris(joined)
    C.export_glb(os.path.join(OUT, f'npc_{v["id"]}.glb'), [arm, joined])
    # LOD1
    lod = joined.copy(); lod.data = joined.data.copy(); lod.name = joined.name + '_lod1'
    bpy.context.scene.collection.objects.link(lod)
    decimate(lod, LOD1_TRIS)
    resolve_layers(lod, arm, layer_of(lod), margin=0.008)   # collapses move surfaces by more at 2k tris
    for ob in (joined, lod):
        if 'layer' in ob.data.attributes:
            ob.data.attributes.remove(ob.data.attributes['layer'])
    lod.data.materials.clear()
    lod.data.materials.append(NA.make_material('npc_' + v['id'] + '_lod1', tex1))
    tris1 = C.mesh_tris(lod)
    C.export_glb(os.path.join(OUT, f'npc_{v["id"]}_lod1.glb'), [arm, lod])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'npc_{v["id"]}.blend'))
    info = dict(id=v['id'], gender=v['gender'], roles=v['roles'], desc=v['desc'], height=round(height, 3),
                hipHeight=round(arm['hipHeight'], 4), tris_lod0=tris0, tris_lod1=tris1,
                clothes=[a for a, _ in v['clothes']], hair=hair_asset or hair[0], skin=v['skin'])
    print('VARIANT', json.dumps(info), 'time', round(time.time() - t0, 1))
    return info


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    todo = [v for v in VARIANTS if not args or v['id'] in args]
    path = os.path.join(OUT, 'variants_info.json')
    if len(todo) == 1:
        info = build_variant(todo[0])
        old = json.load(open(path)) if os.path.exists(path) else {}
        old[info['id']] = info
        json.dump(old, open(path, 'w'), indent=1)
    else:
        # one Blender process per variant (bpy state accumulates across MPFB builds), 2 at a time
        import subprocess
        procs = []
        todo = todo * 1
        for v in todo:
            while len([p for p in procs if p.poll() is None]) >= int(os.environ.get('NPC_JOBS', '2')):
                time.sleep(0.5)
            log = open(os.path.join(OUT, f'log_{v["id"]}.txt'), 'w')
            procs.append(subprocess.Popen([sys.executable, os.path.abspath(__file__), v['id']], stdout=log, stderr=subprocess.STDOUT))
            time.sleep(1.5)  # stagger (variants_info.json read-modify-write)
        for p in procs:
            p.wait()
        codes = [p.returncode for p in procs]
        print('exit codes', codes)
        # Blender occasionally segfaults on exit/after heavy bmesh edits: retry failures
        for attempt in range(3):
            bad = [v for v, c in zip(todo, codes) if c != 0]
            if not bad:
                break
            print('retrying', [v['id'] for v in bad])
            codes2 = []
            for v in bad:
                log = open(os.path.join(OUT, f'log_{v["id"]}.txt'), 'w')
                codes2.append(subprocess.call([sys.executable, os.path.abspath(__file__), v['id']], stdout=log, stderr=subprocess.STDOUT))
            todo, codes = bad, codes2
        print('final failures', [v['id'] for v, c in zip(todo, codes) if c != 0])
