"""Zimbabwe Republic Police (ZRP) Land Cruiser 200: white, blue side band with gold pinstripes, POLICE
lettering, ZRP badge, roof light bar (beacon_blue / beacon_red materials) and a black push bar.
Livery colours follow docs/references/STREETLIFE.md (approx)."""
import vkit
import liveries

from . import common as C
from .suv_landcruiser import LandCruiser

LAY = liveries.police_layout()


def flip_u(c):
    return (c[2], c[1], c[0], c[3])


class Police(LandCruiser):
    NAME = 'police_landcruiser'
    TITLE = 'ZRP police Land Cruiser 200'
    PLATE = 'ZRP 4471'
    PREVIEW_PAINT = '#f2f2ee'
    PAINTS = ['#f2f2ee']
    GRIME = 0.25

    def livery(self, path):
        liveries.police(path)

    def details(self, ctx):
        super().details(ctx)
        lod = ctx.lod
        yf, yr = self.yf, self.yr
        # blue band along both sides (broken at the arches), POLICE on the doors, ZRP badge
        af, ar, R = self.AXLE_F, self.AXLE_R, self.TYRE_R + self.ARCH_GAP + 0.04
        band = LAY['band']
        for where, sd in (('right', 1), ('left', -1)):
            for a0, a1 in ((yf - 0.12, af + R), (af - R + 0.02, ar + R), (ar - R, yr + 0.08)):
                ctx.strip(where, (sd * 3, 0, 0), [(a0, 0.9), (a1, 0.9)], 0.2, 'livery', offset=0.004,
                          uv_u=(band[0], band[2]), uv_v=(band[1], band[3]))
        ctx.patch('right', (3, 0.25, 0.9), C.rect(0.95, 0.2), 'livery', offset=0.006, rings=1, uv_rect=LAY['door'])
        ctx.patch('left', (-3, 0.25, 0.9), C.rect(0.95, 0.2), 'livery', offset=0.006, rings=1, uv_rect=flip_u(LAY['door']))
        ctx.patch('right', (3, -0.6, 1.12), C.ellipse(0.1, 0.1, 14), 'livery', offset=0.006, rings=1, uv_rect=LAY['crest'])
        ctx.patch('left', (-3, -0.6, 1.12), C.ellipse(0.1, 0.1, 14), 'livery', offset=0.006, rings=1, uv_rect=flip_u(LAY['crest']))
        hood = LAY['hood']
        ctx.patch('top', (0, 1.75, 5), C.rect(0.9, 0.22), 'livery', offset=0.005, rings=1,
                  uv_rect=(hood[2], hood[3], hood[0], hood[1]))
        # tailgate lettering sits below the glass line (at z 1.27 its top half sank into the tailgate crease)
        ctx.patch('rear', (0, yr, 1.185), C.rect(0.56, 0.12), 'livery', offset=0.006, rings=1, uv_rect=flip_u(hood))
        # light bar
        loc, _n = ctx.surface(0.0, -0.35)
        z = (loc.z if loc is not None else self.ROOF_Z) + 0.03
        lb = LAY['lightbar']
        C.sign_box(ctx.mb, (0, -0.35, z + 0.03), (1.2, 0.3, 0.06), lb, lb, lb, taper=1.0)
        for sd, mat in ((-1, 'beacon_blue'), (1, 'beacon_red')):
            vkit.rounded_box(ctx.mb, (sd * 0.3, -0.35, z + 0.1), (0.55, 0.26, 0.09), 0.08, mat, n=2 if lod == 0 else 1)
        vkit.box(ctx.mb, (0, -0.35, z + 0.1), (0.06, 0.24, 0.08), 'trim')
        for sd in (1, -1):
            vkit.box(ctx.mb, (sd * 0.55, -0.35, z - 0.01), (0.05, 0.2, 0.06), 'trim')
        # black push bar in front of the grille
        if lod == 0:
            prof = vkit.circle_profile(0.03, 8)
            yb = yf + 0.1
            for sd in (1, -1):
                vkit.sweep(ctx.mb, [(sd * 0.42, yf - 0.05, 0.55), (sd * 0.42, yb, 0.58), (sd * 0.42, yb, 1.0), (sd * 0.36, yb - 0.06, 1.08)],
                           prof, 'trim')
            vkit.sweep(ctx.mb, [(-0.46, yb, 0.62), (0.46, yb, 0.62)], prof, 'trim')
            vkit.sweep(ctx.mb, [(-0.44, yb, 0.95), (0.44, yb, 0.95)], prof, 'trim')
        else:
            vkit.box(ctx.mb, (0, yf + 0.1, 0.8), (0.9, 0.06, 0.45), 'trim')

    def meta(self):
        m = super().meta()
        m['livery'] = 'ZRP white/blue/gold (approx), baked into body; beacons: beacon_blue (left), beacon_red (right)'
        return m


SPEC = Police()
