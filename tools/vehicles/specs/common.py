"""Detail helpers shared by the vehicle specs (lights, plates, mirrors, wipers, interiors, panel lines)."""
import math

from mathutils import Vector

import textures as T
import vkit


def uv(key):
    return T.LAMP_CELLS[key]


def ellipse(rx, ry, n=12, cx=0.0, cy=0.0):
    return [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rect(w, h, cx=0.0, cy=0.0):
    return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]


def rrect(w, h, r, n=3, cx=0.0, cy=0.0):
    """Rounded rectangle outline."""
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    pts = []
    for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ccx, ccy = cx + qx * (w / 2 - r), cy + qy * (h / 2 - r)
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((ccx + r * math.cos(a), ccy + r * math.sin(a)))
    return pts


def plate(ctx, where, center, *, w=0.52, h=0.113, yaw=0.0, pitch=0.0, mb=None, offset=0.012):
    """Number plate (Zimbabwe 520 x 113 mm), flat, on a thin black backing."""
    x, y, z = center
    # both frames run 'a' towards the viewer's left, so flip u to keep the text readable
    ok = ctx.patch(where, (x, y, z), rect(w, h), 'plate', yaw=yaw, pitch=pitch, offset=offset, rings=1, flat=1.0,
                   uv_rect=(1, 0, 0, 1), depth=0.01, side_mat='trim', mb=mb)
    return ok


def mirrors(ctx, y, z, x_out, *, size=(0.1, 0.2, 0.13), mat='paint', glass='chrome', arm=0.06, mb=None):
    """Car door mirrors: rounded housing, mirror glass facing back, short arm to the door."""
    mb = mb or ctx.mb
    if ctx.lod >= 1:
        for sd in (1, -1):
            vkit.box(mb, (sd * (x_out - size[1] / 2), y, z), (size[1], size[0], size[2]), mat)
        return
    for sd in (1, -1):
        sx, sw, sz = size
        cx = sd * (x_out - sw / 2)
        vkit.rounded_box(mb, (cx, y, z), (sw, sx, sz), min(0.045, sx * 0.48), mat, n=2)
        vkit.box(mb, (cx, y - sx / 2 - 0.002, z), (sw * 0.84, 0.004, sz * 0.78), glass)
        vkit.box(mb, (sd * (x_out - sw - arm / 2 + 0.02), y + 0.01, z - sz * 0.22), (arm + 0.04, sx * 0.55, 0.05), 'trim')


def truck_mirrors(ctx, y, z, x_base, *, reach=0.22, h=0.32, w=0.2, mb=None):
    """Big van/bus/truck mirrors on tube arms."""
    mb = mb or ctx.mb
    for sd in (1, -1):
        xb = sd * x_base
        xm = sd * (x_base + reach)
        if ctx.lod == 0:
            vkit.sweep(mb, [(xb, y, z), (xm, y + 0.03, z + 0.02), (xm, y + 0.03, z + 0.12)],
                       vkit.circle_profile(0.011, 5), 'trim', caps=True)
        vkit.box(mb, (xm, y + 0.03, z + 0.12 + h / 2), (w, 0.05, h), 'trim')
        if ctx.lod == 0:
            vkit.box(mb, (xm, y + 0.03 - 0.027, z + 0.12 + h / 2), (w * 0.86, 0.004, h * 0.9), 'chrome')


def wipers(ctx, s, y=None, spans=((0.28, 0.58), (-0.22, 0.5)), mb=None, pitch=0.0):
    """Wiper blades lying along the bottom of the windscreen (projected from above onto the glass)."""
    if ctx.lod >= 1:
        return
    y = (s.Y_COWL - 0.07) if y is None else y
    for x0, L in spans:
        pts = [(x0 - L * t, y + 0.03 * t) for t in (0, 0.33, 0.66, 1.0)]
        ctx.strip('top', (0, 0, 5), pts, 0.014, 'trim', offset=0.01, thick=0.012, mb=mb)


def side_repeaters(ctx, y, z, mb=None):
    if ctx.lod >= 1:
        return
    ctx.patch('right', (1.0, y, z), ellipse(0.03, 0.012, 8), 'indicator', mirror=True, offset=0.004, rings=1,
              uv_rect=uv('indicator'), mb=mb)


