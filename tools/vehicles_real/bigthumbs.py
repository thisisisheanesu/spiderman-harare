"""Fetch the largest Sketchfab thumbnail + description/tags of models (no token) and build a sheet.
    VR_WORK=... python3 bigthumbs.py out.jpg <uid> ...   (writes thumbs/<uid>_big.jpg, prints metadata)"""
import json, os, sys, time, urllib.request
from PIL import Image, ImageDraw, ImageFont
WORK = os.environ.get('VR_WORK', os.path.abspath('vehicles-real-work'))
out, uids = sys.argv[1], sys.argv[2:]
os.makedirs(os.path.join(WORK, 'thumbs'), exist_ok=True)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
tiles = []
for uid in uids:
    mp = os.path.join(WORK, 'thumbs', uid + '_meta.json')
    if os.path.exists(mp):
        m = json.load(open(mp))
    else:
        m = json.load(urllib.request.urlopen(f'https://api.sketchfab.com/v3/models/{uid}')); time.sleep(1.1)
        json.dump(m, open(mp, 'w'))
    p = os.path.join(WORK, 'thumbs', uid + '_big.jpg')
    if not os.path.exists(p):
        ims = sorted(m['thumbnails']['images'], key=lambda t: t['width'])
        big = [t for t in ims if t['width'] >= 1000] or ims[-1:]
        open(p, 'wb').write(urllib.request.urlopen(big[0]['url']).read()); time.sleep(1.1)
    print(f"{uid[:6]} {m['faceCount']:>8}f {m['license']['label']:<16} {m['user']['username']:<20} {m['name']} | tags={[t['name'] for t in m.get('tags', [])][:12]} | {(m.get('description') or '')[:160]!r}")
    im = Image.open(p).convert('RGB'); im = im.resize((720, int(im.height * 720 / im.width)))
    d = ImageDraw.Draw(im); d.rectangle((0, 0, 720, 24), fill=(0, 0, 0))
    d.text((6, 3), f"{uid[:6]} {m['faceCount']}f {m['user']['username']}: {m['name']}"[:80], font=f, fill=(255, 220, 90))
    tiles.append(im)
cols = 2
rows = (len(tiles) + 1) // 2
H = max(t.height for t in tiles)
sheet = Image.new('RGB', (720 * cols, H * rows), (40, 40, 40))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * 720, (i // cols) * H))
sheet.save(out, quality=85)
