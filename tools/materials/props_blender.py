"""Street-prop assembly in Blender (run with Blender's Python / the `bpy` module):

    $BPY tools/materials/props_blender.py [prop names...]

Two kinds of props:
  * Poly Haven CC0 scans (downloaded by fetch_ph_models.py): the chosen variant objects are kept, joined,
    cleaned (custom normals cleared, smooth-by-angle), rotated so the front faces glTF +Z, scaled to
    real size and moved so the feet sit on y = 0 and the footprint is centred on x = z = 0.
  * Props modelled here from primitives (street lamps, bollards, bus shelter, satellite dish, JoJo water
    tank, vendor umbrella, traffic cone, concrete planter). They use one material with a 128 px colour
    palette texture (+ matching ORM palette), so each prop is a single draw call; the lamp lenses are a
    second material named `LampLens` that the game can make emissive at night.

Writes full-resolution intermediates to $PROPS_RAW (default $MAT_CACHE/props_raw)/<name>.glb plus
<name>.json (metadata: height, footprint radius, anchors, source). tools/materials/optimize_props.cjs then
simplifies (LOD0 <= 3000 tris, LOD1 <= 600 tris), resizes textures to WebP and meshopt-compresses into
public/models/props/.
"""
import json
import math
import os
import sys

import bpy  # noqa: I001  (bpy must be imported before bmesh / mathutils when running as a module)
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('MAT_CACHE', '/tmp/spiderman-materials-cache')
RAW = os.environ.get('PROPS_RAW', os.path.join(CACHE, 'props_raw'))
os.makedirs(RAW, exist_ok=True)

# ------------------------------------------------------------------------------------------ Poly Haven props
# keep: exact object names to keep (None = all meshes). rot: degrees about the vertical axis applied first so
# the prop's front faces glTF +Z (Blender -Y). height: rescale to this height (m) (None = keep the scan's
# real-world scale). tex: max texture size for LOD0 (optimize step).
PH_PROPS = [
    dict(name='bench_timber', ph='modular_street_seating', tex=512,
         keep=['legs_single', 'legs_double', 'crossbar', 'suspended_support_01', 'back_support_r', 'back_support_l',
               'arm_rest_01', 'arm_rest_02', 'seat', 'seat_back'],
         tags=['bench', 'seating', 'street-furniture', 'sidewalk', 'park']),
    dict(name='bin_metal', ph='metal_trash_can', keep=['metal_trash_can', 'metal_trash_can_handle_left', 'metal_trash_can_handle_right'],
         tags=['bin', 'rubbish', 'litter', 'street-furniture'], tex=512),
    dict(name='barrier_concrete', ph='concrete_road_barrier', tags=['barrier', 'concrete', 'jersey', 'roadworks', 'planter-base'], tex=1024),
    dict(name='ac_unit', ph='exterior_aircon_unit', keep=['exterior_aircon_unit'], tags=['rooftop', 'aircon', 'wall-mounted', 'clutter'], tex=512,
         drop_parts_below=0.25,  # the scan's drain pipe dangles to the floor; without it the brackets are the feet
         lod1src=False),  # thin sheet-metal casing: Blender dissolve+collapse destroys it, meshopt LOD1 is fine
    dict(name='crate_plastic_yellow', ph='plastic_crate_02', tags=['crate', 'plastic', 'vendor', 'clutter'], tex=512),
    dict(name='chair_monobloc', ph='plastic_monobloc_chair_01', tags=['chair', 'plastic', 'monobloc', 'vendor', 'seating'], tex=512),
    dict(name='plant_aloe_pot', ph='potted_plant_04', height=0.8, tags=['plant', 'aloe', 'pot', 'planter', 'succulent'], tex=512,
         note='Scaled from a 17 cm desk aloe to a 0.8 m street planter.'),
    dict(name='plant_leafy_pot', ph='potted_plant_02', tags=['plant', 'pot', 'terracotta', 'shopfront'], tex=512,
         decimate={'potted_plant_02_dirt': 0.01, 'potted_plant_02_leaves': 0.2, 'potted_plant_02_pot': 0.3}),
    dict(name='crate_plastic_red', ph='plastic_crate_03', tags=['crate', 'plastic', 'vendor', 'clutter', 'beverage'], tex=512,
         decimate={'plastic_crate_03': 0.25}),
    dict(name='trash_bag', ph='trashbag', tags=['rubbish', 'bag', 'litter', 'clutter'], tex=512),
    dict(name='electrical_box', ph='utility_box_02', tags=['utility', 'electrical', 'kiosk', 'street-furniture'], tex=512),
    dict(name='drum_plastic_blue', ph='Barrel_02', tags=['drum', 'barrel', 'plastic', 'vendor', 'water'], tex=512),
    dict(name='cardboard_box', ph='cardboard_box_01', tags=['box', 'cardboard', 'clutter', 'vendor'], tex=512),
    dict(name='fire_hydrant', ph='fire_hydrant', keep=['fire_hydrant', 'fire_hydrant_cap_01', 'fire_hydrant_cap_02', 'fire_hydrant_cap_03'],
         tags=['hydrant', 'optional', 'not-harare-typical'], tex=512,
         note='US-style pillar hydrant: Harare mostly uses underground hydrants marked by yellow plates; use sparingly.'),
    dict(name='tyre_old', ph='old_tyre', tags=['tyre', 'junk', 'clutter', 'vendor'], tex=512),
    dict(name='manhole_cover', ph='water_manhole_cover', tags=['manhole', 'decal-like', 'road', 'sidewalk'], tex=512),
]

