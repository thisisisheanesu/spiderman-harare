# Procedural animation layers on top of retargeted clips (frame data = list of
# {bone: (basis Quaternion, pelvis location Vector|None)} for the MPFB game_engine rig).
# Body-space convention (Blender, after mh_common.finalize): character faces +Y, right = +X, up = +Z.
import math
import numpy as np
from mathutils import Matrix, Vector, Quaternion

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


class Rig:
    def __init__(self, arm):
        self.arm = arm
        self.rest = {b.name: arm.matrix_world @ b.matrix_local for b in arm.data.bones}
        self.R = {n: m.to_3x3().normalized() for n, m in self.rest.items()}
        self.P = {n: m.translation.copy() for n, m in self.rest.items()}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
        self.order = []
        def visit(b):
            self.order.append(b.name)
            for c in b.children:
                visit(c)
        for b in arm.data.bones:
            if b.parent is None:
                visit(b)
        self.Rrel = {}
        self.Prel = {}
        for n in self.order:
            p = self.parent[n]
            if p is None:
                self.Rrel[n] = self.R[n]; self.Prel[n] = self.P[n]
            else:
                self.Rrel[n] = self.R[p].inverted() @ self.R[n]
                self.Prel[n] = self.R[p].inverted() @ (self.P[n] - self.P[p])
        self.len = {}
        for s in ('l', 'r'):
            self.len['uarm_' + s] = (self.P['lowerarm_' + s] - self.P['upperarm_' + s]).length
            self.len['farm_' + s] = (self.P['hand_' + s] - self.P['lowerarm_' + s]).length
            self.len['thigh_' + s] = (self.P['calf_' + s] - self.P['thigh_' + s]).length
            self.len['calf_' + s] = (self.P['foot_' + s] - self.P['calf_' + s]).length
        # local hinge / palm axes from the rest pose
        self.hinge = {}
        for s in ('l', 'r'):
            u = (self.P['lowerarm_' + s] - self.P['upperarm_' + s]).normalized()
            f = (self.P['hand_' + s] - self.P['lowerarm_' + s]).normalized()
            h = u.cross(f).normalized()
            self.hinge['upperarm_' + s] = self.R['upperarm_' + s].inverted() @ h
            self.hinge['lowerarm_' + s] = self.R['lowerarm_' + s].inverted() @ h
            across = (self.P['pinky_01_' + s] - self.P['index_01_' + s]).normalized()
            hd = (self.P['middle_01_' + s] - self.P['hand_' + s]).normalized()
            palm = hd.cross(across).normalized()
            if s == 'l':
                palm = -palm
            # make "palm" point out of the palm: in the A-pose rest the palms face the thighs (inwards)
            inward = Vector((-1 if s == 'r' else 1, 0, 0))
            if palm.dot(inward) < 0:
                palm = -palm
            self.hinge['palm_' + s] = self.R['hand_' + s].inverted() @ palm
            self.hinge['hand_across_' + s] = self.R['hand_' + s].inverted() @ across
            t = (self.P['calf_' + s] - self.P['thigh_' + s]).normalized()
            c = (self.P['foot_' + s] - self.P['calf_' + s]).normalized()
            # knee hinge: rest legs are nearly straight, use the lateral axis
            kh = Vector((1, 0, 0))
            self.hinge['thigh_' + s] = self.R['thigh_' + s].inverted() @ kh
            self.hinge['calf_' + s] = self.R['calf_' + s].inverted() @ kh
            fd = (self.P['ball_' + s] - self.P['foot_' + s]).normalized()
            self.hinge['foot_' + s] = self.R['foot_' + s].inverted() @ kh

    # ---------- FK ----------
    def fk(self, fd):
        W, Pw = {}, {}
        for n in self.order:
            q, loc = fd[n]
            p = self.parent[n]
            B = q.to_matrix()
            if p is None:
                W[n] = self.R[n] @ B
                Pw[n] = self.P[n].copy()
                continue
            W[n] = W[p] @ self.Rrel[n] @ B
            Pw[n] = Pw[p] + W[p] @ self.Prel[n]
            if loc is not None:
                Pw[n] = Pw[n] + W[p] @ self.Rrel[n] @ loc
        return W, Pw

    def basis_from_world(self, n, Wparent, Wn):
        return (self.Rrel[n].inverted() @ Wparent.inverted() @ Wn).to_quaternion()

    def apply(self, fd, overrides, weight=1.0, pelvis_offset=None):
        """overrides: callable(state, bone) -> world 3x3 or None. state has W (final so far), Pw,
        base (W0, P0). Returns new frame data."""
        W0, P0 = self.fk(fd)
        W, Pw = {}, {}
        out = {}
        st = dict(W=W, Pw=Pw, W0=W0, P0=P0, rig=self, pending={}, fd=fd)
        for n in self.order:
            q, loc = fd[n]
            p = self.parent[n]
            if p is None:
                W[n] = W0[n]; Pw[n] = P0[n]; out[n] = (q, loc); continue
            if loc is not None and pelvis_offset is not None and n == 'pelvis':
                loc = loc + self.Rrel[n].inverted() @ (W[p].inverted() @ pelvis_offset)
            Pw[n] = Pw[p] + W[p] @ self.Prel[n]
            if loc is not None:
                Pw[n] = Pw[n] + W[p] @ self.Rrel[n] @ loc
            base_local = W[p] @ self.Rrel[n] @ q.to_matrix()
            Wn = st['pending'].pop(n, None)
            if Wn is None:
                Wn = overrides(st, n) if overrides else None
            if Wn is not None:
                w = weight(n) if callable(weight) else weight
                qa = base_local.to_quaternion(); qb = Wn.to_quaternion()
                if qa.dot(qb) < 0:
                    qb = -qb
                Wn = qa.slerp(qb, w).to_matrix()
                W[n] = Wn
                out[n] = (self.basis_from_world(n, W[p], Wn), loc)
            else:
                W[n] = base_local
                out[n] = (q, loc)
        return out


