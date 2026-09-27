"""Harare facade kit: facade types and their modules (geometry generators + metadata).

Pure Python on top of kitlib.MB (no bpy calls here besides what MB.to_mesh does later), so the geometry can be
reasoned about in isolation. Blender module space: x along the wall (right, seen from the street), z up,
y INTO the building; wall plane y = 0. See kitlib.py.

Every generator returns (mb, meta). meta keys (copied into kit.json, converted to the glTF convention there):
  kind      bay | ground | cap | corner | pier | blank | attachment
  floor     middle | ground | top | any
  w, h      nominal width / height (m) = the module's tiling rectangle [0, w] x [0, h]
  stretch   {'x': [min, max], 'y': [min, max]} allowed width / height range when the builder scales the module
  anchors   attachment points (Blender coords here; exported converted): ac, bars, shutter, sign, pipe
  lod1      'quad' (flat atlas quad) | 'box' | 'self' (the LOD0 mesh is already cheap)
  notes     short description
"""
import math

from kitlib import MB, arch_points

# ------------------------------------------------------------------------------------------------------------
# Facade types (dimensions from the reference photos; see public/models/facades/README.md for the photos)
# materials: role -> [PBR material name in public/textures/materials.json, default tint hex or None]
# palette:   per-role alternative tints seen in the photos (the builder picks one per building)
# ------------------------------------------------------------------------------------------------------------
TYPES = {
    'ribbon': dict(
        title='Ribbon-window office slab (1950s-70s)',
        W=3.0, H=3.4, Hg=4.4, hc=1.0,
        materials=dict(wall=['brick_face_red', '#7e4a3a'], trim=['concrete_painted', '#d9d5cc'],
                       accent=['concrete_painted', '#7fa39c'], plinth=['granite_dark_tiles', None],
                       frame=['window_frame_aluminium', '#e4e2dc'], glass=['window_glass', '#5f7480'],
                       metal=['window_frame_aluminium', '#3a3d40'], sign=['metal_panel', '#e8e4d8']),
        palette=dict(accent=['#7fa39c', '#8eaec2', '#c8935e', '#d6cda9', '#9fb59a'],
                     trim=['#d9d5cc', '#cfc6b4', '#e3dfd6'], wall=['#7e4a3a', '#8e8d88', '#a58f76']),
        glass_cells=[0, 1, 1, 7], room_depth=1.6,
    ),
    'fins': dict(
        title='Vertical-fin / brise-soleil office block (1960s-70s)',
        W=3.0, H=3.4, Hg=4.4, hc=1.2,
        materials=dict(wall=['concrete_painted', '#d3cab8'], trim=['concrete_weathered', '#bdb5a4'],
                       accent=['concrete_painted', '#e2ddd0'], plinth=['granite_dark_tiles', None],
                       frame=['window_frame_aluminium', '#8f9396'], glass=['window_glass', '#56646c'],
                       metal=['window_frame_aluminium', '#3a3d40'], sign=['metal_panel', '#e8e4d8']),
        palette=dict(accent=['#e2ddd0', '#c9c8c2', '#d8c49c', '#b9a585'], wall=['#d3cab8', '#c4c2bb', '#cdb891'],
                     trim=['#bdb5a4', '#a9a79f']),
        glass_cells=[0, 1, 0, 7], room_depth=1.6,
    ),
    'eggcrate': dict(
        title='Deep egg-crate concrete sunshade grid (1960s-70s)',
        W=3.3, H=3.4, Hg=4.4, hc=1.1,
        materials=dict(wall=['concrete_painted', '#e4e0d7'], trim=['concrete_painted', '#dcd7cc'],
                       accent=['concrete_weathered', '#8d7a66'], plinth=['granite_dark_tiles', None],
                       frame=['window_frame_aluminium', '#9a9d9f'], glass=['window_glass', '#56646c'],
                       metal=['window_frame_aluminium', '#3a3d40'], sign=['metal_panel', '#e8e4d8']),
        palette=dict(wall=['#e4e0d7', '#d9cdb5', '#cfc9bf'], accent=['#8d7a66', '#6f7478', '#a8583f', '#c9c2b3']),
        glass_cells=[0, 1, 2, 3], room_depth=1.5,
    ),
    'curtain': dict(
        title='Blue / teal curtain-wall glass tower with granite piers (1980s-2000s)',
        W=3.0, H=3.6, Hg=4.8, hc=1.5,
        materials=dict(wall=['granite_cladding_light', '#b8b5b1'], trim=['granite_cladding_light', '#9ea09e'],
                       accent=['metal_panel', '#8b9399'], plinth=['granite_dark_tiles', None],
                       frame=['window_frame_aluminium', '#9aa3a8'], glass=['window_glass', '#5177a4'],
                       glass_spandrel=['window_glass', '#3d5a78'], metal=['window_frame_aluminium', '#3a3d40'],
                       sign=['metal_panel', '#e8e4d8']),
        palette=dict(glass=['#5177a4', '#5b808c', '#4f7a88', '#3f6f9a', '#5a7189'], wall=['#b8b5b1', '#c9c4ba', '#9d9e9c']),
        glass_cells=[0, 0, 1, 0], room_depth=2.0,
    ),
    'glassgranite': dict(
        title='1990s glass-and-granite office',
        W=3.3, H=3.5, Hg=4.6, hc=1.2,
        materials=dict(wall=['granite_cladding_light', '#c2c0ba'], trim=['granite_cladding_light', '#8e908e'],
                       accent=['granite_dark_tiles', '#6e7271'], plinth=['granite_dark_tiles', None],
                       frame=['window_frame_aluminium', '#3d4146'], glass=['window_glass', '#4b79a8'],
                       metal=['window_frame_aluminium', '#9aa0a4'], sign=['metal_panel', '#e8e4d8']),
        palette=dict(wall=['#c2c0ba', '#cbc3b4', '#b3aea6'], glass=['#4b79a8', '#5b808c', '#4a6f86']),
        glass_cells=[0, 1, 0, 7], room_depth=1.8,
    ),
    'brick': dict(
        title='Face-brick block with punched steel windows (1930s-60s)',
        W=3.2, H=3.3, Hg=4.2, hc=0.9,
        materials=dict(wall=['brick_face_red', '#86503f'], trim=['concrete_painted', '#e0dbd0'],
                       accent=['concrete_painted', '#d8d2c6'], plinth=['granite_dark_tiles', None],
                       frame=['window_frame_aluminium', '#ebe9e3'], glass=['window_glass', '#58666d'],
                       metal=['window_frame_aluminium', '#3a3d40'], sign=['metal_panel', '#e8e4d8']),
        palette=dict(wall=['#86503f', '#7a4436', '#9a6a52', '#8d5a45'], trim=['#e0dbd0', '#d5cbb6', '#c9c6be']),
        glass_cells=[1, 0, 1, 7], room_depth=1.5,
    ),
    'colonial': dict(
        title='Colonial 1-2 storey shops with verandahs (1900s-1940s)',
        W=3.6, H=3.8, Hg=4.2, hc=1.4,
        materials=dict(wall=['plaster_smooth', '#e6dcc2'], trim=['plaster_smooth', '#f0ebe0'],
                       accent=['plaster_smooth', '#8a5a42'], plinth=['concrete_weathered', '#8f8676'],
                       frame=['window_frame_aluminium', '#3f4b3e'], glass=['window_glass', '#5a6468'],
                       metal=['window_frame_aluminium', '#2f3336'], roof_sheet=['corrugated_weathered', None],
                       sign=['metal_panel', '#e8e4d8']),
        palette=dict(wall=['#e6dcc2', '#e2d596', '#d9c7a8', '#efe9dc', '#e8cfa6', '#c9d6c4'],
                     trim=['#f0ebe0', '#8a5a42', '#e9e1cd'], accent=['#8a5a42', '#3f5f4a', '#6b4a3a'],
                     frame=['#3f4b3e', '#f0ece2', '#5a3a2e']),
        glass_cells=[4, 5, 6, 7], room_depth=1.3,
    ),
    'deco': dict(
        title='1930s-50s rendered commercial block (Art Deco / Moderne)',
        W=3.4, H=3.4, Hg=4.2, hc=1.2,
        materials=dict(wall=['plaster_smooth', '#e3d7bb'], trim=['plaster_smooth', '#d2c6aa'],
                       accent=['concrete_painted', '#9d998f'], plinth=['granite_dark_tiles', None],
                       frame=['window_frame_aluminium', '#e9e5da'], glass=['window_glass', '#58666d'],
                       metal=['window_frame_aluminium', '#3a3d40'], sign=['metal_panel', '#e8e4d8']),
        palette=dict(wall=['#e3d7bb', '#e8dfc8', '#d9c9a0', '#c29a4e', '#dcd7cd'], trim=['#d2c6aa', '#bfb59e', '#f0ebdf']),
        glass_cells=[1, 0, 2, 7], room_depth=1.4,
    ),
    'avenues': dict(
        title='Avenues flat block with balconies (1950s-70s residential)',
        W=3.6, H=3.0, Hg=3.2, hc=0.9,
        materials=dict(wall=['plaster_smooth', '#ebe6dc'], trim=['concrete_painted', '#dcd7cd'],
                       accent=['concrete_painted', '#4f7fa8'], plinth=['concrete_weathered', '#8f8676'],
                       frame=['window_frame_aluminium', '#e9e7e1'], glass=['window_glass', '#5a6468'],
                       metal=['window_frame_aluminium', '#35393c'], sign=['metal_panel', '#e8e4d8']),
        palette=dict(wall=['#ebe6dc', '#e6dcc8', '#dfe0dc', '#e9d9b8'], accent=['#4f7fa8', '#ebe6dc', '#7a9b7e', '#c9a36b', '#b75d45']),
        glass_cells=[2, 3, 2, 3], room_depth=1.2,
    ),
}