# ------------------------------------------------------------------------------------------ palette
# index -> (name, sRGB hex, roughness, metalness). 8 x 8 swatches of 16 px in a 128 px texture.
PALETTE = [
    ('galvanised', '#a7abab', 0.45, 1.0), ('steel_grey', '#7d8285', 0.55, 0.35), ('dark_steel', '#2b2d2f', 0.6, 0.3),
    ('white_paint', '#dddcd5', 0.6, 0.0), ('red_paint', '#a82a22', 0.55, 0.0), ('concrete', '#a19d94', 0.92, 0.0),
    ('concrete_dark', '#77736b', 0.92, 0.0), ('lens', '#efece2', 0.2, 0.0), ('solar_cell', '#1b2740', 0.12, 0.2),
    ('aluminium', '#babdc0', 0.35, 1.0), ('jojo_green', '#3f7d5a', 0.5, 0.0), ('jojo_green_dark', '#2f5f45', 0.55, 0.0),
    ('cone_orange', '#e0561c', 0.5, 0.0), ('reflective_white', '#ecece8', 0.3, 0.0), ('rubber_black', '#1b1b1b', 0.85, 0.0),
    ('canvas_red', '#b8302a', 0.85, 0.0), ('canvas_white', '#e3e0d6', 0.85, 0.0), ('canvas_blue', '#2658a3', 0.85, 0.0),
    ('canvas_yellow', '#e6b52b', 0.85, 0.0), ('canvas_green', '#2e7a3a', 0.85, 0.0), ('timber', '#7a5a3c', 0.7, 0.0),
    ('soil', '#5a3e2c', 0.95, 0.0), ('dish_white', '#d9d9d4', 0.45, 0.1), ('roof_sheet', '#a3a8a8', 0.4, 0.9),
    ('green_paint', '#2d5a3a', 0.55, 0.0), ('yellow_paint', '#d9b12c', 0.55, 0.0), ('aloe', '#5b7d4c', 0.7, 0.0),
    ('ad_panel', '#d6d0bf', 0.35, 0.0), ('black_paint', '#1d1e1f', 0.5, 0.0), ('battery_box', '#8f9294', 0.5, 0.4),
    ('rust', '#6b3b24', 0.8, 0.2), ('glass_dark', '#1e2a33', 0.1, 0.0),
]
PAL = {p[0]: i for i, p in enumerate(PALETTE)}
PAL_N, PAL_PX = 8, 16


def hex_to_lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def palette_images():
    size = PAL_N * PAL_PX
    if 'palette' in bpy.data.images:
        return bpy.data.images['palette'], bpy.data.images['palette_orm']
    col = bpy.data.images.new('palette', size, size, alpha=False)
    orm = bpy.data.images.new('palette_orm', size, size, alpha=False)
    cpx = [0.0] * (size * size * 4)
    opx = [0.0] * (size * size * 4)
    for i in range(PAL_N * PAL_N):
        name, hx, r, m = PALETTE[i] if i < len(PALETTE) else ('unused', '#ff00ff', 1.0, 0.0)
        c = [int(hx[k:k + 2], 16) / 255 for k in (1, 3, 5)]  # image stores sRGB bytes
        sx, sy = i % PAL_N, i // PAL_N
        for y in range(PAL_PX):
            for x in range(PAL_PX):
                px = sx * PAL_PX + x
                py = size - 1 - (sy * PAL_PX + y)  # row 0 of the swatch grid at the top of the image
                k = (py * size + px) * 4
                cpx[k:k + 4] = [c[0], c[1], c[2], 1.0]
                opx[k:k + 4] = [1.0, r, m, 1.0]
    # colour space first: changing it later reloads the (empty) buffer
    col.colorspace_settings.name = 'sRGB'
    orm.colorspace_settings.name = 'Non-Color'
    for im, px, fn in ((col, cpx, 'palette.png'), (orm, opx, 'palette_orm.png')):
        im.pixels.foreach_set(px)
        im.update()
        im.filepath_raw = os.path.join(RAW, fn)
        im.file_format = 'PNG'
        im.save()
        im.pack()
    return col, orm


