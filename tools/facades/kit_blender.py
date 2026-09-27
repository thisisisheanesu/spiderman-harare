"""Build the Harare facade kit in Blender (bpy module, Blender 4.2+ / 5.x).

    FACADE_WORK=<scratch> <blender-python> tools/facades/kit_blender.py [types...] [--no-bake] [--preview]

Steps
  1. build every facade type's LOD0 modules from kit_modules.py (metres, pivot = bottom-left on the wall plane)
  2. import the real downloaded attachments (Poly Haven shutter + downpipes, Sketchfab air conditioners;
     fetched by fetch_assets.py into $FACADE_WORK/raw) and normalise / decimate them
  3. bake, per type, an ORTHOGRAPHIC front-view atlas of all modules (albedo, tangent-space normal, ORM,
     tint mask + glass mask) with Cycles emission passes -> LOD1 quads are UV-mapped into it
  4. render, per type, a tileable "impostor" elevation (2 bays x ground / 2 middle floors / cap) with the same passes
  5. export $FACADE_WORK/kit_raw/<type>.glb (+ common.glb) and <type>.json (module metadata, atlas rects)
Post-processing (dilation, WebP, meshopt, kit.json) is done by atlas_post.py and optimize_kit.cjs.
"""
import json
import math
import os
import sys
import time

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit_modules as KM  # noqa: E402
from kitlib import MB, TINTABLE  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
TEX = os.path.join(REPO, 'public', 'textures')
WORK = os.environ.get('FACADE_WORK', '/tmp/facade-work')
RAW = os.path.join(WORK, 'raw')
OUT = os.path.join(WORK, 'kit_raw')
os.makedirs(OUT, exist_ok=True)
MATS = {m['name']: m for m in json.load(open(os.path.join(TEX, 'materials.json')))['materials']}

ATLAS_RES = 1024
DEPTH_RANGE = 1.5  # depth pass encodes heights -1.5 .. +1.5 m
IMP_W, IMP_H = 256, 512

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
FLAGS = {a for a in argv if a.startswith('--')}
ONLY = [a for a in argv if not a.startswith('--')]


