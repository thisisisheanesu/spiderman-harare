"""Build the Harare vehicle set: procedural bodies -> glTF (LOD0 + LOD1) + preview renders.

Run with the Blender-as-a-module Python:
    <bpy python> tools/vehicles/build.py [names...] [--lod 0,1] [--render] [--no-export] [--out DIR]
Then compress with tools/vehicles/optimize.mjs (meshopt + WebP) into public/models/vehicles/.
"""
import argparse
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import materials  # noqa: E402
import textures as T  # noqa: E402
import vkit  # noqa: E402
from vkit import MB, MI, Body, Projector, apply_rules, bm_to_object, inset_faces  # noqa: E402

SEG = {0: vkit.SEG_LOD0, 1: vkit.SEG_LOD1}


class Ctx:
    """Everything a vehicle spec needs while adding details."""

    def __init__(self, spec, lod, body, bm, info, texdir):
        self.spec = spec
        self.lod = lod
        self.body = body
        self.bm = bm
        self.info = info
        self.proj = Projector(bm)
        self.mb = MB()
        self.toggles = {}
        self.texdir = texdir
        self.y_front = body.y1
        self.y_rear = body.y0

    def tog(self, name):
        if name not in self.toggles:
            self.toggles[name] = MB()
        return self.toggles[name]

    # --- projections -------------------------------------------------------------------------------
    def _frame(self, where, yaw=0.0, pitch=0.0):
        """(ax, ay, d) for a projection from 'front', 'rear', 'right', 'left', 'top'.
        a runs to the vehicle's right (front/top) / forward (sides) / left (rear, as seen from behind)."""
        cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
        if where == 'front':
            d = Vector((-sy * cp, -cy * cp, -sp))
            ax = Vector((cy, -sy, 0))
        elif where == 'rear':
            d = Vector((-sy * cp, cy * cp, -sp))
            ax = Vector((-cy, -sy, 0))
        elif where == 'right':
            d = Vector((-cy * cp, sy * cp, -sp))
            ax = Vector((sy, cy, 0))
        elif where == 'left':
            d = Vector((cy * cp, sy * cp, -sp))
            ax = Vector((-sy, cy, 0))
        elif where == 'top':
            d = Vector((0, 0, -1))
            ax = Vector((1, 0, 0))
            return ax, Vector((0, 1, 0)), d
        else:
            raise ValueError(where)
        ay = d.cross(ax).normalized() * -1
        if ay.z < 0:
            ay = -ay
        return ax.normalized(), ay, d.normalized()

    def patch(self, where, origin, outline, mat, *, yaw=0.0, pitch=0.0, mirror=False, mb=None, **kw):
        """Project outline [(a, b)] from `where`. origin = (x, y, z) point in the projection plane.
        mirror=True also builds the copy mirrored across x = 0."""
        mb = mb or self.mb
        kw.setdefault('max_edge', 0.12 if self.lod == 0 else 0.45)
        kw.setdefault('conform', self.lod == 0)   # re-mesh LOD0 decals that would sink into curved panels
        ax, ay, d = self._frame(where, yaw, pitch)
        ok = self.proj.patch(mb, origin, ax, ay, d, outline, mat, **kw)
        if mirror:
            o2 = (-origin[0], origin[1], origin[2])
            w2 = {'right': 'left', 'left': 'right'}.get(where, where)
            ax2, ay2, d2 = self._frame(w2, -yaw if where in ('front', 'rear', 'top') else yaw, pitch)
            if where in ('front', 'rear', 'top'):
                ol = [(-a, b) for a, b in outline][::-1]
                uv = kw.pop('uv_rect', (0, 0, 1, 1))
                kw['uv_rect'] = (uv[2], uv[1], uv[0], uv[3])  # mirrored UVs keep the texture readable
                ok = self.proj.patch(mb, o2, ax2, ay2, d2, ol, mat, **kw) and ok
            else:
                ok = self.proj.patch(mb, o2, ax2, ay2, d2, outline, mat, **kw) and ok
        return ok

    def strip(self, where, origin, pts, width, mat, *, yaw=0.0, pitch=0.0, mirror=False, mb=None, **kw):
        mb = mb or self.mb
        if self.lod >= 1:
            kw.setdefault('max_seg', 0.8)
            kw.setdefault('max_across', 0.2)
        ax, ay, d = self._frame(where, yaw, pitch)
        ok = self.proj.strip(mb, pts, origin, ax, ay, d, width, mat, **kw)
        if mirror:
            o2 = (-origin[0], origin[1], origin[2])
            w2 = {'right': 'left', 'left': 'right'}.get(where, where)
            ax2, ay2, d2 = self._frame(w2, -yaw if where in ('front', 'rear', 'top') else yaw, pitch)
            p2 = [(-a, b) for a, b in pts] if where in ('front', 'rear', 'top') else pts
            ok = self.proj.strip(mb, p2, o2, ax2, ay2, d2, width, mat, **kw) and ok
        return ok

    def surface(self, x, y, z_from=5.0):
        """Top surface point of the body at (x, y) (ray from above)."""
        loc, nor = self.proj.hit((x, y, z_from), (0, 0, -1), back=0)
        return loc, nor

    def side_point(self, y, z, side=1):
        loc, nor = self.proj.hit((side * 5.0, y, z), (-side, 0, 0), back=0)
        return loc, nor