def exhaust(ctx, x, y, z, r=0.028, length=0.16, mb=None):
    mb = mb or ctx.mb
    if ctx.lod >= 1:
        return
    vkit.cylinder(mb, (x, y, z), 'y', r, length, 'chrome', segs=8)


def interior(ctx, *, y_dash, y_back, x_half, z_floor, z_dash, z_seat=0.52, rows=(), rhd=True, z_head=None,
             wheel_y=None, headliner=True, dash_depth=0.35, head_span=None, mb=None):
    """Dark interior silhouettes seen through the glass: floor, headliner, dashboard, seats, wheel."""
    mb = mb or ctx.mb
    cy = (y_dash + y_back) / 2
    L = y_dash - y_back
    if ctx.lod >= 1:
        vkit.box(mb, (0, cy, (z_floor + z_seat + 0.3) / 2), (x_half * 1.9, L * 0.95, z_seat + 0.3 - z_floor), 'interior')
        return
    zh = z_head if z_head is not None else z_dash + 0.45
    vkit.box(mb, (0, cy, z_floor + 0.01), (x_half * 2, L, 0.02), 'interior')
    if headliner:
        h0, h1 = head_span if head_span else (y_back, y_dash)
        vkit.box(mb, (0, (h0 + h1) / 2, zh), (x_half * 1.7, h1 - h0, 0.02), 'interior')
    vkit.box(mb, (0, y_dash - dash_depth / 2, z_dash - 0.1), (x_half * 1.95, dash_depth, 0.2), 'interior')
    vkit.box(mb, (0, y_dash - dash_depth - 0.15, z_dash - 0.3), (0.24, 0.3, 0.28), 'interior')
    sx = 0.36 * (1 if rhd else -1) * min(1.0, x_half / 0.7)
    wy = wheel_y if wheel_y is not None else y_dash - dash_depth - 0.08
    ring = [(sx + 0.18 * math.cos(a), wy - 0.05 * math.sin(a), z_dash + 0.02 + 0.17 * math.sin(a))
            for a in [2 * math.pi * i / 10 for i in range(10)]]
    vkit.sweep(mb, ring, vkit.circle_profile(0.016, 4), 'interior', closed_path=True, caps=False)
    for (ys, kind) in rows:
        seats(mb, ys, kind, x_half, z_seat)


def seats(mb, ys, kind, x_half, z_seat, width=None):
    if kind == 'pair':
        for sd in (1, -1):
            sxx = sd * x_half * 0.5
            vkit.box(mb, (sxx, ys - 0.25, z_seat - 0.06), (0.5, 0.5, 0.14), 'interior')
            a = 0.22
            vkit.oriented_box(mb, (sxx, ys - 0.52, z_seat + 0.27), Vector((1, 0, 0)), Vector((0, math.cos(a), math.sin(a))),
                              Vector((0, -math.sin(a), math.cos(a))), (0.48, 0.12, 0.6), 'interior')
            vkit.box(mb, (sxx, ys - 0.6, z_seat + 0.66), (0.26, 0.1, 0.17), 'interior')
        return
    wb = width or x_half * 1.9
    xc = 0.0
    if kind.startswith('side'):
        # 'side_r:w' bench of width w hugging one side
        sd = 1 if kind[5] == 'r' else -1
        wb = float(kind.split(':')[1])
        xc = sd * (x_half - wb / 2)
    vkit.box(mb, (xc, ys - 0.23, z_seat - 0.06), (wb, 0.46, 0.13), 'interior')
    a = 0.18
    vkit.oriented_box(mb, (xc, ys - 0.48, z_seat + 0.25), Vector((1, 0, 0)), Vector((0, math.cos(a), math.sin(a))),
                      Vector((0, -math.sin(a), math.cos(a))), (wb, 0.1, 0.56), 'interior')
    n = max(1, round(wb / 0.45))
    for i in range(n):
        xx = xc - wb / 2 + wb * (i + 0.5) / n
        vkit.box(mb, (xx, ys - 0.53, z_seat + 0.6), (0.24, 0.09, 0.15), 'interior')


# ---------------------------------------------------------------------------------------------------
# saloon / hatch helpers
# ---------------------------------------------------------------------------------------------------