COMMON_MATS = dict(wall=['concrete_painted', '#d9d5cc'], trim=['concrete_painted', '#d9d5cc'], accent=['concrete_painted', '#bfb8aa'],
                   plinth=['granite_dark_tiles', None], frame=['window_frame_aluminium', '#c9cbcc'],
                   glass=['window_glass', '#5f7480'], glass_spandrel=['window_glass', '#3d5a78'],
                   metal=['window_frame_aluminium', '#3a3d40'], roof_sheet=['corrugated_weathered', None],
                   sign=['metal_panel', '#e8e4d8'])

SLAB = 0.25  # floor slab edge band height


def M(kind, floor, w, h, sx, sy, lod1='quad', notes='', **kw):
    d = dict(kind=kind, floor=floor, w=w, h=h, stretch=dict(x=list(sx), y=list(sy)), lod1=lod1, notes=notes, anchors={})
    d.update(kw)
    return d


def sx_bay(W):
    return (round(W * 0.85, 2), round(W * 1.25, 2))


SY_MID = (2.9, 4.2)
SY_GROUND = (3.4, 5.6)


# ------------------------------------------------------------------------------------------------------------
# shared generators
# ------------------------------------------------------------------------------------------------------------
def blank(W, H, role='wall', band=None, floor='middle'):
    mb = MB()
    if band:  # (role, height, projection)
        brole, bh, bp = band
        mb.box(0, W, -bp, 0, 0, bh, brole, 'ftd')
        mb.wall(0, W, bh, H, 0, [], role)
    else:
        mb.wall(0, W, 0, H, 0, [], role)
    return mb, M('blank', floor, W, H, (0.3, 12.0), SY_MID if floor == 'middle' else SY_GROUND,
                 notes='solid wall bay (end walls, party walls, fill)')


def pier(W, H, role='wall', proj=0.0, floor='any'):
    mb = MB()
    if proj > 0:
        mb.box(0, W, -proj, 0, 0, H, role, 'f')
    else:
        mb.wall(0, W, 0, H, 0, [], role)
    return mb, M('pier', floor, W, H, (0.15, 2.4), (2.6, 5.6), notes='narrow filler strip to absorb leftover edge length')


def corner(a, H, role='wall', proj=0.05, quoins=None, floor='any'):
    """Outer 90-degree corner pier. Origin = the footprint corner; x runs along the OUTGOING wall, the incoming
    wall runs along +y (into the building in this local frame), so the pier covers x, y in [-proj, a]."""
    mb = MB()
    mb.box(-proj, a, -proj, a, 0, H, role, 'fl')
    if quoins:
        qrole, qh, qp = quoins
        z = 0.0
        k = 0
        y0 = -proj - qp
        while z + qh <= H + 1e-6:
            lf, ls = (a + 0.22, a) if k % 2 == 0 else (a, a + 0.22)
            mb.box(y0, lf, y0, -proj, z + 0.012, z + qh - 0.012, qrole, 'ftdr')
            mb.box(y0, -proj, -proj, ls, z + 0.012, z + qh - 0.012, qrole, 'ltdb')
            z += qh
            k += 1
    return mb, M('corner', floor, a, H, (0.2, 1.5), (2.6, 5.6), lod1='box',
                 notes='outer corner pier for ~90 deg corners: origin at the footprint corner, x along the outgoing '
                       'wall; covers x,z in [-proj, a] (the incoming wall lies along -x of the outgoing wall normal)')


def shop(W, Hg, P, closed=False):
    """Ground-floor shopfront under a canopy: side piers, stall riser, display glass + glazed door, shutter box,
    fascia sign board."""
    mb = MB()
    pw = P.get('pier_w', 0.35)
    prole = P.get('pier_role', 'trim')
    fascia_h = 0.6
    box_h = 0.45
    top = Hg - fascia_h - box_h  # top of the glazing
    rec = 0.18
    # piers (half at each edge)
    mb.box(0, pw / 2, -0.02, 0, 0, Hg, prole, 'fr')
    mb.box(W - pw / 2, W, -0.02, 0, 0, Hg, prole, 'fl')
    x0, x1 = pw / 2, W - pw / 2
    # fascia sign board (UV 0..1 over the board) and shutter box
    fz0 = Hg - fascia_h
    pts = [(x0, -0.06, fz0), (x1, -0.06, fz0), (x1, -0.06, Hg), (x0, -0.06, Hg)]
    mb.poly(pts, 'sign', uv0=[(0, 0), (1, 0), (1, 1), (0, 1)])
    mb.box(x0, x1, -0.06, 0, fz0, Hg, P.get('fascia_role', 'trim'), 'td')
    mb.box(x0, x1, -0.03, rec - 0.02, top, fz0, 'metal', 'fd')  # shutter box / bulkhead
    # door on the right third, display window with riser on the left
    dx = x1 - min(1.1, (x1 - x0) * 0.36)
    riser = 0.45
    mb.box(x0, dx, rec - 0.05, rec, 0, riser, 'plinth', 'ft')
    mb.reveal(x0, x1, 0, top, 0, rec, prole, 'lr')
    room = (0, W, 0, Hg, 0)
    mb.glass(x0, dx, riser, top, rec, room)
    mb.frame(x0, dx, riser, top, rec, 0.06, 0.06, mull=[(x0 + dx) / 2], trans=[top - 0.55], role='frame')
    mb.glass(dx, x1, 0.0, top, rec + 0.08, room)
    mb.frame(dx, x1, 0.0, top, rec + 0.08, 0.07, 0.05, mull=[], trans=[top - 0.55, 1.0], role='frame')
    mb.reveal(dx, x1, 0, top, rec, rec + 0.08, 'frame', 'l')
    meta = M('ground', 'ground', W, Hg, sx_bay(W) if W < 4 else (W * 0.7, W * 1.3), SY_GROUND,
             notes='shopfront: display window + glazed door, riser, shutter box, fascia sign board (role sign, UV 0..1)')
    meta['anchors'] = dict(shutter=[[x0, rec - 0.08, 0.0, x1, top]], sign=[[x0, -0.06, fz0, x1, Hg]], canopy=[[0, 0, Hg - 0.55]])
    meta['interior'] = 'shop'
    return mb, meta


def entrance(W, Hg, P):
    """Office / flats entrance: granite surround, recessed glazed double doors with sidelights and transom,
    two steps and a small flat canopy."""
    mb = MB()
    srole = P.get('surround_role', 'plinth')
    sw = 0.45
    top = Hg - 0.9
    rec = 0.6
    wrole = P.get('wall_role', 'wall')
    # wall above + surround
    mb.wall(0, W, top + 0.3, Hg, 0, [], wrole)
    mb.box(0, sw, -0.06, 0, 0, top + 0.3, srole, 'fr')
    mb.box(W - sw, W, -0.06, 0, 0, top + 0.3, srole, 'fl')
    mb.box(sw, W - sw, -0.06, 0, top, top + 0.3, srole, 'fd')
    mb.reveal(sw, W - sw, 0.3, top, 0, rec, srole, 'lrt')
    room = (0, W, 0, Hg, 0)
    mb.glass(sw, W - sw, 0.3, top, rec, room)
    cx = W / 2
    mb.frame(sw, W - sw, 0.3, top, rec, 0.06, 0.06, mull=[cx - 0.8, cx, cx + 0.8], trans=[top - 0.6], role='frame')
    # threshold / steps (inside the recess and one outside)
    mb.box(sw, W - sw, -0.0, rec, 0, 0.3, 'plinth', 'ft')
    mb.box(sw - 0.2, W - sw + 0.2, -0.45, 0.0, 0, 0.15, 'plinth', 'ftlr')
    # canopy slab over the door
    mb.box(sw - 0.3, W - sw + 0.3, -1.3, 0, top + 0.3, top + 0.45, P.get('canopy_role', 'trim'), 'ftdlr')
    meta = M('ground', 'ground', W, Hg, (W * 0.8, W * 1.4), SY_GROUND, notes='entrance bay: recessed glazed doors, steps, canopy')
    meta['interior'] = 'lobby'
    return mb, meta


