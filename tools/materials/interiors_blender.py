"""Render the interior-mapping atlas for facade windows (Blender Cycles, CC0, fully procedural).

    $BPY tools/materials/interiors_blender.py            # all rooms -> $MAT_CACHE/interiors/room_<i>.png
    python3 tools/materials/pack_interiors.py            # -> public/textures/glass/interiors_atlas*.webp + interiors.json

Projection (what the game shader must invert — see public/textures/README.md "Interior mapping"):
  Room space: x in [0,1] across the window (left -> right as seen from the street), y in [0,1] floor -> ceiling,
  z in [0,1] depth into the building (window plane z = 0, back wall z = 1). The real room modelled here is
  3 x 3 x 3 m. Each cell is a pinhole render from (0.5, 0.5, -1) (one window-width in front of the glass)
  looking +z, with the frustum exactly covering the window [0,1]^2 at z = 0 (field of view 2*atan(0.5) =
  53.13 deg). A room point p maps to the cell at
        uv = 0.5 + (p.xy - 0.5) / (1 + p.z)
  so the back wall occupies the central half of the cell and the side walls / floor / ceiling the trapezoids.
"""
import math
import os
import random
import sys

import bpy  # noqa: I001
from mathutils import Vector

CACHE = os.environ.get('MAT_CACHE', '/tmp/spiderman-materials-cache')
OUT = os.path.join(CACHE, 'interiors')
os.makedirs(OUT, exist_ok=True)
RES = int(os.environ.get('ROOM_RES', 512))
SAMPLES = int(os.environ.get('ROOM_SAMPLES', 64))
S = 3.0  # room size (m)

ROOMS = ['office_open', 'office_cellular', 'apartment_living', 'apartment_bedroom',
         'shop_supermarket', 'shop_clothing', 'shop_hardware', 'vacant_storage']


def srgb(h):
    if len(h) == 4:  # '#abc'
        h = '#' + ''.join(ch * 2 for ch in h[1:])
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


_mats = {}


def mat(color, rough=0.6, metal=0.0, emit=0.0, emit_color=None):
    key = (color, rough, metal, emit, emit_color)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new('m%d' % len(_mats))
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb(color)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = srgb(emit_color or color)
        b.inputs['Emission Strength'].default_value = emit
    _mats[key] = m
    return m


