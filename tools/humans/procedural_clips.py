# Procedural clips layered on the retargeted UAL clips (see anim_layers.py for the conventions:
# body frame = character faces +Y, right = +X, up = +Z; arm targets are relative to the shoulder,
# leg targets relative to the hip joint, both in the chest (arms) / pelvis (legs) frame).
import math
from mathutils import Vector, Quaternion
import anim_layers as AL
from anim_layers import ArmIK, LegIK, Twist, combine, ease

FPS = 30
TAU = 2 * math.pi


def copyfd(fd):
    return {k: (q.copy(), (l.copy() if l is not None else None)) for k, (q, l) in fd.items()}


def loop_base(base, n):
    return [copyfd(base[i % (len(base) - 1)]) for i in range(n)]


def mean_pose(data):
    out = {}
    for n in data[0]:
        ref = data[0][n][0]
        acc = Quaternion((0, 0, 0, 0))
        accl = None
        for fd in data[:-1]:
            q = fd[n][0]
            if q.dot(ref) < 0:
                q = -q
            acc = Quaternion((acc.w + q.w, acc.x + q.x, acc.y + q.y, acc.z + q.z))
            if fd[n][1] is not None:
                accl = fd[n][1].copy() if accl is None else accl + fd[n][1]
        acc.normalize()
        out[n] = (acc, (accl / (len(data) - 1)) if accl is not None else None)
    return out


def amplitude(data, k):
    """scale the motion around the cycle's mean pose by k (0..1)"""
    m = mean_pose(data)
    out = []
    for fd in data:
        nf = {}
        for n, (q, l) in fd.items():
            mq, ml = m[n]
            if q.dot(mq) < 0:
                q = -q
            nq = mq.slerp(q, k)
            nl = (ml + (l - ml) * k) if l is not None else None
            nf[n] = (nq, nl)
        out.append(nf)
    return out


def resample(data, n_new, loop=True):
    """time-resample a (looping) clip to n_new frames (last == first for loops)"""
    n = len(data) - 1 if loop else len(data) - 1
    out = []
    for i in range(n_new):
        x = i * n / (n_new - 1)
        a = int(math.floor(x)); f = x - a
        b = min(a + 1, len(data) - 1)
        nf = {}
        for k in data[0]:
            qa, la = data[a][k]; qb, lb = data[b][k]
            if qa.dot(qb) < 0:
                qb = -qb
            nf[k] = (qa.slerp(qb, f), (la.lerp(lb, f) if la is not None else None))
        out.append(nf)
    return out


def with_fingers(fd, src, side, fingers=('thumb', 'index', 'middle', 'ring', 'pinky')):
    for f in fingers:
        for i in (1, 2, 3):
            n = f'{f}_0{i}_{side}'
            fd[n] = (src[n][0].copy(), None)


def straight(fd, side, fingers):
    for f in fingers:
        for i in (1, 2, 3):
            fd[f'{f}_0{i}_{side}'] = (Quaternion(), None)


def gen(rig, base, n, fn, prep=None):
    """fn(t, i) -> (overrides callable, weight, pelvis_offset or None)"""
    out = []
    frames = loop_base(base, n)
    for i, fd in enumerate(frames):
        t = i / FPS
        if prep:
            prep(fd, t)
        ov, w, po = fn(t, i)
        out.append(rig.apply(fd, ov, w, po))
    return out


class FixedFeet:
    """Leg override: both feet reach fixed floor targets (per frame), knees by two-bone IK, feet keep
    the base clip's world orientation."""
    def __init__(self, targets, cur):
        self.T = targets
        self.cur = cur

    def __call__(self, st, n):
        if not n.startswith('thigh_'):
            return None
        s = n[-1]
        rig = st['rig']
        T = self.T[s][self.cur[0]]
        u, f, hng, E = AL.two_bone(st['Pw'][n], T, rig.len['thigh_' + s], rig.len['calf_' + s], Vector((0, 1, 0)))
        hng = -hng
        Wt = AL.frame_from(rig.hinge['thigh_' + s], Vector((0, 1, 0)), hng, u)
        Wc = AL.frame_from(rig.hinge['calf_' + s], Vector((0, 1, 0)), hng, f)
        st['pending']['calf_' + s] = Wc
        st['pending']['foot_' + s] = st['W0']['foot_' + s]
        return Wt