def lobby(W, Hg, P):
    """Tall glazed lobby bay (towers): granite plinth, mullions every 1.5 m, transom."""
    mb = MB()
    room = (0, W, 0, Hg, 0)
    mb.box(0, W, -0.08, 0, 0, 0.35, 'plinth', 'ft')
    mb.box(0, W, -0.1, 0, Hg - 0.5, Hg, P.get('band_role', 'wall'), 'fd')
    mb.glass(0, W, 0.35, Hg - 0.5, 0.12, room)
    mb.reveal(0, W, 0.35, Hg - 0.5, 0, 0.12, 'plinth', 'tb')
    mb.frame(0, W, 0.35, Hg - 0.5, 0.12, 0.05, 0.07, mull=[W / 2], trans=[Hg - 1.4], role='frame', outer=False)
    mb.box(0, 0.04, 0.05, 0.12, 0.35, Hg - 0.5, 'frame', 'f')
    mb.box(W - 0.04, W, 0.05, 0.12, 0.35, Hg - 0.5, 'frame', 'f')
    meta = M('ground', 'ground', W, Hg, sx_bay(W), SY_GROUND, notes='full-height glazed lobby / showroom bay')
    meta['interior'] = 'lobby'
    return mb, meta


def ground_blank(W, Hg, role='wall', plinth=True):
    mb = MB()
    if plinth:
        mb.box(0, W, -0.03, 0, 0, 0.5, 'plinth', 'ft')
        mb.wall(0, W, 0.5, Hg, 0, [], role)
    else:
        mb.wall(0, W, 0, Hg, 0, [], role)
    return mb, M('blank', 'ground', W, Hg, (0.3, 12.0), SY_GROUND, notes='blank ground-floor wall with plinth')


def canopy(W=3.0, D=2.4):
    """Cantilevered concrete canopy over the pavement (first-floor level), fascia face = sign board."""
    mb = MB()
    t = 0.18
    fh = 0.55
    mb.box(0, W, -D, 0, 0, t, 'trim', 'td')
    mb.box(0, W, -D - 0.08, -D + 0.04, -0.2, fh - 0.2, 'trim', 'tdblr')
    pts = [(0, -D - 0.08, -0.2), (W, -D - 0.08, -0.2), (W, -D - 0.08, fh - 0.2), (0, -D - 0.08, fh - 0.2)]
    mb.poly(pts, 'sign', uv0=[(0, 0), (1, 0), (1, 1), (0, 1)])
    mb.box(0, W, -D + 0.04, 0, -0.02, 0.0, 'trim', 'd')
    meta = M('attachment', 'ground', W, fh, (0.5, 8.0), (1.0, 1.0), lod1='self',
             notes='cantilevered pavement canopy; origin = underside of the slab at the wall (place at canopy anchor z); '
                   'fascia front face is role sign (UV 0..1 per module)')
    meta['depth'] = D
    return mb, meta


def cap_generic(W, hc, P):
    """Roof-line cap: slab band, parapet, coping."""
    mb = MB()
    band = P.get('band', ('trim', SLAB, 0.06))
    brole, bh, bp = band
    mb.box(0, W, -bp, 0, 0, bh, brole, 'ftd')
    prole = P.get('parapet_role', 'wall')
    mb.wall(0, W, bh, hc - 0.08, 0, [], prole)
    mb.box(0, W, -0.05, 0.25, hc - 0.08, hc, P.get('coping_role', 'trim'), 'ftdb')
    return mb, M('cap', 'top', W, hc, sx_bay(W) if W < 5 else (0.5, 12), (0.5, 2.0), notes='roof-line parapet with coping')


# ------------------------------------------------------------------------------------------------------------
# ribbon: 1950s-70s office slab with ribbon windows and continuous spandrel bands
# ------------------------------------------------------------------------------------------------------------
def ribbon_bay(W, H, hood=False):
    mb = MB()
    sill = 1.0
    gy = 0.10
    mb.box(0, W, -0.06, 0, 0, SLAB, 'trim', 'ftd')
    # spandrel: two precast panels per bay with dark joints
    j = 0.008
    for a, b in [(0, W / 2), (W / 2, W)]:
        mb.box(a + j, b - j, -0.03, 0, SLAB, sill, 'accent', 'flr')
    for a, b in [(0, j), (W / 2 - j, W / 2 + j), (W - j, W)]:
        mb.poly([(a, 0, SLAB), (b, 0, SLAB), (b, 0, sill), (a, 0, sill)], 'metal')
    # aluminium sill flashing
    mb.box(0, W, -0.07, gy, sill - 0.03, sill + 0.012, 'frame', 'ft')
    room = (0, W, 0, H, 0)
    mb.glass(0, W, sill + 0.012, H, gy, room)
    mb.reveal(0, W, sill, H, 0, gy, 'trim', 'lrt')
    mb.frame(0, W, sill + 0.012, H, gy, 0.045, 0.05, mull=[W / 3, 2 * W / 3], trans=[H - 0.62], role='frame', outer=False)
    mb.box(0, 0.025, gy - 0.05, gy, sill + 0.012, H, 'frame', 'fr')
    mb.box(W - 0.025, W, gy - 0.05, gy, sill + 0.012, H, 'frame', 'fl')
    mb.box(0, W, gy - 0.05, gy, H - 0.05, H, 'frame', 'fd')
    anchors = dict(ac=[[W / 6, gy, sill + 0.012], [5 * W / 6, gy, sill + 0.012]])
    if hood:
        # sloped precast sunshade hood over the window (Batanai Gardens, Mapillary Jason Moyo slabs)
        sec = [(0.0, H), (-0.62, H - 0.34), (-0.62, H - 0.42), (0.0, H - 0.12)]
        for i in range(len(sec)):
            (ya, za), (yb, zb) = sec[i], sec[(i + 1) % len(sec)]
            mb.poly([(0, ya, za), (0, yb, zb), (W, yb, zb), (W, ya, za)][::-1], 'trim')
        mb.poly([(0, y, z) for y, z in sec][::-1], 'trim')
        mb.poly([(W, y, z) for y, z in sec], 'trim')
    meta = M('bay', 'middle', W, H, sx_bay(W), SY_MID,
             notes='ribbon window bay: spandrel panels (accent) under continuous aluminium ribbon glazing' +
                   (', sloped precast sunshade hood (role trim, like the slab band)' if hood else ''))
    meta['anchors'] = anchors
    meta['interior'] = 'office'
    return mb, meta


def ribbon_cap(W, hc):
    mb = MB()
    mb.box(0, W, -0.06, 0, 0, SLAB, 'trim', 'ftd')
    mb.box(0, W, -0.03, 0, SLAB, hc - 0.06, 'accent', 'f')
    mb.box(0, W, -0.07, 0.25, hc - 0.06, hc, 'trim', 'ftdb')
    return mb, M('cap', 'top', W, hc, sx_bay(W), (0.6, 2.0), notes='slab band + spandrel-coloured parapet + coping')


# ------------------------------------------------------------------------------------------------------------
# fins: vertical concrete fins (brise-soleil)
# ------------------------------------------------------------------------------------------------------------
def fins_bay(W, H, angled=False, cap=False):
    mb = MB()
    t = 0.16
    D = 0.6
    gy = 0.12
    sp = 0.95
    fx = [W / 4, 3 * W / 4]
    if not cap:
        mb.box(0, W, -0.02, 0, 0, sp, 'trim', 'f')
        mb.box(0, W, -0.02, gy, sp - 0.02, sp, 'trim', 't')
        room = (0, W, 0, H, 0)
        mb.glass(0, W, sp, H, gy, room)
        mb.reveal(0, W, sp, H, 0, gy, 'trim', 't')
        mullions = []
        for c in fx:
            mullions += [c - t / 2 - 0.02, c + t / 2 + 0.02]
        mb.frame(0, W, sp, H, gy, 0.045, 0.05, mull=[0.02, W - 0.02] + [m for m in mullions], trans=[H - 0.6], role='frame', outer=False)
        for c in fx:  # back of fins (between wall face and glass)
            mb.box(c - t / 2, c + t / 2, 0, gy - 0.05, sp, H, 'accent', 'lr')
    fz0, fz1 = (0, H) if not cap else (0, H - 0.3)
    for c in fx:
        if angled:
            off = 0.32
            base = [(c - t / 2, 0.0), (c + t / 2, 0.0), (c + t / 2 + off, -D + 0.05), (c - t / 2 + off, -D + 0.05)]
            mb.prism(base, fz0, fz1, 'accent', caps=True)
        else:
            mb.box(c - t / 2, c + t / 2, -D, 0, fz0, fz1, 'accent', 'flrd' + ('t' if cap else ''))
    if cap:
        mb.box(0, W, -0.02, 0, 0, SLAB, 'trim', 'f')
        mb.wall(0, W, SLAB, H, 0, [], 'wall')
        mb.box(0, W, -D - 0.05, 0.2, H - 0.3, H, 'accent', 'ftdb')
    meta = M('cap' if cap else 'bay', 'top' if cap else 'middle', W, H, sx_bay(W), (0.8, 2.0) if cap else SY_MID,
             notes=('cap: fins stop under a deep beam' if cap else
                    ('bay with two angled (sawtooth) fins' if angled else 'bay with two full-height fins 0.6 m deep')))
    if not cap:
        meta['anchors'] = dict(ac=[[W / 2, gy, sp]])
        meta['interior'] = 'office'
    return mb, meta


