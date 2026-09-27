"""Facade and street dressing: downloaded models (Sketchfab CC BY, Poly Haven CC0) normalised to the game's
conventions, plus procedural items modelled from the Harare reference photos.

    $BLENDER_PY tools/dressing/items_build.py -- [names...]

Env as tree_build.py (DRESSING_RAW, DRESSING_WORK). Output: $DRESSING_WORK/<name>/{lod0.glb, lod1.glb, meta.json};
tools/dressing/pack.cjs converts to public/models/dressing/.

Blender frame while building: Z up, the street / front side is -Y (three.js +Z after the glTF export).
  ground items   : footprint centred on the origin, bottom at z = 0.
  wall / window  : back face on the wall plane y = 0 (z = 0 at the item's bottom, x centred), body towards -Y.
  wall_top items : centred on the wall's top centre line (x along the wall), bottom at z = 0.
"""
import json
import math
import os
import sys

import bpy  # noqa: I001  (bpy must come first: it provides bmesh)
import bmesh
import mathutils
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_util as U  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.environ.get('SCRATCH', '/tmp/dressing-scratch')
RAW = os.environ.get('DRESSING_RAW', os.path.join(SCRATCH, 'dressing', 'raw'))
WORK = os.environ.get('DRESSING_WORK', os.path.join(SCRATCH, 'dressing', 'work'))
TEX = os.path.join(RAW, 'phtex')


def log(*a):
    print('[item]', *a, flush=True)


# ------------------------------------------------------------------------------------------------ helpers

def all_meshes():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def load(path, rot_z=0.0, scale=1.0, keep=None):
    if path.endswith('.gltf'):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        objs = [o for o in bpy.data.objects if o not in before]
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = [o for o in objs if o.type == 'MESH'][0]
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        for o in objs:
            o.select_set(o.type == 'MESH')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for o in objs:
            if o.type != 'MESH':
                bpy.data.objects.remove(o, do_unlink=True)
        objs = [o for o in objs if o.name in bpy.data.objects]
    else:
        objs = U.import_glb(path)
    if keep:
        for o in list(objs):
            if not any(k in o.name for k in keep):
                objs.remove(o)
                bpy.data.objects.remove(o, do_unlink=True)
    M = mathutils.Matrix.Rotation(math.radians(rot_z), 4, 'Z')
    if isinstance(scale, (tuple, list)):
        M = mathutils.Matrix.Diagonal((*scale, 1.0)) @ M
    else:
        M = mathutils.Matrix.Scale(scale, 4) @ M
    U.transform_all(objs, M)
    for o in objs:
        uvs = o.data.uv_layers
        while len(uvs) > 1:
            uvs.remove(uvs[-1])
    return objs


def place(objs, mode):
    mn, mx = U.bbox(objs)
    if mode == 'ground':
        t = (-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2])
    elif mode in ('wall', 'window', 'shopfront'):
        t = (-(mn[0] + mx[0]) / 2, -mx[1], -mn[2])
    elif mode == 'wall_top':
        t = (-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2])
    else:
        t = (0, 0, 0)
    U.transform_all(objs, mathutils.Matrix.Translation(t))


def fit(objs, axis, size):
    mn, mx = U.bbox(objs)
    k = size / (mx[axis] - mn[axis])
    U.transform_all(objs, mathutils.Matrix.Scale(k, 4))
    return k


def load_img(path, name=None, size=None, colorspace='sRGB'):
    img = bpy.data.images.load(path, check_existing=True)
    if name:
        img = img.copy()
        img.name = name
    if size and max(img.size) > size:
        k = size / max(img.size)
        img.scale(max(4, int(img.size[0] * k)), max(4, int(img.size[1] * k)))
    img.colorspace_settings.name = colorspace
    return img


def mat(name, color=(0.5, 0.5, 0.5), rough=0.8, metal=0.0, img=None, nrm=None, alpha=False, double=False, tint=None):
    m, nt = U._new_mat(name)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    nt.links.new(bs.outputs[0], out.inputs['Surface'])
    if img is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        if tint is not None:
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(tex.outputs['Color'], mix.inputs[6])
            mix.inputs[7].default_value = (*tint, 1)
            nt.links.new(mix.outputs[2], bs.inputs['Base Color'])
        else:
            nt.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
        if alpha:
            nt.links.new(tex.outputs['Alpha'], bs.inputs['Alpha'])
    else:
        bs.inputs['Base Color'].default_value = (*color, 1)
    if nrm is not None:
        t2 = nt.nodes.new('ShaderNodeTexImage')
        t2.image = nrm
        nrm.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t2.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    m.use_backface_culling = not double
    return m


def mat_info(m):
    """(image, rgb, alpha) describing a material's base colour (for card baking)."""
    if m is None or not m.node_tree:
        return None, (0.5, 0.5, 0.5), False
    img, alpha = U.base_image(m)
    rgb = (0.5, 0.5, 0.5)
    tint = None
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            bc = n.inputs['Base Color']
            if not bc.is_linked:
                rgb = tuple(bc.default_value[:3])
            if n.inputs['Alpha'].is_linked:
                alpha = True
        if n.type == 'MIX' and n.blend_type == 'MULTIPLY' and not n.inputs[7].is_linked:
            tint = tuple(n.inputs[7].default_value[:4])
    return img, (tint[:3] if tint else rgb), alpha


