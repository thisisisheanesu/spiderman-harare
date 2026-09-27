"""ZUPCO city bus: a Chinese-built (Yutong/FAW class) 11.5 m high-floor single-decker in the 2019+ white fleet
livery with blue and gold (approx), doors on the left (kerb) side, LED destination displays.
Dimensions: L 11.5 m, W 2.5 m, H 3.25 m, wheelbase 5.8 m, 295/80R22.5 (r 0.522 m), dual rear wheels."""
import vkit
from vkit import edit, sec

import liveries
from . import common as C
from .base import Base

LAY = liveries.bus_layout()


def flip_u(c):
    return (c[2], c[1], c[0], c[3])


def subtract(span, holes, pad=0.0, min_len=0.15):
    """Interval span (lo, hi) minus holes [(lo, hi)] -> list of (hi, lo) pieces (front to rear)."""
    pieces = [span]
    for h0, h1 in holes:
        h0, h1 = h0 - pad, h1 + pad
        nxt = []
        for p0, p1 in pieces:
            if h1 <= p0 or h0 >= p1:
                nxt.append((p0, p1))
                continue
            if h0 > p0:
                nxt.append((p0, h0))
            if h1 < p1:
                nxt.append((h1, p1))
        pieces = nxt
    return [(p1, p0) for p0, p1 in pieces if p1 - p0 > min_len]


