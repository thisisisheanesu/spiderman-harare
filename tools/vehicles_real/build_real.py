"""Build the real-vehicle set: Sketchfab downloads -> normalised game GLBs (LOD0 + LOD1).

    <bpy python> tools/vehicles_real/build_real.py <name> [<name> ...] --raw RAWDIR --out OUTDIR [--lod 0,1]

RAWDIR holds the downloaded <uid>.glb / <uid>.json (see sketchfab.py); OUTDIR gets raw/<name>.glb,
raw/<name>_lod1.glb, tex/ and stats. Then optimize.mjs compresses them into public/models/vehicles_real/.
Every model is described by a recipe in recipes.py (source uid, real dimensions, how to find wheels,
glass, lamps and paint, Harare dressing). Conventions: see public/models/vehicles_real/README.md.
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402,I001
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import vr  # noqa: E402
import vkit  # noqa: E402  (tools/vehicles, put on sys.path by vr)
import textures as T  # noqa: E402
import build as oldbuild  # noqa: E402  (tools/vehicles/build.py: Ctx projection helpers)


class Vehicle:
    """State of one vehicle while a recipe builds it."""

    def __init__(self, name, lod, rawdir, outdir):
        self.name = name
        self.lod = lod
        self.rawdir = rawdir
        self.outdir = outdir
        self.texdir = os.path.abspath(os.path.join(outdir, 'tex', name))
        os.makedirs(self.texdir, exist_ok=True)
        self.body = None           # joined body object (game materials)
        self.extra = []            # extra body parts (interior, plates, lamps ...) joined into body at the end
        self.wheels = {}           # wname -> (hub Vector, mesh key)
        self.wheel_meshes = {}     # key -> object (centred at the hub, axle = x, outer face +x)
        self.toggles = {}          # name -> (object, group, default_visible)
        self.meta = {}
        self.stats = {}
        self.textures = {}         # game material -> image path

    def cache(self, key):
        """Path of a cached intermediate .blend (heavy import/decimation stage); None when VR_NOCACHE=1."""
        d = os.path.join(self.outdir, 'cache')
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, f'{self.name}_{key}.blend')
        if os.environ.get('VR_NOCACHE') == '1' and os.path.exists(p):
            os.remove(p)
        return p

    def raw(self, uid):
        return os.path.join(self.rawdir, uid + '.glb')

    def tex(self, fname):
        return os.path.join(self.texdir, fname)

    def ctx(self, mb_target=None):
        """Projection helper (tools/vehicles/build.Ctx) over the current body."""
        bm = vr.bvh_of([self.body])
        mn, mx = vr.bounds([self.body])

        class _B:
            y1 = mx.y
            y0 = mn.y
        c = oldbuild.Ctx(None, self.lod, _B, bm, None, self.texdir)
        return c


# ---------------------------------------------------------------------------------------------------
# common finishing
# ---------------------------------------------------------------------------------------------------

def add_plates(v, front, rear, text, *, w=0.46, h=0.115, depth=0.012, front_pitch=0.0, rear_pitch=0.0):
    """Zimbabwe yellow plates (tools/vehicles/textures.plate) as flat panels on a thin black backing.
    front/rear: (x, y, z) of the plate centre on the body surface (or None). The plate stands `depth`
    in front of that point. pitch tilts the plate top backwards (degrees)."""
    path = v.tex(f'{v.name}_plate.png')
    T.plate(path, text)
    v.textures['plate'] = path
    mb = vkit.MB()
    for c, sgn, pitch in ((front, 1, front_pitch), (rear, -1, rear_pitch)):
        if c is None:
            continue
        c = Vector(c)
        # u runs from the viewer's left to right: seen from the front the viewer's right is -x
        right = Vector((-sgn, 0, 0))
        up = Vector((0, -sgn * math.sin(math.radians(pitch)), math.cos(math.radians(pitch))))
        out = Vector((0, sgn, 0))
        o = c + out * depth
        p = [o + right * (su * w / 2) + up * (sv * h / 2) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        mb.face(p, 'plate', [(0, 0), (1, 0), (1, 1), (0, 1)], facing=out)
        ob_ = c + out * (depth * 0.5)
        pb = [ob_ + right * (su * (w / 2 + 0.008)) + up * (sv * (h / 2 + 0.008)) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        mb.face(pb, 'trim', facing=out)
        pb2 = [q - out * (depth * 0.5 + 0.004) for q in pb]
        for i in range(4):
            a, b = pb[i], pb[(i + 1) % 4]
            mid = (a + b) / 2
            mb.face([a, b, pb2[(i + 1) % 4], pb2[i]], 'trim', facing=(mid - ob_))
    ob = mb.to_object(f'{v.name}_plates', smooth_angle=None)
    v.extra.append(ob)
    return ob


def van_interior(v, *, x_half, y_front, y_rear, z_floor, z_belt, z_roof, y_dash, rows, rhd=True, mb=None):
    """Dark interior silhouette seen through the glass: floor, dash with a steering wheel on the right
    (RHD), front seats and bench rows, side/roof liners. All 'interior' (double-sided in the game)."""
    mb = mb or vkit.MB()
    lod = v.lod
    W = x_half
    # floor + roof liner + side liners (planes; 'interior' is double-sided)
    mb.face([Vector((-W, y_rear, z_floor)), Vector((W, y_rear, z_floor)), Vector((W, y_front, z_floor)),
             Vector((-W, y_front, z_floor))], 'interior', facing=(0, 0, 1))
    Wr = W * 0.82
    mb.face([Vector((-Wr, y_rear + 0.15, z_roof)), Vector((Wr, y_rear + 0.15, z_roof)), Vector((Wr, y_dash - 0.35, z_roof)),
             Vector((-Wr, y_dash - 0.35, z_roof))], 'interior', facing=(0, 0, -1))
    z_side = z_floor + 0.18          # stays above the wheel arches
    for sd in (1, -1):
        mb.face([Vector((sd * W, y_rear, z_side)), Vector((sd * W, y_dash, z_side)), Vector((sd * W, y_dash, z_belt)),
                 Vector((sd * W, y_rear, z_belt))], 'interior', facing=(-sd, 0, 0))
    # rear wall below the rear window
    mb.face([Vector((-W, y_rear, z_floor)), Vector((W, y_rear, z_floor)), Vector((W, y_rear, z_belt)),
             Vector((-W, y_rear, z_belt))], 'interior', facing=(0, 1, 0))
    # dashboard
    vkit.box(mb, (0, y_dash + 0.12, z_belt - 0.1), (2 * W - 0.04, 0.34, 0.26), 'interior')
    # steering wheel (right-hand drive: +x) : a tilted ring
    sx = (0.36 if rhd else -0.36) * (W / 0.8)
    n = 16 if lod == 0 else 6
    ring = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ring.append((0.19 * math.cos(a), 0.19 * math.sin(a)))
    c = Vector((sx, y_dash - 0.12, z_belt + 0.05))
    ax = Vector((1, 0, 0))
    ay = Vector((0, -0.45, 0.89)).normalized()
    pts = [c + ax * a + ay * b for a, b in ring]
    if lod == 0:
        vkit.sweep(mb, pts, vkit.circle_profile(0.018, 4), 'interior', closed_path=True, caps=False)
        vkit.sweep(mb, [c, c + Vector((0, 0.25, -0.12))], vkit.circle_profile(0.03, 4), 'interior')
    else:
        mb.face(pts, 'interior')
    # seats: rows [(y, kind)] kind in 'pair' (driver + passenger) / 'bench'
    for (ys, kind) in rows:
        if kind == 'pair':
            for sd in (1, -1):
                xs = sd * W * 0.5
                vkit.box(mb, (xs, ys, z_floor + 0.3), (0.5, 0.5, 0.12), 'interior')
                vkit.box(mb, (xs, ys - 0.24, z_floor + 0.62), (0.48, 0.1, 0.6), 'interior')
                vkit.box(mb, (xs, ys - 0.26, z_floor + 0.98), (0.26, 0.08, 0.18), 'interior')
        else:
            vkit.box(mb, (0, ys, z_floor + 0.3), (2 * W - 0.1, 0.5, 0.12), 'interior')
            vkit.box(mb, (0, ys - 0.24, z_floor + 0.62), (2 * W - 0.1, 0.1, 0.62), 'interior')
            if lod == 0:
                for k in range(3):
                    vkit.box(mb, ((k - 1) * (2 * W - 0.1) / 3, ys - 0.26, z_floor + 0.98), (0.24, 0.08, 0.16), 'interior')
    ob = mb.to_object(f'{v.name}_interior', smooth_angle=None)
    v.extra.append(ob)
    return ob


def finish(v, out_path):
    """Assemble root / body / wheels / toggles, set extras and export. Consumes v's objects."""
    col = bpy.context.scene.collection
    parts = [v.body] + [e for e in v.extra if e is not None]
    body = vr.join(parts, 'body')
    labels = [body.data.materials[p.material_index].name for p in body.data.polygons]
    vr.assign_game_materials(body, labels)
    body.data.name = f'{v.name}_body'
    root = bpy.data.objects.new(v.name, None)
    col.objects.link(root)
    body.parent = root
    for wname, (hub, key) in v.wheels.items():
        emp = bpy.data.objects.new(wname, None)
        col.objects.link(emp)
        emp.parent = root
        emp.location = hub
        src = v.wheel_meshes[key]
        src.data.name = f'{v.name}_{key}'
        ob = bpy.data.objects.new(f'{wname}_mesh', src.data)
        col.objects.link(ob)
        ob.parent = emp
        if hub.x < 0:
            ob.rotation_euler = (0, 0, math.pi)
    for key, obj in v.wheel_meshes.items():
        if obj.name in col.objects:
            col.objects.unlink(obj)
    for tname, (tob, group, default) in v.toggles.items():
        tob.name = tname
        tob.data.name = f'{v.name}_{tname}'
        tob.parent = root
        tob['toggle'] = group
        tob['default_visible'] = bool(default)
        labels = [tob.data.materials[p.material_index].name for p in tob.data.polygons]
        vr.assign_game_materials(tob, labels)
    root['vehicle'] = v.name
    root['lod'] = v.lod
    for k, val in v.meta.items():
        if k.startswith('_'):
            continue
        root[k] = val if not isinstance(val, (list, dict)) else json.dumps(val)
    st = {'tris_body': vr.tri_count(body),
          'tris_wheels': {k: vr.tri_count(o) for k, o in v.wheel_meshes.items()},
          'tris_toggles': {t: vr.tri_count(o) for t, (o, g, d) in v.toggles.items()}}
    st['tris_default_view'] = st['tris_body'] + sum(st['tris_wheels'][k] for (_, k) in v.wheels.values()) + \
        sum(vr.tri_count(o) for t, (o, g, d) in v.toggles.items() if d)
    for o in [body] + list(v.wheel_meshes.values()) + [t[0] for t in v.toggles.values()]:
        o.data.validate(clean_customdata=False)
    vr.export_glb(root, out_path)
    st['file'] = out_path
    v.stats[f'lod{v.lod}'] = st
    return root