def natural_stance(rig, base, n, fn=None, prep=None, loop=True, out_x=0.025, ky=0.25):
    """Stand like a pedestrian instead of the UAL idle's wide, split 'hero' stance: feet planted under
    the hip joints (out_x metres outside them), the fore-aft split reduced to `ky`, ankles at the base
    clip's height (at most the rest ankle height). The pelvis is raised per frame so the legs keep the base clip's knee bend instead of
    crouching. fn(t, i) -> (overrides, weight, pelvis_offset) adds upper-body layers as in gen()."""
    frames = loop_base(base, n) if loop else [copyfd(f) for f in base[:n]]
    P = [rig.fk(fd)[1] for fd in frames]
    N = len(P)
    mean = lambda k: sum((p[k] for p in P), Vector((0, 0, 0))) / N
    hip = {s: mean('thigh_' + s) for s in 'lr'}
    foot = {s: mean('foot_' + s) for s in 'lr'}
    ymid = 0.5 * (foot['l'].y + foot['r'].y)
    xy = {}
    for s in 'lr':
        side = 1.0 if hip[s].x > 0 else -1.0
        xy[s] = (hip[s].x + side * out_x, ymid + (foot[s].y - ymid) * ky)
    targets = {s: [] for s in 'lr'}
    lifts = []
    for p in P:
        need = []
        for s in 'lr':
            # ankle at the base clip's height, but never above standing height (UAL 'Idle_Rail_Call'
            # floats both feet ~3 cm)
            T = Vector((xy[s][0], xy[s][1], min(p['foot_' + s].z, rig.P['foot_' + s].z + 0.003)))
            targets[s].append(T)
            h = p['thigh_' + s]
            reach = min((p['foot_' + s] - h).length, 0.995 * (rig.len['thigh_' + s] + rig.len['calf_' + s]))
            hd2 = (h.x - T.x) ** 2 + (h.y - T.y) ** 2
            need.append(math.sqrt(max(reach * reach - hd2, 0.0)) - (h.z - T.z))
        lifts.append(max(0.0, min(need)))
    cur = [0]
    feet = FixedFeet(targets, cur)
    out = []
    for i, fd in enumerate(frames):
        t = i / FPS
        if prep:
            prep(fd, t)
        cur[0] = i
        ov, w, po = fn(t, i) if fn else (None, 1.0, None)
        ov_all = combine(feet, ov) if ov else feet
        lift = Vector((0, 0, lifts[i]))
        out.append(rig.apply(fd, ov_all, w, lift + po if po is not None else lift))
    return out


def keyed(t, keys):
    """piecewise smooth interpolation through (t, v) keys"""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0))
    return keys[-1][1]


def neutral(rig, idle, n):
    """rest (A-pose) basis for every bone, relaxed fingers from the idle, gentle breathing."""
    out = []
    for i in range(n):
        fd = {b: (Quaternion(), None) for b in rig.order}
        fd['pelvis'] = (Quaternion(), Vector((0, 0, 0)))
        with_fingers(fd, idle[0], 'r'); with_fingers(fd, idle[0], 'l')
        out.append(fd)
    return out