def saloon_rules(s, *, black_b=True, frames=True, back_glass=True):
    y0, y1 = s.Y_B
    r = [
        dict(mat='trim', k0=0, k1=0),
        dict(mat='glass', y0=s.Y_GLASS_END, y1=s.Y_COWL, k0=5, k1=5, tag='inset'),
    ]
    if black_b:
        r.append(dict(mat='trim', y0=y0, y1=y1, k0=5, k1=5, tag='inset'))
    else:
        r.append(dict(mat='paint', y0=y0, y1=y1, k0=5, k1=5))
    if frames:
        r.append(dict(mat='trim', y0=s.Y_GLASS_END - 0.02, y1=s.Y_HEADER + 0.02, k0=6, k1=6))
    r.append(dict(mat='glass', y0=s.Y_HEADER, y1=s.Y_COWL, k0=7, k1=8, tag='inset'))
    if back_glass:
        r.append(dict(mat='glass', y0=s.Y_DECK, y1=s.Y_ROOFR, k0=7, k1=8, tag='inset'))
    r += [dict(mat='trim', k0=-1, cap='front', zmax=0.3), dict(mat='trim', k0=-1, cap='rear', zmax=0.35)]
    return r


def saloon_panel_lines(s, cv, *, fuel_side=-1, four_door=True, boot=True):
    yf, yr = s.LENGTH / 2, -s.LENGTH / 2
    yb0, yb1 = s.Y_B
    af, ar = s.AXLE_F, s.AXLE_R
    R = s.TYRE_R + s.ARCH_GAP
    # front door
    y_fd = s.Y_COWL - 0.01
    cv.line([(y_fd, 1.7), (y_fd, 4.9)])
    cv.line([(yb1 + 0.012, 1.7), (yb1 + 0.012, 4.9)])
    if four_door:
        cv.line([(yb0 - 0.012, 1.7), (yb0 - 0.012, 4.9)])
        yre = s.Y_GLASS_END - 0.03
        cv.line([(yre, 4.9), (yre + 0.02, 3.6), (ar + R + 0.06, 3.0), (ar + R + 0.02, 2.5)])
        cv.line([(ar + R + 0.02, 1.9), (ar + R + 0.02, 2.5)])
    cv.line([(y_fd, 1.75), (yb0 - 0.012 if four_door else yb1, 1.75)])
    if four_door:
        cv.line([(yb0 - 0.012, 1.75), (ar + R + 0.02, 1.75)])
    # handles
    cv.handle(yb1 + 0.2, 4.25)
    if four_door:
        cv.handle(s.Y_GLASS_END + 0.3, 4.3)
    # bonnet
    cv.line([(yf - 0.12, 6.1), (af, 6.05), (s.Y_COWL + 0.03, 6.0)])
    cv.line([(s.Y_COWL + 0.03, 6.0), (s.Y_COWL + 0.035, 8.99)])
    # front bumper / wing joint
    cv.line([(yf - 0.34, 5.2), (af + R + 0.12, 4.2), (af + R + 0.03, 3.0)])
    if boot:
        cv.line([(s.Y_DECK - 0.03, 6.05), (s.Y_DECK - 0.03, 8.99)])
        cv.line([(s.Y_DECK - 0.03, 6.05), (yr + 0.1, 6.1)])
        # rear bumper joint
        cv.line([(ar - R - 0.1, 3.0), (yr + 0.32, 4.3)])
    # fuel door
    cv.rect(ar - 0.08 - 0.17, ar - 0.08, 4.0, 4.55, sides=(fuel_side,), outline=90)


def saloon_interior(ctx, s, *, rows=None, z_seat=0.5):
    rows = rows if rows is not None else [(s.Y_COWL - 0.62, 'pair'), (s.Y_B[0] - 0.45, 'bench')]
    interior(ctx, y_dash=s.Y_COWL - 0.02, y_back=s.Y_DECK + 0.12, x_half=0.7, z_floor=0.3, z_dash=0.93,
             z_seat=z_seat, rows=rows, z_head=s.ROOF_Z - 0.06, head_span=(s.Y_ROOFR + 0.06, s.Y_HEADER - 0.06))


