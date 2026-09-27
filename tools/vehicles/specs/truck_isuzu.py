"""Isuzu N-series (NQR 500 class) cab-over light truck with an aluminium box body - the delivery truck
of the Harare CBD. Dimensions: L 7.0 m, W 2.2 m (box; cab 1.995 m), H 3.0 m, wheelbase 3.9 m,
215/75R17.5 (r 0.383 m), dual rear wheels."""
import vkit
from vkit import edit, sec

import liveries
from . import common as C
from .base import Base

LAY = liveries.truck_layout()


class Truck(Base):
    NAME = 'truck_isuzu'
    TITLE = 'Isuzu N-series box truck'
    REAL = 'Isuzu N-series NQR 500 (wide cab) with 5.1 m dry-freight box'
    LENGTH = 7.0
    WIDTH = 2.2
    CAB_W = 1.995
    HEIGHT = 3.0
    WHEELBASE = 3.9
    TRACK_F = 1.68
    TRACK_R = 1.79
    TYRE_R = 0.383
    TYRE_W = 0.215
    RIM_R = 0.222
    FRONT_OVERHANG = 1.1
    WHEEL_STYLE = 'truck'
    REAR_DUAL = True
    ARCH_GAP = 0.06
    ARCH_RAISE = 0.03
    ARCH_DEPTH = 0.42
    STEER_MAX_DEG = 40
    PLATE = 'AEY 9034'
    PREVIEW_PAINT = '#efefea'
    PAINTS = ['#efefea', '#efefea', '#1f4e9c', '#b01e23', '#2e6b3f', '#d9a520']
    GRIME = 0.4
    DS = {0: 0.07, 1: 0.35}
    yf, yr = 3.5, -3.5
    Y_CAB = 3.5 - 1.78
    Y_COWL = 3.5 - 0.1
    Y_HEADER = 3.5 - 0.42
    Y_B = (2.2, 2.3)
    BOX = (1.62, -3.45, 1.0, 3.0)   # y front, y rear, z bottom, z top

    @property
    def W(self):
        return self.CAB_W / 2

    @property
    def BREAKS(self):
        return [self.Y_COWL, self.Y_HEADER, self.Y_CAB + 0.12, *self.Y_B]

    @property
    def RULES(self):
        return [
            dict(mat='trim', k0=0, k1=0),
            dict(mat='glass', y0=self.Y_B[1], y1=self.Y_COWL, k0=5, k1=5, tag='inset'),
            dict(mat='glass', y0=self.Y_CAB + 0.12, y1=self.Y_B[0], k0=5, k1=5, tag='inset'),
            dict(mat='trim', y0=self.Y_B[0], y1=self.Y_B[1], k0=5, k1=5, tag='inset'),
            dict(mat='glass', y0=self.Y_HEADER, y1=self.Y_COWL, k0=7, k1=8, tag='inset'),
            dict(mat='trim', k0=-1, cap='front', zmax=0.72),
            dict(mat='trim', y0=self.yf - 0.12, y1=9, k0=0, k1=3, zmax=0.72),
        ]

    def arches(self):
        R = self.TYRE_R + self.ARCH_GAP
        return [(self.AXLE_F, R, self.TYRE_R + self.ARCH_RAISE, self.ARCH_DEPTH)]

    def body(self):
        """Cab only; the chassis and box are separate parts added in details()."""
        W = self.W
        yf = self.yf
        zb = 0.78

        def cab(y, w=W):
            s = sec(y, W=w, zb=zb, zbelt=1.52, zmax=1.1, top=('glass', 2.12, w - 0.035, 2.32), tuck=0.02, rb=0.05)
            return edit(s, k7=(w - 0.09, 2.24), k8=(w * 0.5, 2.315), k9=(0.0, 2.32))
        S = [
            cab(self.Y_CAB, W - 0.02),
            cab(self.Y_CAB + 0.08),
            cab(self.Y_HEADER),
            sec(self.Y_COWL, W=W, zb=0.66, zbelt=1.38, zmax=0.95, top=('deck', 1.4, 0.975, 0.94, 0.5), rb=0.05),
            sec(yf, W=W - 0.02, zb=0.5, zbelt=1.32, zmax=0.72, top=('deck', 1.34, 0.975, 0.94, 0.5), rb=0.05,
                dy={0: -0.03, 1: -0.03, 2: 0.0, 3: 0.02, 4: -0.1, 5: -0.1, 6: -0.1, 7: -0.1, 8: -0.1, 9: -0.1}),
        ]
        return vkit.Body(S, round_front=0.14, round_rear=0.05, front_bulge=0.02, rear_bulge=0.0)

    def paint(self, cv):
        yf = self.yf
        cv.line([(yf - 0.14, 1.9), (yf - 0.14, 4.95)])
        cv.line([(self.Y_B[0] - 0.02, 1.9), (self.Y_B[0] - 0.02, 4.95)])
        cv.line([(yf - 0.14, 1.9), (self.Y_B[0] - 0.02, 1.9)])
        cv.handle(self.Y_B[0] + 0.12, 4.25)
        cv.cap_line([(-0.9, 1.0), (0.9, 1.0)], 'front')

    def livery(self, path):
        liveries.truck(path)

    def details(self, ctx):
        yf, yr = self.yf, self.yr
        lod = ctx.lod
        rings = 2 if lod == 0 else 1
        mb = ctx.mb
        # cab front: black grille panel with slats, low headlamps, indicators, bumper plate
        ctx.patch('front', (0, yf, 1.02), C.rect(1.3, 0.34), 'trim', offset=0.004, rings=1)
        if lod == 0:
            for dz in (-0.1, -0.03, 0.04, 0.11):
                ctx.strip('front', (0, yf, 1.02 + dz), [(-0.62, 0), (0.62, 0)], 0.022, 'chrome' if dz == 0.11 else 'trim',
                          offset=0.009, thick=0.006)
        ctx.patch('front', (0.74, yf, 0.8), C.rrect(0.34, 0.14, 0.03), 'light_front', mirror=True, yaw=12, offset=0.007,
                  rings=rings, uv_rect=C.uv('head_modern'), depth=0.012, side_mat='trim')
        ctx.patch('front', (0.94, yf, 0.8), C.rect(0.08, 0.14), 'indicator', mirror=True, yaw=45, offset=0.006, rings=1,
                  uv_rect=C.uv('indicator'))
        C.plate(ctx, 'front', (0, yf, 0.6))
        # cab steps + mirrors + wipers
        for sd in (1, -1):
            vkit.box(mb, (sd * (self.W - 0.08), self.AXLE_F - 0.62, 0.5), (0.2, 0.36, 0.05), 'trim')
        if lod == 0:
            C.truck_mirrors(ctx, yf - 0.3, 1.65, self.W - 0.02, reach=0.2, h=0.34, w=0.18)
            C.wipers(ctx, self, y=self.Y_COWL - 0.05, spans=((0.5, 0.75), (-0.3, 0.72)))
            C.side_repeaters(ctx, y=yf - 0.25, z=1.1)
        # chassis rails and cross-members
        vkit.box(mb, (0.43, (self.Y_CAB + 0.2 + yr + 0.15) / 2, 0.72), (0.08, (self.Y_CAB + 0.2) - (yr + 0.15), 0.22), 'trim')
        vkit.box(mb, (-0.43, (self.Y_CAB + 0.2 + yr + 0.15) / 2, 0.72), (0.08, (self.Y_CAB + 0.2) - (yr + 0.15), 0.22), 'trim')
        for y in (1.2, 0.0, -1.2, -2.6):
            vkit.box(mb, (0, y, 0.72), (0.8, 0.07, 0.14), 'trim')
        # fuel tank (right) and battery box (left) between the axles
        vkit.cylinder(mb, (0.66, 0.35, 0.62), 'y', 0.2, 0.9, 'rim', segs=12 if lod == 0 else 6)
        vkit.box(mb, (-0.68, 0.4, 0.62), (0.36, 0.6, 0.32), 'trim')
        # box body (livery-mapped aluminium) with sub-frame, rear doors and lamps on the rear bar
        y0, y1, z0, z1 = self.BOX
        bw = self.WIDTH
        C.uv_box(mb, (0, (y0 + y1) / 2, (z0 + z1) / 2), (bw, y0 - y1, z1 - z0),
                 dict(right=LAY['box_side'], left=LAY['box_side'], front=LAY['box_front'], rear=LAY['box_rear'],
                      top=LAY['box_front'], bottom=None))
        vkit.box(mb, (0, (y0 + y1) / 2, z0 - 0.07), (bw - 0.1, y0 - y1 - 0.1, 0.14), 'trim')
        if lod == 0:
            for zz in (z0 + 0.02, z1 - 0.02):
                for sd in (1, -1):
                    vkit.box(mb, (sd * (bw / 2 + 0.005), (y0 + y1) / 2, zz), (0.02, y0 - y1 + 0.02, 0.05), 'chrome')
            for sd in (1, -1):
                vkit.box(mb, (sd * (bw / 2 - 0.02), y1 - 0.008, (z0 + z1) / 2), (0.05, 0.02, z1 - z0), 'chrome')
        # rear under-run bar, tail lamps, plate, mudguards
        vkit.box(mb, (0, yr + 0.05, 0.5), (1.9, 0.08, 0.12), 'trim')
        for sd in (1, -1):
            vkit.box(mb, (sd * 0.65, yr + 0.12, 0.72), (0.08, 0.2, 0.3), 'trim')
            vkit.box(mb, (sd * 0.85, yr + 0.03, 0.7), (0.24, 0.05, 0.12), 'light_rear',
                     uv=((C.uv('tail_plain')[0] + C.uv('tail_plain')[2]) / 2, (C.uv('tail_plain')[1] + C.uv('tail_plain')[3]) / 2))
        ic = C.uv('indicator')
        for sd in (1, -1):
            vkit.box(mb, (sd * 0.62, yr + 0.03, 0.7), (0.12, 0.05, 0.12), 'indicator', uv=((ic[0] + ic[2]) / 2, (ic[1] + ic[3]) / 2))
        C.plate_quad(mb, (0, yr - 0.001, 0.5), -1)
        for sd in (1, -1):
            C.mudguard(mb, sd * 0.56, sd * 1.06, self.AXLE_R, self.TYRE_R + 0.02, self.TYRE_R + 0.08, a0=0, a1=180,
                       n=8 if lod == 0 else 3)
            vkit.box(mb, (sd * 0.82, self.AXLE_R - self.TYRE_R - 0.12, 0.45), (0.46, 0.02, 0.5), 'trim')
        C.interior(ctx, y_dash=self.Y_COWL - 0.05, y_back=self.Y_CAB + 0.1, x_half=0.9, z_floor=1.0, z_dash=1.42,
                   z_seat=1.2, rows=[(self.Y_COWL - 0.7, 'bench')], z_head=2.26, dash_depth=0.35,
                   head_span=(self.Y_CAB + 0.1, self.Y_HEADER - 0.05))


SPEC = Truck()
