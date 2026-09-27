"""Toyota Hilux double cab 4x4 (7th gen AN20/AN30 facelift, 2011-2015) - Harare's default pickup.
Dimensions: L 5.26 m, W 1.835 m, H 1.81 m, wheelbase 3.085 m, track 1.54 m, 255/70R15 (r 0.369 m)."""
import vkit
from vkit import sec

import liveries
from . import common as C
from .base import Base

CARGO = liveries.cargo_layout()


class Hilux(Base):
    NAME = 'pickup_hilux'
    TITLE = 'Toyota Hilux double cab'
    REAL = 'Toyota Hilux AN20/AN30 double cab 4x4, 2011-2015 facelift'
    LENGTH = 5.26
    WIDTH = 1.835
    HEIGHT = 1.81
    WHEELBASE = 3.085
    TRACK_F = 1.54
    TRACK_R = 1.54
    TYRE_R = 0.369
    TYRE_W = 0.255
    RIM_R = 0.19
    FRONT_OVERHANG = 0.87
    WHEEL_STYLE = 'alloy6'
    TYRE = 'offroad'
    ARCH_GAP = 0.06
    ARCH_DEPTH = 0.4
    PLATE = 'AEK 5310'
    INDICATORS = [('front', (0.87, 2.63, 0.9), 45, 0.06, 0.05), ('rear', (0.85, -2.63, 1.14), 30, 0.08, 0.06)]
    PREVIEW_PAINT = '#eeeeea'
    PAINTS = ['#eeeeea', '#eeeeea', '#eeeeea', '#b7bbbf', '#7c8187', '#4a4f55', '#16181b', '#a3171c', '#1e2d55']
    TOGGLES = {'sports_bar': {'group': 'sports_bar', 'default': False, 'preview': True},
               'cargo': {'group': 'cargo', 'default': False, 'preview': True}}
    Y_COWL = 0.95
    Y_HEADER = 0.22
    Y_ROOFR = -0.93
    Y_CAB = -1.03
    Y_B = (-0.07, 0.02)
    Y_GLASS_END = -0.84
    ROOF_Z = 1.79
    Z_RAIL = 1.26
    yf, yr = 2.63, -2.63

    @property
    def BREAKS(self):
        return [self.Y_COWL, self.Y_HEADER, self.Y_ROOFR, self.Y_CAB, *self.Y_B, self.Y_GLASS_END]

    @property
    def RULES(self):
        return [
            dict(mat='trim', k0=0, k1=0),
            dict(mat='glass', y0=self.Y_GLASS_END, y1=self.Y_COWL, k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=self.Y_B[0], y1=self.Y_B[1], k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=self.Y_GLASS_END - 0.02, y1=self.Y_HEADER, k0=6, k1=6),
            dict(mat='glass', y0=self.Y_HEADER, y1=self.Y_COWL, k0=7, k1=8, tag='inset'),
            dict(mat='trim', k0=-1, cap='front', zmax=0.66),
            dict(mat='trim', y0=self.yf - 0.1, y1=9, k0=0, k1=3, zmax=0.66),
        ]

    def body(self):
        W = self.W
        yf, yr = self.yf, self.yr
        zr = self.Z_RAIL
        bed = lambda y, zb=0.58: sec(y, W=W, zb=zb, zbelt=zr - 0.025, zmax=0.95, top=('flat', zr))  # noqa: E731
        S = [
            sec(yr, W=0.9, zb=0.66, zbelt=zr - 0.03, zmax=0.95, top=('flat', zr - 0.005),
                dy={0: 0.03, 1: 0.03, 2: 0.02, 4: 0.015, 5: 0.02, 6: 0.02, 7: 0.02, 8: 0.02, 9: 0.02}),
            bed(yr + 0.05, 0.62),
            bed(-1.6, 0.56),
            bed(self.Y_CAB, 0.52),
            sec(self.Y_ROOFR, W=W, zb=0.5, zbelt=1.3, zmax=1.0, top=('glass', 1.72, 0.775, 1.765)),
            sec(-0.3, W=W, zb=0.5, zbelt=1.295, zmax=1.0, top=('glass', 1.745, 0.785, 1.79)),
            sec(self.Y_HEADER, W=W, zb=0.5, zbelt=1.285, zmax=1.0, top=('glass', 1.715, 0.775, 1.765)),
            sec(self.Y_COWL, W=0.915, zb=0.5, zbelt=1.17, zmax=0.95, top=('deck', 1.2, 0.95, 0.87, 0.45)),
            sec(1.8, W=0.91, zb=0.5, zbelt=1.12, zmax=0.9, top=('deck', 1.145)),
            sec(yf - 0.08, W=0.895, zb=0.5, zbelt=1.05, zmax=0.78, top=('deck', 1.08)),
            sec(yf, W=0.86, zb=0.48, zbelt=0.98, zmax=0.72, top=('deck', 1.02),
                dy={0: -0.08, 1: -0.08, 2: -0.04, 4: -0.04, 5: -0.06, 6: -0.06, 7: -0.06, 8: -0.06, 9: -0.06}),
        ]
        return vkit.Body(S, round_front=0.3, round_rear=0.06, front_bulge=0.03, rear_bulge=0.0)

    def extra_cuts(self, lod):
        """Load bed: subtract the tub from the rear body (bedliner faces become 'trim')."""
        mb = vkit.MB()
        vkit.box(mb, (0, (self.Y_CAB - 0.035 + self.yr + 0.065) / 2, 0.87 + 0.6),
                 (1.52, (self.Y_CAB - 0.035) - (self.yr + 0.065), 1.2), 'trim')
        return [mb]

    def paint(self, cv):
        yf, yr = self.yf, self.yr
        af, ar = self.AXLE_F, self.AXLE_R
        R = self.TYRE_R + self.ARCH_GAP
        cv.line([(self.Y_COWL - 0.02, 1.6), (self.Y_COWL - 0.02, 4.9)])
        cv.line([(self.Y_B[1] + 0.012, 1.6), (self.Y_B[1] + 0.012, 4.9)])
        cv.line([(self.Y_B[0] - 0.012, 1.6), (self.Y_B[0] - 0.012, 4.9)])
        cv.line([(self.Y_CAB + 0.06, 1.6), (self.Y_CAB + 0.06, 4.9)])
        cv.line([(self.Y_COWL - 0.02, 1.65), (self.Y_CAB + 0.06, 1.65)])
        cv.line([(self.Y_CAB - 0.012, 1.6), (self.Y_CAB - 0.012, 4.95)])   # cab / bed gap
        cv.handle(self.Y_B[1] + 0.22, 4.3)
        cv.handle(self.Y_CAB + 0.25, 4.3)
        cv.line([(yf - 0.1, 6.1), (af, 6.05), (self.Y_COWL + 0.03, 6.0)])
        cv.line([(self.Y_COWL + 0.03, 6.0), (self.Y_COWL + 0.035, 8.99)])
        cv.line([(yf - 0.3, 5.0), (af + R + 0.12, 4.2), (af + R + 0.04, 3.0)])
        cv.rect(ar + 0.55, ar + 0.72, 3.9, 4.4, sides=(-1,), outline=90)
        cv.cap_line([(-0.86, 1.2), (0.86, 1.2)], 'rear')

    def livery(self, path):
        liveries.cargo(path)

    def details(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        rings = 2 if lod == 0 else 1
        # headlamps + big chrome grille
        hl = [(-0.18, 0.06), (-0.18, -0.055), (0.05, -0.07), (0.2, -0.05), (0.27, 0.0), (0.28, 0.07), (0.1, 0.08)]
        ctx.patch('front', (0.64, yf, 0.9), hl, 'light_front', yaw=30, mirror=True, offset=0.006, flat=0.4,
                  uv_rect=C.uv('head_modern'), depth=0.012, side_mat='trim', rings=rings)
        g = [(-0.46, 0.1), (-0.42, -0.1), (0.42, -0.1), (0.46, 0.1)]
        ctx.patch('front', (0, yf, 0.88), g, 'trim', offset=0.005, rings=1, bezel=('chrome', 0.03))
        if lod == 0:
            for dz in (-0.06, -0.02, 0.02, 0.06):
                ctx.strip('front', (0, yf, 0.88 + dz), [(-0.43, 0), (0.43, 0)], 0.016, 'chrome', offset=0.01, thick=0.006)
            ctx.patch('front', (0, yf, 0.9), C.ellipse(0.07, 0.05, 12), 'chrome', offset=0.016, rings=1, flat=1.0)
        # lower bumper intake + fogs
        ctx.patch('front', (0, yf, 0.6), [(-0.5, 0.05), (-0.45, -0.05), (0.45, -0.05), (0.5, 0.05)], 'trim',
                  offset=0.004, rings=1)
        if lod == 0:
            ctx.patch('front', (0.64, yf, 0.6), C.ellipse(0.045, 0.035, 10), 'light_front', mirror=True, yaw=15,
                      uv_rect=C.uv('fog'), offset=0.007, rings=1)
        C.plate(ctx, 'front', (0, yf, 0.72))
        # tailgate: vertical lamps at the bed corners, handle, plate; chrome step bumper
        tl = C.rect(0.1, 0.36)
        ctx.patch('rear', (0.845, yr, 1.02), tl, 'light_rear', yaw=30, mirror=True, offset=0.007, rings=rings,
                  uv_rect=C.uv('tail'), depth=0.012, side_mat='trim')
        C.plate(ctx, 'rear', (0, yr, 0.8))
        vkit.box(ctx.mb, (0, yr - 0.02, 0.62), (1.72, 0.16, 0.12), 'chrome')
        vkit.box(ctx.mb, (0, yr + 0.02, 0.55), (1.6, 0.14, 0.04), 'trim')
        if lod == 0:
            ctx.patch('rear', (0, yr, 1.14), C.rrect(0.24, 0.06, 0.02), 'chrome', offset=0.006, rings=1, flat=1.0)
            C.mirrors(ctx, y=self.Y_COWL - 0.1, z=1.35, x_out=1.03, size=(0.11, 0.2, 0.17), mat='trim')
            C.wipers(ctx, self, y=self.Y_COWL - 0.08, spans=((0.35, 0.65), (-0.25, 0.6)))
            C.side_repeaters(ctx, y=1.95, z=1.0)
            C.exhaust(ctx, -0.6, yr + 0.35, 0.45, r=0.03)
            # tow hitch
            vkit.box(ctx.mb, (0, yr - 0.14, 0.55), (0.06, 0.12, 0.06), 'trim')
        C.arch_flares(ctx, self)
        C.side_steps(ctx, self, z=0.45)
        C.interior(ctx, y_dash=self.Y_COWL - 0.05, y_back=self.Y_CAB + 0.08, x_half=0.75, z_floor=0.62, z_dash=1.2,
                   z_seat=0.9, rows=[(0.3, 'pair'), (-0.5, 'bench')], z_head=self.ROOF_Z - 0.06,
                   head_span=(self.Y_ROOFR + 0.06, self.Y_HEADER - 0.05), dash_depth=0.42)
        # cab rear window (projected on the cab back wall, above the bed rail)
        ctx.patch('rear', (0, self.Y_CAB, 1.52), C.rrect(1.1, 0.3, 0.05), 'interior', offset=0.003, rings=1)
        ctx.patch('rear', (0, self.Y_CAB, 1.52), C.rrect(1.1, 0.3, 0.05), 'glass', offset=0.007, rings=1,
                  bezel=('trim', 0.02))
        # toggles: sports bar and a load of sacks in the bed
        mb = ctx.tog('sports_bar')
        prof = vkit.circle_profile(0.035, 8 if lod == 0 else 4)
        yb = self.Y_CAB - 0.12
        vkit.sweep(mb, [(-0.74, yb, 1.26), (-0.74, yb - 0.05, 1.62), (-0.62, yb - 0.08, 1.8), (0.62, yb - 0.08, 1.8),
                        (0.74, yb - 0.05, 1.62), (0.74, yb, 1.26)], prof, 'chrome')
        vkit.sweep(mb, [(-0.74, yb - 0.05, 1.62), (-0.74, yb - 0.55, 1.26)], prof, 'chrome')
        vkit.sweep(mb, [(0.74, yb - 0.05, 1.62), (0.74, yb - 0.55, 1.26)], prof, 'chrome')
        mb = ctx.tog('cargo')
        for c, sz, cell in [((-0.35, -1.45, 1.1), (0.6, 0.5, 0.45), 'cargo_sack'), ((0.35, -1.45, 1.1), (0.6, 0.5, 0.45), 'cargo_sack'),
                            ((-0.3, -2.0, 1.15), (0.7, 0.55, 0.55), 'cargo_bag'), ((0.35, -2.05, 1.05), (0.6, 0.6, 0.35), 'cargo_box'),
                            ((0.0, -1.75, 1.45), (0.9, 0.9, 0.35), 'cargo_tarp')]:
            C.cargo_box(mb, c, sz, CARGO[cell], lod=lod)


SPEC = Hilux()