def swatch_uv(name):
    i = PAL[name]
    sx, sy = i % PAL_N, i // PAL_N
    return ((sx + 0.5) / PAL_N, 1 - (sy + 0.5) / PAL_N)


def palette_material(name='PropPalette', emissive=False):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    col, orm = palette_images()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True  # exported as doubleSided: false
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    t1 = nt.nodes.new('ShaderNodeTexImage')
    t1.image = col
    t1.interpolation = 'Closest'
    t2 = nt.nodes.new('ShaderNodeTexImage')
    t2.image = orm
    t2.interpolation = 'Closest'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(t1.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(t2.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    return mat


def lens_material():
    if 'LampLens' in bpy.data.materials:
        return bpy.data.materials['LampLens']
    mat = bpy.data.materials.new('LampLens')
    mat.use_nodes = True
    mat.use_backface_culling = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.85, 0.84, 0.8, 1)
    b.inputs['Roughness'].default_value = 0.25
    return mat


# ------------------------------------------------------------------------------------------ helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def select_only(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def apply_all(obj):
    select_only(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def normalize(obj, rot=0.0, height=None, scale=None):
    """Rotate about Z, optionally rescale, then feet on z=0 and footprint centred on x=y=0."""
    apply_all(obj)
    if rot:
        obj.rotation_euler = (0, 0, math.radians(rot))
        apply_all(obj)
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    zmin, zmax = min(v.z for v in bb), max(v.z for v in bb)
    s = scale or (height / (zmax - zmin) if height else 1.0)
    if s != 1.0:
        obj.scale = (s, s, s)
        apply_all(obj)
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    cx = (min(v.x for v in bb) + max(v.x for v in bb)) / 2
    cy = (min(v.y for v in bb) + max(v.y for v in bb)) / 2
    zmin = min(v.z for v in bb)
    obj.location = (-cx, -cy, -zmin)
    apply_all(obj)


def clean_normals(obj, angle=35):
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode='OBJECT')
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except RuntimeError:
        pass
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))


def metrics(obj):
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    h = max(v.z for v in vs)
    r = max(math.hypot(v.x, v.y) for v in vs)
    ext = [max(v.x for v in vs) - min(v.x for v in vs), max(v.y for v in vs) - min(v.y for v in vs)]
    low = [math.hypot(v.x, v.y) for v in vs if v.z < min(0.5 * h, 1.0)]
    return h, r, ext, (max(low) if low else r)


def export(obj, name, meta):
    select_only(obj)
    path = os.path.join(RAW, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_tangents=False, export_texcoords=True,
                              export_materials='EXPORT', export_image_format='AUTO', export_cameras=False,
                              export_extras=False, export_animations=False, export_vertex_color='NONE')
    h, r, ext, rb = metrics(obj)
    # Blender (x, y, z) -> glTF (x, z, -y): footprint extents are [x, z]
    meta.update(name=name, height=round(h, 3), footprintRadius=round(r, 3), baseRadius=round(rb, 3),
                extent=[round(ext[0], 3), round(ext[1], 3)],
                sourceTris=tris(obj))
    json.dump(meta, open(os.path.join(RAW, name + '.json'), 'w'), indent=1)
    print(f'exported {name:24s} tris {tris(obj):6d} h {h:.2f} r {r:.2f}')


# ------------------------------------------------------------------------------------------ Poly Haven
def build_ph(spec):
    reset()
    d = os.path.join(CACHE, 'phm', spec['ph'])
    gltf = [f for f in os.listdir(d) if f.endswith('.gltf')][0]
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, gltf))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    keep = spec.get('keep')
    kept = [o for o in meshes if (keep is None or o.name in keep)]
    for o in list(bpy.context.scene.objects):
        if o not in kept:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in kept:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        # optional per-part pre-decimation (Blender collapse also collapses open borders, which meshopt keeps)
        ratio = spec.get('decimate', {}).get(o.name)
        if ratio:
            select_only(o)
            mod = o.modifiers.new('dec', 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'
            mod.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=mod.name)
    obj = join(kept)
    obj.name = spec['name']
    normalize(obj, rot=spec.get('rot', 0.0), height=spec.get('height'))
    if spec.get('drop_parts_below'):
        # delete every loose part that reaches below this height (e.g. the AC unit's dangling drain pipe)
        select_only(obj)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.object.mode_set(mode='OBJECT')
        for v in obj.data.vertices:
            v.select = v.co.z < spec['drop_parts_below']
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_linked()
        bpy.ops.mesh.delete(type='VERT')
        bpy.ops.object.mode_set(mode='OBJECT')
        normalize(obj)
    clean_normals(obj, spec.get('smooth', 40))
    info = json.load(open(os.path.join(d, 'info.json')))['info']
    meta = dict(kind='polyhaven', tags=spec['tags'], tex=spec.get('tex', 512),
                source=dict(site='Poly Haven', id=spec['ph'], url=f"https://polyhaven.com/a/{spec['ph']}",
                            author=', '.join(info.get('authors', {}).keys()), license='CC0 1.0'),
                notes=spec.get('note', ''))
    export(obj, spec['name'], meta)
    stale = os.path.join(RAW, spec['name'] + '.lod1src.glb')
    if spec.get('lod1src', True):
        lod1_source(obj, spec['name'], spec.get('lod1_angle', 8.0))
    elif os.path.exists(stale):
        os.remove(stale)  # LOD1 falls back to meshopt simplification of the LOD0 source