# ------------------------------------------------------------------------------------------------------------
# eggcrate: deep concrete sunshade grid
# ------------------------------------------------------------------------------------------------------------
def egg_bay(W, H, divided=False, cap=False, hc=1.1):
    mb = MB()
    D = 0.8
    st = 0.18
    ft = 0.2
    gy = 0.08
    if cap:
        H = hc
    mb.box(0, W, -D, 0, 0, st, 'trim', 'ftd')
    top = H if not cap else H - 0.2
    mb.box(0, ft / 2, -D, 0, st, top, 'wall', 'fr')
    mb.box(W - ft / 2, W, -D, 0, st, top, 'wall', 'fl')
    if divided:
        mb.box(W / 2 - 0.05, W / 2 + 0.05, -0.45, 0, st, top, 'wall', 'flr')
    if cap:
        mb.box(0, W, -D, 0.25, top, H, 'trim', 'ftdb')
        mb.wall(ft / 2, W - ft / 2, st, top, 0, [], 'accent')
        meta = M('cap', 'top', W, H, sx_bay(W), (0.6, 2.0), notes='egg-crate cap: last shelf, fins and top slab')
        return mb, meta
    sp = 0.95
    mb.wall(ft / 2, W - ft / 2, st, sp, 0, [], 'accent')
    room = (0, W, 0, H, 0)
    x0, x1 = ft / 2, W - ft / 2
    mb.glass(x0, x1, sp, H, gy, room)
    mb.reveal(x0, x1, sp, H, 0, gy, 'trim', 'lrtb', sill_role='frame')
    mb.frame(x0, x1, sp, H, gy, 0.045, 0.05, mull=[W / 3, 2 * W / 3] if not divided else [W / 2 - 0.08, W / 2 + 0.08],
             trans=[H - 0.65], role='frame')
    meta = M('bay', 'middle', W, H, sx_bay(W), SY_MID,
             notes='egg-crate bay: 0.8 m deep shelf + fins' + (' + central blade' if divided else ''))
    meta['anchors'] = dict(ac=[[W / 4, gy, sp]])
    meta['interior'] = 'office'
    return mb, meta


# ------------------------------------------------------------------------------------------------------------
# curtain wall
# ------------------------------------------------------------------------------------------------------------
def curtain_bay(W, H, cap=False, hc=1.5):
    mb = MB()
    if cap:
        H = hc
    sp = 1.0 if not cap else 0.6
    room = (0, W, 0, H, 0)
    mb.glass(0, W, 0, sp, 0, room, role='glass_spandrel')
    if not cap:
        mb.glass(0, W, sp, H, 0, room)
    for x, a, b in [(0, 0, 0.035), (W / 2, W / 2 - 0.035, W / 2 + 0.035), (W, W - 0.035, W)]:
        mb.box(a, b, -0.09, 0, 0, H if not cap else sp, 'frame', 'f' + ('l' if a > 0 else '') + ('r' if b < W else ''))
    for z in ([0.0, sp] if not cap else [0.0, sp]):
        mb.box(0, W, -0.05, 0, max(0, z - 0.025), z + 0.025, 'frame', 'ftd')
    if cap:
        mb.box(0, W, -0.15, 0.2, sp, H, 'wall', 'ftdb')
        mb.box(0, W, -0.2, -0.15, sp + 0.25, sp + 0.35, 'trim', 'ftd')
        return mb, M('cap', 'top', W, H, sx_bay(W), (0.8, 3.0), notes='curtain-wall crown: spandrel glass + granite coping band')
    meta = M('bay', 'middle', W, H, sx_bay(W), SY_MID, notes='stick curtain wall: vision glass over opaque spandrel glass, mullion caps')
    meta['interior'] = 'office'
    return mb, meta


def granite_pier(W, H, floor='middle'):
    mb = MB()
    mb.box(0, W, -0.15, 0, 0, H, 'wall', 'flr')
    mb.box(0, W, -0.155, -0.15, H - 0.012, H, 'trim', 'f')
    return mb, M('pier', floor, W, H, (0.5, 2.6), SY_MID if floor == 'middle' else SY_GROUND,
                 notes='granite-clad pier (1.2 m nominal): between curtain-wall runs, at ends')


# ------------------------------------------------------------------------------------------------------------
# glass-and-granite (1990s)
# ------------------------------------------------------------------------------------------------------------
def gg_bay(W, H, loggia=False):
    mb = MB()
    pw = 0.3
    sp = 1.05
    head = 0.3
    gy = 0.2 if not loggia else 1.4
    mb.box(0, pw, -0.1, 0, 0, H, 'wall', 'fr')
    mb.box(W - pw, W, -0.1, 0, 0, H, 'wall', 'fl')
    mb.box(pw, W - pw, -0.1, 0, H - head, H, 'wall', 'fd')
    mb.box(pw, W - pw, -0.105, -0.1, sp - 0.08, sp - 0.02, 'accent', 'f')
    room = (0, W, 0, H, 0)
    if not loggia:
        mb.box(pw, W - pw, -0.1, 0, 0, sp, 'wall', 'ft')
        mb.reveal(pw, W - pw, sp, H - head, 0, gy, 'wall', 'lrtb')
        mb.glass(pw, W - pw, sp, H - head, gy, room)
        mb.frame(pw, W - pw, sp, H - head, gy, 0.06, 0.06, mull=[W / 3, 2 * W / 3], trans=[], role='frame')
        meta = M('bay', 'middle', W, H, sx_bay(W), SY_MID, notes='granite piers + spandrel, recessed blue glass ribbon')
        meta['anchors'] = dict(ac=[[W / 2, gy, sp]])
    else:
        # balustrade + recessed gallery (setback balconies)
        mb.box(pw, W - pw, -0.1, 0.12, 0, sp, 'wall', 'ftb')
        mb.box(pw, W - pw, -0.13, -0.07, sp, sp + 0.05, 'metal', 'ftd')
        for k in range(1, 4):
            x = pw + (W - 2 * pw) * k / 4
            mb.box(x - 0.02, x + 0.02, -0.12, -0.08, sp + 0.05, sp + 0.45, 'metal', 'flr')
        mb.box(pw, W - pw, -0.13, -0.07, sp + 0.45, sp + 0.5, 'metal', 'ftd')
        mb.reveal(pw, W - pw, 0, H - head, 0, gy, 'wall', 'lrt', sill_role='plinth')
        mb.poly([(pw, 0.12, 0.0), (W - pw, 0.12, 0.0), (W - pw, gy, 0.0), (pw, gy, 0.0)], 'plinth')
        mb.glass(pw, W - pw, 0.0, H - head, gy, room)
        mb.frame(pw, W - pw, 0.0, H - head, gy, 0.06, 0.06, mull=[W / 3, 2 * W / 3], trans=[2.2], role='frame')
        meta = M('bay', 'middle', W, H, sx_bay(W), SY_MID, notes='recessed gallery (1.4 m) behind a granite balustrade + rail')
    meta['interior'] = 'office'
    return mb, meta


def gg_cap(W, hc):
    mb = MB()
    mb.box(0, W, -0.1, 0, 0, hc - 0.35, 'wall', 'f')
    mb.box(0, W, -0.14, 0, hc - 0.35, hc - 0.12, 'accent', 'ftd')
    mb.box(0, W, -0.1, 0.25, hc - 0.12, hc, 'wall', 'ftb')
    return mb, M('cap', 'top', W, hc, sx_bay(W), (0.6, 2.4), notes='granite parapet with dark band')


# ------------------------------------------------------------------------------------------------------------
# brick
# ------------------------------------------------------------------------------------------------------------
def brick_bay(W, H, variant='plain'):
    mb = MB()
    gy = 0.12
    z0, z1 = 0.9, 2.55
    wins = [(0.75, W - 0.75)] if variant != 'pair' else [(0.5, 1.45), (W - 1.45, W - 0.5)]
    holes = [(a, b, z0, z1 + 0.2) for a, b in wins]
    mb.wall(0, W, 0, H, 0, holes, 'wall')
    room = (0, W, 0, H, 0)
    for a, b in wins:
        mb.poly([(a, 0, z1), (b, 0, z1), (b, 0, z1 + 0.2), (a, 0, z1 + 0.2)], 'trim')  # lintel
        mb.reveal(a, b, z0, z1, 0, gy, 'wall', 'lrt')
        mb.reveal(a, b, z1, z1 + 0.2, 0, gy, 'trim', 't')
        mb.box(a, b, 0.0, gy, z1, z1 + 0.2, 'trim', 'd')
        mb.glass(a, b, z0, z1, gy, room)
        w = b - a
        mb.frame(a, b, z0, z1, gy, 0.045, 0.04, mull=[a + w / 3, a + 2 * w / 3] if w > 1.2 else [a + w / 2],
                 trans=[z0 + (z1 - z0) / 3, z0 + 2 * (z1 - z0) / 3], role='frame', bar=0.028)
        mb.box(a - 0.07, b + 0.07, -0.055, gy - 0.02, z0 - 0.07, z0, 'trim', 'ftlrd')  # precast sill
        if variant == 'surround':
            s = 0.12
            mb.box(a - s, a, -0.07, 0, z0, z1 + 0.2, 'trim', 'flr')
            mb.box(b, b + s, -0.07, 0, z0, z1 + 0.2, 'trim', 'flr')
            mb.box(a - s, b + s, -0.07, 0, z1 + 0.2, z1 + 0.2 + s, 'trim', 'ftd')
    meta = M('bay', 'middle', W, H, sx_bay(W), SY_MID,
             notes={'plain': 'punched window: white steel frame with glazing bars, concrete sill + lintel',
                    'surround': 'punched window with a projecting concrete surround',
                    'pair': 'two narrow punched windows'}[variant])
    meta['anchors'] = dict(ac=[[(wins[0][0] + wins[0][1]) / 2, gy, z0]], bars=[[a, 0.0, z0, b, z1] for a, b in wins])
    meta['interior'] = 'office'
    return mb, meta


