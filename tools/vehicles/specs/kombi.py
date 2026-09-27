"""Toyota HiAce H100 'Commuter' high-roof long-body minibus - the white Harare kombi.
Dimensions: L 4.695 m, W 1.69 m, H 2.20 m (high roof), wheelbase 2.79 m, track 1.445/1.43 m,
195R15C tyres (r 0.345 m). Sliding door on the left (kerb side, left-hand traffic), right-hand drive."""
import math

import liveries
import vkit
from vkit import edit, sec

from . import common as C
from .base import Base

LAY = liveries.kombi_layout()


def flip_u(c):
    return (c[2], c[1], c[0], c[3])


class Kombi(Base):
    NAME = 'kombi'
    TITLE = 'Toyota HiAce H100 Commuter (kombi)'
    REAL = 'Toyota HiAce H100 Commuter LH114/LH125, long body, high roof (1989-2004)'
    LENGTH = 4.695
    WIDTH = 1.69
    HEIGHT = 2.2
    WHEELBASE = 2.79
    TRACK_F = 1.445
    TRACK_R = 1.43
    TYRE_R = 0.345
    TYRE_W = 0.195
    RIM_R = 0.19
    FRONT_OVERHANG = 0.86
    WHEEL_STYLE = 'steel'
    ARCH_GAP = 0.05
    ARCH_DEPTH = 0.36
    PLATE = 'ADT 7719'
    INDICATORS = [('rear', (0.765, -2.3475, 1.16), 30, 0.12, 0.08)]
    PREVIEW_PAINT = '#efeee8'
    PAINTS = ['#efeee8', '#efeee8', '#efeee8', '#e4e1d8', '#b7bbbf', '#7fa3c7', '#1e2d55', '#5b1b22']
    GRIME = 0.45
    DS = {0: 0.07, 1: 0.35}
    TOGGLES = {
        'roof_rack': {'group': 'roof_rack', 'default': False, 'preview': True},
        'livery_stripe': {'group': 'livery_stripe', 'default': False, 'preview': True},
        'livery_zupco': {'group': 'livery_zupco', 'default': False},
        **{f'banner_{i}': {'group': 'banner', 'default': i == 0, 'preview': i == 0} for i in range(6)},
        **{f'route_{i}': {'group': 'route', 'default': i == 0, 'preview': i == 0} for i in range(8)},
    }
    VIEWS = ('front34', 'side', 'rear34', 'front')

    yf = 4.695 / 2
    yr = -4.695 / 2
    Y_COWL = yf - 0.10
    Y_HEADER = yf - 0.62
    Z_BELT = 1.2
    Z_WTOP = 1.74
    WINDOWS = [(1.115, 2.247), (0.225, 1.035), (-0.70, 0.145), (-2.16, -0.78)]

    @property
    def BREAKS(self):
        b = [self.Y_COWL, self.Y_HEADER, self.yf - 0.14]
        for a, c in self.WINDOWS:
            b += [a, c]
        return b

    @property
    def RULES(self):
        yf, yr = self.yf, self.yr
        r = [dict(mat='trim', k0=0, k1=0)]
        for a, c in self.WINDOWS:
            r.append(dict(mat='glass', y0=a, y1=min(c, self.Y_COWL), k0=5, k1=5, tag='inset'))
        r += [
            dict(mat='glass', y0=self.Y_HEADER, y1=self.Y_COWL, k0=7, k1=8, tag='inset'),
            # wrap-around black bumpers
            dict(mat='trim', y0=yf - 0.14, y1=yf + 1, k0=0, k1=4, zmax=0.63),
            dict(mat='trim', y0=yr - 1, y1=yr + 0.12, k0=0, k1=4, zmax=0.66),
            dict(mat='trim', k0=-1, cap='front', zmax=0.63),
            dict(mat='trim', k0=-1, cap='rear', zmax=0.66),
        ]
        return r

    def body(self):
        yf, yr = self.yf, self.yr
        W = self.W
        zb = 0.36
        hi = lambda s: edit(s, k7=(0.78, 2.02), k8=(0.46, 2.185), k9=(0.0, 2.2))  # noqa: E731
        S = [
            sec(yr, W=0.835, zb=0.38, zbelt=1.12, zmax=0.55, top=('glass', 1.78, 0.79, 2.14), tuck=0.02,
                dy={0: 0.03, 1: 0.03, 2: -0.03, 3: -0.05, 4: 0.01, 5: 0.02, 6: 0.02, 7: 0.03, 8: 0.03, 9: 0.03}),
            hi(sec(yr + 0.12, W=W, zb=zb, zbelt=self.Z_BELT, zmax=0.62, top=('glass', self.Z_WTOP, 0.81, 2.2), tuck=0.02)),
            hi(sec(-0.5, W=W, zb=zb, zbelt=self.Z_BELT, zmax=0.62, top=('glass', self.Z_WTOP + 0.01, 0.812, 2.2), tuck=0.02)),
            hi(sec(yf - 1.05, W=W, zb=zb, zbelt=self.Z_BELT, zmax=0.62, top=('glass', self.Z_WTOP + 0.01, 0.81, 2.2), tuck=0.02)),
            edit(sec(self.Y_HEADER, W=W, zb=zb, zbelt=self.Z_BELT, zmax=0.62, top=('glass', self.Z_WTOP, 0.80, 1.86), tuck=0.02),
                 k7=(0.765, 1.8), k8=(0.42, 1.855)),
            sec(self.Y_COWL, W=0.845, zb=0.35, zbelt=1.1, zmax=0.58, top=('deck', 1.12, 0.975, 0.93, 0.5)),
            sec(yf, W=0.835, zb=0.34, zbelt=1.06, zmax=0.52, top=('deck', 1.1, 0.975, 0.93, 0.5),
                dy={0: -0.06, 1: -0.06, 2: -0.02, 3: 0.0, 4: -0.10, 5: -0.10, 6: -0.10, 7: -0.10, 8: -0.10, 9: -0.10}),
        ]
        return vkit.Body(S, round_front=0.12, round_rear=0.12, front_bulge=0.012, rear_bulge=0.01)

    # ------------------------------------------------------------------------------------------------
    def paint(self, cv):
        yf, yr = self.yf, self.yr
        # cab doors (both sides)
        cv.line([(yf - 0.13, 2.0), (yf - 0.13, 4.95)])
        cv.line([(1.075, 1.9), (1.075, 4.95)])
        cv.line([(yf - 0.13, 2.0), (self.AXLE_F + 0.42, 2.0), (self.AXLE_F + 0.40, 2.6), (self.AXLE_F - 0.40, 2.6), (1.09, 2.6)])
        cv.handle(1.2, 4.3)
        # sliding door (left side), with the rail cover line
        cv.line([(1.035, 1.75), (1.035, 7.0)], sides=(-1,))
        cv.line([(0.13, 1.75), (0.13, 7.0)], sides=(-1,))
        cv.line([(1.035, 1.75), (0.13, 1.75)], sides=(-1,))
        cv.line([(1.035, 6.95), (0.13, 6.95)], sides=(-1,))
        cv.handle(0.95, 4.2, sides=(-1,))
        # fuel filler (right, behind the rear wheel) and rear quarter seams
        cv.rect(self.AXLE_R - 0.62, self.AXLE_R - 0.45, 3.7, 4.2, sides=(1,), outline=95)
        cv.line([(yr + 0.12, 3.0), (yr + 0.12, 4.9)])
        # rear hatch outline on the rear face
        cv.cap_line([(-0.74, 0.7), (0.74, 0.7), (0.74, 2.0), (-0.74, 2.0), (-0.74, 0.7)], 'rear')
        # front panel shut line
        cv.cap_line([(-0.78, 0.95), (0.78, 0.95)], 'front')

    def livery(self, path):
        liveries.kombi(path)

    # ------------------------------------------------------------------------------------------------
    def details(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        rings = 2 if lod == 0 else 1
        # --- front: grille band, rectangular lamps, wrap-around indicators, logo, plate
        ctx.patch('front', (0, yf, 0.81), C.rect(0.98, 0.15), 'trim', offset=0.004, rings=1)
        if lod == 0:
            for dz in (-0.035, 0.0, 0.035):
                ctx.strip('front', (0, yf, 0.81 + dz), [(-0.47, 0), (0.47, 0)], 0.012, 'chrome', offset=0.008)
            ctx.patch('front', (0, yf, 0.86), C.ellipse(0.05, 0.03, 12), 'chrome', offset=0.012, rings=1, flat=1.0)
        ctx.patch('front', (0.61, yf, 0.81), C.rect(0.22, 0.155), 'light_front', mirror=True, offset=0.008, rings=rings,
                  uv_rect=C.uv('head_rect'), depth=0.012, side_mat='trim', flat=0.8)
        ctx.patch('front', (0.775, yf, 0.81), C.rect(0.1, 0.155), 'indicator', yaw=38, mirror=True, offset=0.007,
                  rings=1, uv_rect=C.uv('indicator'), depth=0.01, side_mat='trim')
        C.plate(ctx, 'front', (0, yf, 0.47))
        if lod == 0:
            # bumper vents
            for dz in (-0.03, 0.03):
                ctx.strip('front', (0, yf, 0.53 + dz), [(-0.3, 0), (0.3, 0)], 0.018, 'trim', offset=0.004)
        # --- rear: hatch window (dark backing + glass), vertical tail lamps, plate, handle
        rw = C.rrect(1.44, 0.6, 0.06)
        # flat=1: the rear cap is a Coons patch with ~1 cm diagonal ridges; a conforming pane showed them as
        # an 'X' in the reflections and sank into them at the corners, so the backing and glass are flat panes
        ctx.patch('rear', (0, yr, 1.5), rw, 'interior', offset=0.003, rings=1, flat=1.0)
        ctx.patch('rear', (0, yr, 1.5), rw, 'glass', offset=0.007, rings=1, bezel=('trim', 0.02), flat=1.0)
        tl = C.rect(0.12, 0.40)
        ctx.patch('rear', (0.765, yr, 0.9), tl, 'light_rear', yaw=30, mirror=True, offset=0.007, rings=rings,
                  uv_rect=C.uv('tail'), depth=0.012, side_mat='trim')
        C.plate(ctx, 'rear', (0, yr, 0.88))
        if lod == 0:
            ctx.strip('rear', (0, yr, 1.1), [(-0.18, 0), (0.18, 0)], 0.03, 'trim', offset=0.006, thick=0.01)
            C.truck_mirrors(ctx, yf - 0.28, 1.22, 0.83, reach=0.14, h=0.2, w=0.15)
            C.wipers(ctx, self, y=self.Y_COWL - 0.05, spans=((0.32, 0.62), (-0.18, 0.58)))
            C.side_repeaters(ctx, y=yf - 0.25, z=0.95)
            # black rubbing strips along both sides, broken at the wheel arches
            af, ar, R = self.AXLE_F, self.AXLE_R, self.TYRE_R + self.ARCH_GAP + 0.03
            for (a, c) in ((af + R, yf - 0.12), (ar + R, af - R), (yr + 0.1, ar - R)):
                for where in ('right', 'left'):
                    ctx.strip(where, ((1 if where == 'right' else -1) * 2, 0, 0), [(a, 0.66), (c, 0.66)], 0.05, 'trim',
                              offset=0.006, thick=0.008)
            # sliding door rail (left)
            ctx.strip('left', (-2, 0, 0), [(0.13, 1.135), (-0.72, 1.135)], 0.035, 'trim', offset=0.008, thick=0.012)
            C.exhaust(ctx, 0.5, yr + 0.15, 0.3)
        # --- interior: cab-over dash, driver + front bench, four passenger benches
        C.interior(ctx, y_dash=self.Y_COWL - 0.02, y_back=yr + 0.25, x_half=0.76, z_floor=0.62, z_dash=1.22,
                   z_seat=0.98, dash_depth=0.3, z_head=2.12, head_span=(yr + 0.3, self.Y_HEADER - 0.3),
                   rows=[(yf - 0.95, 'pair'), (0.95, 'bench'), (0.2, 'bench'), (-0.55, 'bench'), (-1.3, 'bench')])
        # roof vent hatch on the high roof
        vkit.box(ctx.mb, (0, -0.4, 2.215), (0.5, 0.5, 0.05), 'trim')
        vkit.box(ctx.mb, (0, -0.42, 2.245), (0.44, 0.4, 0.03), 'paint')
        # --- toggles --------------------------------------------------------------------------------
        self._liveries(ctx)
        self._rack(ctx)

    def _liveries(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        # factory waist stripe (gold over black) along both sides
        mb = ctx.tog('livery_stripe')
        segs = [(yf - 0.16, self.AXLE_F + 0.47), (self.AXLE_F + 0.47, yr + 0.14)] if lod == 0 else [(yf - 0.16, yr + 0.14)]
        c = LAY['stripe']
        for where, sd in (('right', 1), ('left', -1)):
            for a0, a1 in segs:
                n = 6 if lod == 0 else 2
                pts = [(a0 + (a1 - a0) * i / n, 0.93 + 0.05 * (a0 + (a1 - a0) * i / n - yr) / self.LENGTH) for i in range(n + 1)]
                ctx.strip(where, (sd * 2, 0, 0), pts, 0.07, 'livery', offset=0.004, mb=mb, uv_u=(c[0], c[2]), uv_v=(c[1], c[3]))
        # ZUPCO franchise: side stickers + windscreen strip + rear roundel
        mb = ctx.tog('livery_zupco')
        ctx.patch('right', (2, 0.55, 1.0), C.rect(0.62, 0.17), 'livery', offset=0.004, rings=1, uv_rect=LAY['zupco_side'], mb=mb)
        ctx.patch('left', (-2, 0.58, 1.0), C.rect(0.62, 0.17), 'livery', offset=0.004, rings=1,
                  uv_rect=flip_u(LAY['zupco_side']), mb=mb)
        ctx.patch('front', (0, yf, 1.745), C.rect(1.1, 0.06), 'livery', offset=0.004, rings=1,
                  uv_rect=flip_u(LAY['zupco_wind']), mb=mb, pitch=0)
        ctx.patch('rear', (-0.45, yr, 1.72), C.ellipse(0.07, 0.07, 12), 'livery', offset=0.01, rings=1,
                  uv_rect=flip_u(LAY['zupco_round']), mb=mb)
        # slogan banners (windscreen top + rear window top): one toggle per slogan
        for i in range(6):
            mb = ctx.tog(f'banner_{i}')
            ctx.patch('front', (0, yf, 1.615), C.rect(1.2, 0.1), 'livery', offset=0.005, rings=1,
                      uv_rect=flip_u(LAY[f'banner_{i}']), mb=mb)
            ctx.patch('rear', (0, yr, 1.72), C.rect(1.3, 0.09), 'livery', offset=0.011, rings=1,
                      uv_rect=flip_u(LAY[f'banner_{i}']), mb=mb)
        # route cards (kerb side, bottom of the windscreen)
        for i in range(8):
            mb = ctx.tog(f'route_{i}')
            ctx.patch('front', (-0.42, yf, 1.24), C.rect(0.3, 0.09), 'livery', offset=0.005, rings=1,
                      uv_rect=flip_u(LAY[f'route_{i}']), mb=mb)

    def _rack(self, ctx):
        """Galvanised roof rack on four feet per side, with a checked bag, a sack and a tarp bundle."""
        mb = ctx.tog('roof_rack')
        lod = ctx.lod
        y0, y1 = self.yr + 0.35, self.Y_HEADER - 0.25
        z = 2.2 + 0.1
        xh = 0.7
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
        # cargo
        cargo = [((-0.3, y0 + 0.5, z + 0.2), (0.7, 0.55, 0.38), 'cargo_bag'),
                 ((0.32, y0 + 0.45, z + 0.16), (0.55, 0.8, 0.3), 'cargo_sack'),
                 ((0.05, y0 + 1.35, z + 0.18), (1.1, 0.7, 0.34), 'cargo_tarp')]
        for c, sz, cell in cargo:
            u0, v0, u1, v1 = LAY[cell]
            cm = vkit.MB()
            vkit.rounded_box(cm, c, sz, 0.08, 'livery', n=2 if lod == 0 else 1)
            # planar UVs into the cell
            for f in cm.bm.faces:
                for loop in f.loops:
                    p = loop.vert.co
                    fu = ((p.x - c[0]) / sz[0] + 0.5 + (p.z - c[2]) / sz[2] * 0.3) % 1.0
                    fv = ((p.y - c[1]) / sz[1] + 0.5) % 1.0
                    loop[cm.uv].uv = (u0 + (u1 - u0) * (0.05 + 0.9 * fu), v0 + (v1 - v0) * (0.05 + 0.9 * fv))
            mb.add_bm(cm.bm)


SPEC = Kombi()
