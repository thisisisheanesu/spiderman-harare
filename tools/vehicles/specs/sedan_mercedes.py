"""Mercedes-Benz C-Class W204 saloon (2007-2014), the 'German executive' of Harare traffic.
Dimensions: L 4.58 m, W 1.77 m, H 1.447 m, wheelbase 2.76 m, track 1.55/1.54 m, 205/55R16 (r 0.316 m)."""
import math

import vkit
from vkit import sec

from . import common as C
from .base import Base


class Merc(Base):
    NAME = 'sedan_mercedes'
    TITLE = 'Mercedes-Benz C-Class (W204) saloon'
    REAL = 'Mercedes-Benz C-Class W204 (2007-2014)'
    LENGTH = 4.58
    WIDTH = 1.77
    HEIGHT = 1.447
    WHEELBASE = 2.76
    TRACK_F = 1.55
    TRACK_R = 1.54
    TYRE_R = 0.316
    TYRE_W = 0.205
    RIM_R = 0.203
    FRONT_OVERHANG = 0.80
    WHEEL_STYLE = 'alloy5'
    PLATE = 'AGB 1166'
    INDICATORS = [('front', (0.8, 2.29, 0.71), 40, 0.07, 0.035), ('rear', (0.76, -2.29, 0.87), 35, 0.09, 0.03)]
    PREVIEW_PAINT = '#16181b'
    PAINTS = ['#16181b', '#16181b', '#b7bbbf', '#eeeeea', '#1e2d55', '#4a4f55']
    Y_COWL = 0.72
    Y_HEADER = -0.08
    Y_ROOFR = -1.0
    Y_DECK = -1.62
    Y_B = (-0.29, -0.2)
    Y_GLASS_END = -1.3
    ROOF_Z = 1.43
    yf, yr = 2.29, -2.29

    @property
    def BREAKS(self):
        return [self.Y_COWL, self.Y_HEADER, self.Y_ROOFR, self.Y_DECK, *self.Y_B, self.Y_GLASS_END, -1.08, -1.13]

    @property
    def RULES(self):
        r = C.saloon_rules(self, black_b=True, frames=False)
        r.insert(3, dict(mat='chrome', y0=self.Y_GLASS_END - 0.02, y1=self.Y_HEADER + 0.03, k0=6, k1=6))
        r.insert(3, dict(mat='trim', y0=-1.13, y1=-1.08, k0=5, k1=5, tag='inset'))
        return r

    def body(self):
        W = self.W
        yf, yr = self.yf, self.yr
        S = [
            sec(yr, W=0.80, zb=0.34, zbelt=0.87, zmax=0.56, top=('deck', 1.0),
                dy={0: 0.08, 1: 0.08, 2: 0.05, 4: 0.03, 5: 0.06, 6: 0.06, 7: 0.06, 8: 0.06, 9: 0.06}),
            sec(yr + 0.08, W=0.86, zb=0.27, zbelt=0.975, zmax=0.57, top=('deck', 1.03)),
            sec(yr + 0.4, W=0.88, zb=0.21, zbelt=0.995, top=('deck', 1.05)),
            sec(self.Y_DECK, W=W, zb=0.2, zbelt=1.0, top=('deck', 1.07, 0.92, 0.74, 0.4)),
            sec(self.Y_ROOFR, W=W, zb=0.19, zbelt=0.99, top=('glass', 1.36, 0.665, 1.41)),
            sec(-0.45, W=W, zb=0.19, zbelt=0.975, top=('glass', 1.385, 0.695, 1.447)),
            sec(self.Y_HEADER, W=W, zb=0.19, zbelt=0.965, top=('glass', 1.37, 0.685, 1.425)),
            sec(self.Y_COWL, W=0.883, zb=0.2, zbelt=0.95, top=('deck', 0.98, 0.93, 0.83, 0.42)),
            sec(1.3, W=0.88, zb=0.21, zbelt=0.905, top=('deck', 0.93)),
            sec(1.9, W=0.87, zb=0.23, zbelt=0.84, top=('deck', 0.865)),
            sec(yf - 0.07, W=0.85, zb=0.25, zbelt=0.785, zmax=0.5, top=('deck', 0.81)),
            sec(yf, W=0.82, zb=0.27, zbelt=0.725, zmax=0.48, top=('deck', 0.75),
                dy={0: -0.1, 1: -0.1, 2: -0.06, 4: -0.035, 5: -0.05, 6: -0.05, 7: -0.05, 8: -0.05, 9: -0.05}),
        ]
        return vkit.Body(S, round_front=0.36, round_rear=0.3, front_bulge=0.03, rear_bulge=0.02)

    def paint(self, cv):
        C.saloon_panel_lines(self, cv, fuel_side=1)

    def details(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        rings = 2 if lod == 0 else 1
        # angular headlamps
        hl = [(-0.22, 0.045), (-0.22, -0.02), (-0.16, -0.055), (0.08, -0.06), (0.22, -0.04), (0.29, 0.02),
              (0.3, 0.075), (0.1, 0.07), (-0.1, 0.06)]
        ctx.patch('front', (0.6, yf, 0.7), hl, 'light_front', yaw=26, mirror=True, offset=0.006, flat=0.4,
                  uv_rect=C.uv('head_modern'), depth=0.012, side_mat='trim', rings=rings)
        # chrome three-bar grille with the big star
        g = [(-0.33, 0.08), (-0.3, -0.08), (0.3, -0.08), (0.33, 0.08)]
        ctx.patch('front', (0, yf, 0.67), g, 'trim', offset=0.006, rings=1, bezel=('chrome', 0.022))
        if lod == 0:
            for dz in (-0.045, 0.0, 0.045):
                ctx.strip('front', (0, yf, 0.67 + dz), [(-0.31, 0), (-0.09, 0)], 0.018, 'chrome', offset=0.012, thick=0.006)
                ctx.strip('front', (0, yf, 0.67 + dz), [(0.09, 0), (0.31, 0)], 0.018, 'chrome', offset=0.012, thick=0.006)
            ctx.patch('front', (0, yf, 0.67), C.ellipse(0.085, 0.085, 16), 'chrome', offset=0.016, rings=1, flat=1.0)
            ctx.patch('front', (0, yf, 0.67), C.ellipse(0.068, 0.068, 16), 'trim', offset=0.019, rings=1, flat=1.0)
            # generic round badge (no manufacturer logo)
            ctx.patch('front', (0, yf, 0.67), C.ellipse(0.03, 0.03, 10), 'chrome', offset=0.022, rings=1, flat=1.0)
        # lower intake, chrome blade, fog lamps
        li = [(-0.52, 0.06), (-0.47, -0.065), (0.47, -0.065), (0.52, 0.06)]
        ctx.patch('front', (0, yf, 0.39), li, 'trim', offset=0.004, rings=1)
        if lod == 0:
            ctx.strip('front', (0, yf, 0.31), [(-0.62, 0.02), (0, 0), (0.62, 0.02)], 0.018, 'chrome', offset=0.007)
            ctx.patch('front', (0.62, yf, 0.39), C.ellipse(0.04, 0.036, 10), 'light_front', yaw=18, mirror=True,
                      uv_rect=C.uv('fog'), offset=0.007, rings=1, bezel=('chrome', 0.012))
        C.plate(ctx, 'front', (0, yf, 0.52))
        # tail lamps: wedge on the wing + inner part on the boot lid
        tl = [(-0.34, 0.05), (-0.34, -0.035), (-0.1, -0.06), (0.16, -0.055), (0.26, -0.02), (0.27, 0.055), (0.0, 0.065)]
        ctx.patch('rear', (0.6, yr, 0.9), [(-a, b) for a, b in tl][::-1], 'light_rear', yaw=22, mirror=True,
                  offset=0.006, flat=0.3, uv_rect=C.uv('tail'), depth=0.01, side_mat='trim', rings=rings)
        C.plate(ctx, 'rear', (0, yr, 0.84))
        if lod == 0:
            ctx.strip('rear', (0, yr, 0.935), [(-0.24, 0), (0.24, 0)], 0.016, 'chrome', offset=0.006)
            ctx.patch('rear', (0, yr, 0.99), C.ellipse(0.04, 0.04, 12), 'chrome', offset=0.008, rings=1, flat=1.0)
            C.mirrors(ctx, y=0.62, z=1.02, x_out=1.0, size=(0.1, 0.2, 0.12))
            C.wipers(ctx, self)
            C.side_repeaters(ctx, y=1.78, z=0.8)
            C.exhaust(ctx, -0.5, yr + 0.08, 0.27, r=0.035)
            # chrome belt line + sill strip along both sides
            for where, sd in (('right', 1), ('left', -1)):
                ctx.strip(where, (sd * 2, 0, 0), [(self.Y_COWL - 0.02, 0.965), (self.Y_B[0], 0.975), (self.Y_GLASS_END + 0.02, 0.99)],
                          0.012, 'chrome', offset=0.006)
                ctx.strip(where, (sd * 2, 0, 0), [(self.AXLE_F - 0.42, 0.29), (self.AXLE_R + 0.42, 0.29)], 0.016, 'chrome', offset=0.006)
        C.saloon_interior(ctx, self)


SPEC = Merc()