def cargo_box(mb, c, size, cell, r=0.06, lod=0):
    """Rounded box with planar UVs into a livery/cargo texture cell (sacks, bags, tarps)."""
    u0, v0, u1, v1 = cell
    cm = vkit.MB()
    vkit.rounded_box(cm, c, size, r, 'livery', n=2 if lod == 0 else 1)
    for f in cm.bm.faces:
        for loop in f.loops:
            p = loop.vert.co
            fu = ((p.x - c[0]) / size[0] + 0.5 + (p.z - c[2]) / size[2] * 0.3) % 1.0
            fv = ((p.y - c[1]) / size[1] + 0.5) % 1.0
            loop[cm.uv].uv = (u0 + (u1 - u0) * (0.05 + 0.9 * fu), v0 + (v1 - v0) * (0.05 + 0.9 * fv))
    mb.add_bm(cm.bm)


def arch_flares(ctx, s, *, width=0.07, thick=0.035, mat='trim', x_out=None, a0=-8, a1=188, mb=None):
    """Wheel-arch flares (off-roaders): swept rectangle around each arch opening on both sides."""
    mb = mb or ctx.mb
    n = 14 if ctx.lod == 0 else 5
    for (ay, R, zc, depth) in s.arches():
        for sd in (1, -1):
            path = []
            for i in range(n + 1):
                a = math.radians(a0 + (a1 - a0) * i / n)
                y = ay + (R + width * 0.35) * math.cos(a)
                z = zc + (R + width * 0.35) * math.sin(a)
                loc, nor = ctx.side_point(y, z, sd)
                x = (loc.x if loc is not None else sd * s.W) + sd * thick * 0.4
                path.append((x, y, z))
            prof = [(-width / 2, -thick / 2), (width / 2, -thick / 2), (width / 2, thick / 2), (-width / 2, thick / 2)]
            # profile axes: a = across the arch (in the y-z plane), b = outward (x)
            vkit.sweep(mb, path, [(a, b) for a, b in prof], mat, up=Vector((sd, 0, 0)))


def side_steps(ctx, s, *, z=0.42, x_in=None, x_out=None, mb=None):
    mb = mb or ctx.mb
    af, ar = s.AXLE_F, s.AXLE_R
    R = s.TYRE_R + s.ARCH_GAP
    x_out = x_out or s.W + 0.03
    x_in = x_in or s.W - 0.12
    for sd in (1, -1):
        vkit.box(mb, (sd * (x_in + x_out) / 2, (af - R - 0.05 + ar + R + 0.05) / 2, z),
                 (x_out - x_in, (af - R - 0.05) - (ar + R + 0.05), 0.05), 'trim')
        if ctx.lod == 0:
            vkit.box(mb, (sd * (x_out - 0.006), (af - R - 0.05 + ar + R + 0.05) / 2, z + 0.012),
                     (0.012, (af - R - 0.05) - (ar + R + 0.05), 0.02), 'chrome')


def sign_box(mb, c, size, uv_face, uv_side, uv_top, mat='livery', taper=0.85):
    """Roof sign / light-bar housing: tapered box whose faces are UV-mapped to atlas cells.
    size = (x, y, z); front (+y) and back faces use uv_face (back mirrored so text reads), sides uv_side."""
    cx, cy, cz = c
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    tx, ty = hx * taper, hy * taper
    b = [Vector((cx - hx, cy - hy, cz - hz)), Vector((cx + hx, cy - hy, cz - hz)), Vector((cx + hx, cy + hy, cz - hz)), Vector((cx - hx, cy + hy, cz - hz))]
    t = [Vector((cx - tx, cy - ty, cz + hz)), Vector((cx + tx, cy - ty, cz + hz)), Vector((cx + tx, cy + ty, cz + hz)), Vector((cx - tx, cy + ty, cz + hz))]

    def r(cell, flip=False):
        u0, v0, u1, v1 = cell
        if flip:
            u0, u1 = u1, u0
        return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    # front (+y): viewer's left is +x -> u runs from +x to -x
    mb.face([b[2], b[3], t[3], t[2]], mat, r(uv_face), facing=(0, 1, 0))
    mb.face([b[0], b[1], t[1], t[0]], mat, r(uv_face), facing=(0, -1, 0))
    mb.face([b[1], b[2], t[2], t[1]], mat, r(uv_side), facing=(1, 0, 0))
    mb.face([b[3], b[0], t[0], t[3]], mat, r(uv_side), facing=(-1, 0, 0))
    mb.face([t[0], t[1], t[2], t[3]], mat, r(uv_top), facing=(0, 0, 1))
    mb.face([b[3], b[2], b[1], b[0]], 'trim', facing=(0, 0, -1))


