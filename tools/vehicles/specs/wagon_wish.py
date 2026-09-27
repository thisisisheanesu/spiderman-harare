"""Toyota Wish (AE10, 2003-2009) compact MPV / wagon - a staple of Harare family and taxi use.
Dimensions: L 4.56 m, W 1.695 m, H 1.59 m, wheelbase 2.75 m, track 1.48/1.475 m, 195/65R15 (r 0.317 m)."""
import vkit
from vkit import sec

from . import common as C
from .base import Base


class Wish(Base):
    NAME = 'wagon_wish'
    TITLE = 'Toyota Wish (AE10) compact MPV'
    REAL = 'Toyota Wish AE10 (2003-2009)'
    LENGTH = 4.56
    WIDTH = 1.695
    HEIGHT = 1.59
    WHEELBASE = 2.75
    TRACK_F = 1.48
    TRACK_R = 1.475
    TYRE_R = 0.317
    TYRE_W = 0.195
    RIM_R = 0.19
    FRONT_OVERHANG = 0.86
    WHEEL_STYLE = 'alloy6'
    PLATE = 'ADX 2290'
    INDICATORS = [('front', (0.76, 2.28, 0.73), 45, 0.07, 0.035), ('rear', (0.75, -2.28, 0.95), 38, 0.05, 0.07)]
    PREVIEW_PAINT = '#c8b78e'
    PAINTS = ['#eeeeea', '#b7bbbf', '#b7bbbf', '#7c8187', '#16181b', '#1e2d55', '#c8b78e']
    Y_COWL = 1.18
    Y_HEADER = 0.28
    Y_ROOFR = -1.78
    Y_DECK = -2.1
    Y_B = (0.02, 0.1)
    Y_GLASS_END = -1.64
    ROOF_Z = 1.57
    yf, yr = 2.28, -2.28

    @property
    def BREAKS(self):
        return [self.Y_COWL, self.Y_HEADER, self.Y_ROOFR, self.Y_DECK, *self.Y_B, self.Y_GLASS_END, 0.92, 0.97,
                -0.84, -0.92]

    @property
    def RULES(self):
        return [
            dict(mat='trim', k0=0, k1=0),
            dict(mat='glass', y0=self.Y_GLASS_END, y1=self.Y_COWL, k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=0.92, y1=0.97, k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=self.Y_B[0], y1=self.Y_B[1], k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=-0.92, y1=-0.84, k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=self.Y_GLASS_END, y1=0.97, k0=6, k1=6),
            dict(mat='glass', y0=self.Y_HEADER, y1=self.Y_COWL, k0=7, k1=8, tag='inset'),
            dict(mat='glass', y0=self.Y_DECK, y1=self.Y_ROOFR, k0=7, k1=8, tag='inset'),
            dict(mat='trim', k0=-1, cap='front', zmax=0.3),
            dict(mat='trim', k0=-1, cap='rear', zmax=0.36),
        ]

    def body(self):
        W = self.W
        yf, yr = self.yf, self.yr
        S = [
            sec(yr, W=0.79, zb=0.34, zbelt=0.9, zmax=0.56, top=('deck', 1.0),
                dy={0: 0.07, 1: 0.07, 2: 0.04, 4: 0.03, 5: 0.06, 6: 0.06, 7: 0.06, 8: 0.06, 9: 0.06}),
            sec(yr + 0.07, W=0.83, zb=0.28, zbelt=1.02, zmax=0.58, top=('deck', 1.07, 0.92, 0.8, 0.42)),
            sec(self.Y_DECK, W=0.842, zb=0.23, zbelt=1.035, top=('deck', 1.1, 0.92, 0.78, 0.4)),
            sec(self.Y_ROOFR, W=W, zb=0.2, zbelt=1.03, top=('glass', 1.45, 0.6, 1.52)),
            sec(-0.6, W=W, zb=0.19, zbelt=1.0, top=('glass', 1.51, 0.665, 1.59)),
            sec(self.Y_HEADER, W=W, zb=0.19, zbelt=0.965, top=('glass', 1.475, 0.65, 1.555)),
            sec(self.Y_COWL, W=0.845, zb=0.2, zbelt=0.935, top=('deck', 0.98, 0.93, 0.85, 0.42)),
            sec(1.7, W=0.84, zb=0.22, zbelt=0.855, top=('deck', 0.885)),
            sec(yf - 0.07, W=0.815, zb=0.25, zbelt=0.76, zmax=0.5, top=('deck', 0.79)),
            sec(yf, W=0.785, zb=0.28, zbelt=0.7, zmax=0.48, top=('deck', 0.725),
                dy={0: -0.09, 1: -0.09, 2: -0.05, 4: -0.035, 5: -0.05, 6: -0.05, 7: -0.05, 8: -0.05, 9: -0.05}),
        ]
        return vkit.Body(S, round_front=0.42, round_rear=0.24, front_bulge=0.04, rear_bulge=0.015)

    def paint(self, cv):
        yf, yr = self.yf, self.yr
        af, ar = self.AXLE_F, self.AXLE_R
        R = self.TYRE_R + self.ARCH_GAP
        cv.line([(0.97, 1.7), (0.95, 4.9)])
        cv.line([(self.Y_B[1] + 0.012, 1.7), (self.Y_B[1] + 0.012, 4.9)])
        cv.line([(self.Y_B[0] - 0.012, 1.7), (self.Y_B[0] - 0.012, 4.9)])
        cv.line([(-0.88, 4.9), (-0.87, 3.6), (ar + R + 0.06, 3.0), (ar + R + 0.02, 2.4), (ar + R + 0.02, 1.8)])
        cv.line([(0.95, 1.75), (ar + R + 0.02, 1.75)])
        cv.handle(self.Y_B[1] + 0.2, 4.35)
        cv.handle(-0.7, 4.4)
        cv.line([(yf - 0.1, 6.1), (af, 6.05), (self.Y_COWL + 0.03, 6.0)])
        cv.line([(self.Y_COWL + 0.03, 6.0), (self.Y_COWL + 0.035, 8.99)])
        cv.line([(yf - 0.32, 5.3), (af + R + 0.1, 4.2), (af + R + 0.03, 3.0)])
        cv.line([(ar - R - 0.08, 3.0), (yr + 0.3, 4.5)])
        cv.rect(ar - 0.34, ar - 0.17, 4.0, 4.55, sides=(-1,), outline=90)
        cv.cap_line([(-0.62, 0.62), (0.62, 0.62)], 'rear')

    def details(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        rings = 2 if lod == 0 else 1
        # big swept headlamps
        hl = [(-0.24, 0.02), (-0.2, -0.045), (0.0, -0.06), (0.18, -0.05), (0.29, 0.0), (0.31, 0.08),
              (0.2, 0.085), (0.02, 0.06), (-0.16, 0.04)]
        ctx.patch('front', (0.58, yf, 0.7), hl, 'light_front', yaw=28, mirror=True, offset=0.006, flat=0.35,
                  uv_rect=C.uv('head_modern'), depth=0.01, side_mat='trim', rings=rings)
        gr = [(-0.3, 0.04), (-0.26, -0.035), (0.26, -0.035), (0.3, 0.04)]
        ctx.patch('front', (0, yf, 0.68), gr, 'trim', offset=0.004, rings=1)
        if lod == 0:
            ctx.strip('front', (0, yf, 0.695), [(-0.29, 0.0), (0.29, 0.0)], 0.02, 'chrome', offset=0.009, thick=0.004)
            ctx.patch('front', (0, yf, 0.695), C.ellipse(0.05, 0.035, 12), 'chrome', offset=0.013, rings=1, flat=1.0)
        li = [(-0.55, 0.07), (-0.48, -0.06), (0.48, -0.06), (0.55, 0.07)]
        ctx.patch('front', (0, yf, 0.39), li, 'trim', offset=0.004, rings=1)
        if lod == 0:
            ctx.patch('front', (0.55, yf, 0.39), C.ellipse(0.04, 0.032, 10), 'light_front', mirror=True, yaw=12,
                      uv_rect=C.uv('fog'), offset=0.007, rings=1)
        C.plate(ctx, 'front', (0, yf, 0.5))
        # tail lamps: tall clear-red clusters on the D-pillar corners + hatch garnish
        tl = [(-0.08, -0.17), (0.1, -0.17), (0.13, 0.08), (0.08, 0.2), (-0.04, 0.2), (-0.09, 0.0)]
        ctx.patch('rear', (0.7, yr, 1.02), [(-a, b) for a, b in tl][::-1], 'light_rear', yaw=34, mirror=True,
                  offset=0.006, flat=0.2, uv_rect=C.uv('tail'), depth=0.01, side_mat='trim', rings=rings)
        C.plate(ctx, 'rear', (0, yr, 0.78))
        if lod == 0:
            ctx.strip('rear', (0, yr, 0.93), [(-0.45, 0), (0.45, 0)], 0.03, 'chrome', offset=0.006)
            ctx.strip('rear', (0, yr, 1.25), [(0.0, -0.1), (-0.38, -0.05)], 0.014, 'trim', offset=0.012, thick=0.01)
            C.mirrors(ctx, y=0.95, z=1.02, x_out=0.955, size=(0.1, 0.19, 0.12))
            C.wipers(ctx, self, y=self.Y_COWL - 0.1, spans=((0.3, 0.62), (-0.2, 0.55)))
            C.side_repeaters(ctx, y=1.62, z=0.8)
            C.exhaust(ctx, -0.45, yr + 0.08, 0.27)
            # roof rails
            for sd in (1, -1):
                pts = [(sd * 0.58, y, 0) for y in (0.1, -0.5, -1.2, -1.65)]
                path = []
                for x, y, _ in pts:
                    loc, _n = ctx.surface(x, y)
                    if loc is not None:
                        path.append((x, y, loc.z + 0.03))
                if len(path) >= 2:
                    vkit.sweep(ctx.mb, path, vkit.rect_profile(0.03, 0.03), 'trim')
        C.interior(ctx, y_dash=self.Y_COWL - 0.05, y_back=self.Y_DECK + 0.15, x_half=0.7, z_floor=0.3, z_dash=0.95,
                   z_seat=0.55, rows=[(0.6, 'pair'), (-0.35, 'bench'), (-1.25, 'bench')], z_head=self.ROOF_Z - 0.06,
                   head_span=(self.Y_ROOFR + 0.1, self.Y_HEADER - 0.1), dash_depth=0.45)


SPEC = Wish()