def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = h.lstrip('#')
    return tuple(srgb2lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 0
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 4
    w = bpy.data.worlds.new('black')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.0
    sc.world = w
    return sc


# ------------------------------------------------------------------------------------------------------------
# materials: one Blender material per (type, role); node trees are rebuilt for each bake pass / export
# ------------------------------------------------------------------------------------------------------------
IMAGES = {}


def img(path, colorspace):
    key = (path, colorspace)
    if key not in IMAGES:
        im = bpy.data.images.load(path, check_existing=False)
        im.colorspace_settings.name = colorspace
        IMAGES[key] = im
    return IMAGES[key]


class RoleMat:
    """A material slot: role of a facade type, or an 'external' material from a downloaded asset."""

    def __init__(self, t, role, spec=None, ext=None):
        self.t, self.role, self.spec, self.ext = t, role, spec, ext
        self.mat = bpy.data.materials.new(f'{t}__{role}')
        self.mat.use_nodes = True

    def factor(self):
        name, tint = self.spec
        e = MATS.get(name)
        if not e or not tint:
            return (1.0, 1.0, 1.0)
        t = hex_lin(tint)
        a = e['avgColorLinear']
        return tuple(t[i] / max(a[i], 1e-4) for i in range(3))

    def build(self, mode):
        nt = self.mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        role = self.role
        if mode == 'export':
            bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
            nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
            if self.ext:
                self._ext_export(nt, bsdf)
                return
            name, tint = self.spec
            col = hex_lin(tint) if tint else tuple(MATS[name]['avgColorLinear']) if name in MATS else (0.6, 0.6, 0.6)
            if role in ('glass', 'glass_spandrel'):
                col = hex_lin(tint)
            bsdf.inputs['Base Color'].default_value = (*col, 1)
            bsdf.inputs['Roughness'].default_value = 0.08 if role.startswith('glass') else 0.75
            bsdf.inputs['Metallic'].default_value = 0.6 if role == 'frame' else 0.0
            return
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        color = self._pass(nt, mode)
        if isinstance(color, tuple):
            em.inputs['Color'].default_value = (*color, 1)
        else:
            nt.links.new(color, em.inputs['Color'])

    # -- helpers --
    def _uv_tex(self, nt, file, cs, tile):
        tc = nt.nodes.new('ShaderNodeUVMap')
        tc.uv_map = 'UVMap'
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile[0], 1 / tile[1], 1)
        nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
        it = nt.nodes.new('ShaderNodeTexImage')
        it.image = img(os.path.join(TEX, file), cs)
        it.interpolation = 'Cubic'
        nt.links.new(mp.outputs['Vector'], it.inputs['Vector'])
        return it

    def _ext_img(self, nt, key, cs):
        path = self.ext.get(key)
        if not path:
            return None
        tc = nt.nodes.new('ShaderNodeUVMap')
        tc.uv_map = self.ext.get('uv', 'UVMap')
        it = nt.nodes.new('ShaderNodeTexImage')
        it.image = img(path, cs)
        nt.links.new(tc.outputs['UV'], it.inputs['Vector'])
        return it

    def _ext_export(self, nt, bsdf):
        a = self._ext_img(nt, 'albedo', 'sRGB')
        if a:
            nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
        n = self._ext_img(nt, 'normal', 'Non-Color')
        if n:
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.uv_map = self.ext.get('uv', 'UVMap')
            nt.links.new(n.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        r = self._ext_img(nt, 'mr', 'Non-Color')
        if r:
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(r.outputs['Color'], sep.inputs['Color'])
            nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
            nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        else:
            bsdf.inputs['Roughness'].default_value = 0.7

    def _vmul(self, nt, a, b):
        m = nt.nodes.new('ShaderNodeVectorMath')
        m.operation = 'MULTIPLY'
        if isinstance(a, tuple):
            m.inputs[0].default_value = a
        else:
            nt.links.new(a, m.inputs[0])
        if isinstance(b, tuple):
            m.inputs[1].default_value = b
        else:
            nt.links.new(b, m.inputs[1])
        return m.outputs[0]

    def _pass(self, nt, mode):
        role = self.role
        e = None if self.ext else MATS.get(self.spec[0])
        textured = e is not None and role not in ('glass', 'glass_spandrel', 'sign')
        if mode == 'albedo':
            if self.ext:
                a = self._ext_img(nt, 'albedo', 'sRGB')
                return a.outputs['Color'] if a else (0.5, 0.5, 0.5)
            if role == 'glass':
                return tuple(c * 0.22 for c in hex_lin(self.spec[1]))
            if role == 'glass_spandrel':
                return tuple(c * 0.2 for c in hex_lin(self.spec[1]))
            if role == 'sign':
                return hex_lin('#d9d6cc')
            if not textured:
                return hex_lin(self.spec[1] or '#888888')
            it = self._uv_tex(nt, e['files']['albedo'], 'sRGB', e['tileSizeMetres'])
            return self._vmul(nt, it.outputs['Color'], self.factor())
        if mode == 'normal':
            if textured or (self.ext and self.ext.get('normal')):
                if self.ext:
                    it = self._ext_img(nt, 'normal', 'Non-Color')
                else:
                    it = self._uv_tex(nt, e['files']['normal'], 'Non-Color', e['tileSizeMetres'])
                nm = nt.nodes.new('ShaderNodeNormalMap')
                nm.uv_map = self.ext.get('uv', 'UVMap') if self.ext else 'UVMap'
                nt.links.new(it.outputs['Color'], nm.inputs['Color'])
                N = nm.outputs['Normal']
            else:
                g = nt.nodes.new('ShaderNodeNewGeometry')
                N = g.outputs['Normal']
            sep = nt.nodes.new('ShaderNodeSeparateXYZ')
            nt.links.new(N, sep.inputs[0])
            neg = nt.nodes.new('ShaderNodeMath')
            neg.operation = 'MULTIPLY'
            neg.inputs[1].default_value = -1.0
            nt.links.new(sep.outputs['Y'], neg.inputs[0])
            comb = nt.nodes.new('ShaderNodeCombineXYZ')
            nt.links.new(sep.outputs['X'], comb.inputs['X'])
            nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
            nt.links.new(neg.outputs[0], comb.inputs['Z'])
            ma = nt.nodes.new('ShaderNodeVectorMath')
            ma.operation = 'MULTIPLY_ADD'
            nt.links.new(comb.outputs[0], ma.inputs[0])
            ma.inputs[1].default_value = (0.5, 0.5, 0.5)
            ma.inputs[2].default_value = (0.5, 0.5, 0.5)
            return ma.outputs[0]
        if mode == 'orm':
            ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
            ao.samples = 6
            ao.only_local = True
            ao.inputs['Distance'].default_value = 0.8
            comb = nt.nodes.new('ShaderNodeCombineColor')
            if textured or (self.ext and self.ext.get('mr')):
                it = self._ext_img(nt, 'mr', 'Non-Color') if self.ext else self._uv_tex(nt, e['files']['orm'], 'Non-Color', e['tileSizeMetres'])
                sep = nt.nodes.new('ShaderNodeSeparateColor')
                nt.links.new(it.outputs['Color'], sep.inputs['Color'])
                if self.ext:
                    nt.links.new(ao.outputs['AO'], comb.inputs['Red'])
                else:
                    mul = nt.nodes.new('ShaderNodeMath')
                    mul.operation = 'MULTIPLY'
                    nt.links.new(ao.outputs['AO'], mul.inputs[0])
                    nt.links.new(sep.outputs['Red'], mul.inputs[1])
                    nt.links.new(mul.outputs[0], comb.inputs['Red'])
                nt.links.new(sep.outputs['Green'], comb.inputs['Green'])
                nt.links.new(sep.outputs['Blue'], comb.inputs['Blue'])
            else:
                nt.links.new(ao.outputs['AO'], comb.inputs['Red'])
                comb.inputs['Green'].default_value = 0.07 if role == 'glass' else 0.12 if role == 'glass_spandrel' else 0.6
                comb.inputs['Blue'].default_value = 0.0
            return comb.outputs['Color']
        if mode == 'mask':
            if role in TINTABLE and not self.ext:
                c = [0.0, 0.0, 0.0]
                c[TINTABLE[role]] = 1.0
                return tuple(c)
            return (0.0, 0.0, 0.0)
        if mode == 'glass':
            return (1.0, 1.0, 1.0) if role == 'glass' and not self.ext else (0.0, 0.0, 0.0)
        if mode == 'depth':
            # height above the wall plane (outward positive) h = -y, encoded e = (h + DEPTH_RANGE) / (2 * DEPTH_RANGE)
            g = nt.nodes.new('ShaderNodeNewGeometry')
            sep = nt.nodes.new('ShaderNodeSeparateXYZ')
            nt.links.new(g.outputs['Position'], sep.inputs[0])
            m = nt.nodes.new('ShaderNodeMath')
            m.operation = 'MULTIPLY_ADD'
            m.use_clamp = True
            nt.links.new(sep.outputs['Y'], m.inputs[0])
            m.inputs[1].default_value = -1.0 / (2 * DEPTH_RANGE)
            m.inputs[2].default_value = 0.5
            return m.outputs[0]
        raise ValueError(mode)


ROLEMATS = {}


def role_mats(t):
    if t not in ROLEMATS:
        spec = KM.TYPES[t]['materials'] if t in KM.TYPES else COMMON_MATS
        d = {}
        for role in ['wall', 'trim', 'accent', 'plinth', 'frame', 'glass', 'glass_spandrel', 'metal', 'roof_sheet', 'sign']:
            s = spec.get(role) or COMMON_MATS.get(role)
            d[role] = RoleMat(t, role, s)
        ROLEMATS[t] = d
    return ROLEMATS[t]


COMMON_MATS = KM.COMMON_MATS

EXT_MATS = []  # RoleMat objects of imported assets


def set_mode(mode):
    for d in ROLEMATS.values():
        for rm in d.values():
            rm.build(mode)
    for rm in EXT_MATS:
        rm.build(mode)


# ------------------------------------------------------------------------------------------------------------
# objects
# ------------------------------------------------------------------------------------------------------------
def make_obj(name, mesh, coll):
    ob = bpy.data.objects.new(name, mesh)
    coll.objects.link(ob)
    return ob


def new_coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def mesh_tris(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def to_gltf(p):
    """Blender module coords (x, y into building, z up) -> kit/glTF coords (x, y up, z outward)."""
    return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]


def conv_anchors(anchors):
    out = {}
    for k, lst in anchors.items():
        conv = []
        for a in lst:
            if len(a) == 3:
                conv.append(to_gltf(a))
            elif len(a) == 5:  # rect: x0, y(depth), z0, x1, z1 -> {x0, y0, x1, y1, z}
                conv.append(dict(x0=round(a[0], 4), y0=round(a[2], 4), x1=round(a[3], 4), y1=round(a[4], 4), z=round(-a[1], 4)))
        out[k] = conv
    return out


def bounds(me):
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


def decimated_copy(ob, ratio, name, coll):
    """New object with a collapse-decimated copy of ob's mesh (UVs kept)."""
    tmp = ob.copy()
    tmp.data = ob.data.copy()
    bpy.context.scene.collection.objects.link(tmp)
    md = tmp.modifiers.new('dec', 'DECIMATE')
    md.decimate_type = 'COLLAPSE'
    md.ratio = ratio
    md.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    me.name = name
    ob2 = make_obj(name, me, coll)
    ob2.matrix_world = ob.matrix_world.copy()
    return ob2


# ------------------------------------------------------------------------------------------------------------
# imported attachments (real downloads)
# ------------------------------------------------------------------------------------------------------------
def safe_remove(objs):
    for o in objs:
        try:
            bpy.data.objects.remove(o)
        except ReferenceError:
            pass


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def ext_rolemat(name, mat):
    """Wrap an imported material (Principled + image textures) as a RoleMat with its textures."""
    ext = {'uv': 'UVMap'}
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)

    def src(sock):
        if not sock.is_linked:
            return None
        n = sock.links[0].from_node
        while n.type not in ('TEX_IMAGE',) and n.inputs and any(i.is_linked for i in n.inputs):
            n = next(i for i in n.inputs if i.is_linked).links[0].from_node
        return n.image.filepath_from_user() if n.type == 'TEX_IMAGE' and n.image else None

    if bsdf:
        ext['albedo'] = src(bsdf.inputs['Base Color'])
        ext['mr'] = src(bsdf.inputs['Roughness']) or src(bsdf.inputs['Metallic'])
        ext['normal'] = src(bsdf.inputs['Normal'])
    for k in ('albedo', 'mr', 'normal'):
        if ext.get(k) and not os.path.exists(ext[k]):
            ext[k] = None
    rm = RoleMat('common', name, spec=None, ext=ext)
    EXT_MATS.append(rm)
    return rm


