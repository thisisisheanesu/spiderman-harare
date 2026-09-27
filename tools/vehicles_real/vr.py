"""vr - helpers to turn downloaded Sketchfab vehicles into game assets (Blender 5 bpy, headless).

Coordinates (Blender, same as tools/vehicles/vkit.py): x = vehicle's right, y = forward, z = up, metres.
The glTF exporter turns Blender +Y into glTF -Z, so exported vehicles face -Z with +Y up.
"""
import math
import os
import re
import sys

import bpy  # noqa: I001  (bpy must be imported before bmesh)
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'vehicles'))
import vkit  # noqa: E402  (MB mesh builder, Projector, wheel generator, contract materials)

GAME_MATS = ['paint', 'glass', 'chrome', 'trim', 'tyre', 'rim', 'light_front', 'light_rear', 'indicator',
             'plate', 'interior', 'livery', 'beacon_blue', 'beacon_red']


# ---------------------------------------------------------------------------------------------------
# import / scene
# ---------------------------------------------------------------------------------------------------

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    """Import a GLB and return its mesh objects with all parent transforms baked into the mesh data
    (every returned object has an identity matrix and no parent)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in meshes:
        mw = o.matrix_world.copy()
        me = o.data
        if me.users > 1:            # instanced mesh (e.g. 4 wheels sharing data): make it single-user
            me = me.copy()
            o.data = me
        me.transform(mw)
        if mw.determinant() < 0:
            me.flip_normals()
        out.append(o)
    for o in out:
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    return out


def recalc_normals(ob):
    """Make face windings consistent and outward (AI/photo meshes often come double-sided with random
    winding; the game materials are single-sided)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def join(objs, name=None):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
            bpy.ops.object.join()
    ob = objs[0]
    if name:
        ob.name = name
    return ob


def bounds(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH' or not len(o.data.vertices):
            continue
        co = np.empty(len(o.data.vertices) * 3, np.float32)
        o.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        co = co @ np.array(o.matrix_world.to_3x3()).T + np.array(o.matrix_world.translation)
        mn = Vector(np.minimum(np.array(mn), co.min(0)))
        mx = Vector(np.maximum(np.array(mx), co.max(0)))
    return mn, mx


def verts_np(ob):
    co = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def set_verts_np(ob, co):
    ob.data.vertices.foreach_set('co', np.asarray(co, np.float32).ravel())
    ob.data.update()


def transform_all(objs, M):
    for o in objs:
        o.data.transform(M)
        if M.determinant() < 0:
            o.data.flip_normals()
        o.data.update()


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons) if ob and ob.type == 'MESH' else 0


# ---------------------------------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------------------------------

def src_image(mat):
    """Base-colour image of an imported (glTF) material, or None."""
    if not mat or not mat.node_tree:
        return None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return None
    links = bsdf.inputs['Base Color'].links
    if not links:
        return None
    n = links[0].from_node
    # glTF importer may insert a mix/multiply node (baseColorFactor * texture)
    for _ in range(4):
        if n.type == 'TEX_IMAGE':
            return n.image
        ins = [i for i in n.inputs if i.links]
        if not ins:
            return None
        n = ins[0].links[0].from_node
    return None


def src_color(mat):
    if not mat or not mat.node_tree:
        return (0.8, 0.8, 0.8, 1.0)
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return (0.8, 0.8, 0.8, 1.0)
    c = tuple(bsdf.inputs['Base Color'].default_value)
    a = bsdf.inputs['Alpha'].default_value
    return (c[0], c[1], c[2], a)


class ImageSampler:
    """Nearest-texel sampler over a Blender image (v up). Returns LINEAR RGBA: image.pixels holds the
    stored (sRGB-encoded) values of 8-bit images, so they are decoded here."""

    def __init__(self, image):
        w, h = image.size
        px = np.empty(w * h * 4, np.float32)
        image.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)
        if not image.is_float and image.colorspace_settings.name in ('sRGB', 'sRGB EOTF'):
            rgb = px[..., :3]
            px[..., :3] = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
        self.px = px
        self.w, self.h = w, h

    def sample(self, uv):
        uv = np.asarray(uv, np.float32)
        u = np.mod(uv[..., 0], 1.0)
        v = np.mod(uv[..., 1], 1.0)
        x = np.clip((u * self.w).astype(np.int32), 0, self.w - 1)
        y = np.clip((v * self.h).astype(np.int32), 0, self.h - 1)
        return self.px[y, x]


