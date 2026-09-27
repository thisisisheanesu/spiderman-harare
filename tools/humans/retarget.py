# Rotation retargeting between two humanoid armatures with (near-)identical bone naming
# (Quaternius UAL / UE-mannequin style  ->  MPFB "game_engine" rig).
#
# Method: bring the target into a "matched pose" whose bone directions equal the source rest
# pose (T-pose), then per bone keep the constant offset  A_b = R_src_rest^-1 * R_tgt_matched  and
# per frame  R_tgt_world(t) = R_src_world(t) * A_b.  World deltas from the source rest therefore
# map 1:1 onto the target. The pelvis translation is scaled by the ratio of hip heights.
import bpy
import numpy as np
from mathutils import Matrix, Vector, Quaternion

# target bone -> source bone
BONE_MAP = {
    'Root': 'root', 'pelvis': 'pelvis', 'spine_01': 'spine_01', 'spine_02': 'spine_02', 'spine_03': 'spine_03',
    'neck_01': 'neck_01', 'head': 'Head',
}
for s in ('l', 'r'):
    for b in ('clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball'):
        BONE_MAP[f'{b}_{s}'] = f'{b}_{s}'
    for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
        for i in (1, 2, 3):
            BONE_MAP[f'{f}_0{i}_{s}'] = f'{f}_0{i}_{s}'

# which child joint defines a bone's primary direction (source and target names)
def _dir_child(name):
    s = name[-1]
    table = {
        'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01',
        'neck_01': 'head', f'clavicle_{s}': f'upperarm_{s}', f'upperarm_{s}': f'lowerarm_{s}',
        f'lowerarm_{s}': f'hand_{s}', f'hand_{s}': f'middle_01_{s}', f'thigh_{s}': f'calf_{s}',
        f'calf_{s}': f'foot_{s}', f'foot_{s}': f'ball_{s}',
    }
    if name in table:
        return table[name]
    for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
        if name.startswith(f + '_01'):
            return f'{f}_02_{s}'
        if name.startswith(f + '_02'):
            return f'{f}_03_{s}'
    return None


def rest_world(arm_obj):
    """bone name -> 4x4 world rest matrix"""
    return {b.name: arm_obj.matrix_world @ b.matrix_local for b in arm_obj.data.bones}


def _joint(rest, name):
    return rest[name].translation


def _src_dir(src_rest, tname):
    sname = BONE_MAP[tname]
    c = _dir_child(tname)
    if c is not None and BONE_MAP.get(c) in src_rest:
        return (_joint(src_rest, BONE_MAP[c]) - _joint(src_rest, sname)).normalized()
    # fingertips / ball / head: source has *_04_leaf / ball_leaf children or use its Y axis
    leaf = sname.replace('_03_', '_04_leaf_') if '_03_' in sname else ('ball_leaf_' + sname[-1] if sname.startswith('ball_') else None)
    if leaf and leaf in src_rest:
        return (_joint(src_rest, leaf) - _joint(src_rest, sname)).normalized()
    return src_rest[sname].to_3x3().col[1].normalized()


def _palm_across(rest, prefix_map, s):
    a = _joint(rest, prefix_map(f'index_01_{s}'))
    b = _joint(rest, prefix_map(f'pinky_01_{s}'))
    return (b - a).normalized()


def matched_pose(tgt, src):
    """Returns dict target bone -> 3x3 world rotation of the target in the matched pose, plus the
    matched world head positions."""
    trest = rest_world(tgt)
    srest = rest_world(src)
    R = {}
    P = {}
    bones = [b for b in tgt.data.bones]  # parents come before children in bpy order
    order = []
    def visit(b):
        order.append(b)
        for c in b.children:
            visit(c)
    for b in bones:
        if b.parent is None:
            visit(b)
    for b in order:
        n = b.name
        Rr = trest[n].to_3x3()
        if b.parent is None:
            R[n] = Rr.copy(); P[n] = trest[n].translation.copy()
            continue
        pn = b.parent.name
        # carry the parent's matched rotation down to this bone (rigid)
        Rpar_rest = trest[pn].to_3x3()
        dR = R[pn] @ Rpar_rest.inverted()
        Rcur = dR @ Rr
        head = P[pn] + dR @ (trest[n].translation - trest[pn].translation)
        P[n] = head
        if n not in BONE_MAP or BONE_MAP[n] not in srest or n == 'Root':
            R[n] = Rcur; continue
        c = _dir_child(n)
        # current direction of the target bone
        if c is not None and c in trest:
            cur = (dR @ (trest[c].translation - trest[n].translation)).normalized()
        else:
            cur = (Rcur.col[1]).normalized()
        want = _src_dir(srest, n)
        q = cur.rotation_difference(want)
        Rn = q.to_matrix() @ Rcur
        s = n[-1]
        if n.startswith(('hand_', 'lowerarm_')):
            # secondary alignment: palm orientation (index->pinky knuckles) about the bone axis
            ax = want
            t_ac = (Rn @ Rr.inverted() @ (trest[f'pinky_01_{s}'].translation - trest[f'index_01_{s}'].translation)).normalized() \
                if n.startswith('hand_') else None
            if n.startswith('lowerarm_'):
                # palm vector as it would be carried by the forearm
                Rh = trest[f'hand_{s}'].to_3x3()
                t_ac = (Rn @ Rr.inverted() @ (trest[f'pinky_01_{s}'].translation - trest[f'index_01_{s}'].translation)).normalized()
            s_ac = _palm_across(srest, lambda x: BONE_MAP[x], s)
            a1 = (t_ac - ax * t_ac.dot(ax)).normalized()
            a2 = (s_ac - ax * s_ac.dot(ax)).normalized()
            ang = a1.angle(a2)
            if a1.cross(a2).dot(ax) < 0:
                ang = -ang
            f = 0.6 if n.startswith('lowerarm_') else 1.0
            Rn = Matrix.Rotation(ang * f, 3, ax) @ Rn
        elif n in ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'):
            # keep facing: remove twist so the bone's X axis stays in the world X/Z plane like the rest
            pass
        R[n] = Rn
    return R, P, trest, srest


