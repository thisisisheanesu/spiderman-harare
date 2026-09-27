"""Small Cycles CPU preview renders (3/4 front, side, 3/4 rear, top) for checking the models."""
import math
import os

import bpy
from mathutils import Vector

HDRI = os.environ.get('VEH_HDRI', '')


def _look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def setup_scene(samples=24, res=(640, 400)):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.max_bounces = 4
    sc.cycles.transparent_max_bounces = 8
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 88
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 2
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    nt.links.new(bg.outputs[0], out.inputs[0])
    if HDRI and os.path.exists(HDRI):
        env = nt.nodes.new('ShaderNodeTexEnvironment')
        env.image = bpy.data.images.load(HDRI)
        mapping = nt.nodes.new('ShaderNodeMapping')
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mapping.inputs['Rotation'].default_value[2] = math.radians(140)
        nt.links.new(tc.outputs['Generated'], mapping.inputs['Vector'])
        nt.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
        nt.links.new(env.outputs[0], bg.inputs[0])
        bg.inputs[1].default_value = 1.0
    else:
        bg.inputs[0].default_value = (0.6, 0.7, 0.85, 1)
        bg.inputs[1].default_value = 1.0
    # sun
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.5
    sun.angle = math.radians(3)
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(40), math.radians(10), math.radians(150))
    sc.collection.objects.link(so)
    # ground
    me = bpy.data.meshes.new('ground')
    s = 60
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('ground', me)
    mat = bpy.data.materials.new('ground_mat')
    mat.use_nodes = True
    b = mat.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (0.32, 0.31, 0.29, 1)
    b.inputs['Roughness'].default_value = 0.9
    me.materials.append(mat)
    sc.collection.objects.link(g)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        if ob.type != 'MESH':
            continue
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


def render_views(objs, prefix, views=('front34', 'side', 'rear34'), samples=24, res=(640, 400)):
    cam = bpy.context.scene.camera or setup_scene(samples, res)
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.resolution_x, sc.render.resolution_y = res
    lo, hi = bbox(objs)
    c = (lo + hi) / 2
    size = hi - lo
    L = max(size.y, size.x, size.z)
    paths = []
    for v in views:
        cd = cam.data
        if v == 'side':
            cd.type = 'ORTHO'
            cd.ortho_scale = max(size.y * 1.12, size.z * 1.12 * res[0] / res[1])
            cam.location = (c.x - 30, c.y, c.z)   # looking at the LEFT side
            _look_at(cam, (c.x, c.y, c.z))
        elif v == 'side_r':
            cd.type = 'ORTHO'
            cd.ortho_scale = max(size.y * 1.12, size.z * 1.12 * res[0] / res[1])
            cam.location = (c.x + 30, c.y, c.z)
            _look_at(cam, (c.x, c.y, c.z))
        elif v == 'front':
            cd.type = 'ORTHO'
            cd.ortho_scale = max(size.x * 1.25, size.z * 1.25) * res[0] / res[1]
            cam.location = (c.x, c.y + 30, c.z)
            _look_at(cam, (c.x, c.y, c.z))
        elif v == 'rear':
            cd.type = 'ORTHO'
            cd.ortho_scale = max(size.x * 1.25, size.z * 1.25) * res[0] / res[1]
            cam.location = (c.x, c.y - 30, c.z)
            _look_at(cam, (c.x, c.y, c.z))
        elif v == 'top':
            cd.type = 'ORTHO'
            cd.ortho_scale = size.y * 1.12
            cam.location = (c.x, c.y, c.z + 30)
            cam.rotation_euler = (0, 0, math.radians(-90))
        else:
            cd.type = 'PERSP'
            cd.lens = 50
            d = L * 1.9 + 2.0
            el = {'rear34': 0.25, 'high': 0.9}.get(v, 0.28)
            if v == 'rear34':
                hdir = Vector((-0.55, -0.83, 0))
            else:
                hdir = Vector((-0.57, 0.82, 0))
            hdir.normalize()
            cam.location = c + hdir * d * math.cos(math.atan(el)) + Vector((0, 0, d * math.sin(math.atan(el))))
            _look_at(cam, c + Vector((0, 0, -size.z * 0.1)))
        p = f'{prefix}_{v}.jpg'
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths
