# Retargets the Quaternius Universal Animation Library 1+2 (CC0) clips onto the MPFB game_engine
# skeleton of the Spider-Man reference body, adds procedural gesture layers for clips the free
# libraries don't have, and exports public/models/anims/humans_anims.glb (skeleton + clips).
#
#   python build_anims.py [clip ...]
import sys, os, math, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from mathutils import Matrix, Vector, Quaternion, Euler
import mh_common as C
import retarget as RT
import anim_layers as AL
import procedural_clips as PC

DL = os.path.join(C.SCRATCH, 'dl')
UAL = {
    'ual1': os.path.join(DL, 'ual1/x/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb'),
    'ual2': os.path.join(DL, 'ual2/x/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb'),
}
UAL_RM = {
    'ual1': os.path.join(DL, 'ual1/x/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard_RM.glb'),
    'ual2': os.path.join(DL, 'ual2/x/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard_RM.glb'),
}
OUT = os.path.join(C.SCRATCH, 'anims')
os.makedirs(OUT, exist_ok=True)
FPS = 30

# our clip name -> (library, source clip, loop)
CLIPS = {
    'idle': ('ual1', 'Idle_Loop', True),
    'talk': ('ual1', 'Idle_Talking_Loop', True),
    'walk': ('ual1', 'Walk_Loop', True),
    'walk_formal': ('ual1', 'Walk_Formal_Loop', True),
    'run': ('ual1', 'Jog_Fwd_Loop', True),
    'sprint': ('ual1', 'Sprint_Loop', True),
    'jump_start': ('ual1', 'Jump_Start', False),
    'jump_air': ('ual1', 'Jump_Loop', True),
    'land': ('ual1', 'Jump_Land', False),
    'roll': ('ual1', 'Roll', False),
    'crouch_idle': ('ual1', 'Crouch_Idle_Loop', True),
    'crouch_walk': ('ual1', 'Crouch_Fwd_Loop', True),
    'sit_idle': ('ual1', 'Sitting_Idle_Loop', True),
    'sit_talk': ('ual1', 'Sitting_Talking_Loop', True),
    'sit_down': ('ual1', 'Sitting_Enter', False),
    'stand_up': ('ual1', 'Sitting_Exit', False),
    'dance': ('ual1', 'Dance_Loop', True),
    'death': ('ual1', 'Death01', False),
    'hit_chest': ('ual1', 'Hit_Chest', False),
    'hit_head': ('ual1', 'Hit_Head', False),
    'punch_jab': ('ual1', 'Punch_Jab', False),
    'punch_cross': ('ual1', 'Punch_Cross', False),
    'push': ('ual1', 'Push_Loop', True),
    'drive': ('ual1', 'Driving_Loop', True),
    'interact': ('ual1', 'Interact', False),
    'pick_up': ('ual1', 'PickUp_Table', False),
    'kneel_work': ('ual1', 'Fixing_Kneeling', True),
    'phone_call': ('ual2', 'Idle_TalkingPhone_Loop', True),
    'idle_arms_folded': ('ual2', 'Idle_FoldArms_Loop', True),
    'shake_no': ('ual2', 'Idle_No_Loop', True),
    'nod_yes': ('ual2', 'Yes', False),
    'call_out': ('ual2', 'Idle_Rail_Call', True),
    'climb_up': ('ual2', 'ClimbUp_1m', False),
    'hero_jump_start': ('ual2', 'NinjaJump_Start', False),
    'fall': ('ual2', 'NinjaJump_Idle_Loop', True),
    'land_hard': ('ual2', 'NinjaJump_Land', False),
    'hit_knockback': ('ual2', 'Hit_Knockback', False),
    'get_up': ('ual2', 'LayToIdle', False),
    'drink': ('ual2', 'Consume', False),
    'throw': ('ual2', 'OverhandThrow', False),
    'punch_hook': ('ual2', 'Melee_Hook', False),
    'slide_start': ('ual2', 'Slide_Start', False),
    'slide': ('ual2', 'Slide_Loop', True),
    'slide_end': ('ual2', 'Slide_Exit', False),
    'walk_carry': ('ual2', 'Walk_Carry_Loop', True),
}