def new_obj(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if material is not None:
        me.materials.append(material)
    return o


def add_box(bm, size, loc, rot=None, uv_scale=1.0):
    """Axis-aligned (or rotated) box into a bmesh with box-projected UVs (metres * uv_scale)."""
    ret = bmesh.ops.create_cube(bm, size=1.0)
    vs = ret['verts']
    M = mathutils.Matrix.Translation(loc)
    if rot is not None:
        M = M @ rot.to_4x4()
    M = M @ mathutils.Matrix.Diagonal((*size, 1.0))
    bmesh.ops.transform(bm, matrix=M, verts=vs)
    return vs


def add_cyl(bm, r, h, loc, seg=8, axis='Z', rot=None, r2=None, caps=True):
    ret = bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    vs = ret['verts']
    R = mathutils.Matrix.Identity(4)
    if axis == 'X':
        R = mathutils.Matrix.Rotation(math.pi / 2, 4, 'Y')
    elif axis == 'Y':
        R = mathutils.Matrix.Rotation(math.pi / 2, 4, 'X')
    if rot is not None:
        R = rot.to_4x4() @ R
    bmesh.ops.transform(bm, matrix=mathutils.Matrix.Translation(loc) @ R, verts=vs)
    return vs


def bar(bm, a, b, t, seg=None):
    """Square steel bar of thickness t from a to b (3D points)."""
    a, b = mathutils.Vector(a), mathutils.Vector(b)
    d = b - a
    L = d.length
    q = d.normalized().to_track_quat('Z', 'Y')
    if seg:
        return add_cyl(bm, t / 2, L, (a + b) / 2, seg=seg, rot=q.to_matrix())
    return add_box(bm, (t, t, L), (a + b) / 2, rot=q.to_matrix())


def box_uv(o, scale=1.0):
    """Box-projection UVs in metres * scale (for tiling textures on procedural geometry)."""
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            if ax == 0:
                l[uv].uv = (c.y * scale, c.z * scale)
            elif ax == 1:
                l[uv].uv = (c.x * scale, c.z * scale)
            else:
                l[uv].uv = (c.x * scale, c.y * scale)
    bm.to_mesh(me)
    bm.free()


def bake_card(objs, name, px=256, double=True, offset_y=None):
    """LOD card: front orthographic albedo render (alpha) of objs on one quad in the item's mid-depth plane."""
    from PIL import Image
    wd = os.path.join(WORK, name)
    mn, mx = U.bbox(objs)
    w, h = mx[0] - mn[0], mx[2] - mn[2]
    pw, ph = (px, max(8, int(round(px * h / w / 4)) * 4)) if w >= h else (max(8, int(round(px * w / h / 4)) * 4), px)
    cam = U.setup_render(pw, ph, samples=16)
    for o in all_meshes():
        o.hide_render = o not in objs
    saved = {}
    for o in objs:
        saved[o.name] = list(o.data.materials)
        for i, m in enumerate(o.data.materials):
            img, rgb, alpha = mat_info(m)
            o.data.materials[i] = U.albedo_material('card_' + (m.name if m else 'x'), img, alpha=alpha, tint=(*rgb, 1) if img is None else None)
    ctr = ((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2)
    U.aim_camera(cam, ctr, (0, -1, 0), dist=50, ortho=max(w, h))
    p = os.path.join(wd, 'card.png')
    U.render_to(p)
    for o in objs:
        for i, m in enumerate(saved[o.name]):
            o.data.materials[i] = m
    im = np.array(Image.open(p).convert('RGBA'))
    from tree_build import dilate_rgba
    Image.fromarray(dilate_rgba(im), 'RGBA').save(p)
    y = (mn[1] + mx[1]) / 2 if offset_y is None else offset_y
    bm = bmesh.new()
    vs = [bm.verts.new((mn[0], y, mn[2])), bm.verts.new((mx[0], y, mn[2])), bm.verts.new((mx[0], y, mx[2])), bm.verts.new((mn[0], y, mx[2]))]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new('UVMap')
    for l, uvv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        l[uvl].uv = uvv
    f.normal_update()
    if f.normal.y > 0:
        f.normal_flip()
        for l, uvv in zip(f.loops, ((0, 1), (1, 1), (1, 0), (0, 0))):
            pass
    img = bpy.data.images.load(p)
    o = new_obj(name + '_card', bm, mat('cutout', img=img, alpha=True, double=double, rough=0.8))
    for m in all_meshes():
        m.hide_render = False
    return o


def save_item(name, lod0, lod1, attach, extra=None):
    wd = os.path.join(WORK, name)
    os.makedirs(wd, exist_ok=True)
    lod0 = [o for o in lod0 if o]
    o0 = U.join(lod0, name)
    U.export_glb([o0], os.path.join(wd, 'lod0.glb'))
    co = np.array([v.co[:] for v in o0.data.vertices])
    mn, mx = co.min(0), co.max(0)
    t1 = None
    if lod1:
        o1 = U.join([o for o in lod1 if o], name + '_lod1')
        U.export_glb([o1], os.path.join(wd, 'lod1.glb'))
        t1 = U.tri_count(o1)
    low = co[co[:, 2] < mn[2] + 0.15]
    meta = {
        'name': name, 'kind': 'item', 'attach': attach,
        'height': round(float(mx[2] - mn[2]), 3),
        'radius': round(float(np.linalg.norm(co[:, :2], axis=1).max()), 3),
        'baseRadius': round(float(np.linalg.norm(low[:, :2], axis=1).max()), 3) if len(low) else None,
        # three.js extent: x = width, y = height, z = depth (from the wall / centre towards the street)
        'extent': [round(float(mx[0] - mn[0]), 3), round(float(mx[2] - mn[2]), 3), round(float(mx[1] - mn[1]), 3)],
        'tris': [U.tri_count(o0), t1],
    }
    meta.update(extra or {})
    json.dump(meta, open(os.path.join(wd, 'meta.json'), 'w'), indent=1)
    log('DONE', name, meta['tris'], 'extent', meta['extent'])


def raw(*p):
    return os.path.join(RAW, *p)


def tex(name, size=512, nrm=False):
    c = load_img(os.path.join(TEX, name + '_diff.jpg'), name + '_d', size)
    n = load_img(os.path.join(TEX, name + '_nor.jpg'), name + '_n', size // 2, 'Non-Color') if nrm else None
    return c, n


def decimated_copy(objs, name, tris):
    cp = [U.duplicate(o, o.name + '_l1') for o in objs]
    j = U.join(cp, name)
    U.decimate(j, tris)
    return j


# ------------------------------------------------------------------------------------------------ downloads

def item_ac_unit_weathered():
    objs = load(raw('ac_weathered', 'model.glb'))
    fit(objs, 0, 0.80)                               # outdoor unit ~0.8 m wide
    place(objs, 'wall')
    for o in objs:
        for m in o.data.materials:
            pass
    l1 = decimated_copy(objs, 'l1', 160)
    save_item('ac_unit_weathered', objs, [l1], 'wall', {'mount': {'height': [1.8, 3.2], 'note': 'under / beside windows; brackets touch the wall'}})


def item_ac_unit_small():
    objs = load(raw('ac_lowpoly', 'model.glb'))
    fit(objs, 0, 0.78)
    place(objs, 'wall')
    save_item('ac_unit_small', objs, None, 'wall', {'mount': {'height': [1.8, 3.2]}})


def item_satellite_dish():
    objs = load(raw('dish_rusty', 'model.glb'), rot_z=180)
    fit(objs, 2, 0.95)                               # ~0.8 m offset dish + arm
    place(objs, 'wall')
    l1 = decimated_copy(objs, 'l1', 300)
    save_item('satellite_dish_wall', objs, [l1], 'wall', {'mount': {'height': [2.5, 12], 'note': 'dish faces north (+Z of the item should point roughly north / up the facade); also fine on roof parapets'}})


def item_meter_boxes():
    objs = load(raw('meter_box', 'model.glb'))
    fit(objs, 0, 1.25)
    place(objs, 'wall')
    l1 = bake_card(objs, 'meter_boxes', px=128)
    save_item('meter_boxes', objs, [l1], 'wall', {'mount': {'height': [0.3, 0.6], 'note': 'bottom of the cables ~0.3 m above the pavement'}})


def item_razor_wire():
    objs = load(raw('barbed_coil', 'model.glb'), rot_z=90)
    fit(objs, 0, 1.6)                                 # 1.6 m module along the wall (x)
    place(objs, 'wall_top')
    for o in objs:
        for i, m in enumerate(o.data.materials):
            img, _, _ = mat_info(m)
            o.data.materials[i] = mat('razor_wire', img=img, rough=0.45, metal=0.8, tint=(0.95, 0.92, 0.9))
    l1 = bake_card(objs, 'razor_wire_coil', px=256)
    objs = [U.join(objs, 'wire0')]
    U.decimate(objs[0], 2400)
    save_item('razor_wire_coil', objs, [l1], 'wall_top', {'tile': {'axis': 'x', 'length': 1.6}})


def item_tuckshop():
    objs = load(raw('kiosk_rusty', 'model.glb'))
    fit(objs, 2, 2.55)
    place(objs, 'ground')
    save_item('tuckshop_kiosk', objs, None, 'ground', {'note': 'serving hatch on the front (+Z), door on the right (+X)'})


def item_awning_corrugated():
    objs = load(raw('awning_metal', 'model.glb'))
    fit(objs, 0, 3.0)
    place(objs, 'wall')
    save_item('awning_corrugated', objs, None, 'wall', {'mount': {'height': [2.4, 2.8], 'note': 'bottom edge of the wall bracket; 3 m module, repeat along the shopfront'}, 'tile': {'axis': 'x', 'length': 3.0}})


def item_umbrella_airtime():
    objs = load(raw('umbrella_white', 'model.glb'))
    fit(objs, 2, 2.35)
    place(objs, 'ground')
    o = U.join(objs, 'umb')
    img, _, _ = mat_info(o.data.materials[0])
    blue = mat('canopy_blue', img=img, rough=0.85, tint=(0.05, 0.28, 0.72))
    white = mat('canopy_white', img=img, rough=0.85)
    pole = mat('pole', img=img, rough=0.6, metal=0.3)
    o.data.materials.clear()
    for m in (blue, white, pole):
        o.data.materials.append(m)
    zmax = max(v.co.z for v in o.data.vertices)
    for p in o.data.polygons:
        c = p.center
        if c.z > zmax - 0.75 and math.hypot(c.x, c.y) > 0.06:
            sector = int(((math.atan2(c.y, c.x) + math.pi) / (2 * math.pi)) * 8) % 8
            p.material_index = 0 if sector % 2 == 0 else 1
        else:
            p.material_index = 2
    l1 = decimated_copy([o], 'l1', 180)
    save_item('umbrella_airtime', [o], [l1], 'ground', {'recolor': {'canopy_blue': 'panel colour (Econet-style blue; set material.color for other networks: NetOne orange, Telecel green)'},
                                                         'anchors': [[0, 2.35, 0]]})


def item_roller_shutters():
    for key, name, sx, sz in (('rollershutter_door', 'roller_shutter_shop', 2.6, 1.05), ('rollershutter_window_01', 'roller_shutter_window', 1.0, 1.0)):
        U.reset()
        objs = load(raw('ph', key, key + '_1k.gltf'), keep=[key + '_graffiti'] if False else None)
        for o in list(objs):
            if 'graffiti' in o.name:
                objs.remove(o)
                bpy.data.objects.remove(o, do_unlink=True)
        U.transform_all(objs, mathutils.Matrix.Diagonal((sx, 1.0, sz, 1.0)))
        place(objs, 'shopfront')
        save_item(name, objs, None, 'shopfront', {'note': 'shutter box on top; x-scale freely (horizontal slats)'})


def item_downpipe():
    base = raw('ph', 'modular_metal_gutter', 'modular_metal_gutter_1k.gltf')
    objs = load(base, keep=['modular_metal_gutter_section', 'modular_metal_gutter_outlet', 'modular_metal_gutter_coupler'])
    sec = next(o for o in objs if o.name.endswith('section'))
    out = next(o for o in objs if o.name.endswith('outlet'))
    cpl = next(o for o in objs if o.name.endswith('coupler'))
    # section: 1 m pipe (x -0.43..-0.27, y 0.11..0.27) -> centre at x=0, back at y=0
    def recentre(o):
        mn, mx = U.bbox([o])
        U.transform_all([o], mathutils.Matrix.Translation((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2])))
    for o in (sec, out, cpl):
        recentre(o)
    parts = [out]
    zo = U.bbox([out])[1][2] - 0.02
    for i in range(3):
        s = U.duplicate(sec, f'sec{i}')
        U.transform_all([s], mathutils.Matrix.Translation((0, 0, zo + i * 0.98)))
        parts.append(s)
        c = U.duplicate(cpl, f'cpl{i}')
        U.transform_all([c], mathutils.Matrix.Translation((0, 0, zo + i * 0.98 + 0.75)))
        parts.append(c)
    bpy.data.objects.remove(sec, do_unlink=True)
    bpy.data.objects.remove(cpl, do_unlink=True)
    # the pipe stands 6 cm off the wall on its clamps
    mn, mx = U.bbox(parts)
    U.transform_all(parts, mathutils.Matrix.Translation((0, -mx[1] - 0.04, 0)))
    for o in parts:
        for i, m in enumerate(o.data.materials):
            img, _, _ = mat_info(m)
            o.data.materials[i] = mat('pipe', img=img, rough=0.5, metal=0.6, tint=(0.62, 0.62, 0.6))
    l1 = U.join([U.duplicate(p, p.name + 'l') for p in parts], 'l1')
    U.decimate(l1, 120)
    j0 = U.join(parts, 'pipe0')
    U.decimate(j0, 900)
    parts = [j0]
    save_item('downpipe', parts, [l1], 'wall', {'tile': {'axis': 'y', 'length': 2.94, 'note': 'shoe at the bottom; stack copies above z = 0.38 + n * 2.94'}, 'mount': {'height': [0, 0]}})


def item_iron_gate():
    objs = load(raw('ph', 'large_iron_gate', 'large_iron_gate_1k.gltf'))
    place(objs, 'ground')
    j = U.join(objs, 'gate')
    U.decimate(j, 5000)
    l1 = bake_card([j], 'gate_iron_ornate', px=256)
    save_item('gate_iron_ornate', [j], [l1], 'ground', {'note': '2.95 m double gate for driveways / church and embassy compounds; hinge posts at x = +-1.47'})


# ------------------------------------------------------------------------------------------------ procedural

def grille_frame(bm, w, h, t):
    bar(bm, (-w / 2, 0, 0), (w / 2, 0, 0), t)
    bar(bm, (-w / 2, 0, h), (w / 2, 0, h), t)
    bar(bm, (-w / 2, 0, 0), (-w / 2, 0, h), t)
    bar(bm, (w / 2, 0, 0), (w / 2, 0, h), t)


def item_burglar_bars():
    """Welded steel window guards (PHOTOS.md: burglar bars on almost every ground / first floor window).
    1.2 x 1.5 m, 16 mm square bar in a 25 mm frame, 4 fixing lugs, painted (material 'paint' - recolour)."""
    W, Hh, t, tf = 1.2, 1.5, 0.016, 0.025
    styles = {
        'grid': lambda bm: ([bar(bm, (x, 0, 0), (x, 0, Hh), t) for x in np.linspace(-W / 2, W / 2, 9)[1:-1]] +
                            [bar(bm, (-W / 2, 0, z), (W / 2, 0, z), t) for z in (Hh / 3, 2 * Hh / 3)]),
        'diamond': lambda bm: diamond(bm, W, Hh, t),
        'sunrise': lambda bm: sunrise(bm, W, Hh, t),
    }
    colors = {'grid': (0.93, 0.92, 0.88), 'diamond': (0.08, 0.08, 0.08), 'sunrise': (0.86, 0.82, 0.70)}
    for st, fn in styles.items():
        U.reset()
        bm = bmesh.new()
        grille_frame(bm, W, Hh, tf)
        fn(bm)
        for x in (-W / 2, W / 2):
            for z in (0.15, Hh - 0.15):
                add_box(bm, (0.05, 0.04, 0.006), (x + (0.03 if x > 0 else -0.03), 0.02, z))
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        paint = mat('paint', color=colors[st], rough=0.55, metal=0.2)
        o = new_obj('bars', bm, paint)
        mn, mx = U.bbox([o])
        U.transform_all([o], mathutils.Matrix.Translation((0, -mx[1] - 0.005, -mn[2])))
        name = 'burglar_bars_' + st
        os.makedirs(os.path.join(WORK, name), exist_ok=True)
        l1 = bake_card([o], name, px=256)
        save_item(name, [o], [l1], 'window', {'size': [W, Hh], 'recolor': {'paint': 'white, cream, black, dark green or maroon'},
                                              'note': 'scale x / y to the window opening (bars are 16 mm; +-30 % stays believable); LOD1 is an alpha card'})


def diamond(bm, W, Hh, t):
    n = 4
    step = W / n
    for i in range(-n, n * 2):
        x0 = -W / 2 + i * step
        seg_clip(bm, (x0, 0), (x0 + Hh, Hh), W, Hh, t)
        seg_clip(bm, (x0 + Hh, 0), (x0, Hh), W, Hh, t)


def seg_clip(bm, a, b, W, Hh, t):
    """Bar from a to b (x, z) clipped to the frame rectangle."""
    (x0, z0), (x1, z1) = a, b
    t0, t1 = 0.0, 1.0
    dx, dz = x1 - x0, z1 - z0
    for p, q in ((-dx, x0 + W / 2), (dx, W / 2 - x0), (-dz, z0), (dz, Hh - z0)):
        if abs(p) < 1e-9:
            if q < 0:
                return
            continue
        r = q / p
        if p < 0:
            t0 = max(t0, r)
        else:
            t1 = min(t1, r)
    if t1 - t0 < 1e-3:
        return
    bar(bm, (x0 + dx * t0, 0, z0 + dz * t0), (x0 + dx * t1, 0, z0 + dz * t1), t)


def sunrise(bm, W, Hh, t):
    zs = Hh * 0.62
    for x in np.linspace(-W / 2, W / 2, 7)[1:-1]:
        bar(bm, (x, 0, 0), (x, 0, zs), t)
    bar(bm, (-W / 2, 0, zs), (W / 2, 0, zs), t)
    r = min(W / 2, Hh - zs) * 0.92
    cx, cz = 0, zs
    pts = [(cx + r * math.cos(a), cz + r * math.sin(a)) for a in np.linspace(0, math.pi, 13)]
    for p, q in zip(pts[:-1], pts[1:]):
        bar(bm, (p[0], 0, p[1]), (q[0], 0, q[1]), t)
    for a in np.linspace(0, math.pi, 9)[1:-1]:
        seg_clip(bm, (cx, cz), (cx + 2 * W * math.cos(a), cz + 2 * W * math.sin(a)), W, Hh, t)


def mesh_texture(path, kind='expanded', px=256):
    """Tileable alpha texture: 'expanded' (diamond expanded metal, cream paint) or 'trellis'."""
    from PIL import Image, ImageDraw
    S = 4
    im = Image.new('RGBA', (px * S, px * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    col = (226, 214, 184, 255)
    if kind == 'expanded':
        # 4 x 8 diamonds per tile (tile = 0.25 m wide): strands ~2.2 mm
        nx, ny = 4, 8
        cw, ch = px * S / nx, px * S / ny
        lw = int(px * S * 0.028)
        for i in range(nx + 1):
            for j in range(ny + 1):
                cx = i * cw + (cw / 2 if j % 2 else 0)
                cy = j * ch
                pts = [(cx - cw / 2, cy), (cx, cy - ch / 2 * 1.02), (cx + cw / 2, cy), (cx, cy + ch / 2 * 1.02), (cx - cw / 2, cy)]
                d.line(pts, fill=col, width=lw)
    else:
        lw = int(px * S * 0.05)
        n = 2
        step = px * S / n
        for i in range(-n, 2 * n + 1):
            d.line([(i * step, 0), (i * step + px * S, px * S)], fill=(40, 40, 40, 255), width=lw)
            d.line([(i * step + px * S, 0), (i * step, px * S)], fill=(40, 40, 40, 255), width=lw)
    im = im.resize((px, px), Image.LANCZOS)
    a = np.array(im)
    rgb = a[..., :3].astype(np.float32)
    noise = np.random.default_rng(3).normal(0, 6, rgb.shape[:2])[..., None]
    a[..., :3] = np.clip(rgb + noise, 0, 255).astype(np.uint8)
    from tree_build import dilate_rgba
    Image.fromarray(dilate_rgba(a), 'RGBA').save(path)


def item_security_mesh():
    """Cream-painted expanded-metal security grille on an angle frame (shopfronts, PHOTOS.md sec. 20).
    3.0 x 2.5 m; the mesh is one alpha-tested quad (texture tiles every 0.25 m)."""
    name = 'security_mesh_grille'
    wd = os.path.join(WORK, name)
    os.makedirs(wd, exist_ok=True)
    tp = os.path.join(wd, 'mesh.png')
    mesh_texture(tp, 'expanded', 256)
    W, Hh = 3.0, 2.5
    paint = mat('frame_paint', color=(0.84, 0.80, 0.68), rough=0.6, metal=0.2)
    bm = bmesh.new()
    t = 0.04
    grille_frame(bm, W, Hh, t)
    bar(bm, (0, 0, 0), (0, 0, Hh), t)
    bar(bm, (-W / 2, 0, Hh * 0.45), (W / 2, 0, Hh * 0.45), 0.03)
    add_box(bm, (0.08, 0.05, 0.12), (0.06, -0.03, 1.0))          # padlock hasp
    frame = new_obj('frame', bm, paint)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((-W / 2, 0, 0), (W / 2, 0, 0), (W / 2, 0, Hh), (-W / 2, 0, Hh))]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new('UVMap')
    for l in f.loops:
        l[uvl].uv = ((l.vert.co.x + W / 2) / 0.25, l.vert.co.z / 0.25)
    img = bpy.data.images.load(tp)
    meshq = new_obj('mesh', bm, mat('grille_mesh', img=img, alpha=True, double=True, rough=0.6, metal=0.2))
    objs = [frame, meshq]
    mn, mx = U.bbox(objs)
    U.transform_all(objs, mathutils.Matrix.Translation((0, -mx[1] - 0.01, -mn[2])))
    l1 = [U.duplicate(meshq, 'mesh1')]
    save_item(name, objs, l1, 'shopfront', {'tile': {'axis': 'x', 'length': 3.0, 'uvRepeat': 0.25},
                                            'note': 'mesh quad UVs are in metres / 0.25: scale x and multiply uv for other widths'})


def item_trellis_gate():
    """Collapsible steel trellis (Trellidor-style) gate across a shop door: 2.0 x 2.3 m, dark grey."""
    W, Hh = 2.0, 2.3
    bm = bmesh.new()
    t = 0.022
    for x in np.linspace(-W / 2, W / 2, 11):
        bar(bm, (x, 0, 0.02), (x, 0, Hh - 0.04), t)
    n = 10
    for k in range(n):
        x0 = -W / 2 + k * W / n
        for zz in np.arange(0.1, Hh - 0.3, 0.42):
            bar(bm, (x0, -0.012, zz), (x0 + W / n, -0.012, zz + 0.4), 0.012)
            bar(bm, (x0 + W / n, -0.012, zz), (x0, -0.012, zz + 0.4), 0.012)
    add_box(bm, (W + 0.1, 0.06, 0.05), (0, 0, Hh - 0.02))
    add_box(bm, (W + 0.1, 0.06, 0.03), (0, 0, 0.01))
    add_box(bm, (0.07, 0.05, 0.1), (W / 2 - 0.05, -0.04, 1.05))
    o = new_obj('trellis', bm, mat('paint', color=(0.16, 0.16, 0.17), rough=0.5, metal=0.4))
    mn, mx = U.bbox([o])
    U.transform_all([o], mathutils.Matrix.Translation((0, -mx[1] - 0.01, -mn[2])))
    name = 'trellis_gate'
    os.makedirs(os.path.join(WORK, name), exist_ok=True)
    l1 = bake_card([o], name, px=256)
    save_item(name, [o], [l1], 'shopfront', {'recolor': {'paint': 'charcoal (typical), white'}})


def stripe_texture(path, c1, c2, px=256, n=8, valance=True):
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (px, px), c1)
    d = ImageDraw.Draw(im)
    w = px / n
    for i in range(0, n, 2):
        d.rectangle([i * w, 0, (i + 1) * w - 1, px], fill=c2)
    a = np.array(im).astype(np.float32)
    rng = np.random.default_rng(1)
    weave = (rng.normal(0, 5, (px, px)) + 4 * np.sin(np.arange(px)[:, None] * 1.3)).astype(np.float32)
    grime = np.linspace(0.9, 1.0, px)[:, None]
    a = np.clip(a * grime[..., None] + weave[..., None], 0, 255).astype(np.uint8)
    Image.fromarray(a).save(path)


def item_awning_canvas():
    """Sloped canvas shop awning with a scalloped-free straight valance, steel frame (3.0 m x 1.1 m projection)."""
    for name, c1, c2 in (('awning_canvas_red', (182, 36, 32), (236, 232, 222)), ('awning_canvas_green', (30, 104, 60), (236, 232, 222))):
        U.reset()
        wd = os.path.join(WORK, name)
        os.makedirs(wd, exist_ok=True)
        tp = os.path.join(wd, 'canvas.png')
        stripe_texture(tp, c1, c2)
        W, P, drop, val = 3.0, 1.1, 0.75, 0.22
        img = bpy.data.images.load(tp)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        nseg = 6
        rows = []
        for i in range(nseg + 1):
            s = i / nseg
            # slight belly in the canvas
            y = -P * s
            z = drop - drop * s - 0.05 * math.sin(math.pi * s)
            rows.append([bm.verts.new((x, y, z)) for x in (-W / 2, W / 2)])
        for i in range(nseg):
            f = bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
            for l in f.loops:
                l[uvl].uv = ((l.vert.co.x + W / 2) / W * 3, 0.25 + 0.75 * (l.vert.co.z / drop))
        vb = [bm.verts.new((x, -P, -val)) for x in (-W / 2, W / 2)]
        f = bm.faces.new((rows[-1][0], rows[-1][1], vb[1], vb[0]))
        for l in f.loops:
            l[uvl].uv = ((l.vert.co.x + W / 2) / W * 3, 0.25 * (l.vert.co.z + val) / val)
        for sx in (-1, 1):   # side cheeks
            vs = [bm.verts.new((sx * W / 2, 0, drop)), bm.verts.new((sx * W / 2, -P, 0)), bm.verts.new((sx * W / 2, 0, 0))]
            f = bm.faces.new(vs if sx > 0 else vs[::-1])
            for l in f.loops:
                l[uvl].uv = (0.05 + (-l.vert.co.y / P) * 0.3, 0.25 + 0.75 * (l.vert.co.z / drop))
        canvas = new_obj('canvas', bm, mat('canvas', img=img, rough=0.9, double=True))
        bm = bmesh.new()
        for sx in (-1, 1):
            bar(bm, (sx * W / 2, -0.01, drop + 0.02), (sx * W / 2, -P, 0.0), 0.02, seg=6)
            bar(bm, (sx * W / 2, -0.01, 0.0), (sx * W / 2, -P, 0.0), 0.016, seg=6)
        bar(bm, (-W / 2, -P, 0.0), (W / 2, -P, 0.0), 0.02, seg=6)
        bar(bm, (-W / 2, -0.02, drop + 0.02), (W / 2, -0.02, drop + 0.02), 0.03)
        frame = new_obj('frame', bm, mat('steel', color=(0.2, 0.2, 0.2), rough=0.5, metal=0.6))
        objs = [canvas, frame]
        mn, mx = U.bbox(objs)
        U.transform_all(objs, mathutils.Matrix.Translation((0, -mx[1], -mn[2])))
        save_item(name, objs, None, 'wall', {'mount': {'height': [2.3, 2.6], 'note': 'item z = 0 is the valance bottom; top rail touches the wall at z = 0.97'},
                                             'tile': {'axis': 'x', 'length': 3.0}})


def item_sign_bracket():
    """Projecting shop sign: wall plate, 0.9 m scroll-less steel arm, two hanging rods, blank 0.8 x 0.5 m board.
    The board's two faces use material 'sign_face' with UVs 0..1 (put the shop's decal texture there)."""
    bm = bmesh.new()
    add_box(bm, (0.12, 0.01, 0.35), (0, -0.005, 0.25))
    bar(bm, (0, -0.01, 0.4), (0, -0.95, 0.4), 0.03)
    bar(bm, (0, -0.01, 0.12), (0, -0.45, 0.4), 0.02)
    for y in (-0.2, -0.8):
        bar(bm, (0, y, 0.4), (0, y, 0.3), 0.008, seg=5)
    steel = new_obj('bracket', bm, mat('steel', color=(0.12, 0.12, 0.12), rough=0.5, metal=0.6))
    bm = bmesh.new()
    add_box(bm, (0.03, 0.8, 0.5), (0, -0.5, 0.05))
    board = new_obj('board', bm, None)
    me = board.data
    me.materials.append(mat('sign_frame', color=(0.85, 0.85, 0.82), rough=0.6))
    me.materials.append(mat('sign_face', color=(0.95, 0.95, 0.93), rough=0.5))
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uvl = me.uv_layers[0]
    for p in me.polygons:
        if abs(p.normal.x) > 0.9:
            p.material_index = 1
            for li in p.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                u = (-(v.y) - 0.1) / 0.8
                uvl.data[li].uv = (u if p.normal.x > 0 else 1 - u, (v.z + 0.2) / 0.5)
        else:
            p.material_index = 0
    objs = [steel, board]
    mn, mx = U.bbox(objs)
    U.transform_all(objs, mathutils.Matrix.Translation((0, -mx[1], -mn[2])))
    save_item('sign_bracket', objs, None, 'wall', {'mount': {'height': [2.6, 3.2]}, 'decal': {'material': 'sign_face', 'size': [0.8, 0.5], 'faces': '+X and -X'}})


def item_durawall():
    """Precast concrete panel wall ('durawall'): 2.0 m bay = H-section post + 4 stacked 0.5 m stone-faced panels
    (PHOTOS.md sec. 25: vendors sit against these). Tiles along x every 2.0 m (post at x = -1)."""
    c, n = tex('precast_concrete_wall', 512, nrm=True)
    conc = mat('precast', img=c, nrm=n, rough=0.95)
    bm = bmesh.new()
    for i in range(4):
        add_box(bm, (1.9, 0.05, 0.49), (0, 0, 0.25 + i * 0.5))
    add_box(bm, (0.12, 0.12, 2.1), (-1.0, 0, 1.05))
    o = new_obj('wall', bm, conc)
    box_uv(o, 0.5)
    mn, mx = U.bbox([o])
    U.transform_all([o], mathutils.Matrix.Translation((0, 0, -mn[2])))
    save_item('durawall_panel', [o], None, 'ground', {'tile': {'axis': 'x', 'length': 2.0}, 'note': 'wall centre line on the local x axis; add one post at the far end of a run'})


def item_vendor_stall():
    """Pavement vendor table with a blue tarpaulin shade on four poles (market / First St stalls)."""
    pl, _ = tex('weathered_planks', 256)
    wood = mat('planks', img=pl, rough=0.9)
    steel = mat('poles', color=(0.28, 0.28, 0.27), rough=0.6, metal=0.5)
    tarp = mat('tarp_shade', color=(0.08, 0.3, 0.62), rough=0.8, double=True)
    bm = bmesh.new()
    add_box(bm, (1.8, 0.8, 0.04), (0, 0, 0.78))
    for x in (-0.82, 0.82):
        for y in (-0.33, 0.33):
            add_box(bm, (0.05, 0.05, 0.76), (x, y, 0.38))
    add_box(bm, (1.7, 0.02, 0.2), (0, -0.39, 0.66))
    table = new_obj('table', bm, wood)
    box_uv(table, 1.0)
    bm = bmesh.new()
    for x in (-1.1, 1.1):
        for y in (-0.8, 0.7):
            bar(bm, (x, y, 0), (x, y, 2.05 if y > 0 else 1.9), 0.035, seg=6)
    poles = new_obj('poles', bm, steel)
    bm = bmesh.new()
    nx, ny = 6, 4
    grid = [[bm.verts.new((-1.2 + 2.4 * i / nx, -0.9 + 1.7 * j / ny, 1.92 + 0.14 * (j / ny) - 0.12 * math.sin(math.pi * i / nx) * math.sin(math.pi * j / ny)))
             for i in range(nx + 1)] for j in range(ny + 1)]
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    shade = new_obj('tarp', bm, tarp)
    objs = [table, poles, shade]
    place(objs, 'ground')
    save_item('vendor_stall', objs, None, 'ground', {'note': 'front (+Z) is the customer side; add crates / fruit on the table top at y = 0.8'})


def item_bollards():
    """Harare-style bollards: steel pipe with yellow/black bands, and a red/white painted median-nose block."""
    U.reset()
    bm = bmesh.new()
    add_cyl(bm, 0.07, 0.95, (0, 0, 0.475), seg=12)
    add_cyl(bm, 0.075, 0.03, (0, 0, 0.96), seg=12)
    o = new_obj('bollard', bm, None)
    yellow = mat('paint_yellow', color=(0.85, 0.66, 0.05), rough=0.55, metal=0.3)
    black = mat('paint_black', color=(0.05, 0.05, 0.05), rough=0.55, metal=0.3)
    o.data.materials.append(yellow)
    o.data.materials.append(black)
    for p in o.data.polygons:
        p.material_index = 1 if int(p.center.z / 0.16) % 2 else 0
    save_item('bollard_steel_banded', [o], None, 'ground', {'recolor': {'paint_yellow': 'or white / red'}})
    U.reset()
    bm = bmesh.new()
    # tapered precast block 1.2 x 0.6 x 0.8 m
    ret = bmesh.ops.create_cube(bm, size=1.0)
    for v in ret['verts']:
        v.co.x *= 1.2
        v.co.y *= 0.6 if v.co.z < 0 else 0.3
        v.co.z = (v.co.z + 0.5) * 0.8
    o = new_obj('block', bm, None)
    red = mat('paint_red', color=(0.62, 0.08, 0.06), rough=0.8)
    white = mat('paint_white', color=(0.86, 0.85, 0.82), rough=0.8)
    o.data.materials.append(red)
    o.data.materials.append(white)
    bpy.context.view_layer.objects.active = o
    # stripe by cutting the block into 0.3 m slices along x
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for x in np.arange(-0.45, 0.6, 0.3):
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(x, 0, 0), plane_no=(1, 0, 0))
    bm.to_mesh(o.data)
    bm.free()
    for p in o.data.polygons:
        p.material_index = 0 if int(math.floor((p.center.x + 0.6) / 0.3)) % 2 == 0 else 1
    save_item('barrier_block_redwhite', [o], None, 'ground', {'note': 'median noses and road works; long axis x'})


ITEMS = {
    'ac_unit_weathered': item_ac_unit_weathered,
    'ac_unit_small': item_ac_unit_small,
    'satellite_dish_wall': item_satellite_dish,
    'meter_boxes': item_meter_boxes,
    'razor_wire_coil': item_razor_wire,
    'tuckshop_kiosk': item_tuckshop,
    'awning_corrugated': item_awning_corrugated,
    'umbrella_airtime': item_umbrella_airtime,
    'roller_shutters': item_roller_shutters,
    'downpipe': item_downpipe,
    'gate_iron_ornate': item_iron_gate,
    'burglar_bars': item_burglar_bars,
    'security_mesh_grille': item_security_mesh,
    'trellis_gate': item_trellis_gate,
    'awning_canvas': item_awning_canvas,
    'sign_bracket': item_sign_bracket,
    'durawall_panel': item_durawall,
    'vendor_stall': item_vendor_stall,
    'bollards': item_bollards,
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for k, fn in ITEMS.items():
        if argv and k not in argv:
            continue
        U.reset()
        os.makedirs(os.path.join(WORK, k), exist_ok=True)
        try:
            fn()
        except Exception as e:  # keep going; report
            import traceback
            traceback.print_exc()
            log('FAILED', k, e)


if __name__ == '__main__':
    main()