def brick_cap(W, hc):
    mb = MB()
    mb.wall(0, W, 0, hc - 0.1, 0, [], 'wall')
    mb.box(0, W, -0.05, 0.25, hc - 0.1, hc, 'trim', 'ftdb')
    mb.box(0, W, -0.03, 0, 0.12, 0.3, 'trim', 'ftd')
    return mb, M('cap', 'top', W, hc, sx_bay(W), (0.5, 2.0), notes='brick parapet, concrete band + coping')


# ------------------------------------------------------------------------------------------------------------
# colonial
# ------------------------------------------------------------------------------------------------------------
def col_pilasters(mb, W, z0, z1, proj=0.07, pw=0.22, role='wall', capital=True):
    mb.box(0, pw, -proj, 0, z0, z1, role, 'fr')
    mb.box(W - pw, W, -proj, 0, z0, z1, role, 'fl')
    if capital:
        mb.box(0, pw + 0.06, -proj - 0.06, 0, z1 - 0.28, z1 - 0.12, 'trim', 'ftdr')
        mb.box(W - pw - 0.06, W, -proj - 0.06, 0, z1 - 0.28, z1 - 0.12, 'trim', 'ftdl')


def col_bay(W, H):
    mb = MB()
    gy = 0.14
    ww = 1.2
    a, b = (W - ww) / 2, (W + ww) / 2
    z0, z1 = 0.85, 3.05
    mb.box(0, W, -0.08, 0, 0, 0.25, 'trim', 'ftd')  # string course
    mb.wall(0, W, 0.25, H, 0, [(a, b, z0, z1)], 'wall')
    col_pilasters(mb, W, 0.25, H)
    s = 0.13
    mb.box(a - s, a, -0.05, 0, z0, z1, 'trim', 'flr')
    mb.box(b, b + s, -0.05, 0, z0, z1, 'trim', 'flr')
    mb.box(a - s - 0.08, b + s + 0.08, -0.16, 0, z1, z1 + 0.16, 'trim', 'ftdlr')  # hood mould / cornice
    mb.box(a - s - 0.04, b + s + 0.04, -0.09, gy - 0.02, z0 - 0.09, z0, 'trim', 'ftlrd')  # sill
    mb.reveal(a, b, z0, z1, 0, gy, 'wall', 'lrt')
    room = (0, W, 0, H, 0)
    mb.glass(a, b, z0, z1, gy, room)
    mid = (z0 + z1) / 2
    mb.frame(a, b, z0, z1, gy, 0.06, 0.05, mull=[W / 2], trans=[mid], role='frame')
    mb.frame(a + 0.06, b - 0.06, z0 + 0.06, z1 - 0.06, gy - 0.01, 0.0, 0.02, mull=[a + ww / 4, b - ww / 4],
             trans=[(z0 + mid) / 2, (mid + z1) / 2], role='frame', outer=False, bar=0.022)
    meta = M('bay', 'middle', W, H, sx_bay(W), (3.0, 4.6), notes='upper floor: tall sash window with moulded surround, pilasters')
    meta['anchors'] = dict(ac=[[W / 2 - 0.3, gy, z0]], bars=[[a, 0.0, z0, b, z1]])
    meta['interior'] = 'office'
    return mb, meta


def col_shop(W, Hg, arched=False):
    mb = MB()
    pw = 0.25
    rec = 0.14
    col_pilasters(mb, W, 0.3, Hg, proj=0.08, pw=pw, capital=True)
    mb.box(0, pw, -0.12, 0, 0, 0.3, 'plinth', 'ftr')
    mb.box(W - pw, W, -0.12, 0, 0, 0.3, 'plinth', 'ftl')
    room = (0, W, 0, Hg, 0)
    x0, x1 = pw, W - pw
    if not arched:
        fz0 = Hg - 0.75
        tz = fz0 - 0.5
        mb.poly([(x0, -0.03, fz0), (x1, -0.03, fz0), (x1, -0.03, Hg - 0.12), (x0, -0.03, Hg - 0.12)], 'sign',
                uv0=[(0, 0), (1, 0), (1, 1), (0, 1)])
        mb.box(x0, x1, -0.03, 0, fz0, Hg - 0.12, 'trim', 'd')
        mb.box(x0, x1, -0.12, 0, Hg - 0.12, Hg, 'trim', 'ftd')
        mb.box(x0, x1, rec - 0.04, rec, 0, 0.5, 'accent', 'ft')
        mb.reveal(x0, x1, 0, fz0, 0, rec, 'wall', 'lrt')
        mb.glass(x0, x1, 0.5, fz0, rec, room)
        mb.frame(x0, x1, 0.5, fz0, rec, 0.07, 0.07, mull=[x0 + (x1 - x0) / 3, x0 + 2 * (x1 - x0) / 3], trans=[tz], role='frame')
        n = 6
        mb.frame(x0 + 0.07, x1 - 0.07, tz, fz0 - 0.07, rec - 0.01, 0.0, 0.02,
                 mull=[x0 + (x1 - x0) * k / n for k in range(1, n)], role='frame', outer=False, bar=0.025)
        meta = M('ground', 'ground', W, Hg, sx_bay(W), SY_GROUND,
                 notes='colonial shopfront: pilasters, stall riser, display glass, small-pane transom lights, fascia (sign)')
        meta['anchors'] = dict(sign=[[x0, -0.03, fz0, x1, Hg - 0.12]], shutter=[[x0, rec - 0.08, 0.0, x1, fz0]], verandah=[[0, 0, Hg - 0.35]])
    else:
        # arched opening with burglar bars (Union Buildings / Kopje shops)
        aw = 2.3
        a, b = (W - aw) / 2, (W + aw) / 2
        r = aw / 2
        spring = Hg - 0.55 - r
        z0 = 0.55
        mb.wall(0, W, 0.3, spring, 0, [(a, b, z0, spring)], 'wall')
        mb.box(pw, W - pw, -0.03, 0, 0, 0.3, 'plinth', 'ft')
        mb.box(a, b, -0.03, 0, 0.3, z0, 'plinth', 'ft')
        # spandrels around the arch (fans from the corners)
        pts = arch_points(W / 2, spring, r, 12)
        top = Hg - 0.12
        left = [(x, z) for x, z in pts if x <= W / 2 + 1e-6]
        right = [(x, z) for x, z in pts if x >= W / 2 - 1e-6]
        poly_l = [(0, spring)] + [(a, spring)] + left[1:] + [(W / 2, top), (0, top)]
        mb.poly([(x, 0, z) for x, z in poly_l], 'wall')
        poly_r = [(W / 2, top)] + right + [(W, spring), (W, top)]
        poly_r = [(W / 2, top), (W / 2, spring + r)] + right[1:] + [(W, spring), (W, top)]
        mb.poly([(x, 0, z) for x, z in poly_r], 'wall')
        mb.box(pw, W - pw, -0.12, 0, Hg - 0.12, Hg, 'trim', 'ftd')
        mb.box(W / 2 - 0.13, W / 2 + 0.13, -0.07, 0, spring + r - 0.12, spring + r + 0.18, 'trim', 'flrtd')  # keystone
        # reveal of the arch + jambs
        mb.reveal(a, b, z0, spring, 0, rec, 'wall', 'lrb')
        for i in range(len(pts) - 1):
            (xa, za), (xb, zb) = pts[i], pts[i + 1]
            mb.poly([(xa, 0, za), (xa, rec, za), (xb, rec, zb), (xb, 0, zb)], 'wall')
        # glass (rectangle + fan)
        mb.glass(a, b, z0, spring, rec, room)
        fan = [(x, rec, z) for x, z in reversed(pts)]
        mb.poly(fan, 'glass', uv1=[(x / W, z / Hg) for x, _, z in fan])
        mb.frame(a, b, z0, spring, rec, 0.06, 0.05, mull=[W / 2], trans=[], role='frame')
        # burglar bars across the arch (steel, painted)
        yb = rec - 0.1
        nb = 9
        for k in range(1, nb):
            x = a + aw * k / nb
            zt = spring + math.sqrt(max(0.0, r * r - (x - W / 2) ** 2)) - 0.03
            mb.box(x - 0.012, x + 0.012, yb - 0.024, yb, z0, zt, 'metal', 'flr')
        for z in (z0 + 0.6, z0 + 1.3, spring):
            mb.box(a, b, yb - 0.03, yb + 0.005, z - 0.015, z + 0.015, 'metal', 'ftd')
        meta = M('ground', 'ground', W, Hg, sx_bay(W), SY_GROUND, notes='rendered ground bay with a round-arched window and burglar bars')
    meta['interior'] = 'shop'
    return mb, meta