def face_data(ob):
    """Per-face arrays: centre (F,3), normal (F,3), area (F,), material index (F,), uv centre (F,2) or None,
    and uv samples at the 3 corners + centre (F,4,2) for triangle meshes."""
    me = ob.data
    nf = len(me.polygons)
    cen = np.empty(nf * 3, np.float32)
    me.polygons.foreach_get('center', cen)
    nor = np.empty(nf * 3, np.float32)
    me.polygons.foreach_get('normal', nor)
    area = np.empty(nf, np.float32)
    me.polygons.foreach_get('area', area)
    mi = np.empty(nf, np.int32)
    me.polygons.foreach_get('material_index', mi)
    uvc = None
    if me.uv_layers.active:
        nl = len(me.loops)
        uv = np.empty(nl * 2, np.float32)
        me.uv_layers.active.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        ls = np.empty(nf, np.int32)
        me.polygons.foreach_get('loop_start', ls)
        lt = np.empty(nf, np.int32)
        me.polygons.foreach_get('loop_total', lt)
        # centre = mean of loop uvs
        acc = np.zeros((nf, 2), np.float32)
        np.add.at(acc, np.repeat(np.arange(nf), lt), uv)
        uvc = acc / lt[:, None]
    return cen.reshape(-1, 3), nor.reshape(-1, 3), area, mi, uvc


def assign_game_materials(ob, labels, mats=None):
    """labels: sequence of game material names per face. Replaces the object's material slots with the
    game materials (created on demand by name) and sets the face indices."""
    names = sorted(set(labels), key=lambda n: GAME_MATS.index(n) if n in GAME_MATS else 99)
    ob.data.materials.clear()
    for n in names:
        m = (mats or {}).get(n) or bpy.data.materials.get(n) or bpy.data.materials.new(n)
        ob.data.materials.append(m)
    idx = {n: i for i, n in enumerate(names)}
    mi = np.array([idx[n] for n in labels], np.int32)
    ob.data.polygons.foreach_set('material_index', mi)
    ob.data.update()


def rule_label(name, rules, default):
    for pat, lab in rules:
        if re.search(pat, name or '', re.I):
            return lab
    return default


# ---------------------------------------------------------------------------------------------------
# mesh ops
# ---------------------------------------------------------------------------------------------------

def decimate(ob, target_tris, *, triangulate=True, symmetry=None):
    """Collapse-decimate to about target_tris triangles (UVs and material boundaries are kept by Blender's
    quadric collapse as far as it can)."""
    cur = tri_count(ob)
    if cur <= target_tris or cur == 0:
        if triangulate:
            triangulate_ob(ob)
        return ob
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = max(0.001, target_tris / cur)
    mod.use_collapse_triangulate = triangulate
    if symmetry:
        mod.use_symmetry = True
        mod.symmetry_axis = symmetry
    apply_mods(ob)
    return ob