def build_all(rig, RAW):
    fist = RAW['punch_jab'][12]
    idle = RAW['idle']
    C = {}
    N61 = neutral(rig, idle, 61)

    # ---- idle_relaxed: NPC idle — feet under the hips (the UAL idle has a wide hero stance), arms
    # closer to the body, hands relaxed open ----
    class NarrowStance:
        def __init__(self, k):
            self.k = k
        def __call__(self, st, n):
            if not n.startswith('thigh_'):
                return None
            s = n[-1]
            hip0, foot0 = st['P0'][n], st['P0']['foot_' + s]
            rel = foot0 - hip0
            rel = Vector((rel.x * self.k, rel.y, rel.z))
            # keep the leg length the base pose had (IK takes care of the knee)
            T = st['Pw'][n] + rel
            u, f, hng, E = AL.two_bone(st['Pw'][n], T, rig.len['thigh_' + s], rig.len['calf_' + s], Vector((0, 1, 0)))
            hng = -hng
            Wt = AL.frame_from(rig.hinge['thigh_' + s], Vector((0, 1, 0)), hng, u)
            Wc = AL.frame_from(rig.hinge['calf_' + s], Vector((0, 1, 0)), hng, f)
            st['pending']['calf_' + s] = Wc
            st['pending']['foot_' + s] = st['W0']['foot_' + s]
            return Wt
    def relax_hands(fd, t):
        for sd in ('l', 'r'):
            for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
                for i in (1, 2, 3):
                    n = f'{f}_0{i}_{sd}'
                    q, l = fd[n]
                    fd[n] = (Quaternion().slerp(q, 0.45), l)
    def f_relaxed(t, i):
        tw = Twist({'upperarm_r': ((0, 1, 0), 7), 'upperarm_l': ((0, 1, 0), -7)})
        return combine(NarrowStance(0.25), tw), 1.0, None
    def f_relaxed_arms(t, i):
        return Twist({'upperarm_r': ((0, 1, 0), 7), 'upperarm_l': ((0, 1, 0), -7)}), 1.0, None
    C['idle_relaxed'] = (natural_stance(rig, idle, len(idle), f_relaxed_arms, prep=relax_hands), True)

    # ---- walk_female: narrower foot placement (steps close to the centre line), arms closer ----
    def f_wf(t, i):
        tw = Twist({'upperarm_r': ((0, 1, 0), 5), 'upperarm_l': ((0, 1, 0), -5)})
        return combine(NarrowStance(0.15), tw), 1.0, None
    C['walk_female'] = (gen(rig, RAW['walk'], len(RAW['walk']), f_wf, prep=relax_hands), True)

    # ---- idle_look: idle + look around (head/neck/chest yaw) ----
    L = 2 * (len(idle) - 1) + 1
    yaw_keys = [(0, 0), (0.7, 0), (1.3, 42), (2.3, 42), (2.9, 0), (3.3, 0), (3.9, -38), (4.6, -38), (5.0, 0)]
    pitch_keys = [(0, 0), (1.3, 6), (2.3, 4), (2.9, 0), (3.9, -3), (4.6, -2), (5.0, 0)]
    def f_look(t, i):
        y = keyed(t, yaw_keys); pch = keyed(t, pitch_keys)
        tw = Twist({'spine_03': ((0, 0, 1), y * 0.18), 'neck_01': ((0, 0, 1), y * 0.35),
                    'head': (Vector((0, 0, 1)), y * 0.47)})
        def ov(st, n):
            r = tw(st, n)
            if n == 'head' and r is not None:
                r = AL.rot_about((1, 0, 0), pch) @ r
            return r
        return ov, 1.0, None
    C['idle_look'] = (gen(rig, idle, L, f_look), True)

    # ---- wave (right hand, loop) ----
    def f_wave(t, i):
        w = math.sin(TAU * 1.6 * t)
        arm = ArmIK('r', (0.30 + 0.05 * w, 0.07, 0.25), (1, -0.1, -0.5), (0.4 * w, 0.1, 1), (0, 1, 0.1), frame_bone=None)
        tw = Twist({'head': ((0, 0, 1), -6)})
        return combine(arm, tw), 1.0, None
    C['wave'] = (natural_stance(rig, idle, len(idle), f_wave, prep=lambda fd, t: straight(fd, 'r', ('index', 'middle', 'ring', 'pinky'))), True)

    # ---- point (right arm, loop hold) ----
    def prep_point(fd, t):
        with_fingers(fd, fist, 'r')
        straight(fd, 'r', ('index',))
    def f_point(t, i):
        e = 0.015 * math.sin(TAU * 0.8 * t)
        arm = ArmIK('r', (0.06, 0.51, 0.12 + e), (1, 0, -1), (0.1, 1, 0.2), (-0.5, 0, -1), frame_bone=None)
        tw = Twist({'neck_01': ((0, 0, 1), -8), 'head': ((0, 0, 1), -10), 'spine_03': ((0, 0, 1), -6)})
        return combine(arm, tw), 1.0, None
    C['point'] = (natural_stance(rig, idle, len(idle), f_point, prep=prep_point), True)

    # ---- cheer (both fists pumping, loop) ----
    def prep_fists(fd, t):
        with_fingers(fd, fist, 'r'); with_fingers(fd, fist, 'l')
    def f_cheer(t, i):
        ph = TAU * 1.6 * t
        a = 0.06 * math.sin(ph); b = 0.06 * math.sin(ph + 0.9)
        ar = ArmIK('r', (0.12, 0.06, 0.44 + a), (1, -0.2, -0.2), (0.1, 0.1, 1), (0, 1, 0), frame_bone=None)
        al = ArmIK('l', (-0.12, 0.06, 0.44 + b), (-1, -0.2, -0.2), (-0.1, 0.1, 1), (0, 1, 0), frame_bone=None)
        tw = Twist({'head': ((1, 0, 0), 12), 'neck_01': ((1, 0, 0), 5)})
        po = Vector((0, 0, 0.022 * abs(math.sin(ph / 2 * 2))))
        return combine(ar, al, tw), 1.0, po
    C['cheer'] = (natural_stance(rig, idle, 61, f_cheer, prep=prep_fists), True)  # 2.0 s

    # ---- phone_film (both hands holding a phone up, loop) ----
    def f_film(t, i):
        pan = 0.03 * math.sin(TAU * t / 2.5)
        ar = ArmIK('r', (-0.13 + pan, 0.33, 0.16), (1, -0.5, -1), (0.0, 0.25, 1), (-1, 0.3, 0), frame_bone=None)
        al = ArmIK('l', (0.13 + pan, 0.33, 0.16), (-1, -0.5, -1), (0.0, 0.25, 1), (1, 0.3, 0), frame_bone=None)
        tw = Twist({'head': ((1, 0, 0), 4), 'neck_01': ((0, 0, 1), -pan * 100)})
        return combine(ar, al, tw), 1.0, None
    C['phone_film'] = (natural_stance(rig, idle, len(idle), f_film), True)

    # ---- pedestrian stance for the UAL standing clips NPCs use (their base is the wide split
    # hero stance of the UAL idle); Spider-Man keeps `idle` / `idle_look` as they are ----
    for nm in ('talk', 'phone_call', 'call_out', 'idle_arms_folded', 'shake_no', 'nod_yes', 'drink'):
        if nm in RAW:
            lp = nm not in ('nod_yes', 'drink')
            C[nm] = (natural_stance(rig, RAW[nm], len(RAW[nm]), loop=lp), lp)

    # ---- talk_2: mirrored talking ----
    C['talk_2'] = (AL.mirror_frames(rig, C['talk'][0] if 'talk' in C else RAW['talk']), True)

    # ---- walk_slow: 75% stride, 82% cadence ----
    ws = amplitude(RAW['walk'], 0.75)
    C['walk_slow'] = (resample(ws, int(round((len(ws) - 1) / 0.82)) + 1), True)

    # ---- turn_left / turn_right: small in-place steps + torso leading the turn ----
    step = resample(amplitude(RAW['walk'], 0.32), 31)
    for nm, sgn in (('turn_left', 1), ('turn_right', -1)):
        def f_turn(t, i, sgn=sgn):
            tw = Twist({'pelvis': ((0, 0, 1), 6 * sgn), 'spine_03': ((0, 0, 1), 8 * sgn),
                        'neck_01': ((0, 0, 1), 10 * sgn), 'head': ((0, 0, 1), 14 * sgn)})
            return tw, 1.0, None
        C[nm] = (gen(rig, step, len(step), f_turn), True)

    # ---- flee_run: run with flailing arms, lean, looking back over the shoulder ----
    run = RAW['run']
    n = 4 * (len(run) - 1) + 1
    look_keys = [(0, 0), (1.5, 0), (1.9, 1), (2.6, 1), (3.0, 0), (5, 0)]
    def f_flee(t, i):
        lb = keyed(t, look_keys)
        wob = math.sin(TAU * t / (len(run) - 1) * FPS)
        tw = Twist({'spine_01': ((1, 0, 0), -6), 'upperarm_r': ((0, 1, 0), -22 - 8 * wob),
                    'upperarm_l': ((0, 1, 0), 22 - 8 * wob), 'lowerarm_r': ((0, 1, 0), -10), 'lowerarm_l': ((0, 1, 0), 10),
                    'spine_03': ((0, 0, 1), 18 * lb), 'neck_01': ((0, 0, 1), 30 * lb), 'head': ((0, 0, 1), 40 * lb)})
        return tw, 1.0, None
    C['flee_run'] = (gen(rig, run, n, f_flee), True)

    # ---- hang (web swinging: both hands up on the web line, legs trailing, loop) ----
    def prep_grip(fd, t):
        with_fingers(fd, fist, 'r'); with_fingers(fd, fist, 'l')
    def f_hang(t, i):
        sw = math.sin(TAU * t / 2.5)
        ar = ArmIK('r', (-0.07, 0.05, 0.52), (1, -0.3, 0.2), (0, 0, 1), (0, 1, 0))
        al = ArmIK('l', (0.03, 0.08, 0.42), (-1, -0.3, 0.1), (0, 0, 1), (0, 1, 0))
        lr = LegIK('r', (0.0, -0.05 + 0.07 * sw, -0.80), (0, 1, 0), (0, 0.45, -1))
        ll = LegIK('l', (0.0, -0.10 + 0.07 * sw, -0.76), (0, 1, 0), (0, 0.45, -1))
        br = 1.5 * math.sin(TAU * t / 2.5 * 2)
        tw = Twist({'spine_03': ((1, 0, 0), 5 + br), 'spine_01': ((1, 0, 0), 3 * sw), 'head': ((1, 0, 0), 8)})
        return combine(ar, al, lr, ll, tw), 1.0, None
    C['hang'] = (gen(rig, N61, 76, f_hang, prep=prep_grip), True)

    # ---- swing: one full pendulum swing cycle (legs back -> tuck -> forward -> back), loop ----
    def f_swing(t, i):
        ph = TAU * t / 2.0
        c = math.cos(ph)       # 1 at start (legs back) .. -1 at mid (legs forward)
        tuck = max(0.0, math.sin(ph)) ** 2
        ar = ArmIK('r', (-0.07, 0.05, 0.52), (1, -0.3, 0.2), (0, 0, 1), (0, 1, 0))
        al = ArmIK('l', (0.22, 0.25 + 0.08 * c, 0.05), (-1, -0.3, -0.5), (-0.2, 1, 0), (1, 0, -0.5))
        fy = -0.18 * c + 0.12 * (1 - c) * 0.5
        fz = -0.80 + 0.30 * tuck
        lr = LegIK('r', (0.0, fy, fz), (0, 1, 0), (0, 0.5, -1))
        ll = LegIK('l', (0.0, fy - 0.06, fz + 0.03), (0, 1, 0), (0, 0.5, -1))
        tw = Twist({'spine_01': ((1, 0, 0), -8 * c), 'head': ((1, 0, 0), 6)})
        return combine(ar, al, lr, ll, tw), 1.0, None
    C['swing'] = (gen(rig, N61, 61, f_swing, prep=prep_grip), True)

    # ---- zip: pulling on a web line ahead, loop ----
    def f_zip(t, i):
        tug = 0.03 * math.sin(TAU * t / 1.0)
        ar = ArmIK('r', (-0.08, 0.45 + tug, 0.22), (1, -0.2, -1), (0, 1, 0.4), (0, 0, -1))
        al = ArmIK('l', (0.08, 0.43 + tug, 0.20), (-1, -0.2, -1), (0, 1, 0.4), (0, 0, -1))
        lr = LegIK('r', (0.02, -0.18, -0.74), (0, 1, 0), (0, 0.4, -1))
        ll = LegIK('l', (-0.02, -0.22, -0.72), (0, 1, 0), (0, 0.4, -1))
        return combine(ar, al, lr, ll), 1.0, None
    C['zip'] = (gen(rig, N61, 31, f_zip, prep=prep_grip), True)

    # ---- skydive: spread-eagle free fall (the game pitches the body face-down) ----
    def f_sky(t, i):
        fl = 0.02 * math.sin(TAU * t * 2)
        ar = ArmIK('r', (0.45, 0.12, 0.12 + fl), (0, -1, -0.3), (1, 0.2, 0.2), (0, 1, 0))
        al = ArmIK('l', (-0.45, 0.12, 0.12 - fl), (0, -1, -0.3), (-1, 0.2, 0.2), (0, 1, 0))
        lr = LegIK('r', (0.20, -0.12, -0.78 + fl), (0, 1, 0.2), (0.1, 0.3, -1))
        ll = LegIK('l', (-0.20, -0.12, -0.78 - fl), (0, 1, 0.2), (-0.1, 0.3, -1))
        tw = Twist({'head': ((1, 0, 0), 25), 'neck_01': ((1, 0, 0), 12), 'spine_03': ((1, 0, 0), 6)})
        return combine(ar, al, lr, ll, tw), 1.0, None
    C['skydive'] = (gen(rig, N61, 31, f_sky), True)

    # ---- dive: streamlined head-first dive (arms overhead, legs together) ----
    def f_dive(t, i):
        fl = 0.012 * math.sin(TAU * t * 2)
        ar = ArmIK('r', (-0.08, 0.10, 0.52), (1, -0.5, 0), (-0.1, 0.1, 1), (-0.3, 1, 0))
        al = ArmIK('l', (0.08, 0.10, 0.52), (-1, -0.5, 0), (0.1, 0.1, 1), (0.3, 1, 0))
        lr = LegIK('r', (-0.04, -0.06 + fl, -0.86), (0, 1, 0), (0, 0.2, -1))
        ll = LegIK('l', (0.04, -0.06 - fl, -0.86), (0, 1, 0), (0, 0.2, -1))
        tw = Twist({'head': ((1, 0, 0), 20)})
        return combine(ar, al, lr, ll, tw), 1.0, None
    C['dive'] = (gen(rig, N61, 31, f_dive), True)

    # ---- climb: Spider-Man wall crawl, facing the wall (+Y), diagonal gait, in place ----
    T = 1.2
    def f_climb(t, i):
        ph = t / T
        def limb(phase, zc, za):
            c = math.cos(TAU * phase)
            lift = max(0.0, -math.sin(TAU * phase))  # moving up = off the wall
            return zc + za * c, lift
        zr, lr_ = limb(ph, 0.25, 0.17); zl, ll_ = limb(ph + 0.5, 0.25, 0.17)
        fr, flr = limb(ph + 0.5, -0.50, 0.13); fl, fll = limb(ph, -0.50, 0.13)
        wall = 0.34
        ar = ArmIK('r', (0.16, wall - 0.08 * lr_, zr), (1, -0.4, -0.6), (0.2, 0.25, 1), (0, 1, 0))
        al = ArmIK('l', (-0.16, wall - 0.08 * ll_, zl), (-1, -0.4, -0.6), (-0.2, 0.25, 1), (0, 1, 0))
        lgr = LegIK('r', (0.24, wall - 0.02 - 0.08 * flr, fr), (1, 0.6, 0), (0.6, 0.2, 0.8))
        lgl = LegIK('l', (-0.24, wall - 0.02 - 0.08 * fll, fl), (-1, 0.6, 0), (-0.6, 0.2, 0.8))
        tw = Twist({'spine_01': ((1, 0, 0), -10), 'spine_03': ((0, 0, 1), 6 * math.sin(TAU * ph)),
                    'head': ((1, 0, 0), 22), 'neck_01': ((1, 0, 0), 10)})
        po = Vector((0, 0.10, 0.025 * math.cos(2 * TAU * ph)))
        return combine(ar, al, lgr, lgl, tw), 1.0, po
    C['climb'] = (gen(rig, N61, int(T * FPS) + 1, f_climb), True)

    # ---- carry_on_head: walk steadying a basin on the head with the left hand ----
    walk = RAW['walk_slow'] if 'walk_slow' in RAW else C['walk_slow'][0]
    def f_carry(t, i):
        al = ArmIK('l', (0.02, 0.02, 0.37), (-1, -0.2, 0.2), (0.35, 0.1, 1), (0.8, 0, 0.6))
        def upright(st, n):
            if n in ('neck_01', 'head'):
                rig_ = st['rig']
                return rig_.R[n].copy()  # world-upright rest orientation: head steady
            return None
        return combine(al, upright), (lambda n: 0.75 if n in ('neck_01', 'head') else 1.0), None
    C['carry_on_head'] = (gen(rig, walk, len(walk), f_carry), True)

    # ---- web_shoot: one-shot, right arm snaps forward with the "thwip" hand ----
    wkeys = [(0, 0), (0.12, 1), (0.42, 1), (0.66, 0)]
    def prep_thwip(fd, t):
        if keyed(t, wkeys) > 0.25:
            with_fingers(fd, fist, 'r', ('middle', 'ring'))
            straight(fd, 'r', ('index', 'pinky', 'thumb'))
    def f_shoot(t, i):
        w = keyed(t, wkeys)
        ar = ArmIK('r', (0.02, 0.52, 0.07), (1, 0, -1), (0, 1, 0.45), (0, 0.4, -1))
        return ar, w, None
    C['web_shoot'] = (gen(rig, idle, 21, f_shoot, prep=prep_thwip), False)
    return C