def col_cap(W, hc, name=False):
    mb = MB()
    mb.box(0, W, -0.08, 0, 0, 0.12, 'trim', 'ftd')
    mb.box(0, W, -0.28, 0, 0.12, 0.3, 'trim', 'ftd')
    mb.box(0, W, -0.16, 0, 0.3, 0.38, 'trim', 'ftd')
    mb.wall(0, W, 0.38, hc - 0.14, 0, [], 'wall')
    mb.box(0, W, -0.08, 0.3, hc - 0.14, hc, 'trim', 'ftdb')
    if name:
        m = 0.25
        z0, z1 = 0.5, hc - 0.24
        mb.box(m, W - m, -0.05, 0, z0, z1, 'trim', 'tdlr')
        mb.poly([(m, -0.05, z0), (W - m, -0.05, z0), (W - m, -0.05, z1), (m, -0.05, z1)], 'sign', uv0=[(0, 0), (1, 0), (1, 1), (0, 1)])
    meta = M('cap', 'top', W, hc, sx_bay(W), (0.8, 2.4),
             notes='cornice + parapet' + (' with a raised name panel (role sign, UV 0..1)' if name else ''))
    if name:
        meta['anchors'] = dict(sign=[[0.25, -0.05, 0.5, W - 0.25, hc - 0.24]])
    return mb, meta


def verandah(W, D=2.8, Hv=3.9, drop=0.45):
    """Colonial verandah: corrugated-iron lean-to roof on cast-iron columns over the pavement.
    Origin at the wall, ground level; one column at x = 0 (add a last column at the run end)."""
    mb = MB()
    yb = -D
    zf = Hv - drop
    # roof sheet (sloping)
    mb.poly([(0, 0, Hv), (0, yb - 0.1, zf), (W, yb - 0.1, zf), (W, 0, Hv)], 'roof_sheet')
    mb.poly([(0, 0, Hv - 0.03), (W, 0, Hv - 0.03), (W, yb - 0.1, zf - 0.03), (0, yb - 0.1, zf - 0.03)], 'roof_sheet')
    # front beam / fascia and gutter
    mb.box(0, W, yb - 0.1, yb + 0.02, zf - 0.32, zf - 0.02, 'metal', 'ftdb')
    mb.box(0, W, yb - 0.16, yb - 0.08, zf - 0.08, zf + 0.02, 'metal', 'fd')
    # wall plate
    mb.box(0, W, -0.08, 0, Hv - 0.15, Hv, 'metal', 'fd')
    # cast-iron column at x = 0.06 (profile: base, fluted shaft, collar, capital)
    cx, cy = 0.07, yb + 0.02
    prof = [(0.13, 0.0), (0.13, 0.12), (0.1, 0.18), (0.075, 0.3), (0.06, 0.45), (0.055, zf - 0.75), (0.08, zf - 0.7),
            (0.06, zf - 0.62), (0.07, zf - 0.5), (0.13, zf - 0.36), (0.13, zf - 0.32)]
    mb.lathe(cx, cy, prof, 10, 'metal', cap_top=True)
    # lace brackets (flat decorative spandrels either side of the column head)
    for s in (1, -1):
        if s < 0:
            continue  # the neighbour module's column covers the left side; keep the right bracket only
        pts = [(cx + 0.05, cy, zf - 0.34), (cx + 0.75, cy, zf - 0.34), (cx + 0.05, cy, zf - 1.0)]
        mb.poly([(p[0], p[1] - 0.01, p[2]) for p in pts], 'metal')
        mb.poly([(p[0], p[1] + 0.01, p[2]) for p in pts][::-1], 'metal')
    meta = M('attachment', 'ground', W, Hv, (1.5, 4.5), (3.2, 4.6), lod1='self',
             notes='verandah bay over the pavement (depth 2.8 m): corrugated roof, fascia beam, cast-iron column at x=0; '
                   'add one extra verandah_post at the end of a run')
    meta['depth'] = D
    return mb, meta


def verandah_post(Hv=3.9, drop=0.45, D=2.8):
    mb = MB()
    zf = Hv - drop
    cx, cy = 0.0, -D + 0.02
    prof = [(0.13, 0.0), (0.13, 0.12), (0.1, 0.18), (0.075, 0.3), (0.06, 0.45), (0.055, zf - 0.75), (0.08, zf - 0.7),
            (0.06, zf - 0.62), (0.07, zf - 0.5), (0.13, zf - 0.36), (0.13, zf - 0.32)]
    mb.lathe(cx, cy, prof, 10, 'metal', cap_top=True)
    pts = [(cx - 0.05, cy, zf - 0.34), (cx - 0.75, cy, zf - 0.34), (cx - 0.05, cy, zf - 1.0)]
    mb.poly([(p[0], p[1] - 0.01, p[2]) for p in pts][::-1], 'metal')
    mb.poly([(p[0], p[1] + 0.01, p[2]) for p in pts], 'metal')
    return mb, M('attachment', 'ground', 0.0, zf, (0, 0), (3.2, 4.6), lod1='self',
                 notes='single cast-iron verandah column (end of a verandah run)')


# ------------------------------------------------------------------------------------------------------------
# deco (1930s-50s render)
# ------------------------------------------------------------------------------------------------------------
def deco_bay(W, H, pilaster=False):
    mb = MB()
    gy = 0.13
    a, b = 0.7, W - 0.7
    z0, z1 = 0.95, 2.5
    mb.box(0, W, -0.04, 0, 0, 0.14, 'trim', 'ftd')
    mb.wall(0, W, 0.14, H, 0, [(a, b, z0, z1)], 'wall')
    mb.reveal(a, b, z0, z1, 0, gy, 'wall', 'lrt')
    room = (0, W, 0, H, 0)
    mb.glass(a, b, z0, z1, gy, room)
    h = z1 - z0
    mb.frame(a, b, z0, z1, gy, 0.045, 0.04, mull=[W / 2], trans=[z0 + h / 3, z0 + 2 * h / 3], role='frame', bar=0.03)
    mb.box(a - 0.05, b + 0.05, -0.06, gy - 0.02, z0 - 0.06, z0, 'trim', 'ftlrd')
    mb.box(a - 0.3, b + 0.3, -0.38, 0, z1 + 0.1, z1 + 0.18, 'trim', 'ftdlr')  # eyebrow ledge
    if pilaster:
        mb.box(0, 0.18, -0.06, 0, 0.14, H, 'trim', 'fr')
        mb.box(W - 0.18, W, -0.06, 0, 0.14, H, 'trim', 'fl')
    meta = M('bay', 'middle', W, H, sx_bay(W), SY_MID,
             notes='rendered bay: steel window with horizontal glazing bars, eyebrow ledge' + (', pilaster strips' if pilaster else ''))
    meta['anchors'] = dict(ac=[[W / 2 + 0.45, gy, z0]], bars=[[a, 0.0, z0, b, z1]])
    meta['interior'] = 'office'
    return mb, meta


def deco_arcade(W, Hg, depth=3.0):
    """Ground-floor arcade: square piers on the building line, walkway, shopfront recessed `depth` m."""
    mb = MB()
    pw = 0.3
    beam = 0.6
    zs = Hg - beam
    mb.box(0, pw, 0, 0.6, 0, zs, 'wall', 'flrb')
    mb.box(W - pw, W, 0, 0.6, 0, zs, 'wall', 'flrb')
    mb.box(0, W, -0.05, 0, zs, Hg, 'wall', 'fd')
    mb.box(0, W, 0, depth, zs - 0.001, zs, 'trim', 'd')  # soffit
    # recessed shopfront at y = depth
    room = (0, W, 0, Hg, 0)
    y = depth
    mb.box(0.05, W - 0.05, y - 0.04, y, 0, 0.45, 'plinth', 'ft')
    mb.glass(0.05, W - 0.05, 0.45, zs - 0.4, y, room)
    mb.frame(0.05, W - 0.05, 0.45, zs - 0.4, y, 0.05, 0.05, mull=[W / 2], trans=[zs - 0.9], role='frame')
    mb.poly([(0.05, y - 0.02, zs - 0.4), (W - 0.05, y - 0.02, zs - 0.4), (W - 0.05, y - 0.02, zs), (0.05, y - 0.02, zs)], 'sign',
            uv0=[(0, 0), (1, 0), (1, 1), (0, 1)])
    mb.poly([(0.0, y, 0), (0.05, y, 0), (0.05, y, zs), (0.0, y, zs)], 'wall')
    mb.poly([(W - 0.05, y, 0), (W, y, 0), (W, y, zs), (W - 0.05, y, zs)], 'wall')
    meta = M('ground', 'ground', W, Hg, sx_bay(W), SY_GROUND, lod1='quad',
             notes='arcade bay: piers on the building line, shopfront recessed 3 m (close runs with arcade_end)')
    meta['anchors'] = dict(sign=[[0.05, y - 0.02, zs - 0.4, W - 0.05, zs]])
    meta['interior'] = 'shop'
    meta['recess'] = depth
    return mb, meta