def box(x0, y0, z0, x1, y1, z1, m):
    """Axis-aligned box from min to max corner (metres, Blender coords: x across, y depth, z up)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.scale = (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0))
    o.data.materials.append(m)
    return o


def cyl(x, y, z0, z1, r, m, seg=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=z1 - z0, location=(x, y, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.data.materials.append(m)
    return o


def area_light(x, y, z, size, energy, color=(1, 1, 1)):
    bpy.ops.object.light_add(type='AREA', location=(x, y, z))
    lt = bpy.context.active_object
    lt.data.size = size
    lt.data.energy = energy
    lt.data.color = color
    return lt


def point_light(x, y, z, energy, color=(1, 0.8, 0.6), radius=0.1):
    bpy.ops.object.light_add(type='POINT', location=(x, y, z))
    lt = bpy.context.active_object
    lt.data.energy = energy
    lt.data.color = color
    lt.data.shadow_soft_size = radius
    return lt


def shell(floor, wall, ceiling, back=None, left=None, right=None):
    t = 0.05
    box(-t, -0.3, -t, S + t, S + t, 0, floor)                       # floor
    box(-t, -0.3, S, S + t, S + t, S + t, ceiling)                  # ceiling
    box(-t, -0.3, 0, 0, S + t, S, left or wall)                     # left wall
    box(S, -0.3, 0, S + t, S + t, S, right or wall)                 # right wall
    box(0, S, 0, S, S + t, S, back or wall)                         # back wall


def fluorescent(x, y, w=0.6, l=1.2, strength=10.0):
    box(x - w / 2, y - l / 2, S - 0.03, x + w / 2, y + l / 2, S - 0.005, mat('#ffffff', emit=strength, emit_color='#f4f7ff'))


def window_fill(energy=60, color=(0.85, 0.9, 1.0)):
    """Soft daylight entering through the window plane."""
    lt = area_light(S / 2, -0.2, S * 0.6, S, energy, color)
    lt.rotation_euler = (math.radians(90), 0, 0)  # area lights shine along local -Z; +90 deg about X -> +Y (into the room)


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except TypeError:
        pass
    sc.cycles.max_bounces = 6
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'  # soft highlight roll-off on lamps / screens
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = float(os.environ.get('ROOM_EXPOSURE', -2.2))
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.02, 0.025, 1)
    sc.world = world
    cam_d = 1.0  # camera distance in window widths
    bpy.ops.object.camera_add(location=(S / 2, -S * cam_d, S / 2), rotation=(math.radians(90), 0, 0))
    cam = bpy.context.active_object
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.angle = 2 * math.atan(0.5 / cam_d)
    cam.data.clip_start = 0.05
    sc.camera = cam
    return sc


# ------------------------------------------------------------------------------------------ furniture helpers
def desk(x, y, w=1.4, d=0.7, top='#b8a888', leg='#3a3c40', rng=random):
    box(x - w / 2, y - d / 2, 0.72, x + w / 2, y + d / 2, 0.75, mat(top, 0.5))
    for sx in (-1, 1):
        box(x + sx * (w / 2 - 0.05) - 0.03, y - d / 2 + 0.05, 0, x + sx * (w / 2 - 0.05) + 0.03, y + d / 2 - 0.05, 0.72, mat(leg, 0.5, 0.6))
    # monitor facing the window (toward -y), keyboard, papers
    box(x - 0.28, y + 0.12, 0.75, x + 0.28, y + 0.16, 1.1, mat('#16181c', 0.3))
    box(x - 0.26, y + 0.115, 0.77, x + 0.26, y + 0.12, 1.08, mat('#8fb4d8', 0.2, emit=1.5, emit_color='#9cc4ee'))
    box(x - 0.05, y + 0.14, 0.75, x + 0.05, y + 0.2, 0.9, mat('#16181c', 0.3))
    box(x - 0.2, y - 0.15, 0.75, x + 0.2, y - 0.02, 0.77, mat('#e0e0dc', 0.6))
    if rng.random() < 0.7:
        box(x + 0.35, y - 0.2, 0.75, x + 0.6, y + 0.05, 0.78, mat('#f2f0ea', 0.8))


def chair(x, y, color='#2a2c33'):
    box(x - 0.25, y - 0.25, 0.42, x + 0.25, y + 0.25, 0.5, mat(color, 0.8))
    box(x - 0.24, y - 0.3, 0.5, x + 0.24, y - 0.24, 1.05, mat(color, 0.8))
    cyl(x, y, 0.05, 0.42, 0.03, mat('#555', 0.4, 0.8), 8)
    box(x - 0.3, y - 0.03, 0.02, x + 0.3, y + 0.03, 0.06, mat('#222', 0.5))


def shelf_unit(x0, x1, y0, y1, z1, levels, frame, rng, product_colors, fill=0.85, item=(0.08, 0.3)):
    box(x0, y0, 0, x1, y1, 0.03, mat(frame, 0.5))
    for i in range(levels + 1):
        z = 0.12 + i * (z1 - 0.12) / levels
        box(x0, y0, z, x1, y1, z + 0.03, mat(frame, 0.5, 0.3))
        if i == levels:
            break
        zt = 0.12 + (i + 1) * (z1 - 0.12) / levels - 0.06
        xx = x0 + 0.02
        while xx < x1 - 0.05:
            w = rng.uniform(*item) * (x1 - x0 if x1 - x0 < 1 else 1)
            w = min(w, x1 - 0.02 - xx)
            if rng.random() < fill:
                h = rng.uniform(0.35, 0.95) * (zt - z - 0.03)
                c = rng.choice(product_colors)
                box(xx, y0 + 0.03, z + 0.03, xx + w * 0.92, y1 - 0.03, z + 0.03 + h, mat(c, rng.uniform(0.3, 0.7)))
            xx += w
    for xs in (x0, x1 - 0.04):
        box(xs, y0, 0, xs + 0.04, y1, z1 + 0.03, mat(frame, 0.5, 0.3))


def shelf_side(xw, y0, y1, z1, levels, frame, rng, colors, fill=0.85, inward=1):
    """Shelf against a side wall (x = xw), items along y."""
    d = 0.4
    xa, xb = (xw, xw + d) if inward > 0 else (xw - d, xw)
    box(xa, y0, 0, xb, y1, 0.03, mat(frame, 0.5))
    for i in range(levels + 1):
        z = 0.12 + i * (z1 - 0.12) / levels
        box(xa, y0, z, xb, y1, z + 0.03, mat(frame, 0.5, 0.3))
        if i == levels:
            break
        zt = 0.12 + (i + 1) * (z1 - 0.12) / levels - 0.06
        yy = y0 + 0.02
        while yy < y1 - 0.05:
            w = min(rng.uniform(0.08, 0.3), y1 - 0.02 - yy)
            if rng.random() < fill:
                h = rng.uniform(0.35, 0.95) * (zt - z - 0.03)
                box(xa + 0.03, yy, z + 0.03, xb - 0.03, yy + w * 0.92, z + 0.03 + h, mat(rng.choice(colors), rng.uniform(0.3, 0.7)))
            yy += w


def curtains(color, open_frac=0.35, rng=random, blind=False):
    """Curtains hanging just inside the window plane, gathered at both sides."""
    if blind:
        # venetian blind lowered to a random height: slats across the whole width
        bottom = S * (1 - open_frac)
        z = S - 0.05
        while z > bottom:
            box(0.02, 0.1, z - 0.035, S - 0.02, 0.14, z, mat(color, 0.5))
            z -= 0.06
        return
    for side in (0, 1):
        w = S * (1 - open_frac) / 2
        x0 = 0.02 if side == 0 else S - 0.02 - w
        n = 7
        for i in range(n):
            xa = x0 + i * w / n
            dy = 0.06 if i % 2 else 0.0
            box(xa, 0.12 + dy, 0.1, xa + w / n + 0.01, 0.16 + dy, S - 0.1, mat(color, 0.9))
    box(0.0, 0.1, S - 0.12, S, 0.2, S - 0.08, mat('#8a7a60', 0.5, 0.5))  # rail


# ------------------------------------------------------------------------------------------ rooms
def office_open(rng):
    shell(mat('#5d6266', 0.9), mat('#e4e0d6', 0.85), mat('#f0efea', 0.9), back=mat('#d9d4c7', 0.85))
    for (x, y) in ((0.9, 1.2), (2.2, 1.2), (0.9, 2.4), (2.2, 2.4)):
        fluorescent(x, y, strength=12)
    area_light(S / 2, S / 2, S - 0.1, 2.5, 280, (0.95, 0.97, 1.0)).rotation_euler = (0, 0, 0)
    for (x, y) in ((0.85, 1.3), (2.2, 1.3), (0.85, 2.45), (2.2, 2.45)):
        desk(x, y, rng=rng)
        chair(x, y - 0.55, rng.choice(['#2a2c33', '#23324a', '#3a2f2a']))
    # partitions
    box(0.1, 1.72, 0, 2.9, 1.76, 1.25, mat('#6f7d87', 0.9))
    # filing cabinets + plant on the back wall
    for i in range(3):
        box(0.2 + i * 0.5, S - 0.6, 0, 0.65 + i * 0.5, S - 0.02, 1.3, mat('#b5b6b2', 0.4, 0.5))
    cyl(2.6, 2.7, 0, 0.35, 0.18, mat('#6b4a33', 0.8))
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.35, location=(2.6, 2.7, 0.75))
    bpy.context.active_object.data.materials.append(mat('#3c6a33', 0.9))
    # notice board / whiteboard
    box(1.8, S - 0.03, 1.2, 2.6, S, 2.0, mat('#f4f4f2', 0.2))
    window_fill(40)


def office_cellular(rng):
    shell(mat('#6b5e52', 0.9), mat('#dcd3bf', 0.85), mat('#efeee8', 0.9), back=mat('#cfc4ab', 0.85))
    fluorescent(1.5, 1.6, strength=12)
    area_light(1.5, 1.6, S - 0.1, 1.2, 160)
    desk(1.5, 1.2, w=1.6, top='#6b4a2e', rng=rng)
    chair(1.5, 1.75, '#1f1f22')
    box(1.2, 0.6, 0.42, 1.8, 0.95, 0.5, mat('#5a2020', 0.8))  # visitor chair seat
    # bookshelf with binders on the back wall
    shelf_unit(0.2, 2.8, S - 0.4, S - 0.02, 2.2, 5, '#5a4632', rng,
               ['#1d3e7a', '#7a1d1d', '#1d5a2c', '#d8c24a', '#e8e4d8', '#2b2b2b', '#6a6a6a'], 0.9, (0.05, 0.09))
    box(0.1, S - 0.03, 2.35, 0.6, S, 2.7, mat('#e8e2d0', 0.4))  # calendar
    cyl(2.6, S - 0.04, 2.45, 2.46, 0.15, mat('#f5f5f5', 0.3))  # clock (thin, facing)
    curtains('#d8d2c2', open_frac=rng.uniform(0.3, 0.6), rng=rng, blind=True)
    window_fill(50)


def apartment_living(rng):
    shell(mat('#7a5638', 0.5), mat('#e6c7a6', 0.9), mat('#f2eee6', 0.9), back=mat('#d9b08a', 0.9))
    point_light(1.5, 1.6, 2.5, 520, (1.0, 0.78, 0.52), 0.15)
    point_light(0.5, 2.6, 1.4, 90, (1.0, 0.75, 0.5), 0.1)  # floor lamp glow
    cyl(1.5, 1.6, 2.5, 2.9, 0.01, mat('#222'))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.18, location=(1.5, 1.6, 2.45))
    bpy.context.active_object.data.materials.append(mat('#fff1d6', emit=6, emit_color='#ffd9a0'))
    # sofa against the back wall
    c = rng.choice(['#6a2a2a', '#2f4a5e', '#5e5a3a', '#4a3a5e'])
    box(0.5, S - 0.9, 0, 2.5, S - 0.1, 0.45, mat(c, 0.95))
    box(0.5, S - 0.3, 0.45, 2.5, S - 0.1, 0.9, mat(c, 0.95))
    box(0.4, S - 0.9, 0, 0.6, S - 0.1, 0.65, mat(c, 0.95))
    box(2.4, S - 0.9, 0, 2.6, S - 0.1, 0.65, mat(c, 0.95))
    # coffee table + rug
    box(0.7, 1.2, 0, 2.3, 2.2, 0.01, mat('#8a3b2a', 0.95))
    box(1.0, 1.5, 0.35, 2.0, 1.95, 0.4, mat('#4a3222', 0.4))
    # TV unit on the left wall
    box(0.02, 0.9, 0, 0.45, 2.1, 0.5, mat('#3a2a1e', 0.5))
    box(0.1, 1.0, 0.55, 0.14, 2.0, 1.15, mat('#0e0f12', 0.2))
    # picture on back wall
    box(1.1, S - 0.03, 1.5, 1.9, S, 2.0, mat(rng.choice(['#3a6e8a', '#b8742e', '#2e6b3a']), 0.4))
    curtains(rng.choice(['#b8894a', '#7a3a3a', '#d8cfa8', '#4a5a7a']), open_frac=rng.uniform(0.3, 0.6), rng=rng)
    window_fill(20, (0.9, 0.9, 1.0))


def apartment_bedroom(rng):
    shell(mat('#6a4a30', 0.5), mat('#c9d6dc', 0.9), mat('#f2f2ee', 0.9), back=mat('#b8c9d2', 0.9))
    point_light(2.6, 2.6, 1.1, 150, (1.0, 0.75, 0.45), 0.1)
    bpy.ops.mesh.primitive_cone_add(radius1=0.18, radius2=0.1, depth=0.22, location=(2.6, 2.6, 1.1))
    bpy.context.active_object.data.materials.append(mat('#f6e2c0', emit=4, emit_color='#ffcf90'))
    point_light(1.5, 1.5, 2.6, 220, (1.0, 0.85, 0.7), 0.2)
    # bed, head against back wall
    box(0.6, S - 2.1, 0, 2.2, S - 0.05, 0.45, mat('#e8e2d6', 0.9))
    box(0.6, S - 2.1, 0.45, 2.2, S - 0.6, 0.55, mat(rng.choice(['#6a2e4a', '#2e4a6a', '#6a5a2e']), 0.95))
    box(0.7, S - 0.55, 0.45, 2.1, S - 0.15, 0.62, mat('#f4f2ee', 0.95))
    box(0.55, S - 0.08, 0, 2.25, S - 0.02, 1.2, mat('#4a3020', 0.5))
    # wardrobe on the left wall, bedside table
    box(0.02, 0.9, 0, 0.62, 2.2, 2.2, mat('#7a5a3a', 0.5))
    box(2.4, S - 0.5, 0, 2.85, S - 0.05, 0.6, mat('#5a4030', 0.5))
    curtains(rng.choice(['#e0d0a8', '#a84a3a', '#5a7a5a']), open_frac=rng.uniform(0.15, 0.4), rng=rng)
    window_fill(15)


GOODS = ['#c8102e', '#ffcc00', '#0057b8', '#00843d', '#ff6f00', '#f2f2f2', '#6d2077', '#e4002b', '#1d1d1b', '#ffd100', '#a4d65e']


def shop_supermarket(rng):
    shell(mat('#d8d6d0', 0.3), mat('#eeeeea', 0.8), mat('#f4f4f2', 0.9), back=mat('#e8e8e2', 0.8))
    for x in (0.75, 2.25):
        for y in (0.8, 1.8, 2.7):
            fluorescent(x, y, 0.25, 1.2, 16)
    area_light(1.5, 1.5, S - 0.1, 2.6, 380, (0.97, 0.99, 1.0))
    shelf_unit(0.05, 2.95, S - 0.5, S - 0.02, 2.2, 5, '#dfe2e4', rng, GOODS, 0.95, (0.07, 0.14))
    shelf_side(0.02, 0.6, 2.4, 1.9, 5, '#dfe2e4', rng, GOODS, 0.9, 1)
    shelf_side(S - 0.02, 0.6, 2.4, 1.9, 5, '#dfe2e4', rng, GOODS, 0.9, -1)
    # gondola in the middle (end cap facing the window)
    shelf_unit(1.05, 1.95, 1.3, 2.1, 1.5, 4, '#dfe2e4', rng, GOODS, 0.95, (0.07, 0.14))
    box(0.8, 0.3, 0, 1.3, 0.8, 0.25, mat('#c8c8c8', 0.4, 0.7))  # basket stack
    # promo banner hanging
    box(0.9, 1.0, 2.4, 2.1, 1.02, 2.8, mat(rng.choice(['#e4002b', '#ffcc00', '#00843d']), 0.6))
    window_fill(30)


def shop_clothing(rng):
    shell(mat('#b89a78', 0.4), mat('#f0ece4', 0.8), mat('#f6f4f0', 0.9), back=mat(rng.choice(['#2e2e30', '#8a2e3a', '#e8e0d0']), 0.8))
    for x, y in ((0.8, 1.0), (2.2, 1.0), (0.8, 2.3), (2.2, 2.3)):
        point_light(x, y, 2.8, 120, (1.0, 0.9, 0.78), 0.05)
        cyl(x, y, 2.85, 3.0, 0.07, mat('#eeeeee', emit=8, emit_color='#fff0d8'))
    # wall rails with garments on back and side walls
    cloth = ['#1d1d1b', '#f2f2f2', '#c8102e', '#0057b8', '#e8b0b8', '#5a6a3a', '#c89a5a', '#2b3a5a', '#d8d0c0']
    for (x0, x1) in ((0.1, 1.4), (1.6, 2.9)):
        box(x0, S - 0.35, 1.7, x1, S - 0.33, 1.72, mat('#aaaaaa', 0.3, 1.0))
        x = x0 + 0.03
        while x < x1 - 0.05:
            box(x, S - 0.55, 0.9, x + 0.035, S - 0.13, 1.68, mat(rng.choice(cloth), 0.9))
            x += 0.06
    for side in (0, 1):
        xw = 0.35 if side == 0 else S - 0.35
        y = 0.6
        while y < 2.5:
            box(xw - 0.2, y, 0.8, xw + 0.2, y + 0.035, 1.6, mat(rng.choice(cloth), 0.9))
            y += 0.06
    # mannequin near the window
    for mx in (0.8, 2.2):
        cyl(mx, 0.7, 0, 0.05, 0.2, mat('#222', 0.4))
        cyl(mx, 0.7, 0.05, 0.95, 0.03, mat('#aaaaaa', 0.3, 1))
        box(mx - 0.2, 0.6, 0.95, mx + 0.2, 0.8, 1.55, mat(rng.choice(cloth), 0.9))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, location=(mx, 0.7, 1.72))
        bpy.context.active_object.data.materials.append(mat('#e8e4dc', 0.5))
    box(1.1, 1.5, 0, 1.9, 2.0, 0.85, mat('#3a2a20', 0.5))  # table with folded stacks
    for i in range(4):
        box(1.15 + i * 0.18, 1.6, 0.85, 1.3 + i * 0.18, 1.9, 0.85 + rng.uniform(0.08, 0.2), mat(rng.choice(cloth), 0.9))
    window_fill(25)


def shop_hardware(rng):
    shell(mat('#8a8a86', 0.9), mat('#d8d8cc', 0.9), mat('#e8e8e0', 0.9), back=mat('#c8c4b0', 0.9))
    for x in (0.9, 2.1):
        fluorescent(x, 1.5, 0.2, 1.2, 12)
    area_light(1.5, 1.5, S - 0.1, 2.0, 260)
    goods = ['#c8a060', '#8a6a40', '#e8e4d8', '#3a6ea8', '#c83a2a', '#e8c040', '#5a5a5a', '#2e7a3a', '#f0f0f0']
    shelf_unit(0.05, 2.95, S - 0.55, S - 0.02, 2.6, 6, '#6a6a6a', rng, goods, 0.97, (0.1, 0.35))
    shelf_side(0.02, 0.9, 2.4, 2.4, 6, '#6a6a6a', rng, goods, 0.95, 1)
    # counter with till, sacks of mealie-meal stacked in front
    box(1.2, 1.1, 0, 2.95, 1.6, 1.0, mat('#7a5a3a', 0.6))
    box(2.3, 1.2, 1.0, 2.6, 1.45, 1.2, mat('#2a2a2a', 0.4))
    for i in range(3):
        for j in range(3 - i):
            box(0.55 + j * 0.42 + i * 0.21, 0.35, 0.22 * i, 0.93 + j * 0.42 + i * 0.21, 0.95, 0.22 * i + 0.2,
                mat(rng.choice(['#f2f0e8', '#e8e0c8']), 0.95))
            box(0.6 + j * 0.42 + i * 0.21, 0.349, 0.22 * i + 0.05, 0.88 + j * 0.42 + i * 0.21, 0.35, 0.22 * i + 0.15,
                mat(rng.choice(['#c8102e', '#0057b8', '#00843d']), 0.8))
    window_fill(30)


def vacant_storage(rng):
    shell(mat('#6e6a64', 0.95), mat('#a8a49a', 0.95), mat('#b8b4ac', 0.95), back=mat('#9a968c', 0.95))
    point_light(1.5, 1.8, 2.7, 110, (1.0, 0.85, 0.65), 0.05)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.05, location=(1.5, 1.8, 2.7))
    bpy.context.active_object.data.materials.append(mat('#fff0d0', emit=20, emit_color='#ffd8a0'))
    cyl(1.5, 1.8, 2.75, 3.0, 0.006, mat('#111'))
    # stacked cardboard boxes, an old chair, a ladder
    for _ in range(14):
        w = rng.uniform(0.35, 0.7)
        x = rng.uniform(0.1, S - 0.1 - w)
        y = rng.uniform(1.8, S - 0.1 - w)
        h = rng.uniform(0.3, 0.6)
        box(x, y, 0, x + w, y + w * 0.8, h, mat(rng.choice(['#b08a5a', '#a07a4a', '#c09a6a']), 0.9))
        if rng.random() < 0.5:
            box(x + 0.05, y + 0.05, h, x + w - 0.05, y + w * 0.8 - 0.05, h + rng.uniform(0.25, 0.45), mat('#b89262', 0.9))
    chair(0.8, 1.0, '#3a3a3a')
    box(2.4, 1.0, 0, 2.45, 1.05, 2.2, mat('#8a8a8a', 0.4, 1))
    box(2.75, 1.0, 0, 2.8, 1.05, 2.2, mat('#8a8a8a', 0.4, 1))
    # newspaper on the window (common on vacant shopfronts): partial cover near the glass
    box(0.1, 0.08, 0.6, 1.2, 0.09, 1.6, mat('#9a9486', 0.9))
    window_fill(20)


ROOM_FNS = dict(office_open=office_open, office_cellular=office_cellular, apartment_living=apartment_living,
                apartment_bedroom=apartment_bedroom, shop_supermarket=shop_supermarket, shop_clothing=shop_clothing,
                shop_hardware=shop_hardware, vacant_storage=vacant_storage)


def main(names):
    for i, n in enumerate(ROOMS):
        if names and n not in names:
            continue
        sc = setup_scene()
        ROOM_FNS[n](random.Random(100 + i))
        sc.render.filepath = os.path.join(OUT, f'room_{i}_{n}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', n, flush=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main([a for a in argv if not a.endswith('.py')])
