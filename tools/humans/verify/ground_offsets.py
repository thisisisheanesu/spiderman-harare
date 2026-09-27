# Ground offsets from review_viewer stats: how far each character's lowest skinned vertex sinks below y=0
# in idle_relaxed / walk (shoe soles and proportions differ from the reference rig). The game lifts the
# model by this much (humans_manifest.json ground_offset_m, README).
#   node review_shot.mjs "mode=stats&vstep=1&clips=idle_relaxed,walk&models=pub/humans/spiderman.glb,pub/humans/npc_...glb" stats.json
#   python3 ground_offsets.py stats.json > ../ground_offsets.json
import json, sys, collections
rows = collections.defaultdict(dict)
for r in json.load(open(sys.argv[1])):
    rows[r['m'].replace('.glb', '')][r['clip']] = r['minY']
out = {}
for m, c in sorted(rows.items()):
    key = 'spiderman' if m == 'spiderman' else m.replace('npc_', '')
    out[key] = round(max(0.0, -(c['idle_relaxed'] + c['walk']) / 2), 3)
print(json.dumps(out, indent=1))
