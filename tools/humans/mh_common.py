# Shared helpers for the humans lane: MPFB (MakeHuman for Blender) setup, human construction,
# finalising (bake targets, apply masks, turn to face +Y so glTF export faces -Z), glTF export.
#
# Run inside the Blender-as-a-module python (bpy 5.0) with MPFB 2.0.x installed as the extension
# 'bl_ext.user_default.mpfb' and the MakeHuman CC0 system assets unpacked into its user data dir
# (see tools/humans/README_tools.md).
import bpy, addon_utils, os, sys, math, json
import mathutils
from mathutils import Matrix, Vector, Quaternion

MPFB = 'bl_ext.user_default.mpfb'
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
SCRATCH = os.environ.get('HUMANS_SCRATCH', '/tmp/humans_scratch')

HS = TS = None


def enable_mpfb():
    global HS, TS
    if HS is not None:
        return
    bpy.context.preferences.use_preferences_save = False
    addon_utils.enable(MPFB, default_set=True)
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    HS, TS = HumanService, TargetService


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images,
                 bpy.data.actions, bpy.data.node_groups, bpy.data.textures):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


def build_human(spec):
    """spec keys: name, phenotype{gender,age,muscle,weight,height,proportions,cupsize,firmness},
    race{african,asian,caucasian}, eyes, eyebrows, eyelashes, hair, clothes[list], skin, targets[list of (name,val)],
    rig (default game_engine). Returns (armature, basemesh)."""
    enable_mpfb()
    info = HS._create_default_human_info_dict()
    ph = info['phenotype']
    for k, v in spec.get('phenotype', {}).items():
        ph[k] = v
    ph['race'] = dict(spec.get('race', {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}))
    info['rig'] = spec.get('rig', 'game_engine')
    for k in ('eyes', 'eyebrows', 'eyelashes', 'hair', 'teeth', 'tongue'):
        info[k] = spec.get(k, '') or ''
    info['clothes'] = list(spec.get('clothes', []))
    info['skin_mhmat'] = spec.get('skin', '') or ''
    info['skin_material_type'] = 'GAMEENGINE' if info['skin_mhmat'] else 'NONE'
    info['clothes_material_type'] = 'GAMEENGINE'
    info['eyes_material_type'] = 'GAMEENGINE'
    info['targets'] = [{'target': t, 'value': v} for t, v in spec.get('targets', [])]
    info['name'] = spec['name']
    s = HS.get_default_deserialization_settings()
    s['subdiv_levels'] = 0
    s['detailed_helpers'] = True
    s['extra_vertex_groups'] = True
    s['mask_helpers'] = True
    bm = HS.deserialize_from_dict(info, s)
    arm = bm.parent if bm.parent and bm.parent.type == 'ARMATURE' else None
    return arm, bm


def _apply_modifier(o, name):
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.modifier_apply(modifier=name)


def bake_shape_keys(o):
    if o.data.shape_keys is None:
        return
    o.shape_key_add(name='__mix', from_mix=True)
    kb = o.data.shape_keys.key_blocks
    co = [0.0] * (len(o.data.vertices) * 3)
    kb['__mix'].data.foreach_get('co', co)
    for k in list(kb):
        o.shape_key_remove(k)
    o.data.vertices.foreach_set('co', co)
    o.data.update()


def finalize(arm, delete_helpers=True, face_plus_y=True):
    """Bake targets/shape keys, apply all MASK modifiers (helpers + clothes delete groups), drop
    subdivision, and rotate everything 180 deg about Z so the character faces +Y (glTF -Z)."""
    meshes = [c for c in arm.children if c.type == 'MESH']
    for o in meshes:
        bake_shape_keys(o)
        # armature modifier last so masks apply on rest data
        for m in list(o.modifiers):
            if m.type == 'SUBSURF':
                o.modifiers.remove(m)
        arm_mods = [m for m in o.modifiers if m.type == 'ARMATURE']
        for m in list(o.modifiers):
            if m.type == 'MASK':
                if not delete_helpers and m.name == 'Hide helpers':
                    continue
                with bpy.context.temp_override(object=o, active_object=o):
                    bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
                _apply_modifier(o, m.name)
    if face_plus_y:
        R = Matrix.Rotation(math.pi, 4, 'Z')
        for o in meshes:
            o.data.transform(R)
            o.data.update()
        bpy.context.view_layer.objects.active = arm
        for o in bpy.context.selected_objects:
            o.select_set(False)
        arm.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        for eb in arm.data.edit_bones:
            eb.transform(R, scale=False, roll=True)
        bpy.ops.object.mode_set(mode='OBJECT')
    return meshes


def mesh_tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def remove_unused_vertex_groups(o, arm):
    bones = set(b.name for b in arm.data.bones)
    for vg in list(o.vertex_groups):
        if vg.name not in bones:
            o.vertex_groups.remove(vg)


def export_glb(path, objects, animations=False, extras=True, **kw):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    args = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                export_apply=False, export_texcoords=True, export_normals=True,
                export_tangents=False, export_materials='EXPORT', export_skins=True,
                export_all_influences=False, export_morph=False, export_animations=animations,
                export_extras=extras, export_def_bones=False, export_leaf_bone=False,
                export_image_format='AUTO', export_cameras=False, export_lights=False)
    args.update(kw)
    bpy.ops.export_scene.gltf(**args)


def rest_rotations(arm):
    """bone name -> 3x3 rest rotation (armature space) as nested lists"""
    return {b.name: [list(r) for r in b.matrix_local.to_3x3()] for b in arm.data.bones}


def normalize_rest(arm, ref):
    """Give every bone the reference skeleton's rest orientation (keeping this character's joint
    positions and bone lengths). With identical rest orientations, the shared animation clips
    (absolute local rotations) produce the same rotation deltas on every character, so poses
    look the same regardless of body proportions."""
    bpy.context.view_layer.objects.active = arm
    for o in bpy.context.selected_objects:
        o.select_set(False)
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = arm.data.edit_bones
    for eb in ebs:
        eb.use_connect = False
    for eb in ebs:
        if eb.name not in ref:
            continue
        L = eb.length
        M = Matrix(ref[eb.name]).to_4x4()
        M.translation = eb.head.copy()
        eb.matrix = M
        eb.length = L
    bpy.ops.object.mode_set(mode='OBJECT')