def make_lod1(v):
    """Reduce the LOD0 state to LOD1 (about 1.5-4k triangles on screen): decimated body, 12-sided-ish
    wheels, the interior silhouette replaced by a few boxes (recipes may override via v.lod1_hook)."""
    v.lod = 1
    tgt = v.meta.get('_lod1_body', 2200)
    vr.decimate(v.body, tgt)
    for k, w in v.wheel_meshes.items():
        vr.decimate(w, v.meta.get('_lod1_wheel', 150))
    keep = []
    for e in v.extra:
        if e is None:
            continue
        if e.name.endswith('_interior'):
            vr.decimate(e, 120)
        keep.append(e)
    v.extra = keep
    for t, (o, g, d) in v.toggles.items():
        if vr.tri_count(o) > 300:
            vr.decimate(o, max(120, vr.tri_count(o) // 4))
    if getattr(v, 'lod1_hook', None):
        v.lod1_hook(v)


def snapshot(v):
    return {'body': v.body.name, 'extra': [e.name for e in v.extra if e is not None],
            'wheel_meshes': {k: o.name for k, o in v.wheel_meshes.items()},
            'toggles': {t: (o.name, g, d) for t, (o, g, d) in v.toggles.items()}}


def restore(v, snap):
    O = bpy.data.objects
    v.body = O[snap['body']]
    v.extra = [O[n] for n in snap['extra']]
    v.wheel_meshes = {k: O[n] for k, n in snap['wheel_meshes'].items()}
    v.toggles = {t: (O[n], g, d) for t, (n, g, d) in snap['toggles'].items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('names', nargs='+')
    ap.add_argument('--raw', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--lod', default='0,1')
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    import recipes
    statp = os.path.join(args.out, 'stats.json')
    allstats = json.load(open(statp)) if os.path.exists(statp) else {}
    lods = [int(x) for x in args.lod.split(',')]
    os.makedirs(os.path.join(args.out, 'state'), exist_ok=True)
    for n in args.names:
        vr.clear()
        v = Vehicle(n, 0, args.rawdir if hasattr(args, 'rawdir') else args.raw, args.out)
        recipes.ALL[n](v)
        snap = snapshot(v)
        state = os.path.join(args.out, 'state', f'{n}.blend')
        bpy.ops.wm.save_as_mainfile(filepath=state, copy=True)
        if 0 in lods:
            finish(v, os.path.join(args.out, 'raw', f'{n}.glb'))
        if 1 in lods:
            bpy.ops.wm.open_mainfile(filepath=state)
            restore(v, snap)
            make_lod1(v)
            finish(v, os.path.join(args.out, 'raw', f'{n}_lod1.glb'))
        allstats[n] = v.stats
        print(n, json.dumps(v.stats))
        json.dump(allstats, open(statp, 'w'), indent=1)


if __name__ == '__main__':
    main()