def frame_from(xaxis_local, yaxis_local, xaxis_world, yaxis_world):
    """rotation R with R@yaxis_local = yaxis_world and R@xaxis_local ~ xaxis_world"""
    yl = yaxis_local.normalized(); xl = (xaxis_local - yl * xaxis_local.dot(yl)).normalized(); zl = xl.cross(yl)
    yw = yaxis_world.normalized(); xw = (xaxis_world - yw * xaxis_world.dot(yw)).normalized(); zw = xw.cross(yw)
    Ml = Matrix((xl, yl, zl)).transposed()
    Mw = Matrix((xw, yw, zw)).transposed()
    return Mw @ Ml.transposed()


def two_bone(S, T, L1, L2, pole):
    d_vec = T - S
    d = d_vec.length
    d = min(max(d, 1e-4), (L1 + L2) * 0.999)
    dirv = d_vec.normalized()
    a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
    h = math.sqrt(max(L1 * L1 - a * a, 0))
    p = (pole - dirv * pole.dot(dirv))
    if p.length < 1e-6:
        p = Vector((0, 0, -1)) - dirv * (-dirv.z)
    p.normalize()
    E = S + dirv * a + p * h
    Tn = S + dirv * d
    hinge = (-dirv.cross(p)).normalized()
    return (E - S).normalized(), (Tn - E).normalized(), hinge, E


def body_rot(st, bone='spine_03'):
    if bone is None:
        return Matrix.Identity(3)
    rig = st['rig']
    return st['W'][bone] @ rig.R[bone].inverted()


class ArmIK:
    """Override for one arm: targets are given relative to the shoulder (upperarm head) in the
    body frame of `frame_bone` (spine_03 delta rotation). All args are callables of nothing
    (closures over the frame time) or constants."""

    def __init__(self, side, target, pole, hand_dir, palm_dir, frame_bone='spine_03'):
        self.s = side; self.target = target; self.pole = pole; self.hand_dir = hand_dir; self.palm = palm_dir
        self.fb = frame_bone

    def __call__(self, st, n):
        s = self.s
        if n != 'upperarm_' + s:
            return None
        rig = st['rig']
        B = body_rot(st, self.fb)
        S = st['Pw'][n]
        T = S + B @ Vector(self.target)
        u, f, hng, E = two_bone(S, T, rig.len['uarm_' + s], rig.len['farm_' + s], B @ Vector(self.pole))
        Wu = frame_from(rig.hinge['upperarm_' + s], Vector((0, 1, 0)), hng, u)
        Wf = frame_from(rig.hinge['lowerarm_' + s], Vector((0, 1, 0)), hng, f)
        st['pending']['lowerarm_' + s] = Wf
        if self.hand_dir is not None:
            hd = B @ Vector(self.hand_dir)
            pm = B @ Vector(self.palm)
            # hand's Y axis to hand_dir, palm normal to palm_dir
            yl = Vector((0, 1, 0))
            Wh = frame_from(rig.hinge['palm_' + s], yl, pm, hd)
            st['pending']['hand_' + s] = Wh
        return Wu


