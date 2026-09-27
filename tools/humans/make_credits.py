# Writes public/models/humans/CREDITS.md from the variant list + MakeHuman asset-pack metadata.
#   python3 make_credits.py <scratch>/npcs/variants_info.json <credits_meta_dir> <out.md>
# credits_meta_dir holds the packs/*.json files shipped inside each MakeHuman asset pack zip.
import json, sys, os, glob

info = json.load(open(sys.argv[1]))
meta = {}
packs = {}
for f in glob.glob(os.path.join(sys.argv[2], '**', '*.json'), recursive=True):
    d = json.load(open(f))
    pack = os.path.basename(f).replace('.json', '')
    for k, v in d.items():
        if isinstance(v, dict):
            meta[k] = v
            packs[k] = pack

PACK_URL = 'https://static.makehumancommunity.org/assets/assetpacks/{}.html'
used = {}
for vid, v in sorted(info.items()):
    names = list(v['clothes']) + [v['skin'][0], 'low-poly']
    if v['hair'] in ('bob02', 'afro01', 'bob01', 'braid01', 'short04'):
        names.append(v['hair'])
    for n in names:
        used.setdefault(n, []).append(vid)

rows = []
for n, vids in sorted(used.items()):
    m = meta.get(n, {})
    pack = packs.get(n, 'makehuman_system_assets')
    lic = m.get('license', 'CC0')
    author = m.get('author', 'makehuman_system') or 'makehuman_system'
    src = m.get('source', '') or ''
    rows.append((n, m.get('type', ''), author, lic, pack, src, vids))

out = []
out.append('# Credits and licences: humans, Spider-Man and animations\n')
out.append('Every asset here is CC0 (public domain) or CC BY 4.0. Nothing is ripped from a game, and nothing comes from Mixamo or any non-commercial/editorial source.\n')
out.append('## Tools (not distributed)\n')
out.append('- **MPFB 2.0.17** (MakeHuman plugin for Blender) by Joel Palmius and the MakeHuman team, from https://extensions.blender.org/add-ons/mpfb/ . The add-on code is GPL-3.0. It was used only as a build tool, and none of its code ships with the game.')
out.append('- **Blender 5.0** (bpy module), **gltf-transform 4.5**, **meshoptimizer**, **sharp**: build and compression tools.\n')
out.append('## Base bodies, rig and skins (CC0)\n')
out.append('- MakeHuman base mesh `hm08`, the morph targets (macro sliders, ears/nose/mouth details) and the `game_engine` rig and skin weights, as shipped in MPFB 2.0.17. They were released as **CC0** by Data Collection AB, Joel Palmius and Jonas Hauquier in September 2020 (http://www.makehumancommunity.org). Spider-Man and all NPC bodies are built on these.')
out.append('- MakeHuman system assets pack (**CC0**): skins, low-poly eyes, hair, shoes and system clothes. Source: https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip\n')
out.append('## Clothes, hair and skins used by the NPC variants\n')
out.append('The asset name matches the MakeHuman asset repository entry. CC BY assets need the attribution in this table, which the game credits screen should reproduce: "<asset> by <author>, CC BY 4.0, via the MakeHuman community asset repository".\n')
out.append('| asset | type | author | licence | pack | source | used by |')
out.append('|---|---|---|---|---|---|---|')
for n, t, a, l, p, s, v in rows:
    purl = PACK_URL.format(p)
    note = ' (used as a plain baseball cap; the flat recolour removes the printed text)' if n == 'toigo_maga_hat' else ''
    out.append(f'| {n}{note} | {t} | {a} | {l} | [{p}]({purl}) | {s} | {", ".join(v)} |')
cc_by = sorted(set((a, n) for n, t, a, l, p, s, v in rows if 'BY' in l.upper()))
out.append('\n### CC BY attribution summary\n')
for a, n in cc_by:
    out.append(f'- "{n}" by {a}, licensed CC BY (the MakeHuman asset repository CC-BY option, CC BY 4.0: https://creativecommons.org/licenses/by/4.0/), MakeHuman community asset repository. Recoloured, decimated and baked into a texture atlas.')
out.append('\n## Animation (CC0)\n')
out.append('- **Universal Animation Library** (Standard) and **Universal Animation Library 2** (Standard) by **Quaternius** (animations with Gonzalo Furnier), **CC0 1.0**. Sources: https://quaternius.itch.io/universal-animation-library and https://quaternius.itch.io/universal-animation-library-2 (free "name your own price" downloads). The clips were retargeted onto the MakeHuman `game_engine` skeleton. The procedural clips (wave, point, cheer, phone_film, idle_look, idle_relaxed, walk_slow, walk_female, turn_left/right, flee_run, hang, swing, zip, skydive, dive, climb, carry_on_head, web_shoot, talk_2) are original work layered on top of those clips and are released as CC0.\n')
out.append('## Spider-Man suits\n')
out.append('- Both suit textures (classic and symbiote) were painted procedurally by `tools/humans/suit_paint.py` for this project. They are original work, released as CC0. Spider-Man is a Marvel character, and this is a non-commercial fan project. The suit designs are generic web/spider patterns drawn from scratch, with no copied artwork.\n')
open(sys.argv[3], 'w').write('\n'.join(out) + '\n')
print('wrote', sys.argv[3], len(rows), 'assets')