def unpack_images(prefix):
    """GLB textures are packed: write them to $WORK/raw/_img/<prefix>_<name>.png so Cycles / export can reuse them."""
    d = os.path.join(RAW, '_img')
    os.makedirs(d, exist_ok=True)
    for im in bpy.data.images:
        if im.packed_file and not im.get('_unpacked'):
            p = os.path.join(d, f'{prefix}_{im.name}.png'.replace(' ', '_'))
            im.filepath_raw = p
            im.file_format = 'PNG'
            im.save()
            im['_unpacked'] = 1
            im.filepath = p


def normalise(obs, rot_z=0.0, scale=1.0, anchor='back', target_y=0.0):
    """Join-free normalisation: rotate / scale about the origin, then translate so the union bbox has
    x centred, z from 0 and (anchor 'back') max y = target_y or (anchor 'front') min y = target_y."""
    R = Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Scale(scale, 4)
    for o in obs:
        o.matrix_world = R @ o.matrix_world
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in obs if o.type == 'MESH' for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    dy = (target_y - mx.y) if anchor == 'back' else (target_y - mn.y)
    T = Matrix.Translation(Vector((-(mn.x + mx.x) / 2, dy, -mn.z)))
    for o in obs:
        o.matrix_world = T @ o.matrix_world


def bake_into_mesh(obs, name, coll):
    """Apply transforms, join mesh objects into one new object named `name`."""
    meshes = [o for o in obs if o.type == 'MESH']
    dg = bpy.context.evaluated_depsgraph_get()
    import bmesh
    bm = bmesh.new()
    mats = []
    for o in meshes:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        me.transform(o.matrix_world)
        # remap material indices
        idx = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            idx.append(mats.index(m))
        for p in me.polygons:
            p.material_index = idx[p.material_index] if idx else 0
        # keep only the first UV layer, named UVMap
        while len(me.uv_layers) > 1:
            me.uv_layers.remove(me.uv_layers[-1])
        if me.uv_layers:
            me.uv_layers[0].name = 'UVMap'
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    for m in mats:
        out.materials.append(m)
    ob = make_obj(name, out, coll)
    safe_remove(obs)
    return ob