def triangulate_ob(ob):
    mod = ob.modifiers.new('tri', 'TRIANGULATE')
    apply_mods(ob)


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    old = ob.data
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def weld(ob, dist=1e-4):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def delete_faces(ob, mask):
    """Delete faces where mask is True."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    kill = [f for f in bm.faces if mask[f.index]]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def split_faces(ob, mask, name):
    """Move faces where mask is True into a new object (returned); they are removed from ob."""
    new_me = ob.data.copy()
    new = bpy.data.objects.new(name, new_me)
    bpy.context.scene.collection.objects.link(new)
    delete_faces(new, ~np.asarray(mask, bool))
    delete_faces(ob, np.asarray(mask, bool))
    for o in (ob, new):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(o.data)
        bm.free()
    return new


def shade(ob, angle=38.0):
    """Smooth shading with sharp edges above `angle` degrees (glTF export splits normals there)."""
    me = ob.data
    me.shade_smooth()
    try:
        me.set_sharpness_by_angle(angle=math.radians(angle), keep_sharp_edges=False)
    except Exception:
        vkit.resharpen(ob, angle)


def loose_parts(ob):
    """Face-index arrays of the connected components of ob."""
    me = ob.data
    nf = len(me.polygons)
    parent = np.arange(len(me.vertices))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    ev = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get('vertices', ev)
    for a, b in ev.reshape(-1, 2):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in range(len(me.vertices))])
    fv0 = np.array([p.vertices[0] for p in me.polygons])
    comp = roots[fv0] if nf else np.array([], int)
    out = {}
    for fi, c in enumerate(comp):
        out.setdefault(c, []).append(fi)
    return [np.array(v) for v in out.values()]


def bvh_of(objs):
    bm = bmesh.new()
    for o in objs:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(o.matrix_world)
        me = bpy.data.meshes.new('tmp')
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    return bm


# ---------------------------------------------------------------------------------------------------
# game materials (Principled BSDF -> glTF metallic-roughness). Names are the integration contract.
# ---------------------------------------------------------------------------------------------------

# name: (base rgb, metallic, roughness, alpha, emissive rgb)
BASE = {
    'paint': ((1.0, 1.0, 1.0), 0.2, 0.3, 1.0, None),
    'glass': ((0.045, 0.058, 0.062), 0.0, 0.04, 0.66, None),
    'chrome': ((0.86, 0.87, 0.88), 1.0, 0.14, 1.0, None),
    'trim': ((0.035, 0.035, 0.037), 0.0, 0.62, 1.0, None),
    'tyre': ((0.04, 0.04, 0.042), 0.0, 0.88, 1.0, None),
    'rim': ((0.72, 0.73, 0.75), 0.75, 0.3, 1.0, None),
    'light_front': ((0.92, 0.93, 0.95), 0.0, 0.08, 1.0, (1.0, 0.96, 0.88)),
    'light_rear': ((0.55, 0.03, 0.03), 0.0, 0.12, 1.0, (1.0, 0.08, 0.05)),
    'indicator': ((0.9, 0.42, 0.05), 0.0, 0.12, 1.0, (1.0, 0.55, 0.05)),
    'plate': ((1.0, 1.0, 1.0), 0.0, 0.45, 1.0, None),
    'interior': ((0.06, 0.06, 0.065), 0.0, 0.85, 1.0, None),
    'livery': ((1.0, 1.0, 1.0), 0.1, 0.4, 1.0, None),
    'beacon_blue': ((0.1, 0.25, 1.0), 0.0, 0.1, 1.0, (0.1, 0.3, 1.0)),
    'beacon_red': ((1.0, 0.08, 0.06), 0.0, 0.1, 1.0, (1.0, 0.1, 0.05)),
}


def load_image(path, noncolor=False):
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = 'Non-Color'
    return im


def setup_game_material(name, *, tex=None, base=None, metal=None, rough=None, alpha=None, normal=None,
                        emissive_tex=False):
    """(Re)build game material `name`. tex: image path (base colour; for 'livery' also alpha).
    base/metal/rough/alpha override BASE. emissive_tex: link the texture to the emission colour too
    (lamps whose colour comes from a texture: the night glow follows the lamp pattern)."""
    b, m, r, a, e = BASE[name]
    base = base if base is not None else b
    metal = metal if metal is not None else m
    rough = rough if rough is not None else r
    alpha = alpha if alpha is not None else a
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (*base, 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Alpha'].default_value = alpha
    mat.use_backface_culling = name not in ('interior', 'livery')
    if alpha < 1.0:
        mat.surface_render_method = 'BLENDED'
    if tex:
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = load_image(tex)
        if base != (1.0, 1.0, 1.0) and name not in ('paint',):
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(tn.outputs['Color'], mix.inputs['A'])
            mix.inputs['B'].default_value = (*base, 1.0)
            nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        else:
            nt.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
        if name == 'livery':
            nt.links.new(tn.outputs['Alpha'], bsdf.inputs['Alpha'])
            mat.surface_render_method = 'DITHERED'
        if e and emissive_tex:
            nt.links.new(tn.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 1.0
    if e and not (tex and emissive_tex):
        bsdf.inputs['Emission Color'].default_value = (*e, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    if normal:
        nn = nt.nodes.new('ShaderNodeTexImage')
        nn.image = load_image(normal, noncolor=True)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(nn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def export_glb(root, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)

    def sel(o):
        o.select_set(True)
        for c in o.children:
            sel(c)
    sel(root)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_extras=True, export_texcoords=True, export_normals=True,
                              export_tangents=False, export_materials='EXPORT', export_image_format='AUTO',
                              export_cameras=False, export_lights=False, export_animations=False,
                              export_skins=False, export_morph=False)


# ---------------------------------------------------------------------------------------------------
# single-atlas (photo-textured / AI-generated) models: per-face colour, paint atlas, wheel cutting
# ---------------------------------------------------------------------------------------------------

def face_colors(ob, image, samples=4):
    """Mean linear RGB of the texture over each face (centre + corners pulled towards the centre)."""
    me = ob.data
    S = ImageSampler(image)
    nf = len(me.polygons)
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    ls = np.empty(nf, np.int32)
    me.polygons.foreach_get('loop_start', ls)
    lt = np.empty(nf, np.int32)
    me.polygons.foreach_get('loop_total', lt)
    acc = np.zeros((nf, 2), np.float32)
    np.add.at(acc, np.repeat(np.arange(nf), lt), uv)
    c = acc / lt[:, None]
    col = S.sample(c)[:, :3].copy()
    n = 1
    for k in range(min(3, samples - 1)):
        corner = uv[ls + np.minimum(k, lt - 1)]
        col += S.sample(c + (corner - c) * 0.6)[:, :3]
        n += 1
    return col / n, c


def luminance(col):
    return 0.2126 * col[:, 0] + 0.7152 * col[:, 1] + 0.0722 * col[:, 2]


def srgb(col):
    col = np.clip(col, 0, 1)
    return np.where(col <= 0.0031308, col * 12.92, 1.055 * np.power(col, 1 / 2.4) - 0.055)


def uv_tris(ob, mask):
    me = ob.data
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    out = []
    for p in me.polygons:
        if mask[p.index]:
            out.append(uv[p.loop_start:p.loop_start + p.loop_total])
    return out


def paint_atlas(src_path, paint_uv_tris, out_path, *, white=None, grow=2, keep_uv_tris=()):
    """Copy of the atlas where the texels under the paint faces become a neutral grey detail map
    (luminance / white level, clamped to 1) so the game can tint `paint`; everything else keeps its
    photo colour. keep_uv_tris: texels that must stay coloured even if a paint face overlaps them."""
    from PIL import Image, ImageDraw, ImageFilter
    im = Image.open(src_path).convert('RGB')
    W, H = im.size
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    for t in paint_uv_tris:
        pts = [(float(u) * W, (1.0 - float(v)) * H) for u, v in t]
        d.polygon(pts, fill=255)
    if grow:
        mask = mask.filter(ImageFilter.MaxFilter(grow * 2 + 1))
    if keep_uv_tris:
        k = Image.new('L', (W, H), 0)
        dk = ImageDraw.Draw(k)
        for t in keep_uv_tris:
            dk.polygon([(float(u) * W, (1.0 - float(v)) * H) for u, v in t], fill=255)
        mask = Image.fromarray((np.array(mask) * (np.array(k) == 0)).astype(np.uint8))
    a = np.asarray(im).astype(np.float32) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    lum = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    m = np.asarray(mask) > 127
    if white is None:
        white = float(np.percentile(lum[m], 75)) if m.any() else 1.0
    g = np.clip(lum / max(white, 1e-3), 0, 1)
    g_s = np.where(g <= 0.0031308, g * 12.92, 1.055 * np.power(g, 1 / 2.4) - 0.055)
    out = a.copy()
    for ch in range(3):
        out[..., ch] = np.where(m, g_s, a[..., ch])
    Image.fromarray((out * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(out_path)
    return white


def cylinder_mask(cen, hub, r, side, x_inner):
    """Faces whose centre is inside the wheel cylinder (axis = x through hub, radius r) on one side
    (side = +1 right / -1 left) beyond |x| > x_inner."""
    dy = cen[:, 1] - hub[1]
    dz = cen[:, 2] - hub[2]
    return (dy * dy + dz * dz < r * r) & (np.sign(cen[:, 0]) == side) & (np.abs(cen[:, 0]) > x_inner)


def atlas_fill(path, uv_tris, color=None, grow=2):
    """Paint the texels under the given UV triangles with one colour (median of those texels when
    color is None). Used to remove badges / wordmarks baked into photo atlases."""
    from PIL import Image, ImageDraw, ImageFilter
    im = Image.open(path).convert('RGB')
    W, H = im.size
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    for t in uv_tris:
        d.polygon([(float(u) * W, (1.0 - float(vv)) * H) for u, vv in t], fill=255)
    if grow:
        mask = mask.filter(ImageFilter.MaxFilter(grow * 2 + 1))
    a = np.asarray(im).copy()
    m = np.asarray(mask) > 127
    if color is None:
        color = np.median(a[m], axis=0) if m.any() else np.array([20, 20, 20])
    a[m] = np.asarray(color, np.uint8)
    Image.fromarray(a).save(path)


def blend_state_save(path, info):
    import json
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=True)
    json.dump(info, open(path + '.json', 'w'))


def blend_state_load(path):
    import json
    if not os.path.exists(path) or not os.path.exists(path + '.json'):
        return None
    bpy.ops.wm.open_mainfile(filepath=path)
    return json.load(open(path + '.json'))