def import_ual(tag, path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = [o for o in new if o.type == 'ARMATURE'][0]
    for o in new:
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    arm.name = tag
    arm.rotation_mode = 'XYZ'
    arm.rotation_euler = (0, 0, math.pi)   # face +Y like the target
    bpy.context.view_layer.update()
    acts = {}
    for a in bpy.data.actions:
        if a.name not in RT_ACTIONS_SEEN:
            acts[a.name.split('|')[-1]] = a
            RT_ACTIONS_SEEN.add(a.name)
    return arm, acts


RT_ACTIONS_SEEN = set()


def action_range(act):
    fr = act.frame_range
    return int(round(fr[0])), int(round(fr[1]))


def root_speed(tag, clipname):
    """natural speed (m/s, source scale) from the root-motion version of the library"""
    return ROOT_SPEEDS.get(tag, {}).get(clipname)


ROOT_SPEEDS = {}
ROOT_DISP = {}


def measure_root_speeds():
    for tag, path in UAL_RM.items():
        before_o = set(bpy.data.objects); before_a = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before_o]
        arm = [o for o in new if o.type == 'ARMATURE'][0]
        ROOT_SPEEDS[tag] = {}
        for a in [a for a in bpy.data.actions if a not in before_a]:
            nm = a.name.split('|')[-1]
            arm.animation_data.action = a
            if a.slots:
                arm.animation_data.action_slot = a.slots[0]
            f0, f1 = action_range(a)
            sc = bpy.context.scene
            ps = []
            for f in (f0, f1):
                sc.frame_set(f)
                ps.append((arm.matrix_world @ arm.pose.bones['root'].matrix).translation.copy())
            dur = (f1 - f0) / FPS
            d = ps[1] - ps[0]
            ROOT_SPEEDS[tag][nm] = ((d.length / dur) if dur > 0 else 0)
            # UAL faces -Y in Blender: forward = -y
            ROOT_DISP.setdefault(tag, {})[nm] = (-d.y, d.z, d.x)
            bpy.data.actions.remove(a)
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)


def main(only=None):
    t0 = time.time()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(C.SCRATCH, 'spiderman', 'spiderman.blend'))
    sc = bpy.context.scene
    sc.render.fps = FPS
    tgt = bpy.data.objects['spiderman']
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for a in bpy.data.actions:
        RT_ACTIONS_SEEN.add(a.name)
    measure_root_speeds()
    srcs = {}
    for tag, path in UAL.items():
        srcs[tag] = import_ual(tag, path)
    tgt.animation_data_create()
    for pb in tgt.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    offsets = {}
    info = {}
    hip_t = RT.hip_height(tgt)
    for tag, (src, acts) in srcs.items():
        # evaluate rests with no action
        src.animation_data.action = None
        bpy.context.view_layer.update()
        A, Rm, Pm, trest, srest = RT.compute_offsets(tgt, src)
        hip_s = RT.hip_height(src)
        offsets[tag] = (A, trest, srest, hip_t / hip_s)
    print('sources ready', time.time() - t0, 'hip scale', {k: v[3] for k, v in offsets.items()})
    made = []
    RAW = {}
    for name, (tag, sname, loop) in CLIPS.items():
        if only and name not in only:
            continue
        src, acts = srcs[tag]
        act = acts.get(sname)
        if act is None:
            print('MISSING', tag, sname); continue
        A, trest, srest, hs = offsets[tag]
        f0, f1 = action_range(act)
        frames = list(range(f0, f1 + 1))
        SF = RT.sample_source(src, act, frames)
        data = RT.retarget_frames(tgt, SF, A, trest, srest, hs)
        if loop:
            fix_loop(data)
        RAW[name] = data
        a = RT.write_action(tgt, name, data, FPS, loop)
        spd = root_speed(tag, sname)
        info[name] = dict(source=f'{tag}:{sname}', loop=loop, frames=len(frames), duration=round((len(frames) - 1) / FPS, 3),
                          speed=round(spd * hs, 3) if spd is not None else None)
        disp = ROOT_DISP.get(tag, {}).get(sname)
        if disp is not None and not loop and (abs(disp[0]) > 0.05 or abs(disp[1]) > 0.05):
            info[name]['root_motion_m'] = dict(forward=round(disp[0] * hs, 3), up=round(disp[1] * hs, 3))
        made.append(a)
        print(name, info[name])
    rig = AL.Rig(tgt)
    if not only or any(k not in CLIPS for k in only):
        need = ['idle', 'talk', 'walk', 'run', 'punch_jab']
        missing = [k for k in need if k not in RAW]
        assert not missing, missing
        for name, (data, loop) in PC.build_all(rig, RAW).items():
            if only and name not in only:
                continue
            if loop:
                fix_loop(data)
            RAW[name] = data
            RT.write_action(tgt, name, data, FPS, loop)
            info[name] = dict(source='procedural layer', loop=loop, frames=len(data), duration=round((len(data) - 1) / FPS, 3), speed=None)
            print(name, info[name])
    for name, d in info.items():
        if d['loop'] and name in RAW:
            sp = stance_speed(rig, RAW[name])
            d['stance_speed'] = round(sp, 3) if sp is not None else None
    for tag, (src, acts) in srcs.items():
        src.animation_data.action = None
    tgt.animation_data.action = None
    json.dump(info, open(os.path.join(OUT, 'clips_info.json'), 'w'), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'anims.blend'))
    if not only:
        export_anims(os.path.join(OUT, 'humans_anims_raw.glb'))
    print('done', time.time() - t0)