def plate_quad(mb, center, facing, w=0.52, h=0.113, backing=True):
    """Free-standing number plate (for parts not on the lofted shell: bumpers, truck/bus rear bars).
    facing: +1 = front (+y), -1 = rear (-y)."""
    x, y, z = center
    s = facing
    P = [Vector((x - w / 2, y, z - h / 2)), Vector((x + w / 2, y, z - h / 2)), Vector((x + w / 2, y, z + h / 2)), Vector((x - w / 2, y, z + h / 2))]
    # viewer's left is +x at the front, -x at the rear
    uvs = [(1, 0), (0, 0), (0, 1), (1, 1)] if s > 0 else [(0, 0), (1, 0), (1, 1), (0, 1)]
    mb.face(P, 'plate', uvs, facing=(0, s, 0))
    if backing:
        vkit.box(mb, (x, y - s * 0.006, z), (w + 0.02, 0.01, h + 0.02), 'trim')


def uv_box(mb, c, size, cells, mat='livery', segs=(1, 1, 1)):
    """Axis-aligned box with each face mapped to an atlas cell: cells = dict(right, left, front, rear, top,
    bottom) -> (u0, v0, u1, v1) or None (face uses 'trim'). Text on the sides reads correctly from outside."""
    cx, cy, cz = c
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2

    def quad(p0, p1, p2, p3, cell, facing, flip=False):
        if cell is None:
            mb.face([p0, p1, p2, p3], 'trim', facing=facing)
            return
        u0, v0, u1, v1 = cell
        if flip:
            u0, u1 = u1, u0
        mb.face([p0, p1, p2, p3], mat, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], facing=facing)
    V = Vector
    # right side (+x): u runs rear -> front
    quad(V((cx + hx, cy - hy, cz - hz)), V((cx + hx, cy + hy, cz - hz)), V((cx + hx, cy + hy, cz + hz)), V((cx + hx, cy - hy, cz + hz)),
         cells.get('right'), (1, 0, 0))
    # left side (-x): u runs front -> rear
    quad(V((cx - hx, cy + hy, cz - hz)), V((cx - hx, cy - hy, cz - hz)), V((cx - hx, cy - hy, cz + hz)), V((cx - hx, cy + hy, cz + hz)),
         cells.get('left'), (-1, 0, 0))
    # front (+y): u runs +x -> -x
    quad(V((cx + hx, cy + hy, cz - hz)), V((cx - hx, cy + hy, cz - hz)), V((cx - hx, cy + hy, cz + hz)), V((cx + hx, cy + hy, cz + hz)),
         cells.get('front'), (0, 1, 0))
    # rear (-y): u runs -x -> +x
    quad(V((cx - hx, cy - hy, cz - hz)), V((cx + hx, cy - hy, cz - hz)), V((cx + hx, cy - hy, cz + hz)), V((cx - hx, cy - hy, cz + hz)),
         cells.get('rear'), (0, -1, 0))
    quad(V((cx - hx, cy - hy, cz + hz)), V((cx + hx, cy - hy, cz + hz)), V((cx + hx, cy + hy, cz + hz)), V((cx - hx, cy + hy, cz + hz)),
         cells.get('top'), (0, 0, 1))
    quad(V((cx - hx, cy + hy, cz - hz)), V((cx + hx, cy + hy, cz - hz)), V((cx + hx, cy - hy, cz - hz)), V((cx - hx, cy - hy, cz - hz)),
         cells.get('bottom'), (0, 0, -1))


def mudguard(mb, x_in, x_out, y, z, R, a0=0, a1=180, n=8, mat='trim'):
    """Half-round mudguard sheet over a wheel (outside surface faces up/out)."""
    rows = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        rows.append([Vector((x_in, y + R * math.cos(a), z + R * math.sin(a))), Vector((x_out, y + R * math.cos(a), z + R * math.sin(a)))])
    mb.grid(rows, mat, facing=lambda c: Vector((0, c.y - y, c.z - z)))