def build_common(coll):
    """Shared attachments: canopy, real AC units, real shutter, real downpipe parts, burglar bars, blade sign."""
    mods = {}
    mats = role_mats('common')
    matmap = {r: rm.mat for r, rm in mats.items()}

    # procedural ones
    mb, meta = KM.canopy()
    ob = make_obj('common.canopy', mb.to_mesh('common.canopy', matmap), coll)
    mods['canopy'] = (ob, meta)

    # burglar bars: 1 x 1 m panel of 20 mm steel flats, stretched to the window (anchors.bars)
    mb = MB()
    nv, nh = 8, 4
    for k in range(nv + 1):
        x = k / nv
        mb.box(x - 0.01, x + 0.01, -0.06, -0.035, 0, 1, 'metal', 'flrb')
    for k in range(nh + 1):
        z = k / nh
        mb.box(0, 1, -0.07, -0.06, z - 0.012, z + 0.012, 'metal', 'ftdb')
    ob = make_obj('common.bars', mb.to_mesh('common.bars', matmap), coll)
    mods['bars'] = (ob, KM.M('attachment', 'any', 1.0, 1.0, (0.4, 4.0), (0.4, 3.0), lod1='none',
                             notes='burglar bars: 1 x 1 m steel grid, scale to the window rect (anchors.bars), 6 cm proud'))

    # blade sign projecting from the wall (CABS "B" / "S" signs)
    mb = MB()
    L, Hs, t = 0.75, 1.6, 0.14
    mb.box(-t / 2, t / 2, -L - 0.12, -0.12, 0, Hs, 'metal', 'td')
    mb.poly([(t / 2, -L - 0.12, 0), (t / 2, -0.12, 0), (t / 2, -0.12, Hs), (t / 2, -L - 0.12, Hs)], 'sign',
            uv0=[(0, 0), (1, 0), (1, 1), (0, 1)])
    mb.poly([(-t / 2, -0.12, 0), (-t / 2, -L - 0.12, 0), (-t / 2, -L - 0.12, Hs), (-t / 2, -0.12, Hs)], 'sign',
            uv0=[(0, 0), (1, 0), (1, 1), (0, 1)])
    mb.box(-t / 2, t / 2, -L - 0.14, -L - 0.12, 0, Hs, 'metal', 'f')
    for z in (0.2, Hs - 0.2):
        mb.box(-0.02, 0.02, -0.14, 0, z - 0.02, z + 0.02, 'metal', 'ftdlr')
    ob = make_obj('common.sign_blade', mb.to_mesh('common.sign_blade', matmap), coll)
    mods['sign_blade'] = (ob, KM.M('attachment', 'any', 0.14, Hs, (0.14, 0.14), (0.8, 3.0), lod1='self',
                                   notes='projecting blade sign (both faces role sign, UV 0..1), origin at the wall, bottom'))

    # --- Poly Haven roll-down shutter (CC0) ---
    p = os.path.join(RAW, 'rollershutter_door', 'rollershutter_door_1k.gltf')
    if os.path.exists(p):
        obs = import_gltf(p)
        keep = [o for o in obs if o.name == 'rollershutter_door']
        for o in obs:
            if o not in keep and o.type == 'MESH':
                bpy.data.objects.remove(o)
        obs = keep
        # origin: left edge, ground, wall plane at the back of the shutter box
        normalise(obs, anchor='back', target_y=0.0)
        for o in obs:
            o.location.x += 0.54
        ob = bake_into_mesh(obs, 'common.shutter', coll)
        for i, m in enumerate(ob.data.materials):
            rm = ext_rolemat('shutter', m)
            ob.data.materials[i] = rm.mat
        mods['shutter'] = (ob, KM.M('attachment', 'ground', 1.08, 2.4, (0.6, 5.0), (1.8, 4.2), lod1='decimate:0.25',
                                    notes='Poly Haven roll-down shutter (scan) incl. shutter box; scale x/y to anchors.shutter; '
                                          'origin bottom-left, back of the box on the wall plane'))

    # --- Poly Haven gutter / downpipe parts (CC0) ---
    p = os.path.join(RAW, 'modular_metal_gutter', 'modular_metal_gutter_1k.gltf')
    if os.path.exists(p):
        obs = import_gltf(p)
        by = {o.name: o for o in obs}
        parts = {'downpipe': ('modular_metal_gutter_section', 0.25), 'downpipe_shoe': ('modular_metal_gutter_outlet', 0.18),
                 'downpipe_hopper': ('modular_metal_gutter_funnel', 0.12)}
        for key, (src, ratio) in parts.items():
            o = by[src]
            o2 = decimated_copy(o, ratio, 'tmp_' + key, coll)
            normalise([o2], scale=0.7, anchor='back', target_y=-0.02)
            ob = bake_into_mesh([o2], 'common.' + key, coll)
            if key == 'downpipe':
                # exactly 1 m long after scaling: rescale z back to 1.0
                zs = [v.co.z for v in ob.data.vertices]
                s = 1.0 / (max(zs) - min(zs))
                for v in ob.data.vertices:
                    v.co.z *= s
            for i, m in enumerate(ob.data.materials):
                if not any(r.mat == m for r in EXT_MATS):
                    rm = ext_rolemat('pipe', m)
                    ob.data.materials[i] = rm.mat
            b = bounds(ob.data)
            mods[key] = (ob, KM.M('attachment', 'any', round(b[1] - b[0], 3), round(b[5] - b[4], 3),
                                  (0, 0), (0.5, 6.0) if key == 'downpipe' else (1, 1), lod1='self' if key != 'downpipe' else 'decimate:0.5',
                                  notes={'downpipe': 'galvanised downpipe, 1 m long: scale y to the run length; axis 0.11 m off the wall',
                                         'downpipe_shoe': 'downpipe shoe (bottom outlet)',
                                         'downpipe_hopper': 'rainwater hopper head (top of a downpipe, under the parapet)'}[key]))
        safe_remove(obs)

    # --- Sketchfab window air conditioner (CC BY, HASSAN) ---
    p = os.path.join(RAW, 'df7687570458444cb66fecdbfea2adc4', 'model.glb')
    if os.path.exists(p):
        obs = import_gltf(p)
        unpack_images('acwin')
        meshes = [o for o in obs if o.type == 'MESH']
        # front grille faces -y already; put the front face 0.35 m in front of the origin
        normalise(meshes, anchor='front', target_y=-0.35)
        ob = bake_into_mesh(meshes, 'tmp_acw', coll)
        safe_remove(obs)
        ob2 = decimated_copy(ob, 0.4, 'common.ac_window', coll)
        bpy.data.objects.remove(ob)
        for i, m in enumerate(ob2.data.materials):
            rm = ext_rolemat('ac_window', m)
            ob2.data.materials[i] = rm.mat
        b = bounds(ob2.data)
        mods['ac_window'] = (ob2, KM.M('attachment', 'any', round(b[1] - b[0], 3), round(b[5] - b[4], 3), (0, 0), (1, 1),
                                       lod1='decimate:0.15',
                                       notes='window / through-wall air conditioner (Sketchfab scan-textured model). Origin: '
                                             'bottom-centre, 0.35 m behind its grille: place on an anchors.ac point'))

    # --- Sketchfab split-system outdoor unit (CC BY, MC_RightLeft) ---
    p = os.path.join(RAW, '11d7c77bfe804f448a516928adf3f05d', 'model.glb')
    if os.path.exists(p):
        obs = import_gltf(p)
        unpack_images('acsplit')
        meshes = [o for o in obs if o.type == 'MESH']
        pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        width = max(p_.y for p_ in pts) - min(p_.y for p_ in pts)
        normalise(meshes, rot_z=math.pi / 2, scale=0.8 / width, anchor='back', target_y=0.0)
        ob = bake_into_mesh(meshes, 'tmp_acs', coll)
        safe_remove(obs)
        ob2 = decimated_copy(ob, 0.45, 'common.ac_split', coll)
        bpy.data.objects.remove(ob)
        for i, m in enumerate(ob2.data.materials):
            rm = ext_rolemat('ac_split', m)
            ob2.data.materials[i] = rm.mat
        b = bounds(ob2.data)
        mods['ac_split'] = (ob2, KM.M('attachment', 'any', round(b[1] - b[0], 3), round(b[5] - b[4], 3), (0, 0), (1, 1),
                                      lod1='decimate:0.2',
                                      notes='split-system outdoor unit on wall brackets (Sketchfab). Origin: bottom-centre on '
                                            'the wall plane; hang it on the wall (spandrel / pier) of any floor'))
    return mods