def lod1_source(obj, name, angle=8.0, target=590):
    """Blender-side LOD1 source: planar dissolve with UV / material delimits (keeps UVs exact on hard-surface
    parts, where meshopt would have to collapse across seams), then a collapse pass if still over budget.
    optimize_props.cjs uses <name>.lod1src.glb for LOD1 when it exists."""
    select_only(obj)
    bpy.ops.object.duplicate()
    lo = bpy.context.active_object
    mod = lo.modifiers.new('dis', 'DECIMATE')
    mod.decimate_type = 'DISSOLVE'
    mod.angle_limit = math.radians(angle)
    mod.delimit = {'UV', 'MATERIAL'}
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = lo.modifiers.new('tri', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for _ in range(6):
        t = tris(lo)
        if t <= target:
            break
        mod = lo.modifiers.new('col', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = max(0.02, target / t * 0.97)
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    select_only(lo)
    bpy.ops.export_scene.gltf(filepath=os.path.join(RAW, name + '.lod1src.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_normals=True, export_tangents=False,
                              export_texcoords=True, export_materials='EXPORT', export_image_format='AUTO',
                              export_cameras=False, export_extras=False, export_animations=False,
                              export_vertex_color='NONE')
    print(f'lod1 source {name:24s} tris {tris(lo)}')
    bpy.data.objects.remove(lo, do_unlink=True)


# ------------------------------------------------------------------------------------------ procedural kit
class Kit:
    """Accumulates primitive parts (each with a palette swatch) into one mesh object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.pal_mat = palette_material()
        self.mats = [self.pal_mat]

    def _finish(self, geom_faces, swatch, mat_index=0):
        u, v = swatch_uv(swatch)
        for f in geom_faces:
            f.material_index = mat_index
            for l in f.loops:
                l[self.uv].uv = (u, v)

    def add(self, fn, swatch, matrix=Matrix(), mat_index=0, **kw):
        before = set(self.bm.faces)
        ret = fn(self.bm, **kw)
        verts = ret['verts'] if isinstance(ret, dict) and 'verts' in ret else []
        bmesh.ops.transform(self.bm, matrix=matrix, verts=verts)
        new = [f for f in self.bm.faces if f not in before]
        self._finish(new, swatch, mat_index)
        return new

    def box(self, swatch, size, loc=(0, 0, 0), rot=None, mat_index=0):
        m = Matrix.Translation(loc)
        if rot is not None:
            m = m @ rot
        m = m @ Matrix.Diagonal((*size, 1.0))
        return self.add(bmesh.ops.create_cube, swatch, m, mat_index, size=1.0)

    def cyl(self, swatch, r1, r2, h, loc=(0, 0, 0), seg=12, rot=None, caps=True, mat_index=0):
        """Cylinder / cone along +Z from loc (base) to loc + h."""
        m = Matrix.Translation(loc)
        if rot is not None:
            m = m @ rot
        m = m @ Matrix.Translation((0, 0, h / 2))
        return self.add(bmesh.ops.create_cone, swatch, m, mat_index, cap_ends=caps, cap_tris=False, segments=seg,
                        radius1=r1, radius2=r2, depth=h)

    def sphere(self, swatch, r, loc=(0, 0, 0), seg=10, rings=6, scale=(1, 1, 1)):
        m = Matrix.Translation(loc) @ Matrix.Diagonal((*scale, 1.0))
        return self.add(bmesh.ops.create_uvsphere, swatch, m, 0, u_segments=seg, v_segments=rings, radius=r)

    def raw(self, swatch, verts, faces, mat_index=0):
        vs = [self.bm.verts.new(v) for v in verts]
        new = []
        for f in faces:
            try:
                new.append(self.bm.faces.new([vs[i] for i in f]))
            except ValueError:
                pass
        self._finish(new, swatch, mat_index)
        return new

    def lens_slot(self):
        if len(self.mats) == 1:
            self.mats.append(lens_material())
        return 1

    def build(self, smooth=35):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        select_only(obj)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
        return obj


def rot_x(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'X')


def rot_y(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Y')


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Z')


def proc_meta(tags, anchors=None, notes=''):
    return dict(kind='procedural', tags=tags, tex=128, anchors=anchors or [],
                source=dict(site='procedural', id='props_blender.py', url='https://github.com/thisisisheanesu/spiderman-harare',
                            author='Spider-Man: Harare contributors (modelled in tools/materials/props_blender.py)',
                            license='CC0 1.0'), notes=notes)


def to_gltf(p):
    """Blender (x, y, z) -> glTF (x, z, -y) for anchor metadata."""
    return [round(p[0], 3), round(p[2], 3), round(-p[1], 3)]


# --- street lamps ---------------------------------------------------------------------------------------------
def lamp_head(k, x, z, dirx):
    """Flat LED luminaire at the end of an arm (arm tip at x, z), extending along dirx."""
    L = 0.62
    cx = x + dirx * L / 2
    k.box('steel_grey', (L, 0.26, 0.09), (cx, 0, z + 0.02))
    k.box('steel_grey', (L * 0.9, 0.22, 0.02), (cx, 0, z - 0.035), mat_index=k.lens_slot())


def street_lamp(name, height=10.0, arms=2, solar=False, panel='-z'):
    """panel: which local axis the solar panel tilts toward. '-z' faces north at rotation.y = 0 (for N-S medians,
    arms across the road along X); '+x' faces north at rotation.y = +pi/2 (for E-W medians, arms along Z)."""
    reset()
    k = Kit(name)
    k.cyl('concrete', 0.28, 0.24, 0.45, seg=12)  # plinth
    k.cyl('galvanised', 0.16, 0.16, 0.08, (0, 0, 0.45), seg=12)  # base flange
    k.cyl('galvanised', 0.105, 0.055, height - 0.5, (0, 0, 0.5), seg=10)  # tapered pole
    k.box('galvanised', (0.14, 0.02, 0.35), (0, -0.1, 1.3))  # door/inspection hatch
    top = height
    anchors = [(0, 0, top)]
    dirs = [1, -1] if arms == 2 else [0]
    for dx in dirs:
        # arm: rises ~12 degrees; single arm reaches toward -Y (glTF +Z, the lamp's front / road side)
        L = 1.9
        ang = math.radians(12)
        if dx == 0:
            m = Matrix.Translation((0, 0, top - 0.25)) @ rot_x(90 - 12)
            k.add(bmesh.ops.create_cone, 'galvanised', m @ Matrix.Translation((0, 0, L / 2)), 0, cap_ends=True,
                  cap_tris=False, segments=8, radius1=0.045, radius2=0.035, depth=L)
            tip = (0, -L * math.cos(ang), top - 0.25 + L * math.sin(ang))
            k.box('steel_grey', (0.26, 0.62, 0.09), (0, tip[1] - 0.31, tip[2] + 0.02))
            k.box('steel_grey', (0.22, 0.56, 0.02), (0, tip[1] - 0.31, tip[2] - 0.035), mat_index=k.lens_slot())
            anchors.append(tuple(tip))
        else:
            m = Matrix.Translation((0, 0, top - 0.25)) @ rot_y(dx * (90 - 12))
            k.add(bmesh.ops.create_cone, 'galvanised', m @ Matrix.Translation((0, 0, L / 2)), 0, cap_ends=True,
                  cap_tris=False, segments=8, radius1=0.045, radius2=0.035, depth=L)
            tip = (dx * L * math.cos(ang), 0, top - 0.25 + L * math.sin(ang))
            lamp_head(k, tip[0], tip[2], dx)
            anchors.append(tuple(tip))
    k.cyl('galvanised', 0.06, 0.03, 0.12, (0, 0, top), seg=8)  # pole cap
    if solar:
        # panel tilted ~20 degrees to face north (Blender +Y = glTF -Z = game north when unrotated)
        k.box('battery_box', (0.36, 0.22, 0.5), (0, 0, top - 1.2))
        k.cyl('galvanised', 0.035, 0.035, 0.5, (0, 0, top + 0.1), seg=8)
        if panel == '+x':  # long side along Blender Y (glTF Z), tilted toward +X
            pm = Matrix.Translation((0, 0.0, top + 0.7)) @ rot_y(20) @ rot_z(90)
        else:  # long side along X, tilted toward Blender +Y = glTF -Z
            pm = Matrix.Translation((0, 0.0, top + 0.7)) @ rot_x(-20)
        k.box('aluminium', (1.2, 0.82, 0.05), rot=pm, loc=(0, 0, 0))
        k.box('solar_cell', (1.14, 0.76, 0.02), rot=pm @ Matrix.Translation((0, 0, 0.022)), loc=(0, 0, 0))
        anchors[0] = (0, 0, top + 0.9)
    obj = k.build()
    notes = ('Harare avenue lighting: tall grey galvanised pole on a concrete plinth. Lens faces use material '
             '"LampLens" (set its emissive at night). anchors = pole top and arm tips (web-swing points).')
    if arms == 2:
        notes += ' Double arms reach along +-X: stand in the median with X across the road.'
    else:
        notes += ' The arm reaches toward +Z (front): face +Z toward the carriageway.'
    if solar and panel == '+x':
        notes += (' Solar panel tilts toward +X: rotation.y = +pi/2 makes it face north (Harare is in the southern '
                  'hemisphere) with the arms across an east-west road (along world Z).')
    elif solar:
        notes += (' Solar panel tilts toward -Z: rotation.y = 0 makes it face north with the arms across a '
                  'north-south road (along world X). For east-west roads use street_lamp_double_solar_ew.')
    export(obj, name, proc_meta(['street-light', 'lamp', 'pole', 'web-anchor'] + (['solar'] if solar else []),
                                [to_gltf(a) for a in anchors], notes))


# --- bollards -------------------------------------------------------------------------------------------------
def bollard(name, painted):
    reset()
    k = Kit(name)
    H = 0.8
    if painted:
        bands = [(0.0, 0.2, 'white_paint'), (0.2, 0.4, 'red_paint'), (0.4, 0.6, 'white_paint'), (0.6, 0.8, 'red_paint')]
    else:
        bands = [(0.0, 0.8, 'concrete')]
    r = lambda z: 0.15 - 0.05 * z / H  # noqa: E731
    for z0, z1, sw in bands:
        k.cyl(sw, r(z0), r(z1), z1 - z0, (0, 0, z0), seg=14, caps=False)
    k.sphere(bands[-1][2], r(H), (0, 0, H), seg=14, rings=6, scale=(1, 1, 0.45))
    obj = k.build(40)
    export(obj, name, proc_meta(['bollard', 'concrete', 'street-furniture'] + (['painted'] if painted else []), [],
                                'Conical precast bollard (0.8 m).' + (' Painted red/white bands.' if painted else '')))


# --- bus shelter ----------------------------------------------------------------------------------------------
def bus_shelter(name='bus_shelter'):
    reset()
    k = Kit(name)
    Wd, D = 4.0, 1.7
    hf, hb = 2.75, 2.5  # roof height front / back (front = -Y = glTF +Z = kerb side)
    for x in (-Wd / 2 + 0.1, Wd / 2 - 0.1):
        for y, h in ((-D / 2 + 0.15, hf), (D / 2 - 0.1, hb)):
            k.box('green_paint', (0.08, 0.08, h), (x, y, h / 2))
    for x in (-Wd / 2 + 0.1, 0, Wd / 2 - 0.1):
        k.box('green_paint', (0.07, D - 0.1, 0.1), (x, 0, (hf + hb) / 2 - 0.08), rot=rot_x(-math.degrees(math.atan2(hf - hb, D - 0.25))))
    # corrugated roof sheet (sine profile along X), sloping down to the back
    n = 64
    verts, faces = [], []
    for i in range(n + 1):
        x = -Wd / 2 - 0.15 + (Wd + 0.3) * i / n
        zoff = 0.025 * math.sin(i * math.pi / 2)
        verts.append((x, -D / 2 - 0.25, hf + 0.03 + zoff))
        verts.append((x, D / 2 + 0.1, hb + 0.03 + zoff))
    for i in range(n):
        a = 2 * i
        faces.append((a, a + 2, a + 3, a + 1))
    k.raw('roof_sheet', verts, faces)
    k.raw('roof_sheet', [(v[0], v[1], v[2] - 0.008) for v in verts], [tuple(reversed(f)) for f in faces])  # underside
    k.box('green_paint', (Wd + 0.3, 0.04, 0.18), (0, -D / 2 - 0.25, hf - 0.02))  # fascia
    # back panel: lower solid, upper advert panel
    k.box('steel_grey', (Wd - 0.2, 0.04, 1.0), (0, D / 2 - 0.1, 0.6))
    k.box('ad_panel', (1.6, 0.06, 1.1), (0.9, D / 2 - 0.1, 1.75))
    k.box('dark_steel', (1.7, 0.08, 1.2), (0.9, D / 2 - 0.08, 1.75))
    # side screens
    for x in (-Wd / 2 + 0.1, Wd / 2 - 0.1):
        k.box('glass_dark', (0.02, D - 0.4, 1.3), (x, 0.1, 1.3))
    # bench
    k.box('timber', (Wd - 0.6, 0.38, 0.05), (0, D / 2 - 0.4, 0.47))
    for x in (-1.4, 0, 1.4):
        k.box('dark_steel', (0.06, 0.3, 0.45), (x, D / 2 - 0.4, 0.225))
    # concrete slab
    k.box('concrete', (Wd + 0.4, D + 0.5, 0.12), (0, -0.05, 0.06))
    obj = k.build(20)
    export(obj, name, proc_meta(['bus-shelter', 'kombi-stop', 'rank', 'street-furniture'],
                                [to_gltf((0, -D / 2 - 0.2, hf))],
                                'Steel-post shelter with corrugated roof, bench, advert panel (4.0 x 1.7 m). Open side '
                                '(front) faces +Z: put +Z toward the kerb. The advert panel face is swatch "ad_panel" '
                                '(re-texture for posters).'))


# --- satellite dish -------------------------------------------------------------------------------------------
def satellite_dish(name='satellite_dish'):
    reset()
    k = Kit(name)
    k.box('dark_steel', (0.5, 0.5, 0.04), (0, 0, 0.02))  # roof base plate / ballast frame
    k.cyl('steel_grey', 0.03, 0.03, 1.0, (0, 0, 0.04), seg=8)
    # parabolic dish, diameter 0.9 m, facing up-north (elevation ~55 degrees toward -glTF Z = Blender +Y)
    R, depth, seg, rings = 0.45, 0.09, 20, 5
    verts, faces = [(0, 0, 0)], []
    for j in range(1, rings + 1):
        rr = R * j / rings
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append((rr * math.cos(a), rr * math.sin(a), depth * (rr / R) ** 2))
    for i in range(seg):
        faces.append((0, 1 + i, 1 + (i + 1) % seg))
    for j in range(rings - 1):
        for i in range(seg):
            a = 1 + j * seg + i
            b = 1 + j * seg + (i + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    m = Matrix.Translation((0, -0.05, 1.12)) @ rot_x(-(90 - 55))
    fs = k.raw('dish_white', [tuple(m @ Vector(v)) for v in verts], faces)
    # make it double-sided: duplicate with reversed normals slightly behind
    back = [tuple(m @ Vector((v[0], v[1], v[2] - 0.006))) for v in verts]
    k.raw('dish_white', back, [tuple(reversed(f)) for f in faces])
    # LNB arm and LNB
    focus = m @ Vector((0, 0, R * R / (4 * depth)))
    base = m @ Vector((0, -R * 0.9, depth * 0.8))
    dvec = focus - base
    arm_rot = dvec.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    k.cyl('steel_grey', 0.012, 0.012, dvec.length, tuple(base), seg=6, rot=arm_rot)
    k.box('dark_steel', (0.06, 0.06, 0.12), tuple(focus))
    obj = k.build(40)
    export(obj, name, proc_meta(['rooftop', 'satellite', 'dish', 'clutter'], [],
                                '0.9 m DStv-style dish on a ballast frame, elevation ~55 deg, pointing toward -Z (north).'))


# --- JoJo water tank ------------------------------------------------------------------------------------------
def water_tank(name, stand):
    reset()
    k = Kit(name)
    z0 = 0.0
    if stand:
        Hs, S = 2.0, 1.5  # stand height, top frame size
        for x in (-S / 2 + 0.03, S / 2 - 0.03):
            for y in (-S / 2 + 0.03, S / 2 - 0.03):
                k.box('rust', (0.06, 0.06, Hs), (x * 1.05, y * 1.05, Hs / 2))
        for zz in (0.7, 1.4):
            for x in (-S / 2, S / 2):
                k.box('rust', (0.04, S, 0.04), (x, 0, zz))
            for y in (-S / 2, S / 2):
                k.box('rust', (S, 0.04, 0.04), (0, y, zz))
        k.box('rust', (S + 0.1, S + 0.1, 0.06), (0, 0, Hs + 0.03))
        z0 = Hs + 0.06
    R, H = 0.7, 1.75
    k.cyl('jojo_green', R, R, H, (0, 0, z0), seg=24, caps=True)
    for i in range(1, 7):  # horizontal ribs
        k.cyl('jojo_green_dark', R + 0.025, R + 0.025, 0.06, (0, 0, z0 + i * H / 7 - 0.03), seg=24, caps=False)
    k.sphere('jojo_green', R, (0, 0, z0 + H), seg=24, rings=8, scale=(1, 1, 0.28))
    k.cyl('jojo_green_dark', 0.2, 0.2, 0.25, (0, 0, z0 + H + 0.1), seg=16)  # lid
    k.cyl('black_paint', 0.035, 0.035, 0.25, (R - 0.02, 0, z0 + 0.12), seg=6, rot=rot_y(90))  # outlet
    obj = k.build(40)
    export(obj, name, proc_meta(['rooftop', 'water-tank', 'jojo', 'plastic', 'green'], [],
                                'JoJo-style ribbed green plastic tank (~2500 L)' + (' on a 2 m steel stand.' if stand else '.')))


# --- vendor umbrella ------------------------------------------------------------------------------------------
def umbrella(name, c1, c2):
    reset()
    k = Kit(name)
    k.cyl('concrete_dark', 0.25, 0.22, 0.12, seg=12)  # weighted base
    H, R, drop, seg = 2.35, 1.25, 0.45, 8
    k.cyl('white_paint', 0.022, 0.022, H + 0.1, (0, 0, 0.1), seg=8)
    apex = (0, 0, H + 0.15)
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        p0 = (R * math.cos(a0), R * math.sin(a0), H + 0.15 - drop)
        p1 = (R * math.cos(a1), R * math.sin(a1), H + 0.15 - drop)
        mid = ((p0[0] + p1[0]) / 2 * 0.97, (p0[1] + p1[1]) / 2 * 0.97, H + 0.15 - drop + 0.03)
        sw = c1 if i % 2 == 0 else c2
        k.raw(sw, [apex, p0, mid, p1], [(0, 1, 2), (0, 2, 3)])
        k.raw(sw, [apex, p0, mid, p1], [(0, 2, 1), (0, 3, 2)])  # underside
        # valance flap
        k.raw(sw, [p0, p1, (p1[0], p1[1], p1[2] - 0.12), (p0[0], p0[1], p0[2] - 0.12)], [(0, 1, 2, 3), (3, 2, 1, 0)])
    k.sphere('white_paint', 0.04, apex, seg=8, rings=4)
    obj = k.build(15)
    export(obj, name, proc_meta(['vendor', 'umbrella', 'market', 'shade'], [to_gltf(apex)],
                                'Street-vendor umbrella, 2.5 m canopy on a weighted base.'))


# --- traffic cone ---------------------------------------------------------------------------------------------
def traffic_cone(name='traffic_cone'):
    reset()
    k = Kit(name)
    k.box('rubber_black', (0.38, 0.38, 0.035), (0, 0, 0.0175))
    H = 0.7
    r = lambda z: 0.15 - 0.12 * z / H  # noqa: E731
    bands = [(0.035, 0.30, 'cone_orange'), (0.30, 0.40, 'reflective_white'), (0.40, 0.50, 'cone_orange'),
             (0.50, 0.57, 'reflective_white'), (0.57, H, 'cone_orange')]
    for z0, z1, sw in bands:
        k.cyl(sw, r(z0), r(z1), z1 - z0, (0, 0, z0), seg=16, caps=(z1 == H))
    obj = k.build(40)
    export(obj, name, proc_meta(['traffic-cone', 'roadworks', 'clutter'], [], '0.7 m PVC traffic cone.'))


# --- concrete planter -----------------------------------------------------------------------------------------
def planter(name='planter_concrete'):
    reset()
    k = Kit(name)
    S, H, t = 1.2, 0.6, 0.1
    k.box('concrete', (S, t, H), (0, -S / 2 + t / 2, H / 2))
    k.box('concrete', (S, t, H), (0, S / 2 - t / 2, H / 2))
    k.box('concrete', (t, S - 2 * t, H), (-S / 2 + t / 2, 0, H / 2))
    k.box('concrete', (t, S - 2 * t, H), (S / 2 - t / 2, 0, H / 2))
    k.box('soil', (S - 2 * t, S - 2 * t, 0.05), (0, 0, H - 0.1))
    k.box('concrete_dark', (S - 0.1, S - 0.1, 0.06), (0, 0, 0.03))
    obj = k.build(20)
    export(obj, name, proc_meta(['planter', 'concrete', 'street-furniture', 'plaza'], [],
                                '1.2 m square precast planter with soil at 0.5 m (plant vegetation into it).'))


PROC = {
    'street_lamp_double': lambda: street_lamp('street_lamp_double', 10.0, 2, False),
    'street_lamp_double_solar': lambda: street_lamp('street_lamp_double_solar', 10.0, 2, True),
    'street_lamp_double_solar_ew': lambda: street_lamp('street_lamp_double_solar_ew', 10.0, 2, True, panel='+x'),
    'street_lamp_single': lambda: street_lamp('street_lamp_single', 8.0, 1, False),
    'bollard_concrete': lambda: bollard('bollard_concrete', False),
    'bollard_painted': lambda: bollard('bollard_painted', True),
    'bus_shelter': bus_shelter,
    'satellite_dish': satellite_dish,
    'water_tank': lambda: water_tank('water_tank', False),
    'water_tank_stand': lambda: water_tank('water_tank_stand', True),
    'umbrella_red_white': lambda: umbrella('umbrella_red_white', 'canvas_red', 'canvas_white'),
    'umbrella_blue_yellow': lambda: umbrella('umbrella_blue_yellow', 'canvas_blue', 'canvas_yellow'),
    'umbrella_green_white': lambda: umbrella('umbrella_green_white', 'canvas_green', 'canvas_white'),
    'traffic_cone': traffic_cone,
    'planter_concrete': planter,
}


def main(names):
    ph = {p['name']: p for p in PH_PROPS}
    todo = names or (list(ph) + list(PROC))
    for n in todo:
        if n in ph:
            build_ph(ph[n])
        elif n in PROC:
            PROC[n]()
        else:
            print('unknown prop', n)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main([a for a in argv if not a.endswith('.py')])