class Bus(Base):
    NAME = 'bus_zupco'
    TITLE = 'ZUPCO city bus'
    REAL = 'Yutong ZK6118 / FAW CA6110 class 11.5 m single-deck bus as run by ZUPCO (2019+)'
    LENGTH = 11.5
    WIDTH = 2.5
    HEIGHT = 3.25
    WHEELBASE = 5.8
    TRACK_F = 2.05
    TRACK_R = 1.86
    TYRE_R = 0.522
    TYRE_W = 0.295
    RIM_R = 0.286
    FRONT_OVERHANG = 2.5
    WHEEL_STYLE = 'truck'
    REAR_DUAL = True
    ARCH_GAP = 0.07
    ARCH_RAISE = 0.03
    ARCH_DEPTH = 0.85
    STEER_MAX_DEG = 42
    PLATE = 'ADB 1147'
    INDICATORS = [('rear', (1.1, -5.75, 1.72), 20, 0.14, 0.12)]
    PREVIEW_PAINT = '#f3f3f0'
    PAINTS = ['#f3f3f0']
    GRIME = 0.35
    DS = {0: 0.14, 1: 0.6}
    TOGGLES = {'livery_stripes': {'group': 'livery_stripes', 'default': True, 'preview': True},
               **{f'dest_{i}': {'group': 'dest', 'default': i == 0, 'preview': i == 0} for i in range(6)}}
    yf, yr = 5.75, -5.75
    Y_COWL = 5.75 - 0.1
    Y_HEADER = 5.75 - 0.62
    Z_BELT = 1.62
    Z_WTOP = 2.75
    DOORS = [(3.9, 5.02), (-0.6, 0.5)]
    PILLARS = [4.3, 3.0, 1.7, 0.45, -0.85, -2.2, -3.55, -4.9]

    @property
    def BREAKS(self):
        b = [self.Y_COWL, self.Y_HEADER, self.yr + 0.6, self.yf - 0.2]
        for a, c in self.DOORS:
            b += [a, c]
        for p in self.PILLARS:
            b += [p - 0.05, p + 0.05]
        return b

    @property
    def RULES(self):
        r = [dict(mat='trim', k0=0, k1=0),
             dict(mat='glass', y0=self.yr + 0.6, y1=self.Y_HEADER, k0=5, k1=5, tag='inset')]
        for p in self.PILLARS:
            r.append(dict(mat='trim', y0=p - 0.05, y1=p + 0.05, k0=5, k1=5, tag='inset'))
        r += [dict(mat='trim', y0=self.Y_HEADER, y1=9, k0=5, k1=6, tag='inset'),
              dict(mat='glass', y0=self.Y_HEADER, y1=self.Y_COWL, k0=7, k1=8, tag='inset')]
        for a, c in self.DOORS:
            r.append(dict(mat='glass', y0=a, y1=c, k0=3, k1=5, side=-1, tag='inset'))
            r.append(dict(mat='trim', y0=a, y1=c, k0=1, k1=2, side=-1))
        r += [dict(mat='trim', k0=-1, cap='front', zmax=0.62), dict(mat='trim', k0=-1, cap='rear', zmax=0.62),
              dict(mat='trim', y0=self.yf - 0.2, y1=9, k0=0, k1=3, zmax=0.62)]
        return r

    def body(self):
        W = self.W
        yf, yr = self.yf, self.yr
        zb = 0.42

        def mid(y, w=W):
            s = sec(y, W=w, zb=zb, zbelt=self.Z_BELT, zmax=1.0, top=('glass', self.Z_WTOP, w - 0.015, 3.25), tuck=0.015, rb=0.05)
            return edit(s, k7=(w - 0.05, 3.03), k8=(w - 0.35, 3.235), k9=(0.0, 3.25))
        S = [
            edit(sec(yr, W=1.21, zb=0.45, zbelt=1.6, zmax=1.0, top=('glass', 2.72, 1.19, 3.17), tuck=0.015, rb=0.05),
                 k7=(1.15, 2.98), k8=(0.88, 3.16), k9=(0.0, 3.17)),
            mid(yr + 0.14),
            mid(0.0),
            mid(self.Y_HEADER),
            sec(self.Y_COWL, W=1.24, zb=zb, zbelt=1.08, zmax=0.75, top=('deck', 1.1, 0.975, 0.94, 0.5), rb=0.05),
            sec(yf, W=1.22, zb=0.44, zbelt=1.02, zmax=0.7, top=('deck', 1.04, 0.975, 0.94, 0.5), rb=0.05,
                dy={0: -0.03, 1: -0.03, 2: -0.01, 3: 0.0, 4: -0.07, 5: -0.07, 6: -0.07, 7: -0.07, 8: -0.07, 9: -0.07}),
        ]
        return vkit.Body(S, round_front=0.16, round_rear=0.14, front_bulge=0.03, rear_bulge=0.015)

    def paint(self, cv):
        yf, yr = self.yf, self.yr
        # skirt panels and service hatches
        for y in (yf - 1.2, 2.3, 1.3, -1.2, -1.9, -3.3, -4.4, yr + 0.5):
            cv.line([(y, 1.9), (y, 3.6)])
        cv.line([(yf - 0.2, 1.9), (yr + 0.14, 1.9)])
        cv.line([(yf - 0.2, 3.7), (yr + 0.14, 3.7)])
        for a, c in self.DOORS:
            cv.rect(a - 0.02, c + 0.02, 1.0, 5.1, sides=(-1,), outline=80)
        cv.cap_line([(-1.0, 1.55), (1.0, 1.55)], 'rear')

    def livery(self, path):
        liveries.bus(path)

    def details(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        rings = 2 if lod == 0 else 1
        # front: lamp clusters low in the corners, black lower grille, badge, plate
        ctx.patch('front', (0.93, yf, 0.73), C.rrect(0.42, 0.16, 0.04), 'light_front', mirror=True, yaw=10, offset=0.007,
                  rings=rings, uv_rect=C.uv('head_modern'), depth=0.012, side_mat='trim')
        ctx.patch('front', (1.1, yf, 0.93), C.rect(0.16, 0.06), 'indicator', mirror=True, yaw=35, offset=0.006, rings=1,
                  uv_rect=C.uv('indicator'))
        ctx.patch('front', (0, yf, 0.75), C.rect(1.2, 0.24), 'trim', offset=0.004, rings=1)
        if lod == 0:
            for dz in (-0.06, 0.0, 0.06):
                ctx.strip('front', (0, yf, 0.75 + dz), [(-0.58, 0), (0.58, 0)], 0.02, 'chrome', offset=0.008)
        C.plate(ctx, 'front', (0, yf, 0.52))
        # rear: back window, engine grille, lamp strips, plate
        ctx.patch('rear', (0, yr, 2.42), C.rrect(2.0, 0.62, 0.08), 'interior', offset=0.003, rings=1)
        ctx.patch('rear', (0, yr, 2.42), C.rrect(2.0, 0.62, 0.08), 'glass', offset=0.007, rings=1, bezel=('trim', 0.03))
        ctx.patch('rear', (0, yr, 1.15), C.rect(1.5, 0.55), 'livery', offset=0.005, rings=1, uv_rect=LAY['engine'])
        ctx.patch('rear', (1.1, yr, 1.2), C.rect(0.14, 0.8), 'light_rear', yaw=20, mirror=True, offset=0.007, rings=rings,
                  uv_rect=C.uv('tail'), depth=0.012, side_mat='trim')
        C.plate(ctx, 'rear', (0, yr, 0.75))
        if lod == 0:
            C.truck_mirrors(ctx, yf - 0.12, 2.35, 1.2, reach=0.18, h=0.36, w=0.2)
            C.wipers(ctx, self, y=self.Y_COWL - 0.05, spans=((0.6, 0.95), (-0.35, 0.9)))
            C.side_repeaters(ctx, y=yf - 0.5, z=1.0)
            # marker lamps along the roof edge
            for y in (4.0, 1.5, -1.0, -3.5):
                ctx.patch('right', (3, y, 2.95), C.rect(0.06, 0.03), 'indicator', mirror=True, offset=0.005, rings=1,
                          uv_rect=C.uv('indicator'))
        # interior: dash, driver, 2+2 rows
        rows = []
        y = self.Y_HEADER - 1.25
        while y > yr + 0.9:
            if not any(a - 0.2 < y < c + 0.6 for a, c in self.DOORS):
                rows.append((y, 'side_r:0.95'))
                rows.append((y, 'side_l:0.95'))
            y -= 0.8
        if lod == 0:
            C.interior(ctx, y_dash=self.Y_COWL - 0.1, y_back=yr + 0.3, x_half=1.15, z_floor=1.12, z_dash=1.55, z_seat=1.55,
                       rows=rows + [(self.Y_COWL - 0.75, 'side_r:0.55')], z_head=3.0, dash_depth=0.4,
                       head_span=(yr + 0.3, self.Y_HEADER - 0.3), wheel_y=self.Y_COWL - 0.55)
        else:
            C.interior(ctx, y_dash=self.Y_COWL - 0.1, y_back=yr + 0.3, x_half=1.15, z_floor=1.12, z_dash=1.55, z_seat=1.55)
        self._roof(ctx)
        self._livery(ctx)

    def _roof(self, ctx):
        """Roof-top air-con pod, two escape hatches and a roof seam: the bus is mostly seen from above."""
        mb = ctx.mb
        lod = ctx.lod
        z = 3.25
        vkit.rounded_box(mb, (0, 0.6, z + 0.09), (1.7, 2.6, 0.22), 0.25, 'paint', n=3 if lod == 0 else 1)
        vkit.box(mb, (0, 0.6, z + 0.205), (1.3, 2.2, 0.01), 'trim')
        if lod == 0:
            for y in (-0.2, 0.6, 1.4):
                vkit.box(mb, (0, y, z + 0.212), (1.1, 0.5, 0.01), 'chrome')
            for y in (-2.8, 3.4):
                vkit.box(mb, (0, y, z + 0.03), (0.72, 0.72, 0.06), 'trim')
                vkit.box(mb, (0, y, z + 0.065), (0.64, 0.64, 0.02), 'paint')

    def _livery(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        af, ar = self.AXLE_F, self.AXLE_R
        R = self.TYRE_R + self.ARCH_GAP + 0.05
        mb = ctx.tog('livery_stripes')
        band, sw = LAY['band'], LAY['swoosh']
        for where, sd in (('right', 1), ('left', -1)):
            spans = [(yf - 0.15, af + R), (af - R, ar + R), (ar - R, yr + 0.12)]
            for a0, a1 in spans:
                for s0, s1 in subtract((min(a0, a1), max(a0, a1)), self.DOORS if sd < 0 else [], pad=0.03):
                    ctx.strip(where, (sd * 3, 0, 0), [(s0, 0.62), (s1, 0.62)], 0.34, 'livery', offset=0.005, mb=mb,
                              uv_u=(band[0], band[2]) if sd > 0 else (band[2], band[0]), uv_v=(band[1], band[3]))
            ctx.strip(where, (sd * 3, 0, 0), [(yf - 0.4, 1.34), (yr + 0.3, 1.34)] if sd > 0 else [(-0.7, 1.34), (yr + 0.3, 1.34)],
                      0.2, 'livery', offset=0.005, mb=mb, uv_u=(sw[0], sw[2]) if sd > 0 else (sw[2], sw[0]), uv_v=(sw[1], sw[3]))
        # permanent lettering on the body
        z = LAY['zupco']
        ctx.patch('right', (3, -4.25, 1.05), C.rect(1.9, 0.46), 'livery', offset=0.006, rings=1, uv_rect=z)
        ctx.patch('left', (-3, -4.25, 1.05), C.rect(1.9, 0.46), 'livery', offset=0.006, rings=1, uv_rect=flip_u(z))
        f = LAY['zupco_full']
        ctx.patch('right', (3, 0.0, 2.88), C.rect(4.4, 0.13), 'livery', offset=0.005, rings=1, uv_rect=f)
        ctx.patch('left', (-3, 0.0, 2.88), C.rect(4.4, 0.13), 'livery', offset=0.005, rings=1, uv_rect=flip_u(f))
        fl = LAY['fleet']
        ctx.patch('right', (3, 2.2, 1.05), C.rect(0.45, 0.2), 'livery', offset=0.006, rings=1, uv_rect=fl)
        ctx.patch('front', (-0.75, yf, 1.02), C.rect(0.3, 0.13), 'livery', offset=0.006, rings=1, uv_rect=flip_u(fl))
        lg = LAY['logo']
        ctx.patch('front', (0, yf, 0.98), C.ellipse(0.1, 0.1, 14), 'livery', offset=0.006, rings=1, uv_rect=flip_u(lg))
        # destination displays: top of the windscreen + rear window + kerb side
        for i in range(6):
            mb = ctx.tog(f'dest_{i}')
            d = LAY[f'dest_{i}']
            ctx.patch('front', (0, yf, 2.86), C.rect(1.7, 0.2), 'livery', offset=0.006, rings=1, uv_rect=flip_u(d), mb=mb)
            ctx.patch('rear', (0, yr, 2.62), C.rect(1.2, 0.14), 'livery', offset=0.012, rings=1, uv_rect=flip_u(d), mb=mb)
            ctx.patch('left', (-3, 3.4, 2.55), C.rect(1.0, 0.16), 'livery', offset=0.012, rings=1, uv_rect=flip_u(d), mb=mb)


SPEC = Bus()