# ------------------------------------------------------------------------------------------------------------
# atlas / impostor rendering
# ------------------------------------------------------------------------------------------------------------
def module_rect(meta, me):
    if meta['kind'] == 'corner':
        b = bounds(me)
        return (b[0], meta['w'], 0.0, meta['h'])
    return (0.0, meta['w'], 0.0, meta['h'])


def pack(rects, res, pad_px=10):
    """Shelf-pack rects [(key, w, h)] into a square of side S metres (smallest S that fits)."""
    area = sum(w * h for _, w, h in rects)
    S = math.sqrt(area) * 1.02
    order = sorted(rects, key=lambda r: -r[2])
    while True:
        pad = pad_px * S / res
        x = y = 0.0
        rowh = 0.0
        pos = {}
        ok = True
        for key, w, h in order:
            if x + w + pad > S:
                x = 0.0
                y += rowh + pad
                rowh = 0.0
            if x + w + pad > S or y + h + pad > S:
                ok = False
                break
            pos[key] = (x + pad / 2, y + pad / 2)
            x += w + pad
            rowh = max(rowh, h)
        if ok:
            return S, pos
        S *= 1.03


def ortho_cam(x0, z0, w, h, fit='AUTO'):
    cam = bpy.data.cameras.new('atlascam')
    cam.type = 'ORTHO'
    cam.sensor_fit = fit
    cam.ortho_scale = max(w, h) if fit == 'AUTO' else (h if fit == 'VERTICAL' else w)
    cam.clip_start = 0.1
    cam.clip_end = 200
    co = bpy.data.objects.new('atlascam', cam)
    bpy.context.scene.collection.objects.link(co)
    co.location = (x0 + w / 2, -60.0, z0 + h / 2)
    co.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.scene.camera = co
    return co


