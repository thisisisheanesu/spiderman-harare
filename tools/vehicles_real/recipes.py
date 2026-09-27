"""Per-vehicle recipes: which Sketchfab model, how to normalise it and how to dress it for Harare.

Each recipe(v) fills v.body (game materials), v.wheels / v.wheel_meshes, v.extra, v.toggles, v.meta and
v.textures. Coordinates are Blender's (x right, y forward, z up, metres); see build_real.py.
"""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

import vr
import vkit
import build_real as B
import toggles as TG

DEBUG = os.environ.get('VR_DEBUG_CLASSES') == '1'
DEBUG_COL = {
    'paint': (0.9, 0.9, 0.9), 'glass': (0.1, 0.4, 1.0), 'chrome': (0.9, 0.9, 0.3), 'trim': (0.15, 0.15, 0.15),
    'tyre': (0.05, 0.05, 0.05), 'rim': (0.6, 0.3, 0.8), 'light_front': (1.0, 1.0, 0.6), 'light_rear': (1.0, 0.0, 0.0),
    'indicator': (1.0, 0.5, 0.0), 'plate': (1.0, 0.9, 0.0), 'interior': (0.3, 0.15, 0.05), 'livery': (0.0, 1.0, 0.3),
}


def extract_texture(glb_path, out_path, index=0):
    """Write the index-th embedded image of a GLB to out_path (keeps the original encoding)."""
    import json
    import struct
    data = open(glb_path, 'rb').read()
    jl = struct.unpack('<I', data[12:16])[0]
    j = json.loads(data[20:20 + jl])
    bin_off = 20 + jl + 8
    img = j['images'][index]
    bv = j['bufferViews'][img['bufferView']]
    o = bin_off + bv.get('byteOffset', 0)
    with open(out_path, 'wb') as f:
        f.write(data[o:o + bv['byteLength']])
    return out_path


def setup_materials(v, textured=(), tex=None, overrides=None, emissive_tex=('light_front', 'light_rear', 'indicator')):
    """Create the game materials used by v.body / wheels / extras. textured: names that use `tex`."""
    overrides = overrides or {}
    for name in vr.GAME_MATS:
        kw = dict(overrides.get(name, {}))
        t = v.textures.get(name) or (tex if name in textured else None)
        if DEBUG:
            m = vr.setup_game_material(name, base=DEBUG_COL.get(name, (1, 0, 1)), alpha=1.0 if name != 'glass' else 0.8,
                                       metal=0.0, rough=0.5)
            bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            bs.inputs['Emission Strength'].default_value = 0.0
            continue
        vr.setup_game_material(name, tex=t, emissive_tex=(name in emissive_tex and t is not None), **kw)


def meta(v, *, title, real, L, W, H, wheelbase, track_f, track_r, r, axle_f, axle_r, steer=35, paints, source):
    """Root extras (three.js root.userData). axle_f/axle_r: Blender y of the axles (front positive)."""
    v.meta.update({
        'title': title, 'real_model': real,
        'length_m': round(L, 3), 'width_m': round(W, 3), 'height_m': round(H, 3),
        'wheelbase_m': round(wheelbase, 3), 'track_front_m': round(track_f, 3), 'track_rear_m': round(track_r, 3),
        'wheel_radius_m': round(r, 3),
        'front_axle_z_m': round(-axle_f, 4), 'rear_axle_z_m': round(-axle_r, 4),
        'steer_max_deg': steer, 'paints': paints, 'source': source,
    })


def source_info(v, uid):
    import json
    p = os.path.join(v.rawdir, uid + '.json')
    j = json.load(open(p)) if os.path.exists(p) else {}
    lic = j.get('license') or {}
    u = j.get('user') or {}
    return {'uid': uid, 'title': j.get('name'), 'author': u.get('username'), 'author_name': u.get('displayName'),
            'url': j.get('viewerUrl') or f'https://sketchfab.com/3d-models/{uid}',
            'licence': lic.get('label'), 'licence_url': lic.get('url')}


