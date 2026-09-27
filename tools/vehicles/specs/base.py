"""Shared defaults for vehicle specs (a spec is an instance of a Base subclass exported as SPEC)."""
import math

import vkit


class Base:
    NAME = ''
    TITLE = ''
    DS = {0: 0.065, 1: 0.3}
    BREAKS = []
    RULES = []
    TOGGLES = {}
    PLATE = 'AEZ 4821'
    PREVIEW_PAINT = '#b7bbbf'
    PAINTS = []
    GRIME = 0.22
    TYRE = 'road'
    SMOOTH = 38
    # dimensions (metres). y = forward, origin at ground under the middle of the overall length
    LENGTH = 4.4
    WIDTH = 1.7
    HEIGHT = 1.46
    WHEELBASE = 2.6
    TRACK_F = 1.48
    TRACK_R = 1.47
    TYRE_R = 0.31
    TYRE_W = 0.185
    RIM_R = 0.19          # rim radius (15" = 0.1905)
    FRONT_OVERHANG = 0.86
    WHEEL_STYLE = 'alloy5'
    REAR_DUAL = False
    ARCH_GAP = 0.05
    ARCH_RAISE = 0.025
    ARCH_DEPTH = 0.33
    STEER_MAX_DEG = 35
    REAL = ''            # real-world model the dimensions come from

    @property
    def W(self):
        return self.WIDTH / 2

    @property
    def AXLE_F(self):
        return self.LENGTH / 2 - self.FRONT_OVERHANG

    @property
    def AXLE_R(self):
        return self.AXLE_F - self.WHEELBASE

    def arches(self):
        R = self.TYRE_R + self.ARCH_GAP
        zc = self.TYRE_R + self.ARCH_RAISE
        return [(self.AXLE_F, R, zc, self.ARCH_DEPTH), (self.AXLE_R, R, zc, self.ARCH_DEPTH)]

    def wheels(self):
        r = self.TYRE_R
        rk = 'wheel_rear' if self.REAR_DUAL else 'wheel'
        return {
            'wheel_fl': (-self.TRACK_F / 2, self.AXLE_F, r, 'wheel'),
            'wheel_fr': (self.TRACK_F / 2, self.AXLE_F, r, 'wheel'),
            'wheel_rl': (-self.TRACK_R / 2, self.AXLE_R, r, rk),
            'wheel_rr': (self.TRACK_R / 2, self.AXLE_R, r, rk),
        }

    def wheel_mesh(self, key, lod):
        return vkit.wheel_mesh(key, R=self.TYRE_R, width=self.TYRE_W, rim_r=self.RIM_R, style=self.WHEEL_STYLE,
                               lod=lod, dual=(key == 'wheel_rear'))

    def body(self):
        raise NotImplementedError

    def details(self, ctx):
        pass

    def paint(self, cv):
        pass

    def meta(self):
        """Exported as extras on the root node (three.js: root.userData). Positions are glTF / three.js
        coordinates: x right, y up, z backwards (the vehicle faces -Z)."""
        return {
            'title': self.TITLE,
            'real_model': self.REAL,
            'length_m': self.LENGTH,
            'width_m': self.WIDTH,
            'height_m': self.HEIGHT,
            'wheelbase_m': self.WHEELBASE,
            'track_front_m': self.TRACK_F,
            'track_rear_m': self.TRACK_R,
            'wheel_radius_m': self.TYRE_R,
            'front_axle_z_m': round(-self.AXLE_F, 4),
            'rear_axle_z_m': round(-self.AXLE_R, 4),
            'steer_max_deg': self.STEER_MAX_DEG,
            'paints': self.PAINTS,
        }
