# Minimal numpy UV-space rasteriser: for every texel covered by a triangle's UVs, returns the
# triangle id and barycentric coordinates, so any per-vertex attribute (rest position, normal,
# bone weights...) can be interpolated per texel. Used to paint procedural textures (Spider-Man
# suit, NPC atlases) directly in 3D space and to dilate texture islands (padding).
import numpy as np


def rasterize(uv, tris, size, supersample=False):
    """uv: (V,2) float in 0..1 (Blender convention, v up); tris: (T,3) int indices into uv.
    Returns tri_id (H,W) int32 (-1 = empty) and bary (H,W,3) float32. Image row 0 = top (v=1)."""
    H = W = size
    tri_id = np.full((H, W), -1, np.int32)
    bary = np.zeros((H, W, 3), np.float32)
    P = np.empty_like(uv, dtype=np.float64)
    P[:, 0] = uv[:, 0] * W - 0.5
    P[:, 1] = (1.0 - uv[:, 1]) * H - 0.5
    A, B, Cc = P[tris[:, 0]], P[tris[:, 1]], P[tris[:, 2]]
    xmin = np.clip(np.floor(np.minimum(np.minimum(A[:, 0], B[:, 0]), Cc[:, 0])).astype(int), 0, W - 1)
    xmax = np.clip(np.ceil(np.maximum(np.maximum(A[:, 0], B[:, 0]), Cc[:, 0])).astype(int), 0, W - 1)
    ymin = np.clip(np.floor(np.minimum(np.minimum(A[:, 1], B[:, 1]), Cc[:, 1])).astype(int), 0, H - 1)
    ymax = np.clip(np.ceil(np.maximum(np.maximum(A[:, 1], B[:, 1]), Cc[:, 1])).astype(int), 0, H - 1)
    den = (B[:, 1] - Cc[:, 1]) * (A[:, 0] - Cc[:, 0]) + (Cc[:, 0] - B[:, 0]) * (A[:, 1] - Cc[:, 1])
    eps = -1e-4
    for t in range(len(tris)):
        if abs(den[t]) < 1e-12:
            continue
        xs = np.arange(xmin[t], xmax[t] + 1)
        ys = np.arange(ymin[t], ymax[t] + 1)
        gx, gy = np.meshgrid(xs, ys)
        w0 = ((B[t, 1] - Cc[t, 1]) * (gx - Cc[t, 0]) + (Cc[t, 0] - B[t, 0]) * (gy - Cc[t, 1])) / den[t]
        w1 = ((Cc[t, 1] - A[t, 1]) * (gx - Cc[t, 0]) + (A[t, 0] - Cc[t, 0]) * (gy - Cc[t, 1])) / den[t]
        w2 = 1.0 - w0 - w1
        m = (w0 >= eps) & (w1 >= eps) & (w2 >= eps)
        if not m.any():
            continue
        yy, xx = gy[m], gx[m]
        tri_id[yy, xx] = t
        bary[yy, xx, 0] = w0[m]
        bary[yy, xx, 1] = w1[m]
        bary[yy, xx, 2] = w2[m]
    return tri_id, bary


def interp(attr, tris, tri_id, bary):
    """attr: (V,k) per-(uv)vertex attribute. Returns (H,W,k) interpolated (zeros where empty)."""
    H, W = tri_id.shape
    out = np.zeros((H, W, attr.shape[1]), np.float32)
    m = tri_id >= 0
    t = tris[tri_id[m]]
    b = bary[m]
    out[m] = attr[t[:, 0]] * b[:, 0:1] + attr[t[:, 1]] * b[:, 1:2] + attr[t[:, 2]] * b[:, 2:3]
    return out


def dilate(img, mask, iters=8):
    """Grow texture islands outwards by `iters` pixels (edge padding) so mip-maps/bilinear
    filtering don't bleed the background into the seams."""
    img = img.copy()
    mask = mask.copy()
    for _ in range(iters):
        acc = np.zeros_like(img, dtype=np.float32)
        cnt = np.zeros(mask.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            sm = np.roll(np.roll(mask, dy, 0), dx, 1)
            si = np.roll(np.roll(img, dy, 0), dx, 1)
            acc += si * sm[..., None]
            cnt += sm
        new = (~mask) & (cnt > 0)
        img[new] = (acc[new] / cnt[new][:, None]).astype(img.dtype)
        mask = mask | new
    return img, mask


def mesh_loop_arrays(me, uv_name=None):
    """From a bpy mesh (already triangulated or not) return per-loop-triangle arrays:
    uv (L,2), tris (T,3) indices into loops, loop->vertex index (L,), and triangle->polygon (T,)."""
    me.calc_loop_triangles()
    L = len(me.loops)
    uvl = me.uv_layers[uv_name] if uv_name else me.uv_layers.active
    uv = np.empty(L * 2, np.float32)
    uvl.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    lv = np.empty(L, np.int32)
    me.loops.foreach_get('vertex_index', lv)
    T = len(me.loop_triangles)
    tl = np.empty(T * 3, np.int32)
    me.loop_triangles.foreach_get('loops', tl)
    tp = np.empty(T, np.int32)
    me.loop_triangles.foreach_get('polygon_index', tp)
    return uv, tl.reshape(-1, 3), lv, tp


def uv_islands(me, uv_name=None):
    """Connected components of polygons in UV space. Returns (poly_island (P,), n_islands)."""
    uvl = me.uv_layers[uv_name] if uv_name else me.uv_layers.active
    L = len(me.loops)
    uv = np.empty(L * 2, np.float32); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    P = len(me.polygons)
    parent = np.arange(P)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    # map (edge key, uv pair) -> polygon
    seen = {}
    for p in me.polygons:
        ls = list(p.loop_indices)
        vs = [me.loops[l].vertex_index for l in ls]
        for k in range(len(ls)):
            a, b = vs[k], vs[(k + 1) % len(ls)]
            ua, ub = uv[ls[k]], uv[ls[(k + 1) % len(ls)]]
            if a > b:
                a, b, ua, ub = b, a, ub, ua
            key = (a, b, round(float(ua[0]), 5), round(float(ua[1]), 5), round(float(ub[0]), 5), round(float(ub[1]), 5))
            q = seen.get(key)
            if q is None:
                seen[key] = p.index
            else:
                ra, rb = find(p.index), find(q)
                if ra != rb:
                    parent[ra] = rb
    roots = np.array([find(i) for i in range(P)])
    _, isl = np.unique(roots, return_inverse=True)
    return isl, isl.max() + 1