def deco_arcade_end(Hg, depth=3.0):
    """Cheek wall closing an arcade run: a wall plane at x = 0 facing +x (into the arcade)."""
    mb = MB()
    zs = Hg - 0.6
    mb.poly([(0, 0.0, 0), (0, depth, 0), (0, depth, zs), (0, 0.0, zs)], 'wall')
    return mb, M('attachment', 'ground', 0.0, Hg, (0, 0), SY_GROUND, lod1='self',
                 notes='arcade run end: wall at x=0 facing +x; mirror (scale x -1) for the right-hand end')


def deco_cap(W, hc):
    mb = MB()
    mb.box(0, W, -0.05, 0, 0, 0.18, 'trim', 'ftd')
    mb.wall(0, W, 0.18, hc - 0.35, 0, [], 'wall')
    mb.box(0, W, -0.12, 0, hc - 0.35, hc - 0.27, 'trim', 'ftd')
    mb.box(0, W, -0.06, 0, hc - 0.27, hc - 0.12, 'trim', 'ftd')
    mb.box(0, W, -0.03, 0.25, hc - 0.12, hc, 'wall', 'ftb')
    return mb, M('cap', 'top', W, hc, sx_bay(W), (0.8, 2.4), notes='stepped Moderne parapet with banded cornice')


# ------------------------------------------------------------------------------------------------------------
# avenues (residential)
# ------------------------------------------------------------------------------------------------------------
def av_bay(W, H, kind='balcony'):
    mb = MB()
    gy = 0.12
    room = (0, W, 0, H, 0)
    if kind == 'loggia':
        rd = 1.2
        a, b = 0.2, W - 0.2
        mb.wall(0, W, 0, H, 0, [(a, b, 0.0, H - 0.3)], 'wall')
        mb.reveal(a, b, 0.0, H - 0.3, 0, rd, 'wall', 'lrt', sill_role='trim')
        mb.poly([(a, 0.0, 0.0), (b, 0.0, 0.0), (b, rd, 0.0), (a, rd, 0.0)], 'trim')
        d0, d1 = a + 0.2, a + 1.3
        w0, w1 = a + 1.7, b - 0.2
        mb.wall(a, b, 0, H - 0.3, rd, [(d0, d1, 0, 2.2), (w0, w1, 0.9, 2.2)], 'wall')
        mb.glass(d0, d1, 0, 2.2, rd + gy, room)
        mb.frame(d0, d1, 0, 2.2, rd + gy, 0.05, 0.05, mull=[(d0 + d1) / 2], role='frame')
        mb.glass(w0, w1, 0.9, 2.2, rd + gy, room)
        mb.frame(w0, w1, 0.9, 2.2, rd + gy, 0.05, 0.05, mull=[(w0 + w1) / 2], role='frame')
        mb.reveal(d0, d1, 0, 2.2, rd, rd + gy, 'wall', 'lrt')
        mb.reveal(w0, w1, 0.9, 2.2, rd, rd + gy, 'wall', 'lrtb')
        mb.box(a, b, -0.02, 0.1, 0, 1.0, 'accent', 'ftb')
        meta = M('bay', 'middle', W, H, sx_bay(W), (2.7, 3.6), notes='recessed loggia balcony (1.2 m) with solid parapet')
        meta['interior'] = 'residential'
        return mb, meta
    d0, d1 = 0.35, 1.45
    w0, w1 = 1.9, W - 0.35
    if kind == 'window':
        d0, d1 = None, None
        w0, w1 = (W - 1.5) / 2, (W + 1.5) / 2
    holes = [(w0, w1, 0.9, 2.25)] + ([(d0, d1, 0.0, 2.25)] if d0 is not None else [])
    mb.wall(0, W, 0, H, 0, holes, 'wall')
    mb.reveal(w0, w1, 0.9, 2.25, 0, gy, 'wall', 'lrt')
    mb.glass(w0, w1, 0.9, 2.25, gy, room)
    mb.frame(w0, w1, 0.9, 2.25, gy, 0.05, 0.045, mull=[(w0 + w1) / 2], trans=[1.9], role='frame')
    mb.box(w0 - 0.05, w1 + 0.05, -0.05, gy - 0.02, 0.84, 0.9, 'trim', 'ftlrd')
    anchors = dict(ac=[[w1 - 0.4, gy, 0.9]], bars=[[w0, 0.0, 0.9, w1, 2.25]])
    if d0 is not None:
        mb.reveal(d0, d1, 0.0, 2.25, 0, gy, 'wall', 'lrt')
        mb.glass(d0, d1, 0.0, 2.25, gy, room)
        mb.frame(d0, d1, 0.0, 2.25, gy, 0.05, 0.05, mull=[(d0 + d1) / 2], trans=[1.9], role='frame')
        bd = 1.25
        x0, x1 = 0.1, W - 0.1
        mb.box(x0, x1, -bd, 0, -0.02, 0.14, 'trim', 'ftdlr')
        if kind == 'balcony':
            t = 0.09
            mb.box(x0, x1, -bd, -bd + t, 0.14, 1.05, 'accent', 'fbtlr')
            mb.box(x0, x0 + t, -bd + t, 0, 0.14, 1.05, 'accent', 'lrt')
            mb.box(x1 - t, x1, -bd + t, 0, 0.14, 1.05, 'accent', 'lrt')
        else:  # steel tube railing
            mb.box(x0, x1, -bd, -bd + 0.05, 1.0, 1.05, 'metal', 'ftdb')
            mb.box(x0, x0 + 0.05, -bd, 0, 1.0, 1.05, 'metal', 'tdlr')
            mb.box(x1 - 0.05, x1, -bd, 0, 1.0, 1.05, 'metal', 'tdlr')
            n = 12
            for k in range(n + 1):
                x = x0 + 0.03 + (x1 - x0 - 0.06) * k / n
                mb.box(x - 0.012, x + 0.012, -bd + 0.01, -bd + 0.035, 0.14, 1.0, 'metal', 'flrb')
            for z in (0.45,):
                mb.box(x0, x1, -bd + 0.01, -bd + 0.04, z - 0.015, z + 0.015, 'metal', 'ftdb')
    meta = M('bay', 'middle', W, H, sx_bay(W), (2.7, 3.6),
             notes={'balcony': 'projecting balcony (1.25 m) with solid painted parapet (accent), door + window',
                    'rail': 'projecting balcony with steel tube railing, door + window',
                    'window': 'plain window bay (add burglar bars on low floors)'}[kind])
    meta['anchors'] = anchors
    meta['interior'] = 'residential'
    return mb, meta


def av_cap(W, hc):
    mb = MB()
    mb.box(0, W, -0.35, 0, 0, 0.2, 'trim', 'ftdlr')
    mb.wall(0, W, 0.2, hc - 0.06, 0, [], 'wall')
    mb.box(0, W, -0.04, 0.2, hc - 0.06, hc, 'trim', 'ftb')
    return mb, M('cap', 'top', W, hc, sx_bay(W), (0.5, 1.6), notes='thin roof-slab overhang + low parapet')


def av_entrance(W, Hg):
    mb = MB()
    gy = 0.15
    a, b = W / 2 - 0.8, W / 2 + 0.8
    mb.box(0, W, -0.03, 0, 0, 0.45, 'plinth', 'ft')
    mb.wall(0, W, 0.45, Hg, 0, [(a, b, 0.45, 2.45)], 'wall')
    mb.box(a, b, -0.03, gy, 0, 0.45, 'plinth', 'ft')
    mb.reveal(a, b, 0.45, 2.45, 0, gy, 'wall', 'lrt')
    room = (0, W, 0, Hg, 0)
    mb.glass(a, b, 0.45, 2.45, gy, room)
    mb.frame(a, b, 0.45, 2.45, gy, 0.06, 0.05, mull=[W / 2], trans=[2.0], role='frame')
    for i, (y0, z) in enumerate([(-0.9, 0.15), (-0.6, 0.3), (-0.3, 0.45)]):
        mb.box(a - 0.3, b + 0.3, y0, 0, z - 0.15, z, 'plinth', 'ftlr')
    mb.box(a - 0.6, b + 0.6, -1.4, 0, 2.6, 2.75, 'trim', 'ftdlr')
    meta = M('ground', 'ground', W, Hg, (W * 0.8, W * 1.4), (2.9, 4.6), notes='flats entrance: steps, glazed door, flat canopy')
    meta['interior'] = 'lobby'
    return mb, meta


