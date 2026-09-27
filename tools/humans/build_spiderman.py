# Builds Spider-Man: an athletic MakeHuman (MPFB) male, ~1.78 m, game_engine rig, turned into a
# smooth masked head (ears/eyes/lips smoothed away), then paints two procedural suits (classic and
# symbiote) straight into the MakeHuman UV layout at 2K and exports the glb.
#
#   python build_spiderman.py            -> $HUMANS_SCRATCH/spiderman/spiderman_{classic,symbiote}.glb (+ .blend)
# The two exports are merged into one file with both materials by merge_suits.mjs, then compressed.
import sys, os, math, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
import mh_common as C

OUT = os.path.join(C.SCRATCH, 'spiderman')
os.makedirs(OUT, exist_ok=True)
TEX = int(os.environ.get('SM_TEX', '2048'))

SPEC = dict(
    name='spiderman',
    phenotype=dict(gender=1.0, age=0.5, muscle=0.9, weight=0.5, height=0.545, proportions=1.0),
    race={'african': 0.25, 'asian': 0.25, 'caucasian': 0.5},
    targets=[('ears/r-ear-scale-decr', 1.0), ('ears/l-ear-scale-decr', 1.0),
             ('ears/r-ear-flap-decr', 1.0), ('ears/l-ear-flap-decr', 1.0),
             ('ears/r-ear-scale-depth-decr', 1.0), ('ears/l-ear-scale-depth-decr', 1.0),
             ('nose/nose-scale-depth-decr', 0.4), ('nose/nose-nostrils-width-decr', 0.6)],
)


def vgroup_weights(o, name):
    vg = o.vertex_groups.get(name)
    w = np.zeros(len(o.data.vertices), np.float32)
    if vg is None:
        return w
    idx = vg.index
    for v in o.data.vertices:
        for g in v.groups:
            if g.group == idx:
                w[v.index] = g.weight
    return w


def neighbours(me):
    n = len(me.vertices)
    ev = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get('vertices', ev)
    ev = ev.reshape(-1, 2)
    nb = [[] for _ in range(n)]
    for a, b in ev:
        nb[a].append(b)
        nb[b].append(a)
    return nb, ev


def smooth_field(EV, w, iters, keep=0.85):
    n = len(w)
    cnt = np.maximum(np.bincount(EV[:, 0], minlength=n) + np.bincount(EV[:, 1], minlength=n), 1)
    for _ in range(iters):
        acc = np.bincount(EV[:, 0], weights=w[EV[:, 1]], minlength=n) + np.bincount(EV[:, 1], weights=w[EV[:, 0]], minlength=n)
        w = np.maximum(w, keep * acc / cnt)
    return w


def laplacian(co, EV, w, iters, lam=0.5, mu=None):
    n = len(co)
    cnt = np.bincount(EV[:, 0], minlength=n) + np.bincount(EV[:, 1], minlength=n)
    cnt = np.maximum(cnt, 1)[:, None]
    for _ in range(iters):
        for f in ((lam,) if mu is None else (lam, mu)):
            acc = np.zeros_like(co)
            np.add.at(acc, EV[:, 0], co[EV[:, 1]])
            np.add.at(acc, EV[:, 1], co[EV[:, 0]])
            co = co + f * w[:, None] * (acc / cnt - co)
    return co


def quadric_patch(co, centre, axis_scale, r0, r1, ring, force=None, normal_hint=(0, 1, 0)):
    """Replace the surface around `centre` by a smooth quadric height field fitted to the ring of
    vertices between r1 and `ring` (ellipsoidal distance using axis_scale). Vertices within r0 are
    projected fully, r0..r1 blended; `force` marks extra vertices (inner mouth / eye sockets) that
    are always projected."""
    d = np.linalg.norm((co - centre) * axis_scale, axis=1)
    fit = (d > r1) & (d < ring) & (co[:, 1] > centre[1] - 0.02)
    n = np.array(normal_hint, float); n /= np.linalg.norm(n)
    ex = np.cross([0, 0, 1.0], n); ex /= np.linalg.norm(ex)
    ey = np.cross(n, ex)
    def local(p):
        q = p - centre
        return q @ ex, q @ ey, q @ n
    x, y, z = local(co[fit])
    A = np.stack([x * x, x * y, y * y, x, y, np.ones_like(x)], 1)
    coef, *_ = np.linalg.lstsq(A, z, rcond=None)
    w = np.clip((r1 - d) / (r1 - r0), 0, 1)
    w = w * w * (3 - 2 * w)
    if force is not None:
        w = np.maximum(w, force.astype(float))
    sel = w > 0
    x, y, z = local(co[sel])
    zq = np.stack([x * x, x * y, y * y, x, y, np.ones_like(x)], 1) @ coef
    znew = z + (zq - z) * w[sel]
    co = co.copy()
    co[sel] = centre + np.outer(x, ex) + np.outer(y, ey) + np.outer(znew, n)
    return co