def compute_offsets(tgt, src):
    Rm, Pm, trest, srest = matched_pose(tgt, src)
    A = {}
    for n, sn in BONE_MAP.items():
        if n in Rm and sn in srest:
            A[n] = srest[sn].to_3x3().inverted() @ Rm[n]
    return A, Rm, Pm, trest, srest


def hip_height(arm):
    rw = rest_world(arm)
    return (rw['thigh_l'].translation.z + rw['thigh_r'].translation.z) * 0.5 if 'thigh_l' in rw else rw['pelvis'].translation.z


def sample_source(src, action, frames):
    """returns list over frames of dict source bone -> world 4x4 pose matrix"""
    src.animation_data.action = action
    if hasattr(src.animation_data, 'action_slot') and action.slots:
        src.animation_data.action_slot = action.slots[0]
    out = []
    sc = bpy.context.scene
    for f in frames:
        sc.frame_set(int(np.floor(f)), subframe=float(f - np.floor(f)))
        mw = src.matrix_world
        out.append({pb.name: mw @ pb.matrix for pb in src.pose.bones})
    return out


def retarget_frames(tgt, src_frames, A, trest, srest, hip_scale, pelvis_offset=Vector((0, 0, 0))):
    """Returns list of dict target bone -> (quaternion basis, location basis or None)."""
    bones = tgt.data.bones
    order = []
    def visit(b):
        order.append(b)
        for c in b.children:
            visit(c)
    for b in bones:
        if b.parent is None:
            visit(b)
    s_pel_rest = srest['pelvis'].translation
    t_pel_rest = trest['pelvis'].translation
    res = []
    for SF in src_frames:
        Rw = {}
        Pw = {}
        out = {}
        for b in order:
            n = b.name
            Rrest = trest[n].to_3x3()
            if b.parent is None:
                Rw[n] = Rrest
                out[n] = (Quaternion(), None)
                continue
            pn = b.parent.name
            Rpar = Rw[pn]
            Rrel_rest = trest[pn].to_3x3().inverted() @ Rrest
            if n in A and BONE_MAP[n] in SF:
                Rt = SF[BONE_MAP[n]].to_3x3().normalized() @ A[n]
            else:
                # unmapped: keep rest relative to parent
                Rt = Rpar @ Rrel_rest
            Rw[n] = Rt
            Rloc = Rpar.inverted() @ Rt
            basis = (Rrel_rest.inverted() @ Rloc).to_quaternion()
            loc = None
            if n == 'pelvis':
                sp = SF['pelvis'].translation
                d = (sp - s_pel_rest) * hip_scale + pelvis_offset
                wp = t_pel_rest + d
                loc = Rrest.inverted() @ (wp - t_pel_rest)
            out[n] = (basis, loc)
        res.append(out)
    return res


def action_fcurves(act):
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for slot in act.slots:
                cb = strip.channelbag(slot)
                if cb:
                    out.extend(cb.fcurves)
    return out


def write_action(tgt, name, frames_data, fps=30, loop=False):
    # a re-layered clip replaces the library version (otherwise Blender names it 'talk.001' and both
    # get exported)
    old = bpy.data.actions.get(name)
    if old is not None:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    tgt.animation_data_create()
    tgt.animation_data.action = act
    for pb in tgt.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    nfr = len(frames_data)
    # make quaternions hemisphere-continuous
    prev = {}
    for i, fd in enumerate(frames_data):
        for n, (q, loc) in fd.items():
            if n in prev and prev[n].dot(q) < 0:
                q = -q
                fd[n] = (q, loc)
            prev[n] = q
    for n in frames_data[0].keys():
        pb = tgt.pose.bones[n]
        qs = np.array([[fd[n][0].w, fd[n][0].x, fd[n][0].y, fd[n][0].z] for fd in frames_data])
        for c in range(4):
            fc = act.fcurve_ensure_for_datablock(tgt, f'pose.bones["{n}"].rotation_quaternion', index=c, group_name=n)
            fc.keyframe_points.add(nfr)
            co = np.empty(nfr * 2); co[0::2] = np.arange(nfr); co[1::2] = qs[:, c]
            fc.keyframe_points.foreach_set('co', co)
            fc.update()
        if frames_data[0][n][1] is not None:
            ls = np.array([list(fd[n][1]) for fd in frames_data])
            for c in range(3):
                fc = act.fcurve_ensure_for_datablock(tgt, f'pose.bones["{n}"].location', index=c, group_name=n)
                fc.keyframe_points.add(nfr)
                co = np.empty(nfr * 2); co[0::2] = np.arange(nfr); co[1::2] = ls[:, c]
                fc.keyframe_points.foreach_set('co', co)
                fc.update()
    for fc in action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    act['loop'] = bool(loop)
    return act
