"""Per-material report of a downloaded GLB (for writing recipe rules): triangles, base colour, alpha,
metallic, texture, bounding box (in the import's Blender coordinates, x/y/z) and the objects using it.

    $BPY tools/vehicles_real/matreport.py model.glb
"""
import sys

import bpy  # noqa: I001
import numpy as np

sys.path.insert(0, __file__.rsplit('/', 1)[0])
import vr  # noqa: E402

path = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else sys.argv[1]
vr.clear()
objs = vr.import_glb(path)
mn, mx = vr.bounds(objs)
print('bounds', [round(x, 3) for x in mn], [round(x, 3) for x in mx], 'size', [round(x, 3) for x in (mx - mn)])
rep = {}
for o in objs:
    me = o.data
    if not len(me.polygons):
        continue
    cen, nor, area, mi, uvc = vr.face_data(o)
    tri = np.array([len(p.vertices) - 2 for p in me.polygons])
    for i, m in enumerate(me.materials):
        sel = mi == i
        if not sel.any():
            continue
        name = m.name if m else '-'
        r = rep.setdefault(name, {'tris': 0, 'min': np.full(3, 1e9), 'max': np.full(3, -1e9), 'objs': set(), 'mat': m})
        r['tris'] += int(tri[sel].sum())
        r['min'] = np.minimum(r['min'], cen[sel].min(0))
        r['max'] = np.maximum(r['max'], cen[sel].max(0))
        r['objs'].add(o.name)
for name, r in sorted(rep.items(), key=lambda kv: -kv[1]['tris']):
    m = r['mat']
    c = vr.src_color(m)
    img = vr.src_image(m)
    met = None
    if m and m.node_tree:
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        met = round(b.inputs['Metallic'].default_value, 2) if b else None
    print(f"{r['tris']:>7} {name[:34]:<34} rgb=({c[0]:.2f},{c[1]:.2f},{c[2]:.2f}) a={c[3]:.2f} met={met} "
          f"tex={img.name + str(tuple(img.size)) if img else '-'} "
          f"x[{r['min'][0]:.2f},{r['max'][0]:.2f}] y[{r['min'][1]:.2f},{r['max'][1]:.2f}] z[{r['min'][2]:.2f},{r['max'][2]:.2f}] "
          f"objs={len(r['objs'])}:{sorted(r['objs'])[:3]}")