# ------------------------------------------------------------------------------------------------------------
# module lists per type
# ------------------------------------------------------------------------------------------------------------
def build_type(t):
    T = TYPES[t]
    W, H, Hg, hc = T['W'], T['H'], T['Hg'], T['hc']
    mods = {}
    if t == 'ribbon':
        mods['bay'] = ribbon_bay(W, H)
        mods['bay_hood'] = ribbon_bay(W, H, hood=True)
        mods['cap'] = ribbon_cap(W, hc)
        mods['blank'] = blank(W, H, 'wall')
        mods['pier'] = pier(0.6, H, 'wall')
        mods['corner'] = corner(0.45, H, 'wall')
        P = dict(pier_role='trim')
        mods['shop'] = shop(W, Hg, P)
        mods['entrance'] = entrance(W * 1.2, Hg, dict(surround_role='plinth', wall_role='trim'))
        mods['ground_blank'] = ground_blank(W, Hg, 'wall')
    elif t == 'fins':
        mods['bay'] = fins_bay(W, H)
        mods['bay_angled'] = fins_bay(W, H, angled=True)
        mods['cap'] = fins_bay(W, hc, cap=True)
        mods['blank'] = blank(W, H, 'wall')
        mods['pier'] = pier(0.6, H, 'wall')
        mods['corner'] = corner(0.5, H, 'wall')
        mods['shop'] = shop(W, Hg, dict(pier_role='accent'))
        mods['entrance'] = entrance(W * 1.2, Hg, dict(surround_role='plinth', wall_role='wall'))
        mods['ground_blank'] = ground_blank(W, Hg, 'wall')
    elif t == 'eggcrate':
        mods['bay'] = egg_bay(W, H)
        mods['bay_divided'] = egg_bay(W, H, divided=True)
        mods['cap'] = egg_bay(W, H, cap=True, hc=hc)
        mods['blank'] = blank(W, H, 'wall')
        mods['pier'] = pier(0.6, H, 'wall')
        mods['corner'] = corner(0.4, H, 'wall', proj=0.8)
        mods['shop'] = shop(W, Hg, dict(pier_role='wall'))
        mods['entrance'] = entrance(W * 1.2, Hg, dict(surround_role='plinth', wall_role='wall'))
        mods['ground_blank'] = ground_blank(W, Hg, 'wall')
    elif t == 'curtain':
        mods['bay'] = curtain_bay(W, H)
        mods['cap'] = curtain_bay(W, H, cap=True, hc=hc)
        mods['pier'] = granite_pier(1.2, H)
        mods['blank'] = blank(W, H, 'wall')
        mods['corner'] = corner(0.9, H, 'wall', proj=0.15)
        mods['lobby'] = lobby(W, Hg, dict(band_role='wall'))
        mods['shop'] = shop(W, Hg, dict(pier_role='wall'))
        mods['entrance'] = entrance(W * 1.2, Hg, dict(surround_role='plinth', wall_role='wall'))
        mods['ground_pier'] = granite_pier(1.2, Hg, floor='ground')
    elif t == 'glassgranite':
        mods['bay'] = gg_bay(W, H)
        mods['bay_gallery'] = gg_bay(W, H, loggia=True)
        mods['cap'] = gg_cap(W, hc)
        mods['blank'] = blank(W, H, 'wall')
        mods['pier'] = pier(0.8, H, 'wall', proj=0.1)
        mods['corner'] = corner(0.6, H, 'wall', proj=0.1)
        mods['lobby'] = lobby(W, Hg, dict(band_role='wall'))
        mods['shop'] = shop(W, Hg, dict(pier_role='wall'))
        mods['entrance'] = entrance(W * 1.2, Hg, dict(surround_role='accent', wall_role='wall'))
    elif t == 'brick':
        mods['bay'] = brick_bay(W, H)
        mods['bay_surround'] = brick_bay(W, H, 'surround')
        mods['bay_pair'] = brick_bay(W, H, 'pair')
        mods['cap'] = brick_cap(W, hc)
        mods['blank'] = blank(W, H, 'wall')
        mods['pier'] = pier(0.6, H, 'trim', proj=0.04)
        mods['corner'] = corner(0.5, H, 'trim', proj=0.04)
        mods['shop'] = shop(W, Hg, dict(pier_role='trim'))
        mods['entrance'] = entrance(W * 1.2, Hg, dict(surround_role='trim', wall_role='wall'))
        mods['ground_blank'] = ground_blank(W, Hg, 'wall')
    elif t == 'colonial':
        mods['bay'] = col_bay(W, H)
        mods['shop'] = col_shop(W, Hg)
        mods['shop_arched'] = col_shop(W, Hg, arched=True)
        mods['cap'] = col_cap(W, hc)
        mods['cap_name'] = col_cap(W, hc, name=True)
        mods['blank'] = blank(W, H, 'wall', band=('trim', 0.25, 0.08))
        mods['ground_blank'] = ground_blank(W, Hg, 'wall')
        mods['pier'] = pier(0.5, H, 'wall')
        mods['corner'] = corner(0.35, H, 'wall', proj=0.08, quoins=('trim', 0.35, 0.04))
        mods['verandah'] = verandah(W)
        mods['verandah_post'] = verandah_post()
    elif t == 'deco':
        mods['bay'] = deco_bay(W, H)
        mods['bay_pilaster'] = deco_bay(W, H, pilaster=True)
        mods['cap'] = deco_cap(W, hc)
        mods['blank'] = blank(W, H, 'wall', band=('trim', 0.14, 0.04))
        mods['pier'] = pier(0.6, H, 'wall')
        mods['corner'] = corner(0.4, H, 'trim', proj=0.06)
        mods['arcade'] = deco_arcade(W, Hg)
        mods['arcade_end'] = deco_arcade_end(Hg)
        mods['shop'] = shop(W, Hg, dict(pier_role='wall'))
        mods['entrance'] = entrance(W * 1.2, Hg, dict(surround_role='plinth', wall_role='wall'))
    elif t == 'avenues':
        mods['bay_balcony'] = av_bay(W, H, 'balcony')
        mods['bay_rail'] = av_bay(W, H, 'rail')
        mods['bay_window'] = av_bay(W, H, 'window')
        mods['bay_loggia'] = av_bay(W, H, 'loggia')
        mods['cap'] = av_cap(W, hc)
        mods['blank'] = blank(W, H, 'wall')
        mods['pier'] = pier(0.6, H, 'wall')
        mods['corner'] = corner(0.35, H, 'wall', proj=0.03)
        mods['entrance'] = av_entrance(W, Hg)
        gw, gm = av_bay(W, Hg, 'window')
        gm['floor'] = 'ground'
        gm['kind'] = 'ground'
        gm['stretch']['y'] = [2.9, 4.6]
        mods['ground_window'] = (gw, gm)
        mods['shop'] = shop(W, Hg + 0.8, dict(pier_role='wall'))
    return mods


def types_json():
    d = {t: dict(title=T['title'], W=T['W'], H=T['H'], Hg=T['Hg'], hc=T['hc'], materials=T['materials'], palette=T['palette'],
                 glass_cells=T['glass_cells'], room_depth=T['room_depth'], rules=RULES[t]) for t, T in TYPES.items()}
    d['__common__'] = dict(materials=COMMON_MATS)
    return d


# Layout rules per type: which modules go where (the builder picks by weight; see kit.json "rules")
RULES = {
    'ribbon': dict(middle={'bay': 6, 'bay_hood': 0}, middle_alt={'bay_hood': 1}, ground={'shop': 6, 'entrance': 1, 'ground_blank': 0.5},
                   top='cap', end_wall='blank', corner='corner', canopy=0.8, attachments=dict(ac=0.28, bars=0.0, pipe=18)),
    'fins': dict(middle={'bay': 1}, middle_alt={'bay_angled': 1}, ground={'shop': 6, 'entrance': 1, 'ground_blank': 0.5},
                 top='cap', end_wall='blank', corner='corner', canopy=0.7, attachments=dict(ac=0.12, pipe=20)),
    'eggcrate': dict(middle={'bay': 3, 'bay_divided': 1}, ground={'shop': 6, 'entrance': 1}, top='cap', end_wall='blank',
                     corner='corner', canopy=0.7, attachments=dict(ac=0.1, pipe=0)),
    'curtain': dict(middle={'bay': 1}, ground={'lobby': 3, 'shop': 2, 'entrance': 1}, top='cap', end_wall='pier',
                    corner='corner', pier_every=4, canopy=0.2, attachments=dict(ac=0.0, pipe=0)),
    'glassgranite': dict(middle={'bay': 4, 'bay_gallery': 1}, ground={'lobby': 2, 'shop': 3, 'entrance': 1}, top='cap',
                         end_wall='blank', corner='corner', canopy=0.3, attachments=dict(ac=0.04, pipe=0)),
    'brick': dict(middle={'bay': 5, 'bay_surround': 1, 'bay_pair': 1}, ground={'shop': 6, 'entrance': 1, 'ground_blank': 0.5},
                  top='cap', end_wall='blank', corner='corner', canopy=0.8, attachments=dict(ac=0.3, bars=0.15, pipe=16)),
    'colonial': dict(middle={'bay': 1}, ground={'shop': 5, 'shop_arched': 1.5, 'ground_blank': 0.3}, top='cap',
                     top_centre='cap_name', end_wall='blank', corner='corner', verandah=0.75, canopy=0.0,
                     attachments=dict(ac=0.1, bars=0.35, pipe=12)),
    'deco': dict(middle={'bay': 4, 'bay_pilaster': 1}, ground={'shop': 4, 'arcade': 3, 'entrance': 1}, top='cap', end_wall='blank',
                 corner='corner', canopy=0.5, attachments=dict(ac=0.25, bars=0.1, pipe=14)),
    'avenues': dict(middle={'bay_balcony': 3, 'bay_rail': 2, 'bay_window': 2, 'bay_loggia': 1}, ground={'ground_window': 4, 'entrance': 1},
                    top='cap', end_wall='blank', corner='corner', canopy=0.0, attachments=dict(ac=0.15, bars=0.6, pipe=14)),
}
