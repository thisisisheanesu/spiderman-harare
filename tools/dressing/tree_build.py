"""Game-ready LODs from high-poly downloaded trees (PlantCatalog, CC BY 4.0) - broadleaf trees.

    $BLENDER_PY tools/dressing/tree_build.py -- <name> [<name> ...]      (names from tools/dressing/trees.json)

Env: DRESSING_RAW  (downloads: <src>/model.glb, <src>/meta.json)   default $SCRATCH/dressing/raw
     DRESSING_WORK (intermediates)                                 default $SCRATCH/dressing/work
Output in $DRESSING_WORK/<name>/: lod0.glb, lod1.glb (Blender exports, PNG textures), imp.png, imp_n.png,
atlas.png, clumps/*.png, meta.json. tools/dressing/pack.mjs turns those into public/models/dressing/.

Method ("clump cards", what SpeedTree-style game trees do):
  1. The source is scaled to the target height; the trunk base goes to the origin.
  2. Bark: the trunk and big limbs (islands longer than barkMinLen) are kept and decimated; twigs, leaves,
     flowers and small branches are removed from the mesh.
  3. Foliage triangles are clustered in a voxel grid sized so that the card budget is met. A handful of those
     voxels are rendered (orthographic, albedo only, depth slab = the clump) from outside the crown into a
     4x4 atlas of 256 px clump images - so the cards show the real leaves, flowers and twigs of the source.
  4. Every voxel becomes one alpha-tested quad at the foliage centroid, facing outwards (randomised), showing
     the clump whose flower/leaf mix is closest. Normals are bent to the crown ellipsoid (soft, volumetric
     lighting instead of flat cards).
  5. LOD1 repeats 2-4 with a coarser grid, bigger clumps and fewer bark islands.
  6. Impostor: LOD0 is rendered from 8 azimuths into an albedo atlas and a normal atlas.
Wind: TEXCOORD_1 = (sway, flutter). sway = (height/H)^1.5 (0 at the ground, 1 at the top); flutter = 0 on
bark, 0.6-1.0 on cards (per-card random: amplitude and phase seed).
"""
import json
import math
import os
import random
import re
import zlib
import sys

import bpy
import mathutils
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_util as U  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.environ.get('SCRATCH', '/tmp/dressing-scratch')
RAW = os.environ.get('DRESSING_RAW', os.path.join(SCRATCH, 'dressing', 'raw'))
WORK = os.environ.get('DRESSING_WORK', os.path.join(SCRATCH, 'dressing', 'work'))
CELL = 256          # clump / impostor cell size (px)
ATLAS_N = 4         # 4x4 clump atlas -> 1024 px
IMP_FRAMES = 8
IMP_PX = 256


def log(*a):
    print('[tree]', *a, flush=True)


# ------------------------------------------------------------------------------------------------ helpers

def classify(o, cfg):
    n = U.mat_name(o).lower()
    if any(k in n for k in cfg.get('exclude', [])):
        return 'exclude'
    if any(k in n for k in cfg.get('barkKeys', ['bark', 'trunk'])):
        return 'bark'
    if any(k in n for k in cfg.get('drop', [])):
        return 'twig'
    if any(k in n for k in cfg.get('flower', [])):
        return 'flower'
    return 'leaf'


def keep_first_uv(o):
    uvs = o.data.uv_layers
    while len(uvs) > 1:
        uvs.remove(uvs[-1])
    if len(uvs):
        uvs[0].name = 'UVMap'


