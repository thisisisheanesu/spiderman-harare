#!/usr/bin/env python3
"""Render the verification shots (shots.json) with the headless page and compose them next to the reference photos.

    node tools/facades/verify/server.mjs 8793 &
    FACADE_PHOTOS=<photos dir> FACADE_SHOTS=<out dir> python3 tools/facades/verify/run_shots.py [names...]
"""
import json
import os
import subprocess
import sys
import urllib.parse

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PHOTOS = os.environ.get('FACADE_PHOTOS', '')
OUT = os.environ.get('FACADE_SHOTS', '/tmp/facade-shots')
os.makedirs(OUT, exist_ok=True)
cfg = json.load(open(os.path.join(HERE, 'shots.json')))
want = sys.argv[1:]


def compose(render, photo, out, title):
    r = Image.open(render).convert('RGB')
    H = 540
    r = r.resize((round(r.width * H / r.height), H))
    tiles = [r]
    if photo and os.path.exists(photo):
        p = Image.open(photo).convert('RGB')
        tiles.insert(0, p.resize((round(p.width * H / p.height), H)))
    W = sum(t.width for t in tiles) + 8 * (len(tiles) - 1)
    s = Image.new('RGB', (W, H + 26), (24, 24, 24))
    x = 0
    for t in tiles:
        s.paste(t, (x, 26))
        x += t.width + 8
    d = ImageDraw.Draw(s)
    d.text((6, 6), title, fill=(235, 235, 235))
    s.save(out, quality=86)


for shot in cfg['shots']:
    if want and shot['name'] not in want:
        continue
    q = shot['query'] + '&spec=' + urllib.parse.quote(json.dumps(shot.get('spec', {})))
    png = os.path.join(OUT, shot['name'] + '.png')
    res = subprocess.run(['node', os.path.join(HERE, 'shoot.mjs'), png, q, str(shot['w']), str(shot['h'])],
                         capture_output=True, text=True, cwd=REPO)
    print(shot['name'], res.stdout.strip()[:1500], res.stderr.strip()[-500:])
    compose(png, os.path.join(PHOTOS, shot['photo']), os.path.join(OUT, shot['name'] + '_vs.jpg'),
            f"left: reference photo {shot['photo']}   right: facade kit render ({shot['name']})")