class LegIK:
    def __init__(self, side, target, pole, foot_dir=None, frame_bone='pelvis'):
        self.s = side; self.target = target; self.pole = pole; self.foot_dir = foot_dir; self.fb = frame_bone

    def __call__(self, st, n):
        s = self.s
        if n != 'thigh_' + s:
            return None
        rig = st['rig']
        B = body_rot(st, self.fb)
        S = st['Pw'][n]
        T = S + B @ Vector(self.target)
        u, f, hng, E = two_bone(S, T, rig.len['thigh_' + s], rig.len['calf_' + s], B @ Vector(self.pole))
        # knee hinge: lateral axis. two_bone hinge for a forward knee pole points to -X; flip to +X
        hng = -hng
        Wt = frame_from(rig.hinge['thigh_' + s], Vector((0, 1, 0)), hng, u)
        Wc = frame_from(rig.hinge['calf_' + s], Vector((0, 1, 0)), hng, f)
        st['pending']['calf_' + s] = Wc
        if self.foot_dir is not None:
            fdw = B @ Vector(self.foot_dir)
            Wf = frame_from(rig.hinge['foot_' + s], Vector((0, 1, 0)), hng, fdw)
            st['pending']['foot_' + s] = Wf
        return Wt


def combine(*fs):
    def f(st, n):
        for g in fs:
            r = g(st, n)
            if r is not None:
                return r
        return None
    return f


def rot_about(axis, deg):
    return Matrix.Rotation(math.radians(deg), 3, Vector(axis))


class Twist:
    """Rotate bones about a world axis (in the body frame) by deg(t) — e.g. head look-around.
    spec: {bone: (axis, degrees)}"""

    def __init__(self, spec):
        self.spec = spec

    def __call__(self, st, n):
        if n not in self.spec:
            return None
        axis, deg = self.spec[n]
        rig = st['rig']
        p = rig.parent[n]
        base = st['W'][p] @ rig.Rrel[n] @ st['fd'][n][0].to_matrix()
        return rot_about(axis, deg) @ base


def copy_fingers(fd, src_fd, side, fingers=('thumb', 'index', 'middle', 'ring', 'pinky')):
    for f in fingers:
        for i in (1, 2, 3):
            n = f'{f}_0{i}_{side}'
            fd[n] = (src_fd[n][0].copy(), None)


def straighten(fd, side, fingers):
    for f in fingers:
        for i in (1, 2, 3):
            fd[f'{f}_0{i}_{side}'] = (Quaternion(), None)


def mirror_frames(rig, data):
    """Left/right mirror of a clip (world-space delta rotations reflected in the YZ plane)."""
    M = Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, 1)))
    out = []
    swap = lambda n: n[:-1] + ('r' if n.endswith('_l') else 'l') if n.endswith(('_l', '_r')) else n
    for fd in data:
        W, Pw = rig.fk(fd)
        D = {n: W[n] @ rig.R[n].inverted() for n in W}
        Wm = {n: (M @ D[swap(n)] @ M) @ rig.R[n] for n in W}
        nf = {}
        for n in rig.order:
            p = rig.parent[n]
            q, loc = fd[n]
            if p is None:
                nf[n] = (q, loc); continue
            b = rig.basis_from_world(n, Wm[p], Wm[n])
            if loc is not None:
                # pelvis translation: mirror the world offset
                wp = W[p] @ rig.Rrel[n] @ loc
                wp = M @ wp
                loc = rig.Rrel[n].inverted() @ (Wm[p].inverted() @ wp)
            nf[n] = (b, loc)
        out.append(nf)
    return out


def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)
