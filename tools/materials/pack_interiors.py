#!/usr/bin/env python3
"""Pack the Blender room renders ($MAT_CACHE/interiors/room_<i>_<name>.png, from interiors_blender.py) into
the interior-mapping atlas used by facade windows:

  public/textures/glass/interiors_atlas.webp        2048 x 1024, 4 x 2 cells of 512 px
  public/textures/glass/interiors_atlas_small.webp  1024 x  512, same layout (phones / low quality)
  public/textures/glass/interiors.json              layout + projection (see README "Interior mapping")
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as T  # noqa: E402
import build_textures as B  # noqa: E402

COLS, ROWS, CELL = 4, 2, 512
KIND = dict(office_open='office', office_cellular='office', apartment_living='residential', apartment_bedroom='residential',
            shop_supermarket='shop', shop_clothing='shop', shop_hardware='shop', vacant_storage='vacant')
DESC = dict(
    office_open='Open-plan office: fluorescent panels, desks with monitors, partitions, filing cabinets.',
    office_cellular='Single office with venetian blind half down, desk, binders on shelves.',
    apartment_living='Flat living room: warm pendant light, sofa, TV unit, curtains half drawn.',
    apartment_bedroom='Flat bedroom: bed, wardrobe, bedside lamp, curtains mostly drawn.',
    shop_supermarket='Supermarket / pharmacy: bright tubes, shelves of colourful goods, gondola, promo banner.',
    shop_clothing='Clothing shop (Edgars / boutique): warm spots, rails of garments, two mannequins.',
    shop_hardware='General dealer / hardware: dense shelving, counter with till, stacked mealie-meal sacks.',
    vacant_storage='Vacant unit / storeroom: bare bulb, cardboard boxes, newspaper on the glass (dim).',
)


def main():
    src = os.path.join(B.CACHE, 'interiors')
    files = sorted(glob.glob(os.path.join(src, 'room_*.png')), key=lambda f: int(re.search(r'room_(\d+)_', f).group(1)))
    assert len(files) == COLS * ROWS, f'expected {COLS * ROWS} rooms, got {len(files)}'
    atlas = Image.new('RGB', (COLS * CELL, ROWS * CELL))
    cells = []
    for f in files:
        i = int(re.search(r'room_(\d+)_', f).group(1))
        name = re.search(r'room_\d+_(.+)\.png', f).group(1)
        im = Image.open(f).convert('RGB').resize((CELL, CELL), Image.LANCZOS)
        col, row = i % COLS, i // COLS
        atlas.paste(im, (col * CELL, row * CELL))
        a = np.asarray(im, dtype=np.float32) / 255
        lum = float((T.srgb_to_linear(a) * np.array([0.2126, 0.7152, 0.0722])).sum(axis=2).mean())
        cells.append(dict(index=i, name=name, kind=KIND[name], col=col, row=row,
                          uvRect=[col / COLS, 1 - (row + 1) / ROWS, (col + 1) / COLS, 1 - row / ROWS],
                          meanLuminanceLinear=round(lum, 4), notes=DESC[name]))
    out = os.path.join(B.OUT, 'glass')
    os.makedirs(out, exist_ok=True)
    cw = T.cwebp_path(B.CACHE)
    big = np.asarray(atlas, dtype=np.float32) / 255
    s1 = T.write_webp(big, os.path.join(out, 'interiors_atlas.webp'), cw, quality=88)
    small = np.asarray(atlas.resize((COLS * CELL // 2, ROWS * CELL // 2), Image.LANCZOS), dtype=np.float32) / 255
    s2 = T.write_webp(small, os.path.join(out, 'interiors_atlas_small.webp'), cw, quality=88)
    meta = dict(
        version=1,
        atlas='glass/interiors_atlas.webp', atlasSmall='glass/interiors_atlas_small.webp',
        size=[COLS * CELL, ROWS * CELL], sizeSmall=[COLS * CELL // 2, ROWS * CELL // 2], grid=[COLS, ROWS],
        colorSpace='sRGB (THREE.SRGBColorSpace); rendered with Blender AgX, interior lights on',
        bytes=[s1, s2],
        projection=dict(
            room='x in [0,1] across the window (left->right seen from outside), y in [0,1] floor->ceiling, '
                 'z in [0,1] into the building; window plane z = 0, back wall z = 1 (baked room: 3 x 3 x 3 m)',
            camera='pinhole at (0.5, 0.5, -1) looking +z, frustum = the window rectangle at z = 0 (FOV 53.13 deg)',
            cellUv='uv = 0.5 + (p.xy - 0.5) / (1.0 + p.z)   (p = where the view ray hits the room box)',
            atlasUv='atlasUv = (vec2(col, ROWS - 1 - row) + cellUv) / vec2(COLS, ROWS)   (three.js flipY = true)',
            depthScale='a room deeper than the window is wide: divide the ray direction z by depth (1 = as baked)',
        ),
        usage='Emissive-like radiance behind the glass: day x0.35-0.6, night lit x1.0-1.4, night dark x0.03. '
              'Pick a cell per window from a hash of the window id + facade class (kind); mirror x for variety.',
        cells=cells,
        license='CC0 1.0 (procedural, rendered by tools/materials/interiors_blender.py)',
    )
    json.dump(meta, open(os.path.join(out, 'interiors.json'), 'w'), indent=1)
    print('atlas', s1 // 1024, 'KB  small', s2 // 1024, 'KB')


if __name__ == '__main__':
    main()
