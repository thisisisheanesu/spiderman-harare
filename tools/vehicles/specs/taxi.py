"""Harare metered taxi: a Toyota Corolla Axio in taxi yellow (the yellow cabs seen at Eastgate) with a
TAXI roof sign and a black/white checker band. Also sensible in white/silver (paint is per instance)."""
import liveries

from . import common as C
from .sedan_corolla import Corolla

LAY = liveries.taxi_layout()


def flip_u(c):
    return (c[2], c[1], c[0], c[3])


class Taxi(Corolla):
    NAME = 'taxi'
    TITLE = 'Metered taxi (Toyota Corolla Axio)'
    PLATE = 'ACN 6041'
    PREVIEW_PAINT = '#f2c21a'
    PAINTS = ['#f2c21a', '#f2c21a', '#eeeeea', '#b7bbbf']
    GRIME = 0.3

    def livery(self, path):
        liveries.taxi(path)

    def details(self, ctx):
        super().details(ctx)
        # roof sign (always on)
        loc, _n = ctx.surface(0.0, -0.35)
        z = (loc.z if loc is not None else self.ROOF_Z) + 0.085
        C.sign_box(ctx.mb, (0, -0.35, z), (0.52, 0.16, 0.16), LAY['sign_face'], LAY['sign_side'], LAY['sign_body'])
        # door decals: TAXI + checker band over both doors
        ctx.patch('right', (2, -0.05, 0.64), C.rect(1.75, 0.2), 'livery', offset=0.004, rings=1, uv_rect=LAY['door'])
        ctx.patch('left', (-2, -0.05, 0.64), C.rect(1.75, 0.2), 'livery', offset=0.004, rings=1,
                  uv_rect=flip_u(LAY['door']))
        if ctx.lod == 0:
            ctx.strip('rear', (0, -self.LENGTH / 2, 0.52), [(-0.6, 0), (0.6, 0)], 0.05, 'livery', offset=0.005,
                      uv_u=(LAY['checker'][0], LAY['checker'][2]), uv_v=(LAY['checker'][1], LAY['checker'][3]))

    def meta(self):
        m = super().meta()
        m['livery'] = 'yellow Harare cab: roof sign + checker band (baked into body)'
        return m


SPEC = Taxi()