PASS_SAMPLES = dict(albedo=16, normal=8, orm=10, mask=4, glass=4, depth=6)


def render_passes(prefix, rx, ry):
    sc = bpy.context.scene
    sc.render.resolution_x = rx
    sc.render.resolution_y = ry
    sc.render.resolution_percentage = 100
    files = {}
    for mode in ('albedo', 'normal', 'orm', 'mask', 'glass', 'depth'):
        set_mode(mode)
        sc.cycles.samples = PASS_SAMPLES[mode]
        sc.view_settings.view_transform = 'Standard' if mode == 'albedo' else 'Raw'
        sc.view_settings.look = 'None'
        sc.render.image_settings.color_depth = '16' if mode == 'depth' else '8'
        sc.render.filepath = f'{prefix}_{mode}.png'
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        files[mode] = sc.render.filepath
        print(f'  pass {mode} {rx}x{ry} {time.time() - t0:.1f}s', flush=True)
    return files


def hide_all_but(coll):
    for c in bpy.context.scene.collection.children:
        c.hide_render = c != coll


def build_atlas(t, mods, coll_atlas):
    """Place a copy of every quad/box module on the atlas plane, render the passes, return rects."""
    items = []
    for key, (ob, meta) in mods.items():
        if meta['lod1'] in ('quad', 'box'):
            r = module_rect(meta, ob.data)
            items.append((key, r[1] - r[0], r[3] - r[2]))
    S, pos = pack(items, ATLAS_RES)
    rects = {}
    for key, w, h in items:
        ob, meta = mods[key]
        r = module_rect(meta, ob.data)
        X0, Z0 = pos[key]
        cp = make_obj(f'atlas.{t}.{key}', ob.data, coll_atlas)
        cp.location = (X0 - r[0], 0.0, Z0 - r[2])
        # pixel rect (from the top-left of the image) and Blender UV rect (v from the bottom)
        px = ATLAS_RES / S
        rects[key] = dict(px=[round(X0 * px, 2), round((S - Z0 - h) * px, 2), round(w * px, 2), round(h * px, 2)],
                          uv=[X0 / S, Z0 / S, (X0 + w) / S, (Z0 + h) / S], rect=list(r))
    cam = ortho_cam(0, 0, S, S)
    hide_all_but(coll_atlas)
    files = render_passes(os.path.join(OUT, f'{t}_atlas'), ATLAS_RES, ATLAS_RES)
    bpy.data.objects.remove(cam)
    return dict(size_m=S, px_per_m=ATLAS_RES / S, res=ATLAS_RES, rects=rects, files=files)


