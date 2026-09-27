#!/usr/bin/env python3
"""Labelled contact sheet of Sketchfab thumbnails (for curating candidates by eye).

    VR_WORK=... python3 contact_sheet.py out.jpg <uid> [<uid> ...]   [--cols 4] [--w 400]
Labels: short uid, face count, licence, name (from the cached search results / model info)."""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

WORK = os.environ.get('VR_WORK', os.path.abspath('vehicles-real-work'))


def meta():
    known = {}
    sd = os.path.join(WORK, 'search')
    for fn in os.listdir(sd) if os.path.isdir(sd) else []:
        for m in json.load(open(os.path.join(sd, fn))):
            known[m['uid']] = m
    return known


def main():
    args = sys.argv[1:]
    cols = int(args[args.index('--cols') + 1]) if '--cols' in args else 4
    w = int(args[args.index('--w') + 1]) if '--w' in args else 400
    args = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or not args[i - 1].startswith('--'))]
    out, uids = args[0], args[1:]
    known = meta()
    h = int(w * 0.5625)
    lab = 34
    rows = (len(uids) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * w, rows * (h + lab)), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
    except OSError:
        f = ImageFont.load_default()
    for i, uid in enumerate(uids):
        x, y = (i % cols) * w, (i // cols) * (h + lab)
        p = os.path.join(WORK, 'thumbs', uid + '.jpg')
        if os.path.exists(p):
            im = Image.open(p).convert('RGB')
            im.thumbnail((w, h))
            sheet.paste(im, (x + (w - im.width) // 2, y + (h - im.height) // 2))
        m = known.get(uid, {})
        d.text((x + 4, y + h + 2), f"{uid[:6]}  {m.get('faces') or 0}f  {m.get('licence', '')}", font=f, fill=(255, 220, 90))
        d.text((x + 4, y + h + 17), f"{(m.get('name') or '')[:52]}", font=f, fill=(230, 230, 230))
    sheet.save(out, quality=88)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
