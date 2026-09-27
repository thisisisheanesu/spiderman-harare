"""Shared Blender helpers for the dressing lane (run inside Blender's Python / the bpy module).

Rendering helpers bake *albedo* (emission shading, Standard view transform) so the images can be used as
base-colour textures, plus camera-space normals for impostors. Everything renders with Cycles on the CPU at
small sizes and few samples (shared build machines)."""
import math
import os

import bpy  # noqa: I001  (bpy must come first: it provides bmesh)
import bmesh
import mathutils
import numpy as np


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    # bake parent transforms into the meshes
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = [o for o in objs if o.type == 'MESH'][0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    meshes = [o for o in objs if o.type == 'MESH']
    for o in objs:
        o.select_set(o.type == 'MESH')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in objs:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def mat_name(o):
    return o.data.materials[0].name if o.data.materials else ''


def base_image(mat):
    """(image, alpha_linked) of the image feeding Base Color of a glTF-imported material."""
    if not mat or not mat.node_tree:
        return None, False
    img = None
    alpha = False
    mixed = None
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            for l in n.outputs['Color'].links:
                if l.to_socket.name == 'Base Color':
                    img = n.image
                elif l.to_node.type in ('MIX', 'MIX_RGB'):
                    mixed = mixed or n.image          # e.g. base colour x vertex colour
            for l in n.outputs['Alpha'].links:
                alpha = True
    img = img or mixed
    if img is None:
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                img = n.image
                break
    return img, alpha


def bbox(objs):
    mn = np.full(3, 1e9)
    mx = np.full(3, -1e9)
    for o in objs:
        co = np.empty(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        if len(co):
            mn = np.minimum(mn, co.min(0))
            mx = np.maximum(mx, co.max(0))
    return mn, mx


def transform_all(objs, mat4):
    for o in objs:
        o.data.transform(mat4)
        o.data.update()


def tri_data(o):
    """Per loop-triangle centroid (N,3), area (N,) for a mesh object (object space == world, transforms applied)."""
    me = o.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    vi = np.empty(n * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('vertices', vi)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    t = co[vi.reshape(-1, 3)]
    cen = t.mean(1)
    area = 0.5 * np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
    return cen, area


def islands(o):
    """Face islands of a mesh: list of arrays of polygon indices (connected through shared vertices)."""
    me = o.data
    nv = len(me.vertices)
    parent = np.arange(nv)

    def find(a):
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    ev = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', ev)
    for a, b in ev.reshape(-1, 2):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in range(nv)])
    loop_start = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_start', loop_start)
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', lv)
    froot = roots[lv[loop_start]]
    order = np.argsort(froot, kind='stable')
    fr = froot[order]
    cuts = np.flatnonzero(np.diff(fr)) + 1
    return np.split(order, cuts)


def delete_faces(o, face_idx):
    """Delete the given polygon indices from a mesh object (and loose verts)."""
    if len(face_idx) == 0:
        return
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    geom = [bm.faces[i] for i in face_idx]
    bmesh.ops.delete(bm, geom=geom, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()


def join(objs, name):
    objs = [o for o in objs if o and len(o.data.polygons)]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def duplicate(o, name):
    c = o.copy()
    c.data = o.data.copy()
    c.name = name
    bpy.context.scene.collection.objects.link(c)
    return c


def decimate(o, target_tris):
    me = o.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    if n <= target_tris:
        return n
    ratio = target_tris / n
    for _ in range(6):
        m = o.modifiers.new('dec', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = ratio
        m.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get()
        ev = o.evaluated_get(dg)
        new = bpy.data.meshes.new_from_object(ev)
        o.modifiers.remove(m)
        new.calc_loop_triangles()
        got = len(new.loop_triangles)
        if got <= target_tris * 1.02 or ratio < 0.002:
            old = o.data
            o.data = new
            bpy.data.meshes.remove(old)
            return got
        bpy.data.meshes.remove(new)
        ratio *= target_tris / got * 0.97
    return n


def tri_count(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


# ----------------------------------------------------------------------------------------------- rendering

def setup_render(res_x, res_y, samples=16, threads=2):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.max_bounces = 0
    sc.cycles.transparent_max_bounces = 96
    sc.cycles.filter_width = 1.0
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = threads
    sc.render.use_persistent_data = True
    sc.render.resolution_x = res_x
    sc.render.resolution_y = res_y
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0
    sc.view_settings.gamma = 1
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[1].default_value = 0.0
    cam = bpy.data.objects.get('bake_cam')
    if cam is None:
        cam = bpy.data.objects.new('bake_cam', bpy.data.cameras.new('bake_cam'))
        sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    sc.camera = cam
    return cam


def aim_camera(cam, target, direction, up=(0, 0, 1), dist=60.0, ortho=1.0, depth=None, shift=(0, 0)):
    """Orthographic camera at target + direction*dist looking at target. depth: slab thickness around target
    (clip planes), None for everything."""
    d = mathutils.Vector(direction).normalized()
    t = mathutils.Vector(target)
    cam.location = t + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    # roll so that 'up' projects to image up
    q = (-d).to_track_quat('-Z', 'Y')
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = q
    cam.data.ortho_scale = ortho
    cam.data.shift_x, cam.data.shift_y = shift
    if depth is None:
        cam.data.clip_start = 0.01
        cam.data.clip_end = dist * 4
    else:
        cam.data.clip_start = dist - depth / 2
        cam.data.clip_end = dist + depth / 2


def _new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return m, nt


def albedo_material(name, image, alpha, hsv=(0, 1, 1), depth_dark=None, hard_alpha=False, tint=None, edge_cull=None):
    """Emission shader showing the image colour (optionally HSV-graded / tinted) with image alpha.
    depth_dark = (near, far, strength): darken with camera depth inside a slab (cheap self-shadowing)."""
    m, nt = _new_mat(name)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    col_socket = None
    if image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.interpolation = 'Linear'
        col_socket = tex.outputs['Color']
        if hsv != (0, 1, 1):
            h = nt.nodes.new('ShaderNodeHueSaturation')
            h.inputs['Hue'].default_value = 0.5 + hsv[0]
            h.inputs['Saturation'].default_value = hsv[1]
            h.inputs['Value'].default_value = hsv[2]
            nt.links.new(col_socket, h.inputs['Color'])
            col_socket = h.outputs['Color']
    else:
        rgb = nt.nodes.new('ShaderNodeRGB')
        rgb.outputs[0].default_value = tint or (0.5, 0.5, 0.5, 1)
        col_socket = rgb.outputs[0]
    if tint is not None and image is not None:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(col_socket, mix.inputs[6])
        mix.inputs[7].default_value = tint
        col_socket = mix.outputs[2]
    if depth_dark is not None:
        near, far, k = depth_dark
        camd = nt.nodes.new('ShaderNodeCameraData')
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = near
        mr.inputs['From Max'].default_value = far
        mr.inputs['To Min'].default_value = 1.0
        mr.inputs['To Max'].default_value = 1.0 - k
        mr.clamp = True
        nt.links.new(camd.outputs['View Z Depth'], mr.inputs['Value'])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        nt.links.new(col_socket, mul.inputs[6])
        c2 = nt.nodes.new('ShaderNodeCombineColor')
        nt.links.new(mr.outputs[0], c2.inputs[0])
        nt.links.new(mr.outputs[0], c2.inputs[1])
        nt.links.new(mr.outputs[0], c2.inputs[2])
        nt.links.new(c2.outputs[0], mul.inputs[7])
        col_socket = mul.outputs[2]
    nt.links.new(col_socket, em.inputs['Color'])
    if alpha and image is not None:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mixs = nt.nodes.new('ShaderNodeMixShader')
        a = tex.outputs['Alpha']
        if edge_cull is not None:
            # drop cards seen almost edge-on (they bake as streaks)
            lw = nt.nodes.new('ShaderNodeLayerWeight')
            lw.inputs['Blend'].default_value = 0.5
            lt = nt.nodes.new('ShaderNodeMath')
            lt.operation = 'LESS_THAN'
            lt.inputs[1].default_value = edge_cull
            nt.links.new(lw.outputs['Facing'], lt.inputs[0])
            mu = nt.nodes.new('ShaderNodeMath')
            mu.operation = 'MULTIPLY'
            nt.links.new(a, mu.inputs[0])
            nt.links.new(lt.outputs[0], mu.inputs[1])
            a = mu.outputs[0]
        if hard_alpha:
            gt = nt.nodes.new('ShaderNodeMath')
            gt.operation = 'GREATER_THAN'
            gt.inputs[1].default_value = 0.5
            nt.links.new(a, gt.inputs[0])
            a = gt.outputs[0]
        nt.links.new(a, mixs.inputs['Fac'])
        nt.links.new(tr.outputs[0], mixs.inputs[1])
        nt.links.new(em.outputs[0], mixs.inputs[2])
        nt.links.new(mixs.outputs[0], out.inputs['Surface'])
    else:
        nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def normal_material(name, image=None, alpha=False):
    """Emission = camera-space shading normal * 0.5 + 0.5 (x right, y up, z towards the camera)."""
    m, nt = _new_mat(name)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    # Cycles turns the shading normal towards the viewer on back faces; undo that so double-sided cards keep
    # their authored (outward / upward) normals: N * (1 - 2 * backfacing)
    flip = nt.nodes.new('ShaderNodeMath')
    flip.operation = 'MULTIPLY_ADD'
    flip.inputs[1].default_value = -2.0
    flip.inputs[2].default_value = 1.0
    nt.links.new(geo.outputs['Backfacing'], flip.inputs[0])
    nsgn = nt.nodes.new('ShaderNodeVectorMath')
    nsgn.operation = 'SCALE'
    nt.links.new(geo.outputs['Normal'], nsgn.inputs[0])
    nt.links.new(flip.outputs[0], nsgn.inputs['Scale'])
    vt = nt.nodes.new('ShaderNodeVectorTransform')
    vt.vector_type = 'NORMAL'
    vt.convert_from = 'WORLD'
    vt.convert_to = 'CAMERA'
    nt.links.new(nsgn.outputs[0], vt.inputs[0])
    # Cycles camera space: x right, y up, z forwards (away from the viewer) -> flip z so +z faces the camera.
    # Render normal passes with view_transform 'Raw' (see render_normals) so the values are stored linearly.
    sc = nt.nodes.new('ShaderNodeVectorMath')
    sc.operation = 'MULTIPLY_ADD'
    sc.inputs[1].default_value = (0.5, 0.5, -0.5)
    sc.inputs[2].default_value = (0.5, 0.5, 0.5)
    nt.links.new(vt.outputs[0], sc.inputs[0])
    nt.links.new(sc.outputs[0], em.inputs['Color'])
    if alpha and image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        gt = nt.nodes.new('ShaderNodeMath')
        gt.operation = 'GREATER_THAN'
        gt.inputs[1].default_value = 0.5
        nt.links.new(tex.outputs['Alpha'], gt.inputs[0])
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mixs = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(gt.outputs[0], mixs.inputs['Fac'])
        nt.links.new(tr.outputs[0], mixs.inputs[1])
        nt.links.new(em.outputs[0], mixs.inputs[2])
        nt.links.new(mixs.outputs[0], out.inputs['Surface'])
    else:
        nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def render_to(path, raw=False):
    sc = bpy.context.scene
    sc.view_settings.view_transform = 'Raw' if raw else 'Standard'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def pbr_material(name, color_img, alpha=False, normal_img=None, rough=0.9, metallic=0.0, double=False):
    """Principled material for glTF export (alpha mode is fixed up in pack.mjs)."""
    m, nt = _new_mat(name)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metallic
    nt.links.new(bs.outputs[0], out.inputs['Surface'])
    if color_img is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = color_img
        nt.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
        if alpha:
            nt.links.new(tex.outputs['Alpha'], bs.inputs['Alpha'])
    if normal_img is not None:
        nt2 = nt.nodes.new('ShaderNodeTexImage')
        nt2.image = normal_img
        normal_img.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(nt2.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    m.use_backface_culling = not double
    return m


def export_glb(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_image_format='AUTO', export_animations=False, export_skins=False, export_morph=False,
        export_attributes=False, export_extras=False, export_cameras=False, export_lights=False,
    )
