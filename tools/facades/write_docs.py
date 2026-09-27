#!/usr/bin/env python3
"""Generate public/models/facades/CREDITS.md and the generated tables of README.md from kit.json + refs.json.

    python3 tools/facades/write_docs.py
README.md prose is hand-written; the blocks between <!-- gen:NAME --> and <!-- /gen:NAME --> are replaced.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(REPO, 'public', 'models', 'facades')
kit = json.load(open(os.path.join(OUT, 'kit.json')))
refs = json.load(open(os.path.join(HERE, 'refs.json')))


def kb(n):
    return f'{n / 1024:.0f} KB'


def files_size():
    tot = 0
    rows = []
    for root, _, files in os.walk(OUT):
        for f in files:
            p = os.path.join(root, f)
            s = os.path.getsize(p)
            tot += s
            rows.append((os.path.relpath(p, OUT), s))
    return tot, sorted(rows)


def gen_types():
    lines = []
    for t, T in kit['types'].items():
        lines.append(f"### `{t}`: {T['title']}\n")
        mats = ', '.join(f"{r} `{m['pbr']}`" + (f" {m['tint']}" if m.get('tint') else '') for r, m in T['materials'].items()
                         if r in ('wall', 'trim', 'accent', 'glass'))
        lines.append(f"Bay {T['bay']} m, floor {T['floor']} m, ground floor {T['groundFloor']} m, cap {T['cap']} m. Default materials: {mats}.\n")
        pal = '; '.join(f"{r}: " + ' '.join(v) for r, v in T['palette'].items())
        lines.append(f"Palette from the photos: {pal}.\n")
        lines.append('Reference photos (in the orchestrator scratch `photos/` folder; every file page is linked):\n')
        for r in T['references']:
            nc = ' **(non-commercial: looked at only)**' if r['reference_only'] else ''
            lines.append(f"- [`{r['photo']}`]({r['url']}): {r['shows']}. {r['author']}, {r['licence']}{nc}.")
        lines.append('')
        lines.append('| module | kind | floor | w x h (m) | depth out / in (m) | stretch x / y (m) | tris LOD0 / LOD1 | notes |')
        lines.append('|---|---|---|---|---|---|---|---|')
        for k, m in T['modules'].items():
            d = m.get('depth', {})
            dep = f"{d.get('out', 0):.2f} / {d.get('in', 0):.2f}" if d else ''
            lines.append(f"| `{k}` | {m['kind']} | {m['floor']} | {m['width']:g} x {m['height']:g} | {dep} | "
                         f"{m['stretch']['x'][0]:g}-{m['stretch']['x'][1]:g} / {m['stretch']['y'][0]:g}-{m['stretch']['y'][1]:g} | "
                         f"{m['tris'][0]} / {m['tris'][1]} | {m['notes']} |")
        lines.append('')
    return '\n'.join(lines)


def gen_common():
    lines = ['| module | w x h (m) | tris LOD0 / LOD1 | materials | notes |', '|---|---|---|---|---|']
    for k, m in kit['common']['modules'].items():
        lines.append(f"| `{k}` | {m['width']:g} x {m['height']:g} | {m['tris'][0]} / {m['tris'][1]} | {', '.join(m['materials'])} | {m['notes']} |")
    return '\n'.join(lines)


def gen_sizes():
    tot, rows = files_size()
    glb = sum(s for f, s in rows if f.endswith('.glb'))
    tex = sum(s for f, s in rows if f.startswith('tex/'))
    other = tot - glb - tex
    lines = [f'**Total {tot / 1e6:.2f} MB** (budget 8 MB): GLBs {glb / 1e6:.2f} MB, atlas + impostor textures {tex / 1e6:.2f} MB, '
             f'json / docs {other / 1e6:.2f} MB. The shared PBR textures in `public/textures/` are referenced by name, not duplicated.', '',
             '| file | size |', '|---|---|']
    for f, s in rows:
        if f.endswith('.glb') or f == 'kit.json':
            lines.append(f'| `{f}` | {kb(s)} |')
    per = {}
    for f, s in rows:
        if f.startswith('tex/'):
            t = os.path.basename(f).split('_')[0]
            per[t] = per.get(t, 0) + s
    lines.append('| `tex/<type>_*` | ' + ', '.join(f'{t} {kb(s)}' for t, s in per.items()) + ' |')
    return '\n'.join(lines)


def credits():
    L = ['# Credits: Harare facade kit (`public/models/facades/`)', '',
         'The facade modules, their LOD1 atlases and impostor textures were modelled and baked for this project by '
         '`tools/facades/` (Blender Python + Cycles) and are released with the game. They use the CC0 PBR materials of '
         '`public/textures/` (see `public/textures/CREDITS.md`).', '',
         '## Downloaded assets embedded in `common.glb`', '',
         '| asset | author | source | licence | used as |', '|---|---|---|---|---|']
    for a in refs['attachments']:
        L.append(f"| {a['title']} | {', '.join(a['authors'])} | [{a['source']}]({a['url']}) | "
                 f"[{a['licence']}]({a.get('licence_url') or ''}) | {a['use']} |")
    L += ['', 'CC BY 4.0 attribution (required when shipping): "Old window air conditioner" by HASSAN '
          '(https://sketchfab.com/3d-models/old-window-air-conditioner-df7687570458444cb66fecdbfea2adc4) and '
          '"Air Conditioner Unit, Low Poly" by MC_RightLeft '
          '(https://sketchfab.com/3d-models/air-conditioner-unit-low-poly-11d7c77bfe804f448a516928adf3f05d), '
          'licensed under CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: re-oriented, re-scaled, '
          'decimated, textures resized to 256 px WebP.', '',
          'Poly Haven assets are CC0 (no attribution required; credited as courtesy).', '',
          '## Reference photos (looked at, not shipped)', '',
          'No photo pixels are in any shipped texture: the photos were only used to decide proportions, colours and details. '
          'Photos marked non-commercial were looked at only.', '',
          '| type | photo | author | licence | link |', '|---|---|---|---|---|']
    seen = set()
    for t, lst in refs['types'].items():
        for r in lst:
            key = (t, r['photo'])
            if key in seen:
                continue
            seen.add(key)
            L.append(f"| {t} | {r['title'] or r['photo']} | {r['author']} | {r['licence']}{' (NC: reference only)' if r['reference_only'] else ''} | {r['url']} |")
    open(os.path.join(OUT, 'CREDITS.md'), 'w').write('\n'.join(L) + '\n')


def readme():
    p = os.path.join(OUT, 'README.md')
    s = open(p).read()
    for name, fn in (('types', gen_types), ('common', gen_common), ('sizes', gen_sizes)):
        s = re.sub(rf'<!-- gen:{name} -->.*?<!-- /gen:{name} -->', lambda m: f'<!-- gen:{name} -->\n{fn()}\n<!-- /gen:{name} -->', s, flags=re.S)
    open(p, 'w').write(s)


if __name__ == '__main__':
    credits()
    readme()
    print('docs written')