def impostor_layout(t, mods, common):
    """Canonical 2-bay elevation: ground, 2 middle floors, cap (+ canopy / verandah / some AC units)."""
    T = KM.TYPES[t]
    R = KM.RULES[t]
    W, H, Hg, hc = T['W'], T['H'], T['Hg'], T['hc']
    mid = max(R['middle'], key=R['middle'].get)
    alt = mid
    ground = max(R['ground'], key=R['ground'].get)
    if t == 'avenues':
        mid, alt = 'bay_balcony', 'bay_rail'
    if t == 'deco':
        ground = 'shop'
    place = []  # (obj, x, z, sx, sz)

    def put(key, x, z, w, h, src=mods):
        ob, meta = src[key]
        place.append((ob, x, z, w / meta['w'] if meta['w'] else 1.0, h / meta['h'] if meta['h'] else 1.0))

    for b in range(2):
        x = b * W
        put(ground, x, 0, W, Hg)
        put(mid if b == 0 else alt, x, Hg, W, H)
        put(alt if b == 0 else mid, x, Hg + H, W, H)
        put('cap', x, Hg + 2 * H, W, hc)
        if R.get('canopy', 0) >= 0.5 and 'canopy' in common:
            put('canopy', x, Hg - 0.55, W, common['canopy'][1]['h'], src=common)
        if R.get('verandah', 0) >= 0.5 and 'verandah' in mods:
            put('verandah', x, 0, W, mods['verandah'][1]['h'])
    extras = []
    if R['attachments'].get('ac', 0) >= 0.1 and 'ac_window' in common:
        m = mods[mid][1]
        if m['anchors'].get('ac'):
            ax, ay, az = m['anchors']['ac'][0]
            extras.append((common['ac_window'][0], W + ax, Hg + H + az, ay))
    return dict(place=place, extras=extras, W=2 * W, H=Hg + 2 * H + hc,
                rows=dict(ground=[0, Hg], middle=[Hg, Hg + 2 * H], cap=[Hg + 2 * H, Hg + 2 * H + hc]),
                ground=ground, mid=[mid, alt])


def build_impostor(t, mods, common, coll_imp):
    lay = impostor_layout(t, mods, common)
    for ob, x, z, sx, sz in lay['place']:
        cp = make_obj(f'imp.{t}.{ob.name}', ob.data, coll_imp)
        cp.location = (x, 0, z)
        cp.scale = (sx, 1, sz)
    for ob, x, z, y in lay['extras']:
        cp = make_obj(f'imp.{t}.{ob.name}', ob.data, coll_imp)
        cp.location = (x, y, z)
    Wm, Hm = lay['W'], lay['H']
    ry = 2 * IMP_H
    rx = round(ry * Wm / Hm)
    cam = ortho_cam(0, 0, Wm, Hm, fit='VERTICAL')
    hide_all_but(coll_imp)
    files = render_passes(os.path.join(OUT, f'{t}_imp'), rx, ry)
    bpy.data.objects.remove(cam)
    rows = {k: [v[0] / Hm, v[1] / Hm] for k, v in lay['rows'].items()}
    return dict(width_m=Wm, height_m=Hm, bays=2, rows_v=rows, rows_m=lay['rows'], render=[rx, ry], files=files,
                ground=lay['ground'], middle=lay['mid'])


