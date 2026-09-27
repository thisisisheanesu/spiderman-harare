#!/usr/bin/env python3
"""Writes public/models/dressing/CREDITS.md (from items.json / trees.json sources) and the asset tables of
README.md (between the <!-- TABLE --> markers) from dressing.json.   python3 tools/dressing/make_docs.py"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'models', 'dressing')
man = json.load(open(os.path.join(OUT, 'dressing.json')))
cfg = {c['name']: c for c in json.load(open(os.path.join(HERE, 'trees.json')))['trees']}
cfg.update({c['name']: c for c in json.load(open(os.path.join(HERE, 'items.json')))['items']})
items = [e for e in man['items'] if e['name'] in cfg]


def kb(b):
    return f'{b / 1024:.0f}' if b else '-'


# ------------------------------------------------------------------ CREDITS
lines = ['# Credits: vegetation and street / facade dressing (`public/models/dressing/`)', '',
         'Every downloaded model or texture is listed with its title, author, source URL and licence. Only CC BY 4.0',
         'and CC0 material is used (no NonCommercial / NoDerivatives / ShareAlike assets). CC BY requires attribution:',
         'keep this file (or its lines) in the game credits. The files here are **modified** versions of the sources:',
         'rescaled, re-oriented, decimated, re-textured / regraded, foliage rebuilt as alpha cards and impostors, then',
         'compressed (meshopt, WebP). Items marked *procedural* were modelled for this project and are CC0.', '']
by_src = {}
for e in items:
    src = cfg[e['name']].get('source') or {}
    key = src.get('url') or ('procedural:' + e['name'])
    by_src.setdefault(key, {'src': src, 'names': []})['names'].append(e['name'])
lines += ['## Downloaded models', '', '| used for | title | author | licence | source |', '|---|---|---|---|---|']
for key, v in sorted(by_src.items(), key=lambda kv: kv[1]['names'][0]):
    s = v['src']
    if s.get('kind') in ('sketchfab', 'polyhaven'):
        site = 'Sketchfab' if s['kind'] == 'sketchfab' else 'Poly Haven'
        lines.append(f"| {', '.join('`' + n + '`' for n in v['names'])} | {s['title']} | {s['author']} ({site}) | {s['license']} | <{s['url']}> |")
lines += ['', '## Textures', '', '| used for | title | author | licence | source |', '|---|---|---|---|---|']
tex_seen = {}
for e in items:
    for t in (cfg[e['name']].get('source') or {}).get('textures', []):
        tex_seen.setdefault(t['url'], {'t': t, 'names': []})['names'].append(e['name'])
for v in tex_seen.values():
    t = v['t']
    lines.append(f"| {', '.join('`' + n + '`' for n in v['names'])} | {t['title']} | {t['author']} (Poly Haven) | {t['license']} | <{t['url']}> |")
lines += ['', '## Procedural (this project, CC0)', '']
for key, v in by_src.items():
    s = v['src']
    if s.get('kind') == 'procedural':
        lines.append(f"- {', '.join('`' + n + '`' for n in v['names'])}: {s.get('note', '')}. `tools/dressing/items_build.py`.")
lines += ['', '## Reference photos (looked at, not shipped)', '',
          'Designs, colours and proportions were matched against freely licensed Harare photos listed in',
          '`docs/references/PHOTOS.md` (Wikimedia Commons / Flickr, CC BY / CC BY-SA / CC0 / PD). The side-by-side checks',
          'use them in `tools/dressing/verify/` renders only; no photo pixels are in any shipped texture. NonCommercial',
          'photos were not used at all.', '']
open(os.path.join(OUT, 'CREDITS.md'), 'w').write('\n'.join(lines) + '\n')

# ------------------------------------------------------------------ README tables
rows = ['| name | group | attach | height m | reach r m | tris LOD0 / LOD1 | KB LOD0 / LOD1 / impostor | source |', '|---|---|---|---|---|---|---|---|']
tot = 0
for e in items:
    s = cfg[e['name']].get('source') or {}
    src = {'sketchfab': 'Sketchfab', 'polyhaven': 'Poly Haven', 'procedural': 'procedural'}.get(s.get('kind'), '?')
    if s.get('author') and s.get('kind') != 'procedural':
        src += ' / ' + s['author']
    imp = e.get('impostor', {}).get('bytes')
    b = e['bytes']
    tot += (b[0] or 0) + (b[1] or 0) + (imp or 0)
    t1 = e['tris'][1] if e['tris'][1] is not None else '-'
    rows.append(f"| `{e['name']}` | {e['group']} | {e['attach']} | {e['height']:.2f} | {e['footprintRadius']:.2f} | {e['tris'][0]} / {t1} | "
                f"{kb(b[0])} / {kb(b[1])} / {kb(imp)} | {src} |")
rows.append(f"\n**Total: {len(items)} assets, {tot / 1048576:.2f} MB** (all GLB + WebP files in this folder).")
rp = os.path.join(OUT, 'README.md')
if os.path.exists(rp):
    txt = open(rp).read()
    a, b = txt.index('<!-- TABLE -->'), txt.index('<!-- /TABLE -->')
    txt = txt[:a] + '<!-- TABLE -->\n' + '\n'.join(rows) + '\n' + txt[b:]
    open(rp, 'w').write(txt)
print('credits + readme table:', len(items), 'items', f'{tot / 1048576:.2f} MB')
