"""Toyota Corolla Axio (E160, 2012-2019; the E140/E160 Axio is Harare's most common saloon).
Dimensions: L 4.40 m, W 1.695 m, H 1.46 m, wheelbase 2.60 m, track 1.48/1.465 m, 185/60R15 (r 0.301 m)."""
import vkit
from vkit import sec

from .base import Base
from . import common as C


class Corolla(Base):
    NAME = 'sedan_corolla'
    TITLE = 'Toyota Corolla Axio (E160) saloon'
    REAL = 'Toyota Corolla Axio E160 (2012-2019)'
    LENGTH = 4.40
    WIDTH = 1.695
    HEIGHT = 1.46
    WHEELBASE = 2.60
    TRACK_F = 1.48
    TRACK_R = 1.465
    TYRE_R = 0.301
    TYRE_W = 0.185
    RIM_R = 0.19
    FRONT_OVERHANG = 0.86
    WHEEL_STYLE = 'alloy10'
    PLATE = 'AFK 3052'
    INDICATORS = [('front', (0.76, 2.2, 0.7), 40, 0.07, 0.035), ('rear', (0.72, -2.2, 0.83), 35, 0.09, 0.03)]
    PREVIEW_PAINT = '#b7bbbf'
    PAINTS = ['#eeeeea', '#e4e1d8', '#b7bbbf', '#7c8187', '#4a4f55', '#16181b', '#1e2d55', '#c8b78e', '#5b1b22']
    # key y positions
    Y_COWL = 0.93
    Y_HEADER = 0.13
    Y_ROOFR = -0.88
    Y_DECK = -1.52
    Y_B = (-0.06, 0.04)
    Y_GLASS_END = -1.02
    ROOF_Z = 1.44

    @property
    def BREAKS(self):
        return [self.Y_COWL, self.Y_HEADER, self.Y_ROOFR, self.Y_DECK, *self.Y_B, self.Y_GLASS_END]

    @property
    def RULES(self):
        return C.saloon_rules(self)

    def body(self):
        W = self.W
        yf, yr = self.LENGTH / 2, -self.LENGTH / 2
        S = [
            sec(yr, W=0.775, zb=0.34, zbelt=0.86, zmax=0.56, top=('deck', 0.99),
                dy={0: 0.08, 1: 0.08, 2: 0.05, 4: 0.03, 5: 0.07, 6: 0.07, 7: 0.07, 8: 0.07, 9: 0.07}),
            sec(yr + 0.07, W=0.82, zb=0.28, zbelt=0.94, zmax=0.57, top=('deck', 1.01)),
            sec(yr + 0.35, W=0.842, zb=0.215, zbelt=0.96, top=('deck', 1.035)),
            sec(self.Y_DECK, W=W, zb=0.20, zbelt=0.97, top=('deck', 1.055, 0.92, 0.75, 0.4)),
            sec(self.Y_ROOFR, W=W, zb=0.19, zbelt=0.97, top=('glass', 1.37, 0.628, 1.425)),
            sec(-0.35, W=W, zb=0.19, zbelt=0.96, top=('glass', 1.388, 0.652, 1.46)),
            sec(self.Y_HEADER, W=W, zb=0.19, zbelt=0.95, top=('glass', 1.372, 0.642, 1.44)),
            sec(self.Y_COWL, W=0.845, zb=0.20, zbelt=0.94, top=('deck', 0.97, 0.93, 0.83, 0.42)),
            sec(1.45, W=0.843, zb=0.21, zbelt=0.905, top=('deck', 0.935)),
            sec(1.9, W=0.832, zb=0.23, zbelt=0.855, top=('deck', 0.885)),
            sec(yf - 0.07, W=0.815, zb=0.245, zbelt=0.80, zmax=0.5, top=('deck', 0.83)),
            sec(yf, W=0.79, zb=0.26, zbelt=0.76, zmax=0.49, top=('deck', 0.785),
                dy={0: -0.1, 1: -0.1, 2: -0.06, 4: -0.04, 5: -0.05, 6: -0.05, 7: -0.05, 8: -0.05, 9: -0.05}),
        ]
        return vkit.Body(S, round_front=0.34, round_rear=0.3, front_bulge=0.025, rear_bulge=0.02)

    def paint(self, cv):
        C.saloon_panel_lines(self, cv)

    def details(self, ctx):
        yf = self.LENGTH / 2
        lod = ctx.lod
        # headlamps: long lozenges wrapping the front corners
        hl = [(-0.25, 0.035), (-0.25, -0.03), (-0.1, -0.05), (0.08, -0.055), (0.2, -0.045), (0.28, 0.0),
              (0.3, 0.07), (0.15, 0.065), (0.0, 0.055), (-0.14, 0.045)]
        ctx.patch('front', (0.6, yf, 0.695), hl, 'light_front', yaw=24, mirror=True, offset=0.006, flat=0.4,
                  uv_rect=C.uv('head_modern'), depth=0.01, side_mat='trim', rings=2 if lod == 0 else 1)
        # grille band between the lamps (black) with a chrome emblem
        gr = [(-0.37, 0.05), (-0.3, -0.055), (0.3, -0.055), (0.37, 0.05)]
        ctx.patch('front', (0, yf, 0.71), gr, 'trim', offset=0.004, rings=1)
        if lod == 0:
            ctx.strip('front', (0, yf, 0.71), [(-0.35, 0.03), (0.35, 0.03)], 0.012, 'chrome', offset=0.008)
            ctx.patch('front', (0, yf, 0.71), C.ellipse(0.045, 0.032, 12), 'chrome', offset=0.012, rings=1, flat=1.0)
        # lower intake + corner vents + plate
        # (kept inside the flat part of the bumper: at +-0.5 the ends wrapped onto the corners and tore)
        li = [(-0.45, 0.08), (-0.4, -0.075), (0.4, -0.075), (0.45, 0.08)]
        ctx.patch('front', (0, yf, 0.40), li, 'trim', offset=0.004, rings=1)
        vent = [(-0.05, 0.04), (-0.04, -0.035), (0.05, -0.03), (0.05, 0.04)]
        ctx.patch('front', (0.64, yf, 0.39), vent, 'trim', yaw=15, mirror=True, offset=0.004, rings=1)
        C.plate(ctx, 'front', (0, yf, 0.47))
        # tail lamps: wrap the rear corners, inner part on the boot lid
        tl = [(-0.3, 0.05), (-0.3, -0.04), (-0.05, -0.065), (0.18, -0.065), (0.26, -0.03), (0.27, 0.06), (0.05, 0.07)]
        ctx.patch('rear', (0.58, -yf, 0.87), [(-a, b) for a, b in tl][::-1], 'light_rear', yaw=22, mirror=True,
                  offset=0.006, flat=0.3, uv_rect=C.uv('tail'), depth=0.01, side_mat='trim', rings=2 if lod == 0 else 1)
        C.plate(ctx, 'rear', (0, -yf, 0.62))
        if lod == 0:
            # boot garnish, side repeaters, reflectors, mirrors, wipers, exhaust
            ctx.strip('rear', (0, -yf, 0.8), [(-0.3, 0.0), (0.3, 0.0)], 0.02, 'chrome', offset=0.006)
            ctx.patch('rear', (0.62, -yf, 0.42), C.rect(0.12, 0.025), 'light_rear', yaw=12, mirror=True,
                      uv_rect=C.uv('tail_plain'), offset=0.004, rings=1)
            C.mirrors(ctx, y=0.83, z=1.0, x_out=0.955)
            C.wipers(ctx, self)
            C.side_repeaters(ctx, y=1.62, z=0.78)
            C.exhaust(ctx, -0.45, -yf + 0.06, 0.25)
        C.saloon_interior(ctx, self)
        # black sills (rocker cladding) are paint on this car; underbody is trim via rules


SPEC = Corolla()
