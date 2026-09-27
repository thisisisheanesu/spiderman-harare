"""Harare dressing as toggle nodes, with the same group / node names as tools/vehicles (so the game's
streetlife mapping keeps working): kombi liveries, slogan banners, route cards and roof rack; pickup
cargo and sports bar; bus livery stripes and destination displays. Decals are projected onto the new
bodies with tools/vehicles' Projector (build.Ctx), textures come from tools/vehicles/liveries.py."""
import math

from mathutils import Vector

import liveries
import vkit
from specs import common as C


def flip_u(c):
    return (c[2], c[1], c[0], c[3])


def _obj(mb, name):
    return mb.to_object(name, smooth_angle=45)


def kombi(v, ctx, g):
    """g: dict with y_front, y_rear, wind_top, wind_bot, rear_top, stripe_z, roof_z, zupco_z, route_x, L."""
    lay_path = v.tex('kombi_livery.png')
    LAY = liveries.kombi(lay_path)
    v.textures['livery'] = lay_path
    lod = v.lod
    yf, yr = g['y_front'], g['y_rear']
    out = {}
    # factory waist stripe: faded gold over black along both sides (the Harare photos)
    mb = vkit.MB()
    c = LAY['stripe']
    a0, a1 = yf - 0.25, yr + 0.12
    for where, sd in (('right', 1), ('left', -1)):
        n = 8 if lod == 0 else 2
        pts = [(a0 + (a1 - a0) * i / n, g['stripe_z']) for i in range(n + 1)]
        ctx.strip(where, (sd * 2, 0, 0), pts, 0.075, 'livery', offset=0.006, mb=mb, uv_u=(c[0], c[2]), uv_v=(c[1], c[3]))
    out['livery_stripe'] = (_obj(mb, 'livery_stripe'), 'livery_stripe', False)
    # ZUPCO franchise: side stickers, windscreen strip, rear roundel
    mb = vkit.MB()
    z = g['zupco_z']
    ctx.patch('right', (2, g.get('zupco_y', 0.2), z), C.rect(0.62, 0.17), 'livery', offset=0.006, rings=1, uv_rect=LAY['zupco_side'], mb=mb)
    ctx.patch('left', (-2, g.get('zupco_y', 0.2), z), C.rect(0.62, 0.17), 'livery', offset=0.006, rings=1,
              uv_rect=flip_u(LAY['zupco_side']), mb=mb)
    ctx.patch('front', (0, yf, g['wind_top'] - 0.035), C.rect(1.1, 0.06), 'livery', offset=0.006, rings=1,
              uv_rect=flip_u(LAY['zupco_wind']), mb=mb)
    ctx.patch('rear', (-0.42, yr, g['rear_top'] - 0.2), C.ellipse(0.07, 0.07, 12), 'livery', offset=0.007, rings=1,
              uv_rect=flip_u(LAY['zupco_round']), mb=mb)
    out['livery_zupco'] = (_obj(mb, 'livery_zupco'), 'livery_zupco', False)
    # slogan banners: top of the windscreen and of the rear window
    for i in range(6):
        mb = vkit.MB()
        ctx.patch('front', (0, yf, g['wind_top'] - 0.075), C.rect(g.get('banner_w', 1.2), 0.1), 'livery', offset=0.007,
                  rings=1, uv_rect=flip_u(LAY[f'banner_{i}']), mb=mb, conform=False, max_edge=0.3)
        ctx.patch('rear', (0, yr, g['rear_top'] - 0.065), C.rect(g.get('rear_banner_w', 1.2), 0.09), 'livery', offset=0.007,
                  rings=1, uv_rect=flip_u(LAY[f'banner_{i}']), mb=mb, conform=False, max_edge=0.3)
        out[f'banner_{i}'] = (_obj(mb, f'banner_{i}'), 'banner', i == 0)
    # route cards: kerb side (left, -x) bottom corner of the windscreen
    for i in range(8):
        mb = vkit.MB()
        ctx.patch('front', (g['route_x'], yf, g['wind_bot'] + 0.075), C.rect(0.3, 0.09), 'livery', offset=0.007, rings=1,
                  uv_rect=flip_u(LAY[f'route_{i}']), mb=mb, conform=False, max_edge=0.4)
        out[f'route_{i}'] = (_obj(mb, f'route_{i}'), 'route', i == 0)
    # roof rack with a checked bag, a sack and a tarp bundle
    out['roof_rack'] = (_obj(kombi_rack(g, LAY, lod), 'roof_rack'), 'roof_rack', False)
    v.toggles.update(out)
    return out


def kombi_rack(g, LAY, lod):
    mb = vkit.MB()
    y0, y1 = g['y_rear'] + 0.35, g['rack_front']
    z = g['roof_z'] + 0.1
    xh = g.get('rack_x', 0.68)
    prof = vkit.circle_profile(0.016, 5 if lod == 0 else 3)
    for sd in (1, -1):
        vkit.sweep(mb, [(sd * xh, y0, z), (sd * xh, y1, z)], prof, 'chrome')
        vkit.sweep(mb, [(sd * xh, y0, z + 0.14), (sd * xh, y1, z + 0.14)], prof, 'chrome')
        for yy in [y0 + (y1 - y0) * t for t in (0, 0.33, 0.66, 1)]:
            vkit.box(mb, (sd * xh, yy, z - 0.06), (0.04, 0.05, 0.12), 'trim')
            vkit.sweep(mb, [(sd * xh, yy, z), (sd * xh, yy, z + 0.14)], prof, 'chrome')
    for yy in [y0 + (y1 - y0) * t for t in (0, 0.2, 0.4, 0.6, 0.8, 1)]:
        vkit.sweep(mb, [(-xh, yy, z), (xh, yy, z)], prof, 'chrome')
    vkit.sweep(mb, [(-xh, y0, z + 0.14), (xh, y0, z + 0.14)], prof, 'chrome')
    vkit.sweep(mb, [(-xh, y1, z + 0.14), (xh, y1, z + 0.14)], prof, 'chrome')
    cargo = [((-0.3, y0 + 0.5, z + 0.2), (0.7, 0.55, 0.38), 'cargo_bag'),
             ((0.32, y0 + 0.45, z + 0.16), (0.55, 0.8, 0.3), 'cargo_sack'),
             ((0.05, y0 + 1.35, z + 0.18), (1.1, 0.7, 0.34), 'cargo_tarp')]
    for c, sz, cell in cargo:
        u0, v0, u1, v1 = LAY[cell]
        cm = vkit.MB()
        vkit.rounded_box(cm, c, sz, 0.08, 'livery', n=2 if lod == 0 else 1)
        for f in cm.bm.faces:
            for loop in f.loops:
                p = loop.vert.co
                fu = ((p.x - c[0]) / sz[0] + 0.5 + (p.z - c[2]) / sz[2] * 0.3) % 1.0
                fv = ((p.y - c[1]) / sz[1] + 0.5) % 1.0
                loop[cm.uv].uv = (u0 + (u1 - u0) * (0.05 + 0.9 * fu), v0 + (v1 - v0) * (0.05 + 0.9 * fv))
        mb.add_bm(cm.bm)
    return mb