# ---------------------------------------------------------------------------------------------------
# build one vehicle
# ---------------------------------------------------------------------------------------------------

def build_vehicle(spec, lod, outdir, texdir, render=False, export=True):
    vkit.clear_scene()
    name = spec.NAME
    body = spec.body()
    bm, info = body.build(seg=SEG[lod], ds=spec.DS[lod], breaks=spec.BREAKS, n_end=6 if lod == 0 else 2)
    tags = apply_rules(bm, info, spec.RULES)
    if lod == 0:
        inset_faces(bm, list(tags.get('inset', [])), thickness=getattr(spec, 'INSET_T', 0.013),
                    depth=getattr(spec, 'INSET_D', -0.009))
    for extra in getattr(spec, 'POST_BODY', []):
        extra(bm, info, lod)
    ctx = Ctx(spec, lod, body, bm, info, texdir)

    # --- textures (LOD0 generates, LOD1 reuses) ---
    tex = spec_textures(spec, ctx, texdir, generate=(lod == 0))
    materials.setup_materials(tex)

    col = bpy.context.scene.collection
    body_ob = bm_to_object(bm, 'body', col, smooth_angle=getattr(spec, 'SMOOTH', 38))
    # wheel arches
    for (ay, R, zc, depth) in spec.arches():
        for sd in (1, -1):
            c = MB()
            W = spec.W
            xin = W - depth
            vkit.cylinder(c, (sd * (xin + (W + 0.3 - xin) / 2), ay, zc), 'x', R, (W + 0.3 - xin), 'trim',
                          segs=28 if lod == 0 else 10)
            cut = c.to_object('cut', col, smooth_angle=None)
            vkit.boolean(body_ob, cut)
            bpy.data.objects.remove(cut)
    # extra boolean cuts (pickup bed, truck chassis gaps ...)
    for cm in (spec.extra_cuts(lod) if hasattr(spec, 'extra_cuts') else []):
        cut = cm.to_object('cut', col, smooth_angle=None)
        vkit.boolean(body_ob, cut)
        bpy.data.objects.remove(cut)
    vkit.resharpen(body_ob, getattr(spec, 'SMOOTH', 38))
    # details
    spec.details(ctx)
    # turn indicators (material 'indicator'; left/right told apart by the sign of x)
    for (where, origin, yaw, w, h) in getattr(spec, 'INDICATORS', []):
        ctx.patch(where, origin, [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)], 'indicator',
                  yaw=yaw, mirror=True, offset=0.011, rings=1, uv_rect=T.LAMP_CELLS['indicator'], max_edge=0.05)
    det = ctx.mb.to_object('details', col, smooth_angle=45)
    join(body_ob, [det])
    body_ob.name = 'body'
    body_ob.data.name = f'{name}_body'
    # root + wheels + toggles
    root = bpy.data.objects.new(name, None)
    col.objects.link(root)
    body_ob.parent = root
    wheels = spec.wheels()
    shared = {}
    for wname, (x, y, z, wkey) in wheels.items():
        emp = bpy.data.objects.new(wname, None)
        col.objects.link(emp)
        emp.parent = root
        emp.location = (x, y, z)
        if wkey not in shared:
            shared[wkey] = spec.wheel_mesh(wkey, lod)
            shared[wkey].data.name = f'{name}_{wkey}'
        src = shared[wkey]
        ob = bpy.data.objects.new(f'{wname}_mesh', src.data)
        col.objects.link(ob)
        ob.parent = emp
        if x < 0:
            ob.rotation_euler = (0, 0, math.pi)
    for key, obj in shared.items():
        col.objects.unlink(obj)
    for tname, tmb in ctx.toggles.items():
        tob = tmb.to_object(tname, col, smooth_angle=45)
        tob.parent = root
        tob.data.name = f'{name}_{tname}'
        meta = spec.TOGGLES.get(tname, {}) if hasattr(spec, 'TOGGLES') else {}
        tob['toggle'] = meta.get('group', tname)
        tob['default_visible'] = bool(meta.get('default', False))
    root['vehicle'] = name
    root['lod'] = lod
    for k, v in spec.meta().items():
        root[k] = v if not isinstance(v, (list, dict)) else json.dumps(v)
    stats = {'tris_body': vkit.tri_count(body_ob)}
    stats['tris_wheel'] = {k: vkit.tri_count(o) for k, o in shared.items()}
    stats['tris_toggles'] = {t: vkit.tri_count(bpy.data.objects[t]) for t in ctx.toggles}
    stats['tris_total_rendered'] = stats['tris_body'] + sum(stats['tris_wheel'][wk] for (_, _, _, wk) in wheels.values())
    if export:
        path = os.path.join(outdir, f'{name}{"_lod1" if lod else ""}.glb')
        export_glb(root, path)
        stats['file'] = path
    if render and lod == 0:
        import render as R
        materials.setup_materials(tex, preview_paint=hex_lin(spec.PREVIEW_PAINT), emission=0.3)
        for t in ctx.toggles:
            bpy.data.objects[t].hide_render = not spec.TOGGLES.get(t, {}).get('preview', spec.TOGGLES.get(t, {}).get('default', False))
        R.setup_scene()
        objs = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render and o.name != 'ground']
        stats['previews'] = R.render_views(objs, os.path.join(outdir, 'previews', name),
                                           views=getattr(spec, 'VIEWS', ('front34', 'side', 'rear34', 'front')))
    return stats


