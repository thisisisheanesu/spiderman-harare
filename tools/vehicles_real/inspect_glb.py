"""Print the structure of a downloaded GLB (objects, tris, materials, textures, bounds) for curation.

    $BPY tools/vehicles_real/inspect_glb.py model.glb [--full]
"""
import sys

import bpy
from mathutils import Vector

path = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else sys.argv[1]
full = '--full' in sys.argv
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
dg = bpy.context.evaluated_depsgraph_get()
mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
tot = 0
rows = []
for o in bpy.context.scene.objects:
    if o.type != 'MESH':
        continue
    me = o.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    tot += tris
    for v in o.bound_box:
        w = o.matrix_world @ Vector(v)
        mn = Vector(map(min, mn, w))
        mx = Vector(map(max, mx, w))
    bb = [o.matrix_world @ Vector(v) for v in o.bound_box]
    c = sum(bb, Vector()) / 8
    size = Vector(map(max, *[tuple(b) for b in bb])) - Vector(map(min, *[tuple(b) for b in bb]))
    mats = [s.material.name if s.material else '-' for s in o.material_slots]
    rows.append((tris, o.name, o.parent.name if o.parent else '', mats, tuple(round(x, 2) for x in c), tuple(round(x, 2) for x in size)))
rows.sort(key=lambda r: -r[0])
for r in rows if full else rows[:60]:
    print(f'{r[0]:>8}  {r[1][:40]:<40} parent={r[2][:20]:<20} c={r[4]} s={r[5]} mats={r[3][:6]}')
print('objects', len(rows), 'tris', tot)
print('bounds', tuple(round(x, 3) for x in mn), tuple(round(x, 3) for x in mx), 'size', tuple(round(x, 3) for x in mx - mn))
print('materials:')
for m in bpy.data.materials:
    texs = []
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                texs.append(f'{n.image.name}({n.image.size[0]}x{n.image.size[1]})->{[l.to_socket.name for l in n.outputs[0].links]}')
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        bc = tuple(round(x, 2) for x in b.inputs['Base Color'].default_value[:3]) if b else None
        al = round(b.inputs['Alpha'].default_value, 2) if b else None
    else:
        bc = al = None
    users = sum(1 for o in bpy.context.scene.objects if o.type == 'MESH' and any(s.material == m for s in o.material_slots))
    print(f'  {m.name[:40]:<40} users={users} base={bc} alpha={al} blend={m.surface_render_method} {texs[:4]}')
print('images:', [(i.name, i.size[0], i.size[1]) for i in bpy.data.images])
