# Texture-atlas baking for NPCs: joins all parts of a character into one mesh, packs a new UV set
# ("atlas", texel density by 3D area, faces/hands enlarged) and bakes every part's (recoloured)
# diffuse texture into a single 1K atlas with numpy (no GPU / Cycles needed).
import os, math
import bpy
import numpy as np
from PIL import Image
import uvraster as UR

_IMG = {}


def srgb2lin(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def hex2lin(h):
    h = h.lstrip('#')
    return srgb2lin(np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32))


def load_image(path, max_size=1024):
    key = (path, max_size)
    if key not in _IMG:
        im = Image.open(path).convert('RGBA')
        if max(im.size) > max_size:
            im = im.resize((max_size, max_size), Image.LANCZOS)
        a = np.asarray(im, np.float32) / 255.0
        a[..., :3] = srgb2lin(a[..., :3])
        _IMG[key] = a
    return _IMG[key]


def diffuse_path(obj):
    for m in obj.data.materials:
        if not m or not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                p = bpy.path.abspath(n.image.filepath)
                if 'normal' in os.path.basename(p).lower() or '_ao' in os.path.basename(p).lower():
                    continue
                return os.path.normpath(p)
    return None


def sample(img, uv):
    """bilinear sample, uv (N,2) Blender convention (v up), wrapping."""
    H, W = img.shape[:2]
    x = (uv[:, 0] % 1.0) * W - 0.5
    y = (1.0 - (uv[:, 1] % 1.0)) * H - 0.5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    x0 %= W; y0 %= H; x1 = (x0 + 1) % W; y1 = (y0 + 1) % H
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy) +
            img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


def blurred_lum(img, sigma_px, mask=None):
    """Low-frequency luminance of a texture. With `mask` (H,W bool: texels the mesh actually uses)
    the blur is normalised over the mask, so island padding / background never bleeds in."""
    from scipy.ndimage import gaussian_filter
    lum = img[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    if mask is None:
        return gaussian_filter(lum, sigma_px, mode='wrap')
    m = mask.astype(np.float32)
    num = gaussian_filter(lum * m, sigma_px, mode='wrap')
    den = gaussian_filter(m, sigma_px, mode='wrap')
    mean = float((lum * m).sum() / max(m.sum(), 1.0))
    return np.where(den > 1e-3, num / np.maximum(den, 1e-3), mean).astype(np.float32)


def uv_mask(obj, shape, grow=1):
    """(H,W) bool mask of the texels covered by obj's active UV map (image row 0 = top)."""
    from scipy.ndimage import binary_dilation
    H, W = shape
    S = max(H, W)
    uv, tl, lv, tp = UR.mesh_loop_arrays(obj.data)
    tid, _ = UR.rasterize(np.clip(uv, 0.0, 1.0), tl, S)
    m = tid >= 0
    if (H, W) != (S, S):
        m = np.asarray(Image.fromarray(m.astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 127
    if grow:
        m = binary_dilation(m, iterations=grow)
    return m


def join(objs, name):
    for o in objs:
        me = o.data
        # single UV layer called UVMap
        while len(me.uv_layers) > 1:
            me.uv_layers.remove(me.uv_layers[-1])
        if len(me.uv_layers) == 0:
            me.uv_layers.new(name='UVMap')
        me.uv_layers[0].name = 'UVMap'
    for i, o in enumerate(objs):
        o.data.materials.clear()
        m = bpy.data.materials.get(f'__part{i}') or bpy.data.materials.new(f'__part{i}')
        o.data.materials.append(m)
    base = objs[0]
    with bpy.context.temp_override(active_object=base, object=base, selected_objects=objs,
                                   selected_editable_objects=objs):
        bpy.ops.object.join()
    base.name = name
    base.data.name = name
    return base


def pack_atlas(obj, boost=None, margin=0.006):
    """new UV layer 'atlas': islands scaled by 3D area, optional per-polygon boost (P,) factors,
    then packed with Blender's packer."""
    me = obj.data
    uvl = me.uv_layers.new(name='atlas')
    me.uv_layers.active = uvl
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(o == obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    # edit-mode round trips reallocate the mesh layers: the old `uvl` wrapper now dangles (it made
    # Blender segfault intermittently here), so look the layer up again
    uvl = me.uv_layers['atlas']
    if boost is not None:
        isl, ni = UR.uv_islands(me, 'atlas')
        uv = np.empty(len(me.loops) * 2, np.float32); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        pl = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('loop_start', pl)
        pn = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', pn)
        loop_poly = np.repeat(np.arange(len(me.polygons)), pn)
        for i in range(ni):
            ps = np.nonzero(isl == i)[0]
            f = float(np.max(boost[ps]))
            if abs(f - 1) < 1e-3:
                continue
            m = np.isin(loop_poly, ps)
            c = uv[m].mean(0)
            uv[m] = c + (uv[m] - c) * f
        uvl.data.foreach_set('uv', uv.ravel())
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin=margin, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    return me.uv_layers['atlas']


def bake(obj, parts, size, extra_vertex_attrs=None):
    """parts: list (index = material index) of dict(img=np RGBA linear or None, rule=callable).
    rule(ctx) -> (N,3) linear rgb where ctx = dict(src (N,4), P (N,3), N (N,3), uv (N,2), V (N,k) extras).
    Returns (H,W,3) linear image and coverage mask."""
    me = obj.data
    uv_at, tl, lv, tp = UR.mesh_loop_arrays(me, 'atlas')
    uv_src = np.empty(len(me.loops) * 2, np.float32); me.uv_layers['UVMap'].data.foreach_get('uv', uv_src); uv_src = uv_src.reshape(-1, 2)
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(n * 3, np.float32); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', mi)
    tid, bary = UR.rasterize(uv_at, tl, size)
    m = tid >= 0
    attrs = [co[lv], nr[lv], uv_src]
    if extra_vertex_attrs is not None:
        attrs.append(extra_vertex_attrs[lv])
    A = np.concatenate(attrs, 1).astype(np.float32)
    I = UR.interp(A, tl, tid, bary)
    tri_part = mi[tp]
    part_img = np.full(tid.shape, -1, np.int32)
    part_img[m] = tri_part[tid[m]]
    out = np.zeros(tid.shape + (3,), np.float32)
    for k, part in enumerate(parts):
        sel = part_img == k
        if not sel.any():
            continue
        v = I[sel]
        ctx = dict(P=v[:, 0:3], N=v[:, 3:6], uv=v[:, 6:8], V=v[:, 8:] if v.shape[1] > 8 else None)
        ctx['src'] = sample(part['img'], ctx['uv']) if part.get('img') is not None else np.ones((len(v), 4), np.float32)
        out[sel] = part['rule'](ctx)
    out, mask = UR.dilate(out, m, 16)
    return out, m


def finish_uvs(obj):
    """keep only the atlas UVs (renamed UVMap) and a single material slot"""
    me = obj.data
    me.uv_layers.remove(me.uv_layers['UVMap'])
    me.uv_layers['atlas'].name = 'UVMap'
    me.polygons.foreach_set('material_index', np.zeros(len(me.polygons), np.int32))
    me.materials.clear()


def make_material(name, img_path, roughness=0.8):
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(img_path)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


def save_png(lin, path, size=None):
    im = Image.fromarray((lin2srgb(lin) * 255 + 0.5).astype(np.uint8))
    if size and size != im.size[0]:
        im = im.resize((size, size), Image.LANCZOS)
    im.save(path)
    return path
