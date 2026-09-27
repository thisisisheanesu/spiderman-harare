"""Toyota Land Cruiser 200 (2007-2015 'V8') - the big SUV of Harare's government and business elite.
Dimensions: L 4.95 m, W 1.97 m, H 1.905 m (with rails), wheelbase 2.85 m, track 1.64/1.635 m,
285/60R18 (r 0.400 m)."""
import vkit
from vkit import sec

from . import common as C
from .base import Base


class LandCruiser(Base):
    NAME = 'suv_landcruiser'
    TITLE = 'Toyota Land Cruiser 200'
    REAL = 'Toyota Land Cruiser 200 (UZJ200/VDJ200, 2007-2015)'
    LENGTH = 4.95
    WIDTH = 1.97
    HEIGHT = 1.905
    WHEELBASE = 2.85
    TRACK_F = 1.64
    TRACK_R = 1.635
    TYRE_R = 0.400
    TYRE_W = 0.285
    RIM_R = 0.2286
    FRONT_OVERHANG = 0.92
    WHEEL_STYLE = 'alloy6'
    TYRE = 'offroad'
    ARCH_GAP = 0.055
    ARCH_DEPTH = 0.42
    PLATE = 'AFP 0200'
    INDICATORS = [('front', (0.9, 2.475, 0.9), 45, 0.06, 0.05), ('rear', (0.84, -2.475, 1.0), 36, 0.07, 0.06)]
    PREVIEW_PAINT = '#16181b'
    PAINTS = ['#eeeeea', '#e4e1d8', '#16181b', '#16181b', '#b7bbbf', '#4a4f55', '#c8b78e']
    Y_COWL = 0.78
    Y_HEADER = 0.02
    Y_ROOFR = -2.22
    Y_DECK = -2.4
    Y_B = (-0.2, -0.11)
    Y_GLASS_END = -2.05
    Y_C = (-1.12, -1.03)
    ROOF_Z = 1.855
    yf, yr = 2.475, -2.475

    @property
    def BREAKS(self):
        return [self.Y_COWL, self.Y_HEADER, self.Y_ROOFR, self.Y_DECK, *self.Y_B, self.Y_GLASS_END, *self.Y_C]

    @property
    def RULES(self):
        return [
            dict(mat='trim', k0=0, k1=0),
            dict(mat='glass', y0=self.Y_GLASS_END, y1=self.Y_COWL, k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=self.Y_B[0], y1=self.Y_B[1], k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=self.Y_C[0], y1=self.Y_C[1], k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=self.Y_GLASS_END - 0.02, y1=self.Y_HEADER + 0.02, k0=6, k1=6),
            dict(mat='glass', y0=self.Y_HEADER, y1=self.Y_COWL, k0=7, k1=8, tag='inset'),
            dict(mat='glass', y0=self.Y_DECK, y1=self.Y_ROOFR, k0=7, k1=8, tag='inset'),
            dict(mat='trim', k0=-1, cap='front', zmax=0.6),
            dict(mat='trim', k0=-1, cap='rear', zmax=0.6),
            dict(mat='trim', y0=self.yf - 0.1, y1=9, k0=0, k1=3, zmax=0.6),
            dict(mat='trim', y0=-9, y1=self.yr + 0.08, k0=0, k1=3, zmax=0.6),
        ]

    def body(self):
        W = self.W
        yf, yr = self.yf, self.yr
        S = [
            sec(yr, W=0.94, zb=0.52, zbelt=1.26, zmax=0.8, top=('deck', 1.3, 0.94, 0.8, 0.45),
                dy={0: 0.06, 1: 0.06, 2: 0.03, 3: -0.02, 4: 0.03, 5: 0.05, 6: 0.05, 7: 0.05, 8: 0.05, 9: 0.05}),
            sec(self.Y_DECK, W=0.975, zb=0.47, zbelt=1.29, zmax=0.85, top=('deck', 1.33, 0.93, 0.8, 0.44)),
            sec(self.Y_ROOFR, W=W, zb=0.45, zbelt=1.3, zmax=0.9, top=('glass', 1.78, 0.83, 1.84)),
            sec(-1.0, W=W, zb=0.43, zbelt=1.285, zmax=0.9, top=('glass', 1.8, 0.845, 1.855)),
            sec(self.Y_HEADER, W=W, zb=0.43, zbelt=1.27, zmax=0.9, top=('glass', 1.775, 0.835, 1.83)),
            sec(self.Y_COWL, W=0.98, zb=0.44, zbelt=1.2, zmax=0.9, top=('deck', 1.23, 0.95, 0.87, 0.45)),
            sec(1.6, W=0.975, zb=0.45, zbelt=1.16, zmax=0.88, top=('deck', 1.19)),
            sec(yf - 0.09, W=0.955, zb=0.47, zbelt=1.1, zmax=0.8, top=('deck', 1.13)),
            sec(yf, W=0.92, zb=0.5, zbelt=1.04, zmax=0.72, top=('deck', 1.07),
                dy={0: -0.1, 1: -0.1, 2: -0.05, 4: -0.04, 5: -0.06, 6: -0.06, 7: -0.06, 8: -0.06, 9: -0.06}),
        ]
        return vkit.Body(S, round_front=0.32, round_rear=0.2, front_bulge=0.03, rear_bulge=0.015)

    def paint(self, cv):
        yf, yr = self.yf, self.yr
        af, ar = self.AXLE_F, self.AXLE_R
        R = self.TYRE_R + self.ARCH_GAP
        cv.line([(self.Y_COWL - 0.02, 1.7), (self.Y_COWL - 0.02, 4.9)])
        cv.line([(self.Y_B[1] + 0.012, 1.7), (self.Y_B[1] + 0.012, 4.9)])
        cv.line([(self.Y_B[0] - 0.012, 1.7), (self.Y_B[0] - 0.012, 4.9)])
        cv.line([(self.Y_C[1] + 0.02, 4.9), (self.Y_C[1] + 0.02, 3.6), (ar + R + 0.05, 3.0), (ar + R + 0.02, 1.7)])
        cv.line([(self.Y_COWL - 0.02, 1.75), (ar + R + 0.02, 1.75)])
        cv.handle(self.Y_B[1] + 0.24, 4.3, length=0.16)
        cv.handle(self.Y_C[1] + 0.25, 4.3, length=0.16)
        cv.line([(yf - 0.1, 6.1), (af, 6.05), (self.Y_COWL + 0.03, 6.0)])
        cv.line([(self.Y_COWL + 0.03, 6.0), (self.Y_COWL + 0.035, 8.99)])
        cv.line([(yf - 0.35, 5.2), (af + R + 0.12, 4.3), (af + R + 0.04, 3.0)])
        cv.line([(ar - R - 0.08, 3.0), (yr + 0.3, 4.6)])
        cv.rect(ar - 0.42, ar - 0.25, 4.0, 4.5, sides=(-1,), outline=90)
        cv.cap_line([(-0.8, 0.66), (0.8, 0.66)], 'rear')

    def details(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        rings = 2 if lod == 0 else 1
        self._front_rear(ctx, rings)
        # a0/a1 keep the flare ends at the sill: the default -8..188 deg hung 8 cm below the body as white tabs
        C.arch_flares(ctx, self, width=0.06, thick=0.03, mat='paint', a0=5, a1=175)
        C.side_steps(ctx, self, z=0.42)
        if lod == 0:
            C.mirrors(ctx, y=self.Y_COWL - 0.1, z=1.36, x_out=1.12, size=(0.12, 0.22, 0.17))
            C.wipers(ctx, self, y=self.Y_COWL - 0.08, spans=((0.38, 0.7), (-0.28, 0.62)))
            C.exhaust(ctx, -0.6, yr + 0.1, 0.48, r=0.035)
            C.side_repeaters(ctx, y=1.95, z=1.02)
            # roof rails
            for sd in (1, -1):
                path = []
                for y in (-0.05, -0.8, -1.6, -2.15):
                    loc, _n = ctx.surface(sd * 0.72, y)
                    if loc is not None:
                        path.append((sd * 0.72, y, loc.z + 0.04))
                if len(path) >= 2:
                    vkit.sweep(ctx.mb, path, vkit.rect_profile(0.035, 0.035), 'chrome')
        C.interior(ctx, y_dash=self.Y_COWL - 0.05, y_back=self.Y_DECK + 0.2, x_half=0.8, z_floor=0.62, z_dash=1.23,
                   z_seat=0.95, rows=[(0.25, 'pair'), (-0.65, 'bench'), (-1.55, 'bench')], z_head=self.ROOF_Z - 0.06,
                   head_span=(self.Y_ROOFR + 0.05, self.Y_HEADER - 0.05), dash_depth=0.45)

    def _front_rear(self, ctx, rings):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        hl = [(-0.2, 0.07), (-0.2, -0.06), (0.05, -0.075), (0.2, -0.06), (0.28, 0.0), (0.29, 0.08), (0.1, 0.09)]
        ctx.patch('front', (0.68, yf, 0.92), hl, 'light_front', yaw=30, mirror=True, offset=0.006, flat=0.4,
                  uv_rect=C.uv('head_modern'), depth=0.012, side_mat='trim', rings=rings)
        g = [(-0.46, 0.11), (-0.43, -0.12), (0.43, -0.12), (0.46, 0.11)]
        ctx.patch('front', (0, yf, 0.9), g, 'trim', offset=0.005, rings=1, bezel=('chrome', 0.035))
        if lod == 0:
            for dz in (-0.075, -0.025, 0.025, 0.075):
                ctx.strip('front', (0, yf, 0.9 + dz), [(-0.44, 0), (0.44, 0)], 0.02, 'chrome', offset=0.011, thick=0.006)
            ctx.patch('front', (0, yf, 0.9), C.ellipse(0.08, 0.055, 12), 'chrome', offset=0.017, rings=1, flat=1.0)
            ctx.patch('front', (0.66, yf, 0.6), C.ellipse(0.05, 0.04, 10), 'light_front', mirror=True, yaw=15,
                      uv_rect=C.uv('fog'), offset=0.007, rings=1, bezel=('trim', 0.015))
        ctx.patch('front', (0, yf, 0.62), [(-0.5, 0.05), (-0.46, -0.05), (0.46, -0.05), (0.5, 0.05)], 'trim',
                  offset=0.004, rings=1)
        C.plate(ctx, 'front', (0, yf, 0.72))
        tl = [(-0.07, -0.16), (0.12, -0.16), (0.14, 0.12), (0.1, 0.18), (-0.05, 0.18), (-0.08, 0.0)]
        ctx.patch('rear', (0.82, yr, 1.1), [(-a, b) for a, b in tl][::-1], 'light_rear', yaw=34, mirror=True,
                  offset=0.006, flat=0.25, uv_rect=C.uv('tail'), depth=0.012, side_mat='trim', rings=rings)
        C.plate(ctx, 'rear', (0, yr, 0.92))
        if lod == 0:
            ctx.patch('rear', (0, yr, 0.92), C.rect(0.62, 0.18), 'chrome', offset=0.008, rings=1, flat=1.0)
            ctx.patch('rear', (0, yr, 1.1), C.rect(0.9, 0.035), 'chrome', offset=0.006, rings=1)
            ctx.strip('rear', (0, yr, 1.6), [(0.0, -0.2), (-0.42, -0.14)], 0.016, 'trim', offset=0.014, thick=0.01)


SPEC = LandCruiser()