def hex_lin(h):
    r, g, b = T.hex2rgb(h)

    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b))


def join(target, others):
    with bpy.context.temp_override(active_object=target, selected_editable_objects=[target] + others,
                                   object=target):
        bpy.ops.object.join()


def export_glb(root, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)

    def sel(o):
        o.select_set(True)
        for c in o.children:
            sel(c)
    sel(root)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_extras=True, export_texcoords=True, export_normals=True,
                              export_tangents=False, export_materials='EXPORT', export_image_format='AUTO',
                              export_cameras=False, export_lights=False, export_animations=False,
                              export_skins=False, export_morph=False)


def spec_textures(spec, ctx, texdir, generate=True):
    os.makedirs(texdir, exist_ok=True)
    n = spec.NAME
    tex = {
        'lights': os.path.join(texdir, 'lamps.png'),
        'tyre_normal': os.path.join(texdir, f'tyre_{getattr(spec, "TYRE", "road")}_n.png'),
        'plate': os.path.join(texdir, f'{n}_plate.png'),
        'paint': os.path.join(texdir, f'{n}_paint.png'),
        'paint_normal': os.path.join(texdir, f'{n}_paint_n.png'),
    }
    if generate or not os.path.exists(tex['paint']):
        if not os.path.exists(tex['lights']):
            T.lamp_atlas(tex['lights'])
        if not os.path.exists(tex['tyre_normal']):
            T.tyre_normal(tex['tyre_normal'], style=getattr(spec, 'TYRE', 'road'))
        T.plate(tex['plate'], spec.PLATE)
        canvas = T.PaintCanvas(1024, lambda y, kf, sd: ctx.body.uv(y, kf, sd, ctx.info),
                               cap_uv=lambda x, z, w: ctx.body.cap_uv(x, z, w, ctx.info))
        spec.paint(canvas)
        canvas.grime(getattr(spec, 'GRIME', 0.25))
        canvas.save(tex['paint'], tex['paint_normal'])
    liv = getattr(spec, 'livery', None)
    if liv:
        tex['livery'] = os.path.join(texdir, f'{n}_livery.png')
        if generate or not os.path.exists(tex['livery']):
            liv(tex['livery'])
    return tex


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('names', nargs='*')
    ap.add_argument('--lod', default='0,1')
    ap.add_argument('--render', action='store_true')
    ap.add_argument('--no-export', action='store_true')
    ap.add_argument('--out', default=os.environ.get('VEH_OUT', '/tmp/vehicles_build'))
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    import specs
    names = args.names or list(specs.ALL)
    allstats = {}
    statp = os.path.join(args.out, 'stats.json')
    if os.path.exists(statp):
        allstats = json.load(open(statp))
    for n in names:
        spec = specs.ALL[n]
        for lod in [int(x) for x in args.lod.split(',')]:
            st = build_vehicle(spec, lod, os.path.join(args.out, 'raw'), os.path.join(args.out, 'tex'),
                               render=args.render, export=not args.no_export)
            allstats[f'{n}_lod{lod}'] = st
            print(n, lod, json.dumps(st))
    os.makedirs(args.out, exist_ok=True)
    json.dump(allstats, open(statp, 'w'), indent=1)


if __name__ == '__main__':
    main()