def stance_speed(rig, data):
    """Ground speed implied by the planted foot (m/s): median backwards speed of the lowest foot
    while it is within 2.5 cm of its lowest height. None if the feet don't move."""
    pos = []
    for fd in data:
        W, P = rig.fk(fd)
        pos.append((P['ball_l'].copy(), P['ball_r'].copy()))
    zmin = min(min(a.z, b.z) for a, b in pos)
    v = []
    for i in range(len(pos) - 1):
        for k in (0, 1):
            a, b = pos[i][k], pos[i + 1][k]
            if a.z < zmin + 0.025 and b.z < zmin + 0.025 and a.z <= pos[i][1 - k].z + 0.01:
                v.append(-(b.y - a.y) * FPS)
    if len(v) < 3:
        return None
    v = sorted(v)
    sp = v[len(v) // 2]
    return sp if sp > 0.05 else 0.0


def fix_loop(data):
    """Make a looping clip seamless: blend the last few frames towards the first frame and remove
    any residual horizontal pelvis drift."""
    n = len(data)
    # pelvis drift (in place)
    if data[0]['pelvis'][1] is not None:
        p0 = Vector(data[0]['pelvis'][1]); p1 = Vector(data[-1]['pelvis'][1])
        drift = p1 - p0
        for i, fd in enumerate(data):
            q, loc = fd['pelvis']
            fd['pelvis'] = (q, loc - drift * (i / (n - 1)))
    # rotations: distribute the end mismatch over the clip
    for bn in data[0].keys():
        qa = data[0][bn][0]; qb = data[-1][bn][0]
        if qa.dot(qb) < 0:
            qb = -qb
        err = qa @ qb.inverted()      # rotation taking last -> first
        for i, fd in enumerate(data):
            q, loc = fd[bn]
            t = i / (n - 1)
            e = Quaternion().slerp(err, t)
            fd[bn] = ((e @ q).normalized(), loc)




def export_anims(path, with_mesh=False):
    """Export the reference armature with every action as an NLA track -> glTF animation."""
    tgt = bpy.data.objects['spiderman']
    tgt.animation_data_create()
    for o in list(bpy.data.objects):
        if o.type == 'ARMATURE' and o is not tgt:
            bpy.data.objects.remove(o, do_unlink=True)
    tgt.name = 'humans_anim_rig'
    for tr in list(tgt.animation_data.nla_tracks):
        tgt.animation_data.nla_tracks.remove(tr)
    acts = [a for a in bpy.data.actions if a.get('loop') is not None]
    for a in sorted(acts, key=lambda a: a.name):
        tr = tgt.animation_data.nla_tracks.new()
        tr.name = a.name
        st = tr.strips.new(a.name, 0, a)
        st.name = a.name
    tgt.animation_data.action = None
    objs = [tgt] + ([o for o in tgt.children if o.type == 'MESH'] if with_mesh else [])
    C.export_glb(path, objs, animations=True, export_animation_mode='NLA_TRACKS',
                 export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=False,
                 export_anim_slide_to_zero=True, export_bake_animation=False, export_reset_pose_bones=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main(set(args) if args else None)