def mask_head(o, eye_centres):
    """Turn the face into a fabric mask: flatten ears, cover the eye sockets and mouth with smooth
    quadric patches (inner-mouth / eye-socket islands collapse onto them), soften nostrils and
    fine facial detail while keeping the skull, brow ridge, nose and chin shape."""
    import uvraster
    me = o.data
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    _, EV = neighbours(me)
    head_w = vgroup_weights(o, 'head')
    ears = vgroup_weights(o, 'ears')
    lips = vgroup_weights(o, 'lips')
    # inner islands: eye sockets + mouth cavity (small UV islands whose centroid is inside the head)
    isl, ni = uvraster.uv_islands(me)
    pv = [list(p.vertices) for p in me.polygons]
    inner_eye = np.zeros(n, bool); inner_mouth = np.zeros(n, bool)
    lip_c = co[lips > 0.5].mean(0)
    for i in range(ni):
        ps = np.nonzero(isl == i)[0]
        vs = np.unique(np.concatenate([pv[p] for p in ps]))
        c = co[vs].mean(0)
        if len(ps) > 2000:
            continue
        if min(np.linalg.norm(c - e) for e in eye_centres) < 0.03:
            inner_eye[vs] = True
        elif np.linalg.norm(c - lip_c) < 0.06:
            inner_mouth[vs] = True
    print('inner eye verts', inner_eye.sum(), 'inner mouth verts', inner_mouth.sum())
    # ears: collapse with laplacian
    ears = smooth_field(EV, np.clip(ears, 0, 1), 4)
    co = laplacian(co, EV, ears, 80, lam=0.6)
    # membrane: fabric stretched over the face. The eye-socket / mouth-cavity islands are removed
    # from the smoothing graph and the slits they leave (eyelids, lips) are stitched with virtual
    # edges; then Laplacian smoothing where exterior vertices may not sink below their original
    # surface, so the fabric rests on brow, nose, cheekbones, lips and chin and spans the slits.
    me.vertices.foreach_set('co', co.ravel()); me.update()
    n0 = np.empty(n * 3); me.vertices.foreach_get('normal', n0); n0 = n0.reshape(-1, 3)
    co0 = co.copy()
    inner = inner_eye | inner_mouth
    ext_edges = EV[~inner[EV[:, 0]] & ~inner[EV[:, 1]]]
    border = np.zeros(n, bool)
    cross = EV[inner[EV[:, 0]] != inner[EV[:, 1]]]
    border[cross[~inner[cross[:, 0]], 0]] = True
    border[cross[~inner[cross[:, 1]], 1]] = True
    bidx = np.nonzero(border)[0]
    virt = []
    for b in bidx:
        d = co[bidx] - co[b]
        across = (np.abs(d[:, 2]) > 0.8 * np.abs(d[:, 0])) & (np.linalg.norm(d, axis=1) > 1e-5)
        if not across.any():
            continue
        dist = np.where(across, np.linalg.norm(d, axis=1), 9)
        c = bidx[np.argmin(dist)]
        if dist.min() < 0.02:
            virt.append((b, c))
    virt = np.array(virt, np.int64).reshape(-1, 2)
    print('border verts', len(bidx), 'virtual edges', len(virt))
    G = np.concatenate([ext_edges, virt, virt]) if len(virt) else ext_edges  # stitch edges weigh 2x
    w = smooth_field(EV, np.clip(head_w * 1.5 - 0.2, 0, 1), 3, keep=0.7)
    w[border] = 1.0
    free = np.zeros(n, bool)
    free[border] = True  # lid / lip edges may move inwards to meet each other
    cnt = np.maximum(np.bincount(G[:, 0], minlength=n) + np.bincount(G[:, 1], minlength=n), 1)[:, None]
    for it in range(200):
        acc = np.zeros_like(co)
        np.add.at(acc, G[:, 0], co[G[:, 1]])
        np.add.at(acc, G[:, 1], co[G[:, 0]])
        co = co + 0.5 * w[:, None] * (acc / cnt - co)
        d = ((co - co0) * n0).sum(1)
        push = (d < 0) & ~inner & ~free
        co[push] -= d[push][:, None] * n0[push]
    # cavity vertices: tuck them just behind their nearest border vertex
    from scipy.spatial import cKDTree
    kd = cKDTree(co[bidx])
    ii = np.nonzero(inner)[0]
    _, j = kd.query(co[ii])
    co[ii] = co[bidx[j]] - n0[bidx[j]] * 0.002
    me.vertices.foreach_set('co', co.ravel())
    me.update()
    # delete the cavity faces and weld the stitched lid / lip edges so no slit or crease remains
    bm = bmesh.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    pairs = [(bm.verts[int(a)], bm.verts[int(b)]) for a, b in virt]
    dead = [f for f in bm.faces if all(inner[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    tmap = {}
    for a, b in pairs:
        if a.is_valid and b.is_valid and a not in tmap and b not in tmap and (a.co - b.co).length < 0.006:
            tmap[a] = b
    bmesh.ops.weld_verts(bm, targetmap=tmap)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(me); bm.free(); me.update()
    print('eye/mouth weld: removed', len(dead), 'cavity faces, welded', len(tmap), 'vertex pairs')
    # final unconstrained smoothing of the lens / mouth area
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    _, EV = neighbours(me)
    w = np.zeros(n)
    for e in eye_centres:
        d = np.linalg.norm(co - e, axis=1)
        w = np.maximum(w, np.clip((0.03 - d) / 0.012, 0, 1))
    d = np.linalg.norm((co - lip_c) * np.array([0.6, 1, 1]), axis=1)
    w = np.maximum(w, np.clip((0.024 - d) / 0.01, 0, 1) * 0.7)
    co = laplacian(co, EV, w, 25, lam=0.5, mu=-0.52)
    # lens centres: plain laplacian irons out folds left by the weld
    w2 = np.zeros(n)
    for e in eye_centres:
        d = np.linalg.norm(co - e, axis=1)
        w2 = np.maximum(w2, np.clip((0.022 - d) / 0.008, 0, 1))
    co = laplacian(co, EV, w2, 40, lam=0.6)
    me.vertices.foreach_set('co', co.ravel())
    me.update()


def build():
    C.enable_mpfb(); C.clear_scene()
    arm, bm = C.build_human(SPEC)
    C.bake_shape_keys(bm)
    # eye centres from the (still present) helper geometry
    me = bm.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    eyes = []
    for g in ('helper-l-eye', 'helper-r-eye'):
        w = vgroup_weights(bm, g)
        eyes.append(co[w > 0.5].mean(0))
    meshes = C.finalize(arm)
    body = meshes[0]
    R = Matrix.Rotation(math.pi, 3, 'Z')
    eyes = [np.array(R @ Vector(e)) for e in eyes]
    mask_head(body, eyes)
    body.name = 'spiderman_body'
    body.data.name = 'spiderman_body'
    for k in list(body.keys()):
        del body[k]
    arm.name = 'spiderman'
    global EYES
    EYES = eyes
    return arm, body


PARTS = {'head': 0, 'neck_01': 0, 'pelvis': 1, 'spine_01': 1, 'spine_02': 1, 'spine_03': 1,
         'clavicle_l': 1, 'clavicle_r': 1, 'upperarm_l': 2, 'upperarm_r': 2, 'lowerarm_l': 3, 'lowerarm_r': 3,
         'thigh_l': 5, 'thigh_r': 5, 'calf_l': 6, 'calf_r': 6, 'foot_l': 7, 'foot_r': 7, 'ball_l': 7, 'ball_r': 7}


def part_weights(o):
    names = {g.index: g.name for g in o.vertex_groups}
    W = np.zeros((len(o.data.vertices), 8), np.float32)
    for v in o.data.vertices:
        for g in v.groups:
            nm = names[g.group]
            if nm in PARTS:
                W[v.index, PARTS[nm]] += g.weight
            elif nm.startswith(('hand_', 'thumb_', 'index_', 'middle_', 'ring_', 'pinky_')):
                W[v.index, 4] += g.weight
    return W / np.maximum(W.sum(1, keepdims=True), 1e-6)


def joints(arm):
    J = {}
    for b in arm.data.bones:
        J[b.name] = np.array(b.head_local)
    for sfx in ('l', 'r'):
        J['middle_tip_' + sfx] = np.array(arm.data.bones['middle_03_' + sfx].tail_local)
        J['toe_' + sfx] = np.array(arm.data.bones['ball_' + sfx].tail_local)
    return J


def edge_grad(co, EV, f):
    g = np.abs(f[EV[:, 0]] - f[EV[:, 1]]) / np.maximum(np.linalg.norm(co[EV[:, 0]] - co[EV[:, 1]], axis=1), 1e-6)
    out = np.zeros(len(co))
    np.maximum.at(out, EV[:, 0], g)
    np.maximum.at(out, EV[:, 1], g)
    return out


def paint_textures(body, arm, size):
    import uvraster as UR, suit_paint as SP
    from PIL import Image
    t0 = time.time()
    me = body.data
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(n * 3); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    W = part_weights(body)
    _, EV = neighbours(me)
    # seam fields (3D): neck base (head vs torso) and shoulders (torso vs upper arm)
    f1 = W[:, 0] - W[:, 1]
    f2 = W[:, 1] - W[:, 2]
    g1 = edge_grad(co, EV, f1); g2 = edge_grad(co, EV, f2)
    uv, tl, lv, tp = UR.mesh_loop_arrays(me)
    tid, bary = UR.rasterize(uv, tl, size)
    print('raster', time.time() - t0)
    m = tid >= 0
    attr = np.concatenate([co, nr, W, np.stack([f1, g1, f2, g2], 1)], 1).astype(np.float32)
    img = UR.interp(attr[lv], tl, tid, bary)
    # texel size (m) from the position gradient, on a dilated position image
    pimg, _ = UR.dilate(img[..., :3], m, 3)
    gy, gx = np.gradient(pimg, axis=(0, 1))
    texel = np.maximum(np.linalg.norm(gx, axis=2), np.linalg.norm(gy, axis=2))
    texel = np.clip(texel, 1e-4, 0.01)
    P = img[m][:, :3]; Nn = img[m][:, 3:6]; Wt = img[m][:, 6:14]
    F = img[m][:, 14:18]
    parts = np.argmax(Wt, 1)
    J = joints(arm)
    J['eye_l'], J['eye_r'] = EYES[0], EYES[1]
    res = SP.paint(P.astype(np.float64), Nn, None, J, texel[m], parts)
    # part seams: black ring lines where the web pattern changes coordinate system
    d1 = np.abs(F[:, 0]) / np.maximum(F[:, 1], 1e-3)
    d2 = np.abs(F[:, 2]) / np.maximum(F[:, 3], 1e-3)
    near1 = (parts <= 1) & ((Wt[:, 0] + Wt[:, 1]) > 0.8)
    near2 = ((parts == 1) | (parts == 2)) & ((Wt[:, 1] + Wt[:, 2]) > 0.8)
    seam = np.maximum(SP.line_cov(np.where(near1, d1, 1e9), SP.LINE_W, texel[m]),
                      SP.line_cov(np.where(near2, d2, 1e9), SP.LINE_W, texel[m]))
    # only where the suit is red (seams in the blue armpits would look odd)
    redish = res['classic'][:, 0] > res['classic'][:, 2]
    seam = seam * redish
    BLACK = np.array([0.018, 0.018, 0.022])
    res['classic'] = res['classic'] * (1 - seam[:, None]) + np.outer(seam, BLACK)
    res['height'] = np.maximum(res['height'], np.clip(1 - np.where(near1, d1, 1e9) / (SP.BUMP_W * .5), 0, 1) ** .7 * redish)
    res['height'] = np.maximum(res['height'], np.clip(1 - np.where(near2, d2, 1e9) / (SP.BUMP_W * .5), 0, 1) ** .7 * redish)
    out = {}
    H, Wd = m.shape

    def to_img(vals, ch):
        a = np.zeros((H, Wd, ch), np.float32)
        a[m] = vals.reshape(-1, ch)
        a, _ = UR.dilate(a, m, 12)
        return a
    def srgb(c):
        c = np.clip(c, 0, 1)
        return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    for k in ('classic', 'symbiote'):
        a = to_img(res[k], 3)
        Image.fromarray((srgb(a) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'suit_{k}_base.png'))
        r = to_img(res[k + '_rough'], 1)[..., 0]
        mr = np.zeros((H, Wd, 3), np.uint8)
        mr[..., 1] = (np.clip(r, 0, 1) * 255).astype(np.uint8)
        Image.fromarray(mr).resize((size // 2, size // 2), Image.LANCZOS).save(os.path.join(OUT, f'suit_{k}_mr.png'))
    # normal map from the height field (tangent space, OpenGL / glTF convention: +Y = +V)
    h = to_img(res['height'], 1)[..., 0] * 0.0011   # metres of relief
    h = h * 1.0
    dh_row, dh_col = np.gradient(h)
    tx = np.linalg.norm(gx, axis=2); ty = np.linalg.norm(gy, axis=2)
    sx = dh_col / np.maximum(tx, 1e-4)
    sy = -dh_row / np.maximum(ty, 1e-4)
    nrm = np.stack([-sx, -sy, np.ones_like(sx)], 2)
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    nimg = np.zeros_like(nrm); nimg[m] = nrm[m]
    nimg, _ = UR.dilate(nimg, m, 12)
    nimg[~(np.linalg.norm(nimg, axis=2) > 0)] = (0, 0, 1)
    Image.fromarray(((nimg * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, 'suit_normal.png'))
    print('paint', time.time() - t0)


def make_material(name, base, mr, normal):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    def tex(path, non_color):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(path)
        if non_color:
            n.image.colorspace_settings.name = 'Non-Color'
        return n
    tb = tex(base, False)
    nt.links.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
    tm = tex(mr, True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    if normal:
        tn = tex(normal, True)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def decimate(o, target_tris):
    tris = C.mesh_tris(o)
    if tris <= target_tris:
        return
    md = o.modifiers.new('dec', 'DECIMATE')
    md.ratio = target_tris / tris
    md.use_symmetry = True
    md.symmetry_axis = 'X'
    with bpy.context.temp_override(object=o, active_object=o):
        bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
    C._apply_modifier(o, 'dec')


if __name__ == '__main__':
    t0 = time.time()
    arm, body = build()
    decimate(body, 23000)
    tri = body.modifiers.new('tri', 'TRIANGULATE')
    with bpy.context.temp_override(object=body, active_object=body):
        bpy.ops.object.modifier_move_to_index(modifier='tri', index=0)
    C._apply_modifier(body, 'tri')
    print('tris', C.mesh_tris(body), 'build', time.time() - t0)
    C.remove_unused_vertex_groups(body, arm)
    paint_textures(body, arm, TEX)
    body.data.materials.clear()
    mc = make_material('suit_classic', os.path.join(OUT, 'suit_classic_base.png'), os.path.join(OUT, 'suit_classic_mr.png'), os.path.join(OUT, 'suit_normal.png'))
    ms = make_material('suit_symbiote', os.path.join(OUT, 'suit_symbiote_base.png'), os.path.join(OUT, 'suit_symbiote_mr.png'), os.path.join(OUT, 'suit_normal.png'))
    body.data.materials.append(mc)
    bpy.ops.object.shade_smooth() if False else None
    for p in body.data.polygons:
        p.use_smooth = True
    # height for the game's pelvis scaling
    arm['hipHeight'] = float(arm.data.bones['pelvis'].head_local[2])
    arm['height'] = float(max(v.co[2] for v in body.data.vertices))
    json.dump(C.rest_rotations(arm), open(os.path.join(OUT, 'ref_rest.json'), 'w'))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'spiderman.blend'))
    C.export_glb(os.path.join(OUT, 'spiderman_classic.glb'), [arm, body])
    body.data.materials[0] = ms
    C.export_glb(os.path.join(OUT, 'spiderman_symbiote.glb'), [arm, body])
    body.data.materials[0] = mc
    print('done', time.time() - t0)
