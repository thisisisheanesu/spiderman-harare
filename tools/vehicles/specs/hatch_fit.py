"""Honda Fit / Jazz GE (2007-2013) - named Harare's most common car; also the mushikashika pirate taxi.
Dimensions: L 3.90 m, W 1.695 m, H 1.525 m, wheelbase 2.50 m, track 1.475/1.465 m, 175/65R14 (r 0.292 m)."""
import vkit
from vkit import sec

from . import common as C
from .base import Base


class Fit(Base):
    NAME = 'hatch_fit'
    TITLE = 'Honda Fit (GE) hatchback'
    REAL = 'Honda Fit / Jazz GE (2007-2013)'
    LENGTH = 3.90
    WIDTH = 1.695
    HEIGHT = 1.525
    WHEELBASE = 2.50
    TRACK_F = 1.475
    TRACK_R = 1.465
    TYRE_R = 0.292
    TYRE_W = 0.175
    RIM_R = 0.178
    FRONT_OVERHANG = 0.72
    WHEEL_STYLE = 'steel_cap'
    PLATE = 'AEZ 4821'
    INDICATORS = [('front', (0.74, 1.95, 0.76), 45, 0.06, 0.035), ('rear', (0.75, -1.95, 0.9), 40, 0.05, 0.07)]
    PREVIEW_PAINT = '#b7bbbf'
    PAINTS = ['#eeeeea', '#eeeeea', '#b7bbbf', '#b7bbbf', '#7c8187', '#16181b', '#2b56a1', '#7fa3c7', '#a3171c', '#9fbf3b', '#d0671f', '#e4e1d8']
    Y_COWL = 1.2
    Y_HEADER = 0.3
    Y_ROOFR = -1.6
    Y_DECK = -1.86
    Y_B = (-0.06, 0.02)
    Y_GLASS_END = -1.5
    ROOF_Z = 1.52

    yf, yr = 1.95, -1.95

    @property
    def BREAKS(self):
        return [self.Y_COWL, self.Y_HEADER, self.Y_ROOFR, self.Y_DECK, *self.Y_B, self.Y_GLASS_END, 0.9, 0.95,
                -0.85, -0.92]

    @property
    def RULES(self):
        return [
            dict(mat='trim', k0=0, k1=0),
            dict(mat='glass', y0=self.Y_GLASS_END, y1=self.Y_COWL, k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=0.9, y1=0.95, k0=5, k1=5, tag='inset'),      # quarter-light divider
            dict(mat='trim', y0=self.Y_B[0], y1=self.Y_B[1], k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=-0.92, y1=-0.85, k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=self.Y_GLASS_END, y1=0.95, k0=6, k1=6),       # black door frames
            dict(mat='glass', y0=self.Y_HEADER, y1=self.Y_COWL, k0=7, k1=8, tag='inset'),
            dict(mat='glass', y0=self.Y_DECK, y1=self.Y_ROOFR, k0=7, k1=8, tag='inset'),
            dict(mat='trim', k0=-1, cap='front', zmax=0.31),
            dict(mat='trim', k0=-1, cap='rear', zmax=0.36),
        ]

    def body(self):
        W = self.W
        yf, yr = self.yf, self.yr
        S = [
            sec(yr, W=0.79, zb=0.34, zbelt=0.88, zmax=0.56, top=('deck', 0.96),
                dy={0: 0.07, 1: 0.07, 2: 0.04, 3: 0.0, 4: 0.03, 5: 0.05, 6: 0.05, 7: 0.05, 8: 0.05, 9: 0.05}),
            sec(yr + 0.06, W=0.83, zb=0.28, zbelt=0.99, zmax=0.58, top=('deck', 1.03, 0.92, 0.8, 0.42)),
            sec(self.Y_DECK, W=0.84, zb=0.24, zbelt=1.01, top=('deck', 1.06, 0.92, 0.78, 0.4)),
            sec(self.Y_ROOFR, W=W, zb=0.2, zbelt=1.0, top=('glass', 1.43, 0.6, 1.5)),
            sec(-0.4, W=W, zb=0.19, zbelt=0.975, top=('glass', 1.455, 0.66, 1.525)),
            sec(self.Y_HEADER, W=W, zb=0.19, zbelt=0.95, top=('glass', 1.42, 0.645, 1.49)),
            sec(self.Y_COWL, W=0.845, zb=0.2, zbelt=0.925, top=('deck', 0.975, 0.93, 0.85, 0.42)),
            sec(1.58, W=0.838, zb=0.22, zbelt=0.86, top=('deck', 0.895)),
            sec(yf - 0.07, W=0.815, zb=0.26, zbelt=0.775, zmax=0.5, top=('deck', 0.805)),
            sec(yf, W=0.78, zb=0.29, zbelt=0.72, zmax=0.48, top=('deck', 0.745),
                dy={0: -0.09, 1: -0.09, 2: -0.05, 3: 0.0, 4: -0.035, 5: -0.05, 6: -0.05, 7: -0.05, 8: -0.05, 9: -0.05}),
        ]
        return vkit.Body(S, round_front=0.33, round_rear=0.2, front_bulge=0.03, rear_bulge=0.015)

    def paint(self, cv):
        yf, yr = self.yf, self.yr
        af, ar = self.AXLE_F, self.AXLE_R
        R = self.TYRE_R + self.ARCH_GAP
        cv.line([(0.95, 1.7), (0.93, 4.9)])
        cv.line([(self.Y_B[1] + 0.012, 1.7), (self.Y_B[1] + 0.012, 4.9)])
        cv.line([(self.Y_B[0] - 0.012, 1.7), (self.Y_B[0] - 0.012, 4.9)])
        cv.line([(-0.88, 4.9), (-0.86, 3.6), (ar + R + 0.05, 3.0), (ar + R + 0.02, 2.4), (ar + R + 0.02, 1.8)])
        cv.line([(0.93, 1.75), (ar + R + 0.02, 1.75)])
        cv.handle(self.Y_B[1] + 0.18, 4.35)
        cv.handle(-0.72, 4.4)
        cv.line([(yf - 0.1, 6.1), (af, 6.05), (self.Y_COWL + 0.03, 6.0)])
        cv.line([(self.Y_COWL + 0.03, 6.0), (self.Y_COWL + 0.035, 8.99)])
        cv.line([(yf - 0.3, 5.3), (af + R + 0.1, 4.2), (af + R + 0.03, 3.0)])
        cv.line([(ar - R - 0.08, 3.0), (yr + 0.3, 4.5)])
        cv.rect(ar - 0.3, ar - 0.14, 4.0, 4.55, sides=(1,), outline=90)
        # hatch outline on the tail
        cv.cap_line([(-0.6, 0.62), (0.6, 0.62)], 'rear')

    def details(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        rings = 2 if lod == 0 else 1
        # swept headlamps climbing the wing
        hl = [(-0.2, -0.01), (-0.14, -0.06), (0.02, -0.075), (0.16, -0.05), (0.26, 0.0), (0.3, 0.07),
              (0.24, 0.1), (0.1, 0.07), (-0.08, 0.035), (-0.19, 0.02)]
        ctx.patch('front', (0.58, yf, 0.72), hl, 'light_front', yaw=30, mirror=True, offset=0.006, flat=0.35,
                  uv_rect=C.uv('head_modern'), depth=0.01, side_mat='trim', rings=rings)
        # upper grille: black trapezoid + chrome bar with badge
        gr = [(-0.3, 0.035), (-0.25, -0.045), (0.25, -0.045), (0.3, 0.035)]
        ctx.patch('front', (0, yf, 0.715), gr, 'trim', offset=0.004, rings=1)
        if lod == 0:
            ctx.strip('front', (0, yf, 0.742), [(-0.31, -0.005), (0.0, 0.012), (0.31, -0.005)], 0.016, 'chrome', offset=0.008)
            ctx.patch('front', (0, yf, 0.72), C.rrect(0.07, 0.05, 0.01), 'chrome', offset=0.011, rings=1, flat=1.0)
        # lower intake with fog lamps
        li = [(-0.52, 0.06), (-0.46, -0.06), (0.46, -0.06), (0.52, 0.06)]
        ctx.patch('front', (0, yf, 0.4), li, 'trim', offset=0.004, rings=1)
        if lod == 0:
            ctx.patch('front', (0.5, yf, 0.4), C.ellipse(0.035, 0.03, 10), 'light_front', mirror=True, yaw=10,
                      uv_rect=C.uv('fog'), offset=0.007, rings=1)
        C.plate(ctx, 'front', (0, yf, 0.5))
        # tall tail lamps up the D-pillars (wrap onto the sides)
        tl = [(-0.07, -0.2), (0.08, -0.2), (0.1, 0.1), (0.07, 0.24), (-0.05, 0.24), (-0.08, 0.0)]
        ctx.patch('rear', (0.72, yr, 1.02), [(-a, b) for a, b in tl][::-1], 'light_rear', yaw=38, mirror=True,
                  offset=0.006, flat=0.2, uv_rect=C.uv('tail'), depth=0.01, side_mat='trim', rings=rings)
        C.plate(ctx, 'rear', (0, yr, 0.76))
        if lod == 0:
            ctx.strip('rear', (0, yr, 0.9), [(-0.25, 0), (0.25, 0)], 0.018, 'chrome', offset=0.006)
            ctx.patch('rear', (0.6, yr, 0.42), C.rect(0.1, 0.025), 'light_rear', yaw=15, mirror=True,
                      uv_rect=C.uv('tail_plain'), offset=0.004, rings=1)
            # rear wiper
            ctx.strip('rear', (0, yr, 1.2), [(0.0, 1.07 - 1.2), (-0.35, 1.13 - 1.2)], 0.014, 'trim', offset=0.012, thick=0.01)
            C.mirrors(ctx, y=0.93, z=1.0, x_out=0.955, size=(0.1, 0.19, 0.12))
            C.wipers(ctx, self, y=self.Y_COWL - 0.1, spans=((0.3, 0.6), (-0.2, 0.52)))
            C.side_repeaters(ctx, y=1.5, z=0.8)
            C.exhaust(ctx, -0.45, yr + 0.08, 0.26)
        C.interior(ctx, y_dash=self.Y_COWL - 0.05, y_back=self.Y_DECK + 0.15, x_half=0.7, z_floor=0.3, z_dash=0.95,
                   z_seat=0.55, rows=[(0.55, 'pair'), (-0.45, 'bench')], z_head=self.ROOF_Z - 0.06,
                   head_span=(self.Y_ROOFR + 0.06, self.Y_HEADER - 0.1), dash_depth=0.45)


SPEC = Fit()