def graded_image(img, hsv, name, max_size=None):
    """Copy of a Blender image with an HSV grade baked into the pixels (numpy), optionally downscaled."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    if tuple(hsv) != (0, 1, 1):
        rgb = px[..., :3]
        mx = rgb.max(-1)
        mn = rgb.min(-1)
        d = mx - mn
        hue = np.zeros_like(mx)
        m = d > 1e-6
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        idx = m & (mx == r)
        hue[idx] = ((g - b)[idx] / d[idx]) % 6
        idx = m & (mx == g)
        hue[idx] = ((b - r)[idx] / d[idx]) + 2
        idx = m & (mx == b)
        hue[idx] = ((r - g)[idx] / d[idx]) + 4
        hue = (hue / 6 + hsv[0]) % 1
        sat = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0) * hsv[1]
        val = np.clip(mx * hsv[2], 0, 1)
        sat = np.clip(sat, 0, 1)
        c = val * sat
        hp = hue * 6
        x = c * (1 - np.abs(hp % 2 - 1))
        z = np.zeros_like(c)
        sel = [(hp < 1, (c, x, z)), ((hp >= 1) & (hp < 2), (x, c, z)), ((hp >= 2) & (hp < 3), (z, c, x)),
               ((hp >= 3) & (hp < 4), (z, x, c)), ((hp >= 4) & (hp < 5), (x, z, c)), (hp >= 5, (c, z, x))]
        out = np.zeros_like(rgb)
        for s, (a, bb, cc) in sel:
            out[..., 0] = np.where(s, a, out[..., 0])
            out[..., 1] = np.where(s, bb, out[..., 1])
            out[..., 2] = np.where(s, cc, out[..., 2])
        out += (val - c)[..., None]
        px[..., :3] = out
    new = bpy.data.images.new(name, w, h, alpha=True)
    new.pixels.foreach_set(px.ravel())
    if max_size and max(w, h) > max_size:
        k = max_size / max(w, h)
        new.scale(max(4, int(w * k)), max(4, int(h * k)))
    return new


def normal_image_of(mat):
    if not mat or not mat.node_tree:
        return None
    for n in mat.node_tree.nodes:
        if n.type == 'NORMAL_MAP':
            for l in n.inputs['Color'].links:
                if l.from_node.type == 'TEX_IMAGE':
                    return l.from_node.image
    return None


def voxels(P, A, F, v, minfrac=0.2):
    keys = np.floor(P / v).astype(np.int64)
    k = (keys[:, 0] * 73856093) ^ (keys[:, 1] * 19349663) ^ (keys[:, 2] * 83492791)
    uk, inv = np.unique(k, return_inverse=True)
    m = np.bincount(inv, A)
    c = np.stack([np.bincount(inv, A * P[:, i]) for i in range(3)], 1) / m[:, None]
    fl = np.bincount(inv, A * F) / m
    keep = m >= minfrac * np.median(m)
    return c[keep], m[keep], fl[keep]


def voxel_size_for(P, A, F, target):
    lo, hi = 0.03, 8.0
    for _ in range(30):
        mid = math.sqrt(lo * hi)
        n = len(voxels(P, A, F, mid)[0])
        if n > target:
            lo = mid
        else:
            hi = mid
    return hi


def out_dir(p, crown, low=0.0):
    cz, rh, rz = crown
    cz = cz - low * rz
    d = np.array([p[0] / (rh * rh), p[1] / (rh * rh), (p[2] - cz) / (rz * rz)])
    n = np.linalg.norm(d)
    return d / n if n > 1e-9 else np.array([0, 0, 1.0])


def build_cards(name, cen, fl, L, cells, cell_flower, crown, H, rng, jitter=0.5):
    """One quad per voxel. cells: list of atlas cell indices usable; cell_flower: their flower ratios."""
    verts, faces, uvs, nors, sway = [], [], [], [], []
    cf = np.array(cell_flower)
    inset = 1.5 / (CELL * ATLAS_N)
    for i, c in enumerate(cen):
        n = out_dir(c, crown) + rng.normal(0, jitter, 3)
        n /= np.linalg.norm(n)
        t = np.cross(n, [0, 0, 1.0])
        if np.linalg.norm(t) < 1e-3:
            t = np.array([1.0, 0, 0])
        t /= np.linalg.norm(t)
        b = np.cross(n, t)
        ang = rng.uniform(-0.6, 0.6)                     # mostly upright, some roll
        t, b = t * math.cos(ang) + b * math.sin(ang), -t * math.sin(ang) + b * math.cos(ang)
        s = L * rng.uniform(0.85, 1.15) / 2
        order = np.argsort(np.abs(cf - fl[i]) + rng.uniform(0, 0.25, len(cf)))
        cell = cells[order[0]]
        cx, cy = cell % ATLAS_N, cell // ATLAS_N
        u0, u1 = cx / ATLAS_N + inset, (cx + 1) / ATLAS_N - inset
        v1, v0 = 1 - cy / ATLAS_N - inset, 1 - (cy + 1) / ATLAS_N + inset   # Blender v is up
        base = len(verts)
        flut = rng.uniform(0.6, 1.0)
        for (a, bb, uu, vv) in ((-1, -1, u0, v0), (1, -1, u1, v0), (1, 1, u1, v1), (-1, 1, u0, v1)):
            p = c + t * a * s + b * bb * s
            p[2] = max(p[2], 0.3)
            verts.append(p)
            uvs.append((uu, vv))
            nn = out_dir(p, crown, low=0.9) * 0.8 + n * 0.2
            nors.append(nn / np.linalg.norm(nn))
            sway.append((min(1.0, max(0.0, p[2] / H)) ** 1.5, flut))
        faces.append((base, base + 1, base + 2, base + 3))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    uvl = me.uv_layers.new(name='UVMap')
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', lv)
    uva = np.array(uvs)[lv]
    uvl.data.foreach_set('uv', uva.ravel())
    sw = me.uv_layers.new(name='Sway')
    sw.data.foreach_set('uv', np.array(sway)[lv].ravel())
    me.normals_split_custom_set_from_vertices([tuple(x) for x in nors])
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def set_bark_sway(o, H):
    me = o.data
    if 'Sway' not in me.uv_layers:
        me.uv_layers.new(name='Sway')
    sw = me.uv_layers['Sway']
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', lv)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    z = co.reshape(-1, 3)[lv, 2]
    s = np.clip(z / H, 0, 1) ** 1.5
    sw.data.foreach_set('uv', np.stack([s, np.zeros_like(s)], 1).ravel())


def dilate_rgba(arr):
    """Fill RGB of transparent pixels with the nearest opaque colour (no dark fringes in mips)."""
    from scipy import ndimage
    a = arr[..., 3]
    mask = a < 8
    if mask.all() or not mask.any():
        return arr
    _, (iy, ix) = ndimage.distance_transform_edt(mask, return_indices=True)
    out = arr.copy()
    out[..., :3] = arr[iy, ix, :3]
    return out


def render_impostor(objs, alb, nrm, wd, samples=16):
    """8-azimuth albedo + normal atlases of objs. alb / nrm map a material name to its bake material (every
    material slot is swapped). Frame k: seen from three.js direction (sin a, 0, cos a), a = k * 45 deg."""
    from PIL import Image
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o not in objs
    allco = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in objs])
    R = float(np.linalg.norm(allco[:, :2], axis=1).max()) * 1.03
    Htop = float(allco[:, 2].max()) * 1.02
    fw, fh = 2 * R, Htop
    if fw >= fh:
        px_w, px_h = IMP_PX, max(32, int(round(IMP_PX * fh / fw / 8)) * 8)
        fh = fw * px_h / px_w
    else:
        px_w, px_h = max(32, int(round(IMP_PX * fw / fh / 8)) * 8), IMP_PX
        fw = fh * px_w / px_h
    cam = U.setup_render(px_w, px_h, samples=samples)
    keep = {o.name: list(o.data.materials) for o in objs}
    cols, rows = 4, 2
    imp = np.zeros((rows * px_h, cols * px_w, 4), dtype=np.uint8)
    impn = np.zeros((rows * px_h, cols * px_w, 4), dtype=np.uint8)
    for k in range(IMP_FRAMES):
        th = 2 * math.pi * k / IMP_FRAMES
        d = (math.sin(th), -math.cos(th), 0.0)
        for mats, arr, tag in ((alb, imp, 'a'), (nrm, impn, 'n')):
            for o in objs:
                for i, m in enumerate(keep[o.name]):
                    o.data.materials[i] = mats[m.name]
            U.aim_camera(cam, (0, 0, fh / 2), d, dist=80, ortho=max(fw, fh))
            p = os.path.join(wd, f'imp_{tag}{k}.png')
            U.render_to(p, raw=(tag == 'n'))
            im = np.array(Image.open(p).convert('RGBA'))
            cx, cy = k % cols, k // cols
            arr[cy * px_h:(cy + 1) * px_h, cx * px_w:(cx + 1) * px_w] = im
            os.remove(p)
    impn[..., 3] = imp[..., 3]
    Image.fromarray(dilate_rgba(imp), 'RGBA').save(os.path.join(wd, 'imp.png'))
    Image.fromarray(dilate_rgba(impn)[..., :3], 'RGB').save(os.path.join(wd, 'imp_n.png'))
    for o in objs:
        for i, m in enumerate(keep[o.name]):
            o.data.materials[i] = m
    return {'cols': cols, 'rows': rows, 'frames': IMP_FRAMES, 'frameW': round(fw, 3), 'frameH': round(fh, 3), 'px': [px_w, px_h]}


def impostor_only(cfg):
    """Re-render the impostor atlases from the exported LOD0 (work/<name>/lod0.glb) and update meta.json."""
    name = cfg['name']
    wd = os.path.join(WORK, name)
    U.reset()
    objs = U.import_glb(os.path.join(wd, 'lod0.glb'))
    alb, nrm = {}, {}
    for o in objs:
        for m in o.data.materials:
            img, alpha = U.base_image(m)
            cut = alpha or bool(re.search('foliage|frond|skirt', m.name))
            alb[m.name] = U.albedo_material('ia_' + m.name, img, alpha=cut, hard_alpha=True)
            nrm[m.name] = U.normal_material('in_' + m.name, img if cut else None, alpha=cut)
    meta = json.load(open(os.path.join(wd, 'meta.json')))
    meta['impostor'] = render_impostor(objs, alb, nrm, wd, cfg.get('impSamples', 16))
    json.dump(meta, open(os.path.join(wd, 'meta.json'), 'w'), indent=1)
    log('IMPOSTOR', name, meta['impostor'])


# ------------------------------------------------------------------------------------------------ build

def build_broadleaf(cfg):
    name = cfg['name']
    wd = os.path.join(WORK, name)
    os.makedirs(os.path.join(wd, 'clumps'), exist_ok=True)
    rng = np.random.default_rng(zlib.crc32(name.encode()))
    random.seed(7)
    U.reset()
    objs = U.import_glb(os.path.join(RAW, cfg['src'], 'model.glb'))
    cat = {o.name: classify(o, cfg) for o in objs}
    for o in list(objs):
        if cat[o.name] == 'exclude':
            objs.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    for o in objs:
        keep_first_uv(o)
    # normalise: trunk base to the origin, target height (aspect < 1 narrows the crown: taller-looking tree)
    bark = [o for o in objs if cat[o.name] == 'bark']
    co = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in bark])
    base = co[co[:, 2] < co[:, 2].min() + 0.4][:, :2].mean(0)
    mn, mx = U.bbox(objs)
    s = cfg['height'] / (mx[2] - mn[2])
    asp = cfg.get('aspect', 1.0)
    M = mathutils.Matrix.Diagonal((s * asp, s * asp, s, 1.0)) @ mathutils.Matrix.Translation((-base[0], -base[1], -mn[2]))
    U.transform_all(objs, M)
    H = cfg['height']
    log(name, 'scale', round(s, 3), 'objects', {k: sum(1 for v in cat.values() if v == k) for k in set(cat.values())})

    # materials: remember the source images per category
    src_img = {}
    for o in objs:
        img, _ = U.base_image(o.data.materials[0] if o.data.materials else None)
        src_img[o.name] = img
    bark_main = next((o for o in bark if '02' not in U.mat_name(o)), bark[0])
    bark_img = src_img[bark_main.name]
    bark_nrm = normal_image_of(bark_main.data.materials[0])

    # ---- bark split
    ball = U.join([U.duplicate(o, o.name + '_d') for o in bark], 'bark_all')
    isl = U.islands(ball)
    cov = np.empty(len(ball.data.vertices) * 3)
    ball.data.vertices.foreach_get('co', cov)
    cov = cov.reshape(-1, 3)
    ls = np.empty(len(ball.data.polygons), dtype=np.int64)
    ball.data.polygons.foreach_get('loop_start', ls)
    lv = np.empty(len(ball.data.loops), dtype=np.int64)
    ball.data.loops.foreach_get('vertex_index', lv)
    fv = cov[lv[ls]]
    size = np.array([np.linalg.norm(fv[f].max(0) - fv[f].min(0)) for f in isl])
    small0 = np.concatenate([f for f, sz in zip(isl, size) if sz < cfg['barkMinLen0']] or [np.array([], int)])
    small1 = np.concatenate([f for f, sz in zip(isl, size) if sz < cfg['barkMinLen1']] or [np.array([], int)])
    big0 = np.concatenate([f for f, sz in zip(isl, size) if sz >= cfg['barkMinLen0']] or [np.array([], int)])
    bark0 = U.duplicate(ball, 'bark0')
    U.delete_faces(bark0, small0)
    bark1 = U.duplicate(ball, 'bark1')
    U.delete_faces(bark1, small1)
    twigs = U.duplicate(ball, 'bark_small')         # small branches: only rendered into clumps
    U.delete_faces(twigs, big0)
    bpy.data.objects.remove(ball, do_unlink=True)
    for o in bark:
        o.hide_render = True
    log('bark islands', len(isl), 'kept0', int((size >= cfg['barkMinLen0']).sum()), 'kept1', int((size >= cfg['barkMinLen1']).sum()))

    # ---- foliage points
    fol = [o for o in objs if cat[o.name] in ('leaf', 'flower')]
    Ps, As, Fs = [], [], []
    for o in fol:
        c, a = U.tri_data(o)
        Ps.append(c)
        As.append(a)
        Fs.append(np.full(len(a), 1.0 if cat[o.name] == 'flower' else 0.0))
    P, A, F = np.concatenate(Ps), np.concatenate(As), np.concatenate(Fs)
    # flower cards carry more visual weight than their triangle area (they are sparse panicles)
    Aw = A * np.where(F > 0, 1.0, 1.0)
    rh = np.percentile(np.linalg.norm(P[:, :2], axis=1), 88)
    z10, z95 = np.percentile(P[:, 2], [8, 97])
    crown = ((z10 + z95) / 2, rh, (z95 - z10) / 2)
    log('foliage tris', len(P), 'crown cz/rh/rz', [round(x, 2) for x in crown], 'flower share', round(float((A * F).sum() / A.sum()), 2))

    # clump size is physical (m); the card budget only caps the count (bigger voxels if needed)
    v0 = max(cfg['clump0'] / cfg['cardScale'], voxel_size_for(P, Aw, F, cfg['cards0']))
    v1 = max(cfg['clump1'] / cfg['cardScale'], voxel_size_for(P, Aw, F, cfg['cards1']))
    c0, m0, f0 = voxels(P, Aw, F, v0)
    c1, m1, f1 = voxels(P, Aw, F, v1)
    L0, L1 = v0 * cfg['cardScale'], v1 * cfg['cardScale']
    log('voxel0', round(v0, 3), 'cards', len(c0), 'L0', round(L0, 2), '| voxel1', round(v1, 3), 'cards', len(c1), 'L1', round(L1, 2))

    # ---- clump renders
    cam = U.setup_render(CELL, CELL, samples=cfg.get('samples', 12))
    hsv = cfg.get('hsv', {})
    albedo = {}
    for o in objs + [twigs]:
        k = 'bark' if o is twigs else cat[o.name]
        if o in bark:
            continue
        img = src_img.get(o.name) if o is not twigs else bark_img
        albedo[o.name] = (o, img, k)
    orig = {o.name: list(o.data.materials) for o, _, _ in albedo.values()}

    def clump_set(cen, mass, fl, L, v, K, tag):
        order = np.argsort(-mass)
        heavy = order[: max(K * 4, int(len(order) * 0.35))]
        chosen = []
        # spread the flower ratio: pick K quantiles of flower share among heavy voxels, spaced apart
        qs = np.linspace(0.05, 0.95, K)
        fh = fl[heavy]
        for q in qs:
            target = np.quantile(fh, q)
            cand = heavy[np.argsort(np.abs(fh - target))]
            for ci in cand:
                if all(np.linalg.norm(cen[ci] - cen[j]) > L * 1.5 for j in chosen):
                    chosen.append(ci)
                    break
        paths, fls = [], []
        for i, ci in enumerate(chosen):
            p = cen[ci]
            d = out_dir(p, crown)
            d = d + np.array([0, 0, 0.15])
            dist = 80.0
            depth = v * cfg.get('slab', 1.25)
            alt = 'leafAlt' in hsv and (i % cfg.get('altEvery', 3) == 1)
            for on, (o, img, k) in albedo.items():
                key = 'bark' if k in ('bark', 'twig') else k
                if alt and k == 'leaf':
                    key = 'leafAlt'
                m = U.albedo_material('alb_' + on, img, alpha=k in ('leaf', 'flower', 'twig'),
                                      hsv=tuple(hsv.get(key, (0, 1, 1))),
                                      depth_dark=(dist - depth / 2, dist + depth / 2, 0.22),
                                      edge_cull=0.8 if k in ('leaf', 'flower') else None)
                o.data.materials.clear()
                o.data.materials.append(m)
            U.aim_camera(cam, p, d, dist=dist, ortho=L, depth=depth)
            path = os.path.join(wd, 'clumps', f'{tag}{i:02d}.png')
            U.render_to(path)
            paths.append(path)
            fls.append(float(fl[ci]))
            log('clump', tag, i, 'flower', round(float(fl[ci]), 2))
        return paths, fls

    for o in bark0, bark1:
        o.hide_render = True
    p0, fl0 = clump_set(c0, m0, f0, L0, v0, cfg['clumps0'], 'a')
    p1, fl1 = clump_set(c1, m1, f1, L1, v1, cfg['clumps1'], 'b')
    for on, (o, _, _) in albedo.items():
        o.data.materials.clear()
        for m in orig[on]:
            o.data.materials.append(m)

    # ---- atlas
    from PIL import Image
    atlas = np.zeros((CELL * ATLAS_N, CELL * ATLAS_N, 4), dtype=np.uint8)
    yy, xx = np.mgrid[0:CELL, 0:CELL]
    rr = np.hypot(xx - CELL / 2 + 0.5, yy - CELL / 2 + 0.5) / (CELL / 2)
    vign = np.clip((1.0 - rr) / 0.14, 0, 1)            # soft round clump edge
    cells0, cells1 = [], []
    for i, p in enumerate(p0 + p1):
        im = np.array(Image.open(p).convert('RGBA')).astype(np.float32)
        im[..., 3] *= vign
        cx, cy = i % ATLAS_N, i // ATLAS_N
        atlas[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL] = np.clip(im, 0, 255).astype(np.uint8)
        (cells0 if i < len(p0) else cells1).append(i)
    atlas = dilate_rgba(atlas)
    apath = os.path.join(wd, 'atlas.png')
    Image.fromarray(atlas, 'RGBA').save(apath)
    cov = [float((np.array(Image.open(p))[..., 3] > 127).mean()) for p in p0 + p1]
    log('clump coverage', [round(c, 2) for c in cov])

    # ---- remove source foliage & bark from the scene
    for o in objs + [twigs]:
        bpy.data.objects.remove(o, do_unlink=True)

    # ---- cards
    cards0 = build_cards('cards0', c0, f0, L0, cells0, fl0, crown, H, rng)
    cards1 = build_cards('cards1', c1, f1, L1, cells1, fl1, crown, H, rng, jitter=0.4)

    # ---- bark decimation
    t0 = U.decimate(bark0, cfg['bark0'])
    t1 = U.decimate(bark1, cfg['bark1'])
    for o in (bark0, bark1):
        set_bark_sway(o, H)
    log('bark tris', t0, t1)

    # ---- materials for export
    bark_g = graded_image(bark_img, hsv.get('bark', (0, 1, 1)), name + '_bark', max_size=512)
    bark_g.filepath_raw = os.path.join(wd, 'bark.png')
    bark_g.file_format = 'PNG'
    bark_g.save()
    atlas_img = bpy.data.images.load(apath)
    nimg = None
    if bark_nrm is not None:
        nimg = bpy.data.images.new(name + '_bark_n', *bark_nrm.size, alpha=False)
        px = np.empty(bark_nrm.size[0] * bark_nrm.size[1] * 4, dtype=np.float32)
        bark_nrm.pixels.foreach_get(px)
        nimg.pixels.foreach_set(px)
        nimg.colorspace_settings.name = 'Non-Color'
        if max(nimg.size) > 512:
            nimg.scale(max(4, nimg.size[0] // 2), max(4, nimg.size[1] // 2))
    m_bark0 = U.pbr_material('bark', bark_g, rough=0.95)
    m_bark1 = U.pbr_material('bark', bark_g, rough=0.95)
    m_leaf = U.pbr_material('foliage', atlas_img, alpha=True, rough=0.85, double=True)
    for o, m in ((bark0, m_bark0), (bark1, m_bark1), (cards0, m_leaf), (cards1, m_leaf)):
        o.data.materials.clear()
        o.data.materials.append(m)

    # ---- impostor (albedo + normal atlas of LOD0)
    lod0_objs = [bark0, cards0]
    allco = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in lod0_objs])
    R = float(np.linalg.norm(allco[:, :2], axis=1).max())
    Htop = float(allco[:, 2].max())
    imp_meta = None
    if cfg.get('impostor', True):
        m_alb = {m_bark0.name: U.albedo_material('imp_bark', bark_g, alpha=False),
                 m_leaf.name: U.albedo_material('imp_leaf', atlas_img, alpha=True, hard_alpha=True)}
        m_nrm = {m_bark0.name: U.normal_material('impn_bark'),
                 m_leaf.name: U.normal_material('impn_leaf', atlas_img, alpha=True)}
        imp_meta = render_impostor(lod0_objs, m_alb, m_nrm, wd, cfg.get('impSamples', 16))

    # ---- export LODs (bark + foliage joined: one mesh, two primitives)
    lod0 = U.join([bark0, cards0], name)
    lod1 = U.join([bark1, cards1], name + '_lod1')
    U.export_glb([lod0], os.path.join(wd, 'lod0.glb'))
    U.export_glb([lod1], os.path.join(wd, 'lod1.glb'))
    trunk_r = float(np.percentile(np.linalg.norm(allco[allco[:, 2] < 1.0][:, :2], axis=1), 90)) if (allco[:, 2] < 1.0).any() else 0.3
    meta = {
        'name': name, 'kind': 'tree', 'src': cfg['src'], 'height': round(Htop, 2), 'radius': round(R, 2),
        'trunkRadius': round(trunk_r, 2), 'crown': {'cy': round(crown[0], 2), 'rh': round(crown[1], 2), 'rv': round(crown[2], 2)},
        'tris': [U.tri_count(lod0), U.tri_count(lod1)],
        'tags': cfg.get('tags', []),
    }
    if imp_meta:
        meta['impostor'] = imp_meta
    json.dump(meta, open(os.path.join(wd, 'meta.json'), 'w'), indent=1)
    log('DONE', name, meta['tris'], 'H', meta['height'], 'R', meta['radius'])


# ------------------------------------------------------------------------------------------------ palms

def frond_frame(pts, tip):
    d = pts - tip
    u = d.mean(0)
    u /= max(np.linalg.norm(u), 1e-9)
    c = d - d.mean(0)
    w, V = np.linalg.eigh(c.T @ c)
    n = V[:, 0]
    n = n - u * (n @ u)
    n /= max(np.linalg.norm(n), 1e-9)
    if n[2] < 0:
        n = -n
    v = np.cross(n, u)
    return u, v, n


def build_palm(cfg):
    """Fan palms: trunk / stubs / petioles decimated; every frond (petiole + its leaflet fan) becomes a bent
    card grid. 12 template fronds are rendered (orthographic along their fan normal) into a 4x3 atlas; each
    frond instantiates the template with the closest elevation, transformed into its own frame. Skirt cards
    (dead fronds) keep their geometry at 2 tris each and use two of the source skirt textures (bottom row)."""
    from PIL import Image
    name = cfg['name']
    wd = os.path.join(WORK, name)
    os.makedirs(wd, exist_ok=True)
    rng = np.random.default_rng(zlib.crc32(name.encode()))
    U.reset()
    objs = U.import_glb(os.path.join(RAW, cfg['src'], 'model.glb'))

    def kind(o):
        n = U.mat_name(o).lower()
        if 'spine' in n:
            return 'drop'
        if 'crownshaft' in n:
            return 'crown'
        if 'trunk' in n:
            return 'trunk'
        if 'cut stalk' in n or 'cut_stalk' in n:
            return 'stub'
        if 'fur' in n:
            return 'skirt'
        if 'stalk' in n:
            return 'stalk'
        if 'leaf' in n:
            return 'leaflet'
        return 'drop'
    cat = {o.name: kind(o) for o in objs}
    imgs = {o.name: U.base_image(o.data.materials[0])[0] for o in objs}
    for o in objs:
        if cat[o.name] != 'skirt':
            keep_first_uv(o)
        else:
            uvs = o.data.uv_layers
            while len(uvs) > 1:
                uvs.remove(uvs[-1])
            uvs[0].name = 'UVMap'
    trunk = [o for o in objs if cat[o.name] == 'trunk']
    co = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in trunk])
    base = co[co[:, 2] < co[:, 2].min() + 0.5][:, :2].mean(0)
    mn, mx = U.bbox([o for o in objs if cat[o.name] != 'drop'])
    s = cfg['height'] / (mx[2] - max(mn[2], co[:, 2].min()))
    M = mathutils.Matrix.Scale(s, 4) @ mathutils.Matrix.Translation((-base[0], -base[1], -co[:, 2].min()))
    U.transform_all(objs, M)
    H = cfg['height']
    for o in objs:
        if cat[o.name] == 'drop':
            bpy.data.objects.remove(o, do_unlink=True)
    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    log(name, 'scale', round(s, 3), {k: sum(1 for o in objs if cat[o.name] == k) for k in set(cat[o.name] for o in objs)})

    # groups and one source image per group, captured before any join invalidates object references
    groups = {}
    cat_img = {}
    for o in objs:
        groups.setdefault(cat[o.name], []).append(o)
        cat_img.setdefault(cat[o.name], imgs[o.name])
    fur_src = [(U.mat_name(o), imgs[o.name]) for o in groups.get('skirt', [])]

    # ---- fronds: petiole islands + leaflet islands
    stalk_obj = U.join(groups.get('stalk', []), 'stalks')
    leaf_obj = U.join(groups.get('leaflet', []), 'leaflets')
    stalk_img = cat_img.get('stalk')

    def verts(o):
        a = np.empty(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get('co', a)
        return a.reshape(-1, 3)

    def poly_verts(o):
        ls = np.empty(len(o.data.polygons), dtype=np.int64)
        o.data.polygons.foreach_get('loop_start', ls)
        lt = np.empty(len(o.data.polygons), dtype=np.int64)
        o.data.polygons.foreach_get('loop_total', lt)
        lv = np.empty(len(o.data.loops), dtype=np.int64)
        o.data.loops.foreach_get('vertex_index', lv)
        return ls, lt, lv
    sv = verts(stalk_obj)
    s_isl = U.islands(stalk_obj)
    ls, lt, lv = poly_verts(stalk_obj)
    top = np.array([0, 0, H * 0.97])
    stalks = []
    for f in s_isl:
        vid = np.unique(np.concatenate([lv[ls[i]:ls[i] + lt[i]] for i in f]))
        p = sv[vid]
        dax = np.linalg.norm(p[:, :2], axis=1)
        tip = p[np.argmax(np.linalg.norm(p - top, axis=1))]
        root = p[np.argmin(dax)]
        stalks.append({'faces': f, 'tip': tip, 'root': root, 'len': float(np.linalg.norm(tip - root))})
    lvv = verts(leaf_obj)
    l_isl = U.islands(leaf_obj)
    ls2, lt2, lv2 = poly_verts(leaf_obj)
    tips = np.array([st['tip'] for st in stalks])
    fronds = [[] for _ in stalks]
    for f in l_isl:
        vid = np.unique(np.concatenate([lv2[ls2[i]:ls2[i] + lt2[i]] for i in f]))
        p = lvv[vid]
        dmin = np.linalg.norm(p[:, None, :] - tips[None, :, :], axis=2).min(0)
        fronds[int(np.argmin(dmin))].append((f, p))
    F = []
    for st, lf in zip(stalks, fronds):
        if len(lf) < 3:
            continue
        pts = np.concatenate([p for _, p in lf])
        u, v, n = frond_frame(pts, st['tip'])
        d = pts - st['tip']
        a, b, h = d @ u, d @ v, d @ n
        F.append({'st': st, 'faces': np.concatenate([f for f, _ in lf]), 'pts': pts, 'u': u, 'v': v, 'n': n,
                  'rect': (a.min(), a.max(), b.min(), b.max()), 'elev': float(math.degrees(math.asin(max(-1, min(1, u[2]))))),
                  'size': float(max(a.max() - a.min(), b.max() - b.min()))})
    log('fronds', len(F), 'stalks', len(stalks), 'leaflet islands', len(l_isl))

    # ---- templates: spread over elevation
    NT = 12
    el = np.array([f['elev'] for f in F])
    order = np.argsort(el)
    tidx = [int(order[int(round(q * (len(order) - 1)))]) for q in np.linspace(0.04, 0.96, NT)]
    cam = U.setup_render(CELL, CELL, samples=cfg.get('samples', 12))
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = True
    leaf_img = cat_img['leaflet']
    hsv = cfg.get('hsv', {})
    m_leaf = U.albedo_material('alb_leaflet', leaf_img, alpha=False, hsv=tuple(hsv.get('leaf', (0, 1, 1))))
    m_stalk = U.albedo_material('alb_stalk', stalk_img, alpha=False, hsv=tuple(hsv.get('leaf', (0, 1, 1))))
    templates = []
    for ti, fi in enumerate(tidx):
        fr = F[fi]
        tmp = U.duplicate(leaf_obj, 'tmpl')
        keep = np.zeros(len(tmp.data.polygons), bool)
        keep[fr['faces']] = True
        U.delete_faces(tmp, np.flatnonzero(~keep))
        tmp.data.materials.clear()
        tmp.data.materials.append(m_leaf)
        tmp.hide_render = False
        a0, a1, b0, b1 = fr['rect']
        pad = 0.03 * fr['size']
        a0, a1, b0, b1 = a0 - pad, a1 + pad, b0 - pad, b1 + pad
        side = max(a1 - a0, b1 - b0)
        ctr = fr['st']['tip'] + fr['u'] * (a0 + a1) / 2 + fr['v'] * (b0 + b1) / 2
        # camera looks along -n with image-up = +u (frond axis) -> image x = v... keep 'up' = u
        cam.location = mathutils.Vector(ctr + fr['n'] * 60)
        rot = mathutils.Matrix((tuple(-fr['v']), tuple(fr['u']), tuple(fr['n']))).transposed()
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = rot.to_quaternion()
        cam.data.ortho_scale = side
        cam.data.clip_start, cam.data.clip_end = 1, 120
        p = os.path.join(wd, f'frond{ti:02d}.png')
        U.render_to(p)
        bpy.data.objects.remove(tmp, do_unlink=True)
        # card grid heights: mean offset along n per grid node (from the frond points)
        d = fr['pts'] - fr['st']['tip']
        A, B, Hh = d @ fr['u'], d @ fr['v'], d @ fr['n']
        templates.append({'fi': fi, 'png': p, 'rect': ((a0 + a1) / 2, (b0 + b1) / 2, side), 'A': A, 'B': B, 'H': Hh,
                          'elev': fr['elev'], 'size': fr['size']})
        log('frond template', ti, 'elev', round(fr['elev'], 1), 'size', round(fr['size'], 2))

    # ---- atlas: 4x3 frond cells + bottom row: 2 skirt textures (512x256 each)
    atlas = np.zeros((CELL * 4, CELL * 4, 4), dtype=np.uint8)
    for ti, t in enumerate(templates):
        im = np.array(Image.open(t['png']).convert('RGBA'))
        cx, cy = ti % 4, ti // 4
        atlas[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL] = im
    skirt_objs = groups.get('skirt', [])
    fur_imgs = {}
    for mname, img in fur_src:
        g = '1' if '1' in mname.split('fur')[-1][:3] else '2'
        fur_imgs.setdefault(g, img)
    for gi, g in enumerate(('1', '2')):
        img = fur_imgs.get(g) or next(iter(fur_imgs.values()), None)
        if img is None:
            continue
        gimg = graded_image(img, hsv.get('skirt', (0, 1, 1)), 'fur' + g)
        gimg.scale(512, 256)
        px = np.empty(512 * 256 * 4, dtype=np.float32)
        gimg.pixels.foreach_get(px)
        px = (np.clip(px.reshape(256, 512, 4)[::-1], 0, 1) * 255).astype(np.uint8)   # Blender rows are bottom-up
        # Blender stores linear floats for sRGB images: convert back to sRGB bytes
        lin = px[..., :3] / 255.0
        srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
        px[..., :3] = (np.clip(srgb, 0, 1) * 255).astype(np.uint8)
        atlas[3 * CELL:4 * CELL, gi * 512:(gi + 1) * 512] = px
    atlas = dilate_rgba(atlas)
    apath = os.path.join(wd, 'atlas.png')
    Image.fromarray(atlas, 'RGBA').save(apath)

    # ---- frond cards
    def frond_mesh(nu, nv, lod):
        verts_, faces_, uvs_, nors_, sway_ = [], [], [], [], []
        from scipy.spatial import cKDTree
        tkd = []
        for t in templates:
            tkd.append(cKDTree(np.stack([t['A'], t['B']], 1)))
        tel = np.array([t['elev'] for t in templates])
        for fr in F:
            cand = np.argsort(np.abs(tel - fr['elev']))[:2]
            ti = int(cand[rng.integers(0, len(cand))])
            t = templates[ti]
            ac, bc, side = t['rect']
            k = fr['size'] / t['size']
            cx, cy = ti % 4, ti // 4
            base_i = len(verts_)
            flut = rng.uniform(0.6, 1.0)
            for j in range(nv + 1):
                for i in range(nu + 1):
                    a = ac + (i / nu - 0.5) * side
                    b = bc + (j / nv - 0.5) * side
                    dd, ii = tkd[ti].query([a, b], k=6)
                    w = 1 / np.maximum(dd, 0.02) ** 2
                    h = float((t['H'][ii] * w).sum() / w.sum())
                    p = fr['st']['tip'] + (fr['u'] * a + fr['v'] * b + fr['n'] * h) * k
                    verts_.append(p)
                    # image: x = -v... camera right = -v, up = u  => u_img = 0.5 - (b - bc)/side, v_img = 0.5 + (a - ac)/side
                    ui = 0.5 - (b - bc) / side
                    vi = 0.5 + (a - ac) / side
                    uvs_.append(((cx + ui) / 4, 1 - (cy + 1 - vi) / 4))
                    nn = fr['n'] * 0.6 + np.array([0, 0, 0.8]) + (p - np.array([0, 0, H * 0.9])) * 0.08
                    nors_.append(nn / np.linalg.norm(nn))
                    sway_.append((min(1.0, max(0.0, p[2] / H)) ** 1.5, flut * (0.3 + 0.7 * abs(a - ac + side / 2) / side)))
            for j in range(nv):
                for i in range(nu):
                    q = base_i + j * (nu + 1) + i
                    faces_.append((q, q + 1, q + nu + 2, q + nu + 1))
        me = bpy.data.meshes.new('fronds%d' % lod)
        me.from_pydata([tuple(x) for x in verts_], [], faces_)
        me.update()
        lvx = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get('vertex_index', lvx)
        me.uv_layers.new(name='UVMap').data.foreach_set('uv', np.array(uvs_)[lvx].ravel())
        me.uv_layers.new(name='Sway').data.foreach_set('uv', np.array(sway_)[lvx].ravel())
        me.normals_split_custom_set_from_vertices([tuple(x) for x in nors_])
        o = bpy.data.objects.new('fronds%d' % lod, me)
        bpy.context.scene.collection.objects.link(o)
        return o
    fr0 = frond_mesh(cfg.get('frondGrid0', [4, 4])[0], cfg.get('frondGrid0', [4, 4])[1], 0)
    fr1 = frond_mesh(1, 1, 1)
    bpy.data.objects.remove(leaf_obj, do_unlink=True)

    # ---- skirt: 2 tris per card, UVs into the atlas bottom row
    skirt0 = U.join(skirt_objs, 'skirt0') if skirt_objs else None
    skirt1 = None
    if skirt0 is not None:
        # which fur group each face used: by material slot name
        grp = []
        for m in skirt0.data.materials:
            g = '1' if '1' in m.name.split('fur')[-1][:3] else '2'
            grp.append(0 if g == '1' else 1)
        mi = np.empty(len(skirt0.data.polygons), dtype=np.int64)
        skirt0.data.polygons.foreach_get('material_index', mi)
        uvl = skirt0.data.uv_layers[0]
        uvv = np.empty(len(skirt0.data.loops) * 2)
        uvl.data.foreach_get('uv', uvv)
        uvv = uvv.reshape(-1, 2)
        ls3, lt3, _ = poly_verts(skirt0)
        for pi in range(len(skirt0.data.polygons)):
            g = grp[mi[pi]] if mi[pi] < len(grp) else 0
            for L in range(ls3[pi], ls3[pi] + lt3[pi]):
                u_, v_ = uvv[L]
                uvv[L] = ((g * 2 + np.clip(u_, 0, 1) * 2) / 4, 1 - (3 + 1 - np.clip(v_, 0, 1)) / 4)
        uvl.data.foreach_set('uv', uvv.ravel())
        skirt0.data.materials.clear()
        t0 = U.tri_count(skirt0)
        U.decimate(skirt0, max(200, int(len(U.islands(skirt0)) * 2.2)))
        # LOD1: every 4th card, scaled up 1.8x about its centre
        skirt1 = U.duplicate(skirt0, 'skirt1')
        isl = U.islands(skirt1)
        drop = np.concatenate([f for i, f in enumerate(isl) if i % 4] or [np.array([], int)])
        U.delete_faces(skirt1, drop)
        cov = verts(skirt1)
        for f in U.islands(skirt1):
            ls4, lt4, lv4 = poly_verts(skirt1)
            vid = np.unique(np.concatenate([lv4[ls4[i]:ls4[i] + lt4[i]] for i in f]))
            c = cov[vid].mean(0)
            cov[vid] = c + (cov[vid] - c) * 1.8
        skirt1.data.vertices.foreach_set('co', cov.ravel())
        skirt1.data.update()
        log('skirt tris', t0, '->', U.tri_count(skirt0), 'lod1', U.tri_count(skirt1))
        for o in (skirt0, skirt1):
            o.data.normals_split_custom_set_from_vertices([tuple((np.array(v.co[:]) * np.array([1, 1, 0]) / max(1e-6, np.linalg.norm(np.array(v.co[:2]))) + np.array([0, 0, 0.3])).tolist()) for v in o.data.vertices])
            set_bark_sway(o, H)

    # ---- trunk & friends
    trunk_o = U.join(groups.get('trunk', []), 'trunk0')
    crown_o = U.join(groups.get('crown', []), 'crown0')
    stubs_o = U.join(groups.get('stub', []), 'stubs0')
    trunk_img = cat_img['trunk']
    crown_img = cat_img.get('crown', trunk_img)
    stub_img = cat_img.get('stub', trunk_img)
    trunk1 = U.duplicate(trunk_o, 'trunk1')
    crown1 = U.duplicate(crown_o, 'crown1') if crown_o else None
    U.decimate(trunk_o, cfg.get('trunk0', 1400))
    U.decimate(trunk1, cfg.get('trunk1', 180))
    if crown_o:
        U.decimate(crown_o, cfg.get('crown0', 500))
        U.decimate(crown1, cfg.get('crown1', 60))
    if stubs_o:
        U.decimate(stubs_o, cfg.get('stubs0', 1800))
    U.decimate(stalk_obj, max(len(stalks) * 10, 300))
    for o in (trunk_o, trunk1, crown_o, crown1, stubs_o, stalk_obj):
        if o:
            set_bark_sway(o, H)

    # materials
    th = hsv.get('trunk', (0, 1, 1))
    g_trunk = graded_image(trunk_img, th, name + '_trunk', max_size=512)
    g_crown = graded_image(crown_img, th, name + '_crown', max_size=256)
    g_stub = graded_image(stub_img, hsv.get('stub', th), name + '_stub', max_size=256)
    g_stalk = graded_image(stalk_img, hsv.get('leaf', (0, 1, 1)), name + '_stalk', max_size=128) if stalk_img else None
    atlas_img = bpy.data.images.load(apath)
    m_trunk = U.pbr_material('bark', g_trunk, rough=0.95)
    m_crown = U.pbr_material('crown', g_crown, rough=0.95)
    m_stub = U.pbr_material('stubs', g_stub, rough=0.95)
    m_stalk2 = U.pbr_material('stalk', g_stalk, rough=0.8)
    m_frond = U.pbr_material('frond', atlas_img, alpha=True, rough=0.75, double=True)
    for o, m in ((trunk_o, m_trunk), (trunk1, m_trunk), (crown_o, m_crown), (crown1, m_trunk), (stubs_o, m_stub),
                 (stalk_obj, m_stalk2), (fr0, m_frond), (fr1, m_frond), (skirt0, m_frond), (skirt1, m_frond)):
        if o is None:
            continue
        o.data.materials.clear()
        o.data.materials.append(m)

    lod0_objs = [o for o in (trunk_o, crown_o, stubs_o, stalk_obj, fr0, skirt0) if o]
    lod1_objs = [o for o in (trunk1, crown1, fr1, skirt1) if o]
    # ---- impostor
    allco = np.concatenate([verts(o) for o in lod0_objs])
    R = float(np.linalg.norm(allco[:, :2], axis=1).max())
    Htop = float(allco[:, 2].max())
    alb, nrm = {}, {}
    for o in lod0_objs:
        m = o.data.materials[0]
        img, _ = U.base_image(m)
        is_alpha = o in (fr0, skirt0)
        alb[m.name] = U.albedo_material('ia_' + m.name, img, alpha=is_alpha, hard_alpha=True)
        nrm[m.name] = U.normal_material('in_' + m.name, img if is_alpha else None, alpha=is_alpha)
    imp_meta = render_impostor(lod0_objs, alb, nrm, wd, cfg.get('impSamples', 16))

    lod0 = U.join(lod0_objs, name)
    lod1 = U.join(lod1_objs, name + '_lod1')
    U.export_glb([lod0], os.path.join(wd, 'lod0.glb'))
    U.export_glb([lod1], os.path.join(wd, 'lod1.glb'))
    low = allco[allco[:, 2] < 1.0]
    meta = {
        'name': name, 'kind': 'tree', 'src': cfg['src'], 'height': round(Htop, 2), 'radius': round(R, 2),
        'trunkRadius': round(float(np.percentile(np.linalg.norm(low[:, :2], axis=1), 90)) if len(low) else 0.35, 2),
        'crown': {'cy': round(float(H * 0.93), 2), 'rh': round(R, 2), 'rv': round(float(H * 0.08), 2)},
        'tris': [U.tri_count(lod0), U.tri_count(lod1)],
        'impostor': imp_meta,
        'tags': cfg.get('tags', []),
    }
    json.dump(meta, open(os.path.join(wd, 'meta.json'), 'w'), indent=1)
    log('DONE', name, meta['tris'], 'H', meta['height'], 'R', meta['radius'])


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    imp_only = '--impostor-only' in argv
    argv = [a for a in argv if not a.startswith('--')]
    cfgs = json.load(open(os.path.join(HERE, 'trees.json')))['trees']
    for c in cfgs:
        if argv and c['name'] not in argv:
            continue
        if imp_only:
            if c.get('impostor', True):
                impostor_only(c)
            continue
        if c['kind'] == 'broadleaf':
            build_broadleaf(c)
        elif c['kind'] == 'palm':
            build_palm(c)


if __name__ == '__main__':
    main()
