#!/usr/bin/env python3
"""Contact sheet of every material in public/textures/materials.json for a quick visual check.

Each cell shows the material tiled 2x2 (so seams show up as a cross in the middle), shaded with its own
normal map and AO under a low sun from the upper left:  albedo * ao * (0.3 + 0.9 * max(0, n.l)).
    python3 tools/materials/preview_sheet.py out.jpg [name-filter]
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX = os.path.join(ROOT, 'public', 'textures')


def lit_cell(e, cell=256):
    def load(k, mode='RGB'):
        return np.asarray(Image.open(os.path.join(TEX, e['files'][k])).convert(mode).resize((cell // 2, cell // 2), Image.LANCZOS),
                          dtype=np.float32) / 255
    alb = load('albedo')
    n = load('normal') * 2 - 1
    orm = load('orm')
    L = np.array([-0.5, 0.6, 0.62])
    L /= np.linalg.norm(L)
    ndl = np.clip((n * L).sum(axis=2), 0, 1)
    lin = alb ** 2.2 * orm[..., 0:1] * (0.3 + 0.9 * ndl[..., None])
    img = np.clip(lin ** (1 / 2.2), 0, 1)
    img = np.tile(img, (2, 2, 1))
    return Image.fromarray((img * 255).astype(np.uint8))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'materials_sheet.jpg'
    filt = sys.argv[2] if len(sys.argv) > 2 else ''
    man = json.load(open(os.path.join(TEX, 'materials.json')))
    mats = [e for e in man['materials'] if filt in e['name'] or filt in e['category']]
    cell, cols = 256, 7
    rows = (len(mats) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * (cell + 28)), (24, 24, 24))
    dr = ImageDraw.Draw(sheet)
    for i, e in enumerate(mats):
        x, y = (i % cols) * cell, (i // cols) * (cell + 28)
        sheet.paste(lit_cell(e, cell), (x, y))
        dr.text((x + 3, y + cell + 2), e['name'], fill=(255, 255, 255))
        dr.text((x + 3, y + cell + 14), f"{e['tileSizeMetres']} m  {e['avgColor']}  {e['bytes'] // 1024} KB", fill=(180, 180, 180))
    sheet.save(out, quality=88)
    print(out, len(mats))


if __name__ == '__main__':
    main()