def lod1_quad(t, key, ob, meta, rect, coll, atlas_mat):
    import bmesh
    r = rect['rect']
    u0, v0, u1, v1 = rect['uv']
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')

    def quad(pts, uvs):
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        for l, uv in zip(f.loops, uvs):
            l[uvl].uv = uv

    if meta['lod1'] == 'box':  # corner pier: front face + left (return) face, both showing the front view
        x0, x1, z0, z1 = r
        y0 = x0  # corner piers are square: they start at -proj in both x and y
        quad([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
        quad([(x0, x1, z0), (x0, y0, z0), (x0, y0, z1), (x0, x1, z1)], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    else:
        quad([(0, 0, 0), (meta['w'], 0, 0), (meta['w'], 0, meta['h']), (0, 0, meta['h'])], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    me = bpy.data.meshes.new(f'{t}.{key}.lod1')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(atlas_mat)
    return make_obj(f'{t}.{key}.lod1', me, coll)


def export(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_extras=True, export_yup=True,
                              export_apply=False, export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_animations=False, export_skins=False, export_morph=False, export_lights=False,
                              export_cameras=False, export_image_format='AUTO')


def preview_scene(t, mods, common, path):
    """Lit 3/4 preview of the impostor elevation + module line-up (QA only)."""
    sc = bpy.context.scene
    coll = new_coll('preview_' + t)
    lay = impostor_layout(t, mods, common)
    for ob, x, z, sx, sz in lay['place']:
        cp = make_obj('pv.' + ob.name, ob.data, coll)
        cp.location = (x, 0, z)
        cp.scale = (sx, 1, sz)
    x = lay['W'] + 1.5
    for key, (ob, meta) in mods.items():
        cp = make_obj('pv.' + ob.name, ob.data, coll)
        cp.location = (x, 0, 0)
        x += (meta['w'] or 0.5) + 0.8
    hide_all_but(coll)
    set_mode('export')
    w = bpy.data.worlds.new('sky')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.7, 0.95, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    old = sc.world
    sc.world = w
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 4.0
    so = bpy.data.objects.new('sun', sun)
    coll.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    cam = bpy.data.cameras.new('pv')
    cam.lens = 28
    co = bpy.data.objects.new('pv', cam)
    coll.objects.link(co)
    target = Vector((x / 2, 0, lay['H'] / 2.2))
    co.location = target + Vector((-0.18 * x, -0.62 * x, 0.12 * x))
    co.rotation_euler = (target - co.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.cycles.samples = 16
    sc.cycles.max_bounces = 3
    sc.view_settings.view_transform = 'AgX'
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    sc.render.film_transparent = False
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sc.render.film_transparent = True
    sc.cycles.max_bounces = 0
    sc.world = old
    coll.hide_render = True


# ------------------------------------------------------------------------------------------------------------
def write_types():
    json.dump(KM.types_json(), open(os.path.join(OUT, 'types.json'), 'w'), indent=1)


def main():
    sc = reset()
    write_types()
    types = ONLY or list(KM.TYPES)
    coll_common = new_coll('common')
    common = build_common(coll_common)
    summary = {}
    # common kit export (LOD0 + LOD1)
    lod1s = []
    for key, (ob, meta) in common.items():
        spec = meta['lod1']
        if spec.startswith('decimate'):
            lod1s.append(decimated_copy(ob, float(spec.split(':')[1]), f'common.{key}.lod1', coll_common))
        elif spec == 'self':
            cp = make_obj(f'common.{key}.lod1', ob.data, coll_common)
            lod1s.append(cp)
    set_mode('export')
    if 'common' in types or not ONLY:
        export([o for o, _ in common.values()] + lod1s, os.path.join(OUT, 'common.glb'))
        cm = {}
        for key, (ob, meta) in common.items():
            m = dict(meta)
            m['anchors'] = conv_anchors(meta.get('anchors', {}))
            m['node'] = ob.name
            m['lod1_node'] = f'common.{key}.lod1' if meta['lod1'] != 'none' else None
            m['tris'] = [mesh_tris(ob.data), mesh_tris(bpy.data.objects[m['lod1_node']].data) if m['lod1_node'] else 0]
            m['materials'] = [mm.name.split('__', 1)[1] for mm in ob.data.materials]
            cm[key] = m
        json.dump(dict(modules=cm, ext_materials={rm.role: rm.ext for rm in EXT_MATS}), open(os.path.join(OUT, 'common.json'), 'w'), indent=1)
        print('common exported', {k: v['tris'] for k, v in cm.items()}, flush=True)

    for t in types:
        if t not in KM.TYPES:
            continue
        t0 = time.time()
        coll = new_coll(t)
        mats = role_mats(t)
        matmap = {r: rm.mat for r, rm in mats.items()}
        mods = {}
        for key, (mb, meta) in KM.build_type(t).items():
            me = mb.to_mesh(f'{t}.{key}', matmap)
            ob = make_obj(f'{t}.{key}', me, coll)
            mods[key] = (ob, meta)
        info = {}
        if '--no-bake' not in FLAGS:
            coll_atlas = new_coll('atlas_' + t)
            info['atlas'] = build_atlas(t, mods, coll_atlas)
            coll_imp = new_coll('imp_' + t)
            info['impostor'] = build_impostor(t, mods, common, coll_imp)
        # LOD1
        atlas_mat = bpy.data.materials.new(f'{t}__atlas')
        lod1 = {}
        for key, (ob, meta) in mods.items():
            if meta['lod1'] in ('quad', 'box') and 'atlas' in info:
                lod1[key] = lod1_quad(t, key, ob, meta, info['atlas']['rects'][key], coll, atlas_mat)
            elif meta['lod1'] == 'self':
                lod1[key] = decimated_copy(ob, 0.35 if key.startswith('verandah') else 1.0, f'{t}.{key}.lod1', coll)
        set_mode('export')
        coll.hide_render = False
        export([o for o, _ in mods.values()] + list(lod1.values()), os.path.join(OUT, f'{t}.glb'))
        mm = {}
        for key, (ob, meta) in mods.items():
            m = dict(meta)
            m['anchors'] = conv_anchors(meta.get('anchors', {}))
            b = bounds(ob.data)
            m['bounds'] = dict(min=to_gltf((b[0], b[3], b[4])), max=to_gltf((b[1], b[2], b[5])))
            m['node'] = ob.name
            m['lod1_node'] = lod1[key].name if key in lod1 else None
            m['tris'] = [mesh_tris(ob.data), mesh_tris(lod1[key].data) if key in lod1 else 0]
            m['materials'] = [x.name.split('__', 1)[1] for x in ob.data.materials]
            mm[key] = m
        info['modules'] = mm
        json.dump(info, open(os.path.join(OUT, f'{t}.json'), 'w'), indent=1)
        if '--preview' in FLAGS:
            preview_scene(t, mods, common, os.path.join(OUT, f'{t}_preview.png'))
        summary[t] = {k: v['tris'] for k, v in mm.items()}
        print(t, f'{time.time() - t0:.1f}s', summary[t], flush=True)


main()
