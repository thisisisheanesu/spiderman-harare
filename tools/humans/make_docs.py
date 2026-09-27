# Generates the machine-readable manifests next to the assets:
#   public/models/humans/humans_manifest.json   (variants, files, sizes, tris, heights, roles)
#   public/models/anims/humans_anims.json       (clips: duration, loop, speeds, root motion, notes)
# and prints the markdown tables used in public/models/humans/README.md.
#   python3 make_docs.py <scratch>
import json, os, sys

S = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PH = os.path.join(REPO, 'public', 'models', 'humans')
PA = os.path.join(REPO, 'public', 'models', 'anims')

NOTES = {
    'idle': 'standing idle, wide "hero" stance (good for Spider-Man)',
    'idle_relaxed': 'NPC idle: feet under hips, arms closer, hands open',
    'idle_look': 'idle + looking left/right (5 s)',
    'idle_arms_folded': 'waiting with folded arms (vendors, guards)',
    'talk': 'talking with hand gestures', 'talk_2': 'talking (mirrored gestures)',
    'phone_call': 'phone held to the ear', 'phone_film': 'filming with a phone held up in both hands (attach phone to hand_r)',
    'point': 'pointing forward with the right index finger', 'cheer': 'both fists up, pumping, small bounce',
    'wave': 'waving the right hand overhead', 'call_out': 'hand cupped, calling out (hwindi touting)',
    'nod_yes': 'nodding (one-shot)', 'shake_no': 'head shake', 'dance': 'dance loop',
    'walk': 'normal walk', 'walk_female': 'walk with narrow (centre-line) steps', 'walk_formal': 'upright walk, arms straighter',
    'walk_slow': 'slow short-stride walk (elders)', 'walk_carry': 'walking carrying a box in front',
    'carry_on_head': 'walk steadying a load on the head with the left hand (market women)',
    'run': 'fast run', 'sprint': 'full sprint', 'flee_run': 'panicked run, arms flailing, looks back over the shoulder once',
    'crouch_walk': 'sneaking crouched walk', 'turn_left': 'in-place stepping, torso leading left: rotate the character yourself ~100 deg/s',
    'turn_right': 'in-place stepping, torso leading right', 'jump_start': 'take-off (one-shot)', 'jump_air': 'airborne loop',
    'land': 'landing recovery', 'fall': 'mid-air superhero crouch (falling)', 'land_hard': 'superhero landing, crouch then stand',
    'hero_jump_start': 'crouched power take-off', 'roll': 'forward combat roll', 'crouch_idle': 'crouch / perch on ledges',
    'climb': 'Spider-Man wall crawl: faces the wall (-Z), hands/feet on a plane ~0.34 m in front; move the character up yourself',
    'climb_up': 'vault / climb onto a 1 m ledge', 'hang': 'hanging from the web: both hands up, legs trailing',
    'swing': 'one full web-swing cycle (legs back -> tuck -> forward), right hand on the web', 'zip': 'pulling on a web line ahead',
    'skydive': 'spread-eagle free fall (pitch the body face-down yourself)', 'dive': 'head-first streamlined dive',
    'web_shoot': 'right arm snaps forward, "thwip" hand (one-shot)', 'sit_idle': 'seated idle (seat height ~0.45 m)',
    'sit_talk': 'seated talking', 'sit_down': 'stand -> sit', 'stand_up': 'sit -> stand', 'drive': 'seated, hands on a steering wheel (kombi / car drivers)',
    'push': 'pushing (handcart pushers)', 'kneel_work': 'kneeling and working on something', 'interact': 'reach and press / use',
    'pick_up': 'pick something up from a table', 'drink': 'drink / eat', 'throw': 'overhand throw',
    'punch_jab': 'jab', 'punch_cross': 'cross', 'punch_hook': 'hook', 'hit_chest': 'hit reaction (chest)', 'hit_head': 'hit reaction (head)',
    'hit_knockback': 'knocked back', 'death': 'collapse', 'get_up': 'get up from lying on the back',
    'slide_start': 'slide start', 'slide': 'sliding loop', 'slide_end': 'slide end',
}


LOCO = {'walk', 'walk_female', 'walk_formal', 'walk_slow', 'walk_carry', 'carry_on_head', 'run', 'sprint', 'flee_run',
        'crouch_walk', 'push', 'turn_left', 'turn_right'}