def wheel_well(mb, hub, r, x_face, sgn):
    """Dark disc closing the wheel arch behind a wheel (faces outwards)."""
    n = 20
    pts = [Vector((x_face, hub.y + r * math.cos(2 * math.pi * i / n), hub.z + r * math.sin(2 * math.pi * i / n)))
           for i in range(n)]
    mb.face(pts, 'trim', facing=(sgn, 0, 0))


# ---------------------------------------------------------------------------------------------------
# kombi: Toyota HiAce H100 Commuter high roof (AI-assisted Tripo model, single 1K photo atlas)
# ---------------------------------------------------------------------------------------------------

def kombi(v):
    UID = 'bbb17dc295be4acf92acf09aa0148dc2'
    L, W, H = 4.695, 1.69, 2.2
    R = 0.345
    TW = 0.195
    cache = v.cache('s1')
    info = vr.blend_state_load(cache)
    if info is None:
        objs = vr.import_glb(v.raw(UID))
        ob = vr.join(objs, 'body')
        vr.weld(ob, 1e-6)
        vr.recalc_normals(ob)
        extract_texture(v.raw(UID), v.tex('kombi_src.jpg'))
        # front is +x in the download: turn it to +y
        vr.transform_all([ob], Matrix.Rotation(math.radians(90), 4, 'Z'))
        mn, mx = vr.bounds([ob])
        co = vr.verts_np(ob)
        Ls, Hs = mx.y - mn.y, mx.z - mn.z
        mid = (co[:, 1] > mn.y + 0.2 * Ls) & (co[:, 1] < mx.y - 0.3 * Ls)
        Ws = 2 * np.percentile(np.abs(co[mid, 0] - (mn.x + mx.x) / 2), 99.5)
        sL, sW, sH = L / Ls, W / Ws, H / Hs
        vr.transform_all([ob], Matrix.Translation((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z)))
        co = vr.verts_np(ob)
        # wheels (source units): contact patches give the axles; the radius comes from the real tyre
        r_s = R / sH
        hubs = {}
        for fr, ysg in (('f', 1), ('r', -1)):
            sel = (np.sign(co[:, 1]) == ysg) & (co[:, 2] < 0.012 * Hs)
            hubs[fr] = [0.0, float((co[sel, 1].min() + co[sel, 1].max()) / 2), float(r_s)]
        x_in = (W / 2 - 0.235) / sW
        wheel_objs = {}
        for fr in ('f', 'r'):
            for side, sgn in (('r', 1), ('l', -1)):
                cen = vr.face_data(ob)[0]
                m = vr.cylinder_mask(cen, Vector(hubs[fr]), r_s * 0.985, sgn, x_in)
                wheel_objs[fr + side] = vr.split_faces(ob, m, f'w_{fr}{side}')
        vr.decimate(ob, 32000)
        wheel = wheel_objs['fr']
        for k, w in wheel_objs.items():
            if k != 'fr':
                bpy.data.objects.remove(w)
        vr.decimate(wheel, 1400)
        # real size: body non-uniform, wheel uniform (stays round)
        vr.transform_all([ob], Matrix.Diagonal((sW, sL, sH, 1)))
        wx_out = float(vr.verts_np(wheel)[:, 0].max())
        vr.transform_all([wheel], Matrix.Translation((0, -hubs['f'][1], -hubs['f'][2])))
        vr.transform_all([wheel], Matrix.Diagonal((sH, sH, sH, 1)))
        w_off = float(vr.verts_np(wheel)[:, 0].max())
        vr.transform_all([wheel], Matrix.Translation((-(w_off - TW / 2), 0, 0)))   # outer face at +TW/2
        wheel.name = 'wheel'
        info = {'scale': [sW, sL, sH], 'src_dims': [float(Ws), float(Ls), float(Hs)],
                'hub_f_y': hubs['f'][1] * sL, 'hub_r_y': hubs['r'][1] * sL, 'tyre_x': wx_out * sW - TW / 2 - 0.005}
        vr.blend_state_save(cache, info)
    ob = bpy.data.objects['body']
    wheel = bpy.data.objects['wheel']
    src_tex = v.tex('kombi_src.jpg')
    img = vr.load_image(src_tex)
    v.stats['scale'] = [round(x, 3) for x in info['scale']]
    hub_f = Vector((0, info['hub_f_y'], R))
    hub_r = Vector((0, info['hub_r_y'], R))
    tyre_x = info['tyre_x']
    track = 2 * tyre_x
    # --- classify body faces from the photo atlas + position
    cols, _ = vr.face_colors(ob, img)
    cen, nor, area, mi, _ = vr.face_data(ob)
    lum = vr.luminance(cols)
    r_, g_, b_ = cols[:, 0], cols[:, 1], cols[:, 2]
    x, y, z = cen[:, 0], cen[:, 1], cen[:, 2]
    nx, ny, nz = nor[:, 0], nor[:, 1], nor[:, 2]
    yF, yR = L / 2, -L / 2
    lab = np.full(len(cen), 'paint', dtype=object)
    lab[lum < 0.13] = 'trim'
    # glass: dark texels in the window band of the sides, plus the whole windscreen / rear-window areas
    band = (z > 1.13) & (z < 1.86)
    side_w = band & (np.abs(nx) > 0.5) & (y > yR + 0.08) & (lum < 0.22)
    wind = (ny > 0.3) & (y > yF - 1.0) & (z > 1.12) & (z < 1.83) & (np.abs(x) < 0.76) & (lum < 0.75)
    rear_w = (ny < -0.55) & (y < yR + 0.25) & (z > 1.2) & (z < 1.9) & (np.abs(x) < 0.72) & (lum < 0.3)
    glass = side_w | wind | rear_w
    lab[glass] = 'glass'
    red = (r_ > 0.18) & (r_ > 2.6 * g_) & (r_ > 2.6 * b_)
    amber = (r_ > 0.3) & (g_ > 0.06) & (g_ < 0.55 * r_) & (b_ < 0.25 * g_) & ~red
    yellow = (r_ > 0.25) & (g_ > 0.18) & (b_ < 0.4 * g_) & ~amber
    lab[red & (y < yR + 0.4)] = 'light_rear'
    lab[amber & ((y > yF - 0.35) | (y < yR + 0.4))] = 'indicator'
    # the downloaded (Australian-style) plates: cover them with Zimbabwe plates at the same spots
    plates = {}
    for key, sel in (('front', yellow & (y > yF - 0.3)), ('rear', yellow & (y < yR + 0.3))):
        if sel.sum() > 3:
            plates[key] = (float(np.median(x[sel])), float(np.median(z[sel])))
    lab[yellow] = 'trim'
    # front: grille band (de-badged: the TOYOTA letters are painted out below) and the headlamps
    front = (ny > 0.45) & (y > yF - 0.35)
    grille = front & (np.abs(x) < 0.36) & (z > 0.55) & (z < 0.93)
    lab[grille] = 'trim'
    head = front & (np.abs(x) > 0.36) & (np.abs(x) < 0.8) & (z > 0.6) & (z < 0.9) & ~amber & (lum > 0.12)
    lab[head] = 'light_front'
    # wheel: dark = tyre, bright = hubcap / steel rim
    wcols, _ = vr.face_colors(wheel, img)
    wl = vr.luminance(wcols)
    wcen = vr.face_data(wheel)[0]
    wr = np.sqrt(wcen[:, 1] ** 2 + wcen[:, 2] ** 2)
    wlab = np.where((wl > 0.12) & (wr < 0.24), 'rim', 'tyre')
    vr.assign_game_materials(wheel, list(wlab))
    vr.assign_game_materials(ob, list(lab))
    v.stats['labels'] = {k: int((lab == k).sum()) for k in set(lab)}
    vr.shade(ob, 40)
    vr.shade(wheel, 60)
    # --- atlas: paint texels -> grey detail (tintable); badges painted out
    atlas = v.tex('kombi_atlas.png')
    white = vr.paint_atlas(src_tex, vr.uv_tris(ob, lab == 'paint'), atlas,
                           keep_uv_tris=vr.uv_tris(ob, (lab != 'paint') & (lab != 'glass')))
    vr.atlas_fill(atlas, vr.uv_tris(ob, grille), color=(22, 23, 25))
    v.stats['paint_white'] = round(float(white), 3)
    v.body = ob
    v.wheel_meshes['wheel'] = wheel
    for wname, hub, sgn in (('wheel_fl', hub_f, -1), ('wheel_fr', hub_f, 1), ('wheel_rl', hub_r, -1), ('wheel_rr', hub_r, 1)):
        v.wheels[wname] = (Vector((sgn * tyre_x, hub.y, R)), 'wheel')
    mb = vkit.MB()
    for wname, (hub, key) in v.wheels.items():
        sgn = 1 if hub.x > 0 else -1
        wheel_well(mb, hub, R * 1.08, sgn * (abs(hub.x) - 0.12), sgn)
    v.extra.append(mb.to_object('wells', smooth_angle=None))
    B.van_interior(v, x_half=W / 2 - 0.1, y_front=yF - 0.55, y_rear=yR + 0.15, z_floor=0.62, z_belt=1.12,
                   z_roof=1.86, y_dash=yF - 0.7, rows=[(yF - 1.05, 'pair'), (yF - 1.9, 'bench'), (yF - 2.65, 'bench'),
                                                        (yF - 3.4, 'bench'), (yF - 4.05, 'bench')])
    fp = (0.0, plates.get('front', (0, 0.46))[1])      # plates sit on the centre line of an H100
    rp = (0.0, plates.get('rear', (0, 0.62))[1])
    B.add_plates(v, (fp[0], ray_y(ob, fp[0], fp[1], 1), fp[1]), (rp[0], ray_y(ob, rp[0], rp[1], -1), rp[1]), 'AFV 4417',
                 w=0.48, h=0.125)
    v.stats['plates'] = plates
    # --- Harare dressing (toggles): same groups / names as the generated kombi
    gl = lab == 'glass'
    wf = gl & (ny > 0.3)
    wr_ = gl & (ny < -0.5)
    g = {'y_front': yF, 'y_rear': yR, 'wind_top': float(np.percentile(z[wf], 99)), 'wind_bot': float(np.percentile(z[wf], 1)),
         'rear_top': float(np.percentile(z[wr_], 99)) if wr_.any() else 1.85, 'stripe_z': 1.02, 'zupco_z': 0.98,
         'zupco_y': -0.35, 'roof_z': float(z.max()), 'route_x': -0.42, 'rack_front': yF - 1.05, 'rack_x': 0.62,
         'banner_w': 1.15, 'rear_banner_w': 1.1}
    v.stats['toggle_geom'] = {k: round(val, 3) for k, val in g.items()}
    TG.kombi(v, v.ctx(), g)
    setup_materials(v, textured=('paint', 'trim', 'light_front', 'light_rear', 'indicator', 'tyre', 'rim'), tex=atlas)
    meta(v, title='Toyota HiAce H100 Commuter (kombi)',
         real='Toyota HiAce H100 Commuter, long body, high roof (1989-2004)',
         L=L, W=W, H=H, wheelbase=hub_f.y - hub_r.y, track_f=track, track_r=track, r=R,
         axle_f=hub_f.y, axle_r=hub_r.y, steer=35,
         paints=['#efeee8', '#efeee8', '#efeee8', '#e4e1d8', '#b7bbbf', '#7fa3c7', '#1e2d55', '#5b1b22'],
         source=source_info(v, UID))
    v.meta['_lod1_body'] = 2300


def ray_y(ob, x, z, sgn, start=10.0):
    """y of the body surface hit by a ray along -sgn*y at (x, z) (front: sgn=1)."""
    from mathutils.bvhtree import BVHTree
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bvh = BVHTree.FromBMesh(bm)
    loc, nor, i, d = bvh.ray_cast(Vector((x, sgn * start, z)), Vector((0, -sgn, 0)))
    bm.free()
    return loc.y if loc is not None else sgn * 2.0


ALL = {
    'kombi': kombi,
}
