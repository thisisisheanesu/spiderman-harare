#!/usr/bin/env python3
"""Download Poly Haven (CC0) glTF models + their 1k textures into the material cache.

    python3 tools/materials/fetch_ph_models.py plastic_monobloc_chair_01 metal_trash_can ...
    (no arguments = every Poly Haven id used by tools/materials/props_blender.py)

Files land in $MAT_CACHE/phm/<id>/ (gltf, bin, textures/) with info.json (authors, licence).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as T  # noqa: E402

CACHE = os.environ.get('MAT_CACHE', '/tmp/spiderman-materials-cache')

# Poly Haven ids used by props_blender.py (keep in sync with PH_PROPS there)
DEFAULT_IDS = [
    'modular_street_seating', 'metal_trash_can', 'concrete_road_barrier', 'exterior_aircon_unit',
    'plastic_crate_02', 'plastic_crate_03', 'plastic_monobloc_chair_01', 'potted_plant_04', 'potted_plant_02',
    'trashbag', 'utility_box_02', 'Barrel_02', 'cardboard_box_01', 'fire_hydrant', 'old_tyre',
    'water_manhole_cover',
]


def fetch(pid, res='1k'):
    d = os.path.join(CACHE, 'phm', pid)
    os.makedirs(d, exist_ok=True)
    info_p = os.path.join(d, 'info.json')
    if not os.path.exists(info_p):
        info = T.http_get(f'https://api.polyhaven.com/info/{pid}').json()
        files = T.http_get(f'https://api.polyhaven.com/files/{pid}').json()
        json.dump(dict(info=info, files=files), open(info_p, 'w'))
    meta = json.load(open(info_p))
    g = meta['files']['gltf'][res]['gltf']
    gltf_path = T.download(g['url'], os.path.join(d, os.path.basename(g['url'])))
    for rel, inc in g['include'].items():
        T.download(inc['url'], os.path.join(d, rel))
    print(pid, 'ok', ', '.join(meta['info'].get('authors', {}).keys()))
    return gltf_path


if __name__ == '__main__':
    for pid in (sys.argv[1:] or DEFAULT_IDS):
        fetch(pid)