def glb_json(p):
    import struct
    b = open(p, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n])


def glb_tris_extras(p):
    g = glb_json(p)
    tris = sum(g['accessors'][pr['indices']]['count'] // 3 for m in g.get('meshes', []) for pr in m['primitives'])
    ex = {}
    for nd in g['nodes']:
        ex.update(nd.get('extras', {}))
    return tris, ex


def fsize(p):
    return os.path.getsize(p) if os.path.exists(p) else None


def main():
    vi = json.load(open(os.path.join(S, 'npcs', 'variants_info.json')))
    ci = json.load(open(os.path.join(S, 'anims', 'clips_info.json')))
    variants = []
    for vid in sorted(vi):
        v = vi[vid]
        variants.append(dict(id=vid, gender=v['gender'], roles=v['roles'], description=v['desc'],
                             height_m=v['height'], hip_height_m=v['hipHeight'],
                             lod0=dict(file=f'npc_{vid}.glb', tris=v['tris_lod0'], bytes=fsize(os.path.join(PH, f'npc_{vid}.glb')), texture=1024),
                             lod1=dict(file=f'npc_{vid}_lod1.glb', tris=v['tris_lod1'], bytes=fsize(os.path.join(PH, f'npc_{vid}_lod1.glb')), texture=256),
                             clothes=v['clothes'], hair=v['hair'], skin=dict(base=v['skin'][0], tone=v['skin'][1])))
    sm_tris, sm_ex = glb_tris_extras(os.path.join(PH, 'spiderman.glb'))
    _, an_ex = glb_tris_extras(os.path.join(PA, 'humans_anims.glb'))
    man = dict(
        units='metres, y up, characters face -Z, feet at y=0',
        skeleton='MakeHuman game_engine rig (53 bones, UE-mannequin-like names); every file shares the same bone names and rest orientations',
        animations='../anims/humans_anims.glb',
        reference_hip_height_m=an_ex.get('hipHeight'),
        spiderman=dict(file='spiderman.glb', bytes=fsize(os.path.join(PH, 'spiderman.glb')), tris=sm_tris,
                       height_m=round(sm_ex.get('height', 0), 3), hip_height_m=sm_ex.get('hipHeight'),
                       materials=['suit_classic', 'suit_symbiote'], variants=['classic', 'symbiote']),
        lod_distances_m=dict(desktop=dict(lod0=0, lod1=22, cull=90), phone=dict(lod0=0, lod1=12, cull=55)),
        npcs=variants)
    clips = []
    for name in sorted(ci):
        c = ci[name]
        loco = name in LOCO
        clips.append(dict(name=name, duration_s=c['duration'], loop=c['loop'], frames=c['frames'], fps=30,
                          speed_mps=c.get('stance_speed') if (c['loop'] and loco) else None,
                          root_speed_mps=c.get('speed'), root_motion_m=c.get('root_motion_m'),
                          source=c['source'], note=NOTES.get(name, '')))
    json.dump(dict(file='humans_anims.glb', fps=30, clips=clips), open(os.path.join(PA, 'humans_anims.json'), 'w'), indent=1)
    json.dump(man, open(os.path.join(PH, 'humans_manifest.json'), 'w'), indent=1)
    # markdown tables
    print('| id | gender | roles | description | height m | LOD0 tris / KB | LOD1 tris / KB |')
    print('|---|---|---|---|---|---|---|')
    for v in variants:
        print(f"| `{v['id']}` | {v['gender']} | {', '.join(v['roles'])} | {v['description']} | {v['height_m']:.2f} | "
              f"{v['lod0']['tris']} / {round((v['lod0']['bytes'] or 0) / 1024)} | {v['lod1']['tris']} / {round((v['lod1']['bytes'] or 0) / 1024)} |")
    print()
    print('| clip | s | loop | speed m/s | root motion (one-shots) | source | notes |')
    print('|---|---|---|---|---|---|---|')
    for c in clips:
        sp = '' if not c['loop'] or not c['speed_mps'] else f"{c['speed_mps']:.2f}"
        rm = '' if not c['root_motion_m'] else f"fwd {c['root_motion_m']['forward']:.2f} m, up {c['root_motion_m']['up']:.2f} m"
        print(f"| `{c['name']}` | {c['duration_s']:.2f} | {'yes' if c['loop'] else 'no'} | {sp} | {rm} | {c['source']} | {c['note']} |")


main()
