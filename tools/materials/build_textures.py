#!/usr/bin/env python3
"""Build the game-ready PBR texture library in public/textures/ from CC0 sources.

Sources: ambientCG (https://ambientcg.com, CC0) and Poly Haven (https://polyhaven.com, CC0).
Every material is written as three WebP files:
    public/textures/<category>/<name>_albedo.webp   sRGB base colour
    public/textures/<category>/<name>_normal.webp   tangent-space normal, OpenGL convention (+Y / green = up)
    public/textures/<category>/<name>_orm.webp      R = ambient occlusion, G = roughness, B = metalness (linear)
and listed in public/textures/materials.json (see public/textures/README.md for the schema).

Processing per material: download (cached) -> resize in linear light -> optional low-frequency
"flattening" of albedo/roughness (removes big blotches that make a repeated tile obvious on a 60 m
facade; the game adds its own macro variation) -> optional colour grade towards the Harare look ->
pack ORM (AO derived from the height map when a source has none) -> WebP (cwebp, sharp YUV).

Usage:
    python3 tools/materials/build_textures.py                 # build everything
    python3 tools/materials/build_textures.py asphalt_bleached kerb_concrete   # only these
    python3 tools/materials/build_textures.py --list
    python3 tools/materials/build_textures.py --refresh-stats   # re-measure manifest stats from the files on disk
Env: MAT_CACHE (download cache, default /tmp/spiderman-materials-cache), CWEBP (path to cwebp).
Generated (procedural) materials — granite cladding joints, painted kerbs, window glass — are built by
tools/materials/gen_textures.py, which reads the downloaded sources through the same cache, and the
interior atlas by tools/materials/interiors_blender.py. Run this script first, then gen_textures.py.
"""
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as T  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'textures')
CACHE = os.environ.get('MAT_CACHE', '/tmp/spiderman-materials-cache')

AUTHOR_ACG = 'Lennart Demes (ambientCG)'

# ----------------------------------------------------------------------------------------------
# Material list. tile = real-world size in metres that ONE repeat of the texture covers [u, v].
# flatten = strength of low-frequency albedo flattening (0 = keep source blotches).
# grade = optional colour grade applied in linear light: {'sat': s, 'gain': g, 'mul': [r,g,b]}.
# rough = optional roughness remap: {'mul': m, 'add': a, 'min': lo, 'max': hi}.
# detilt = remove a planar tilt baked into a scanned normal map (non-zero mean slope).
# ao_norm = rescale AO so its 99.5th percentile is 1 (for scans whose AO never reaches 'unoccluded').
# ----------------------------------------------------------------------------------------------
MATERIALS = [
    # ---------------- concrete
    dict(name='concrete_raw', cat='concrete', src='acg', id='Concrete042A', tile=[2.0, 2.0], flatten=0.75,
         tags=['wall', 'facade', 'raw', 'modernist', 'tintable', 'grey'],
         note='Plain grey off-form concrete (1960s-80s slab blocks, parking decks, parapets). Size estimated.'),
    dict(name='concrete_board_formed', cat='concrete', src='ph', id='concrete_layers_02', tile=[2.0, 2.0], flatten=0.5,
         tags=['wall', 'facade', 'raw', 'brutalist', 'tintable', 'grey'],
         note='Board-marked concrete with horizontal lift lines: stair drums, service cores, Eastgate-style precast.'),
    dict(name='concrete_weathered', cat='concrete', src='ph', id='concrete_wall_007', res='1k', tile=None, flatten=0.55,
         tags=['wall', 'facade', 'weathered', 'tintable', 'beige'],
         note='Stained, weathered beige concrete / render for older blocks and back walls.'),
    dict(name='concrete_painted', cat='concrete', src='ph', id='painted_plaster_wall', tile=None, flatten=0.8,
         tags=['wall', 'facade', 'painted', 'tintable', 'light'],
         note='Painted concrete / render, light and neutral: the base for most tinted facades.'),
    # ---------------- plaster / render
    dict(name='plaster_smooth', cat='plaster', src='acg', id='Plaster003', tile=[1.5, 1.5], flatten=0.8,
         tags=['wall', 'facade', 'render', 'smooth', 'tintable', 'white'],
         note='Smooth cement render, near white: tint to cream/beige/sand facade colours. Size estimated.'),
    dict(name='plaster_textured', cat='plaster', src='acg', id='Concrete040', tile=[1.4, 1.4], flatten=0.7,
         tags=['wall', 'facade', 'render', 'textured', 'tintable', 'sand'],
         note='Coarse spray / tyrolean render in sand-tan (Monomotapa-type tan walls, boundary walls).'),
    dict(name='plaster_peeling', cat='plaster', src='ph', id='white_rough_plaster', tile=None, flatten=0.4,
         detilt=True,  # the scan's normal map carries a 7 degree planar tilt
         tags=['wall', 'facade', 'render', 'weathered', 'colonial', 'tintable'],
         note='Rough, patchy white plaster with worn paint: 1920s-50s colonial shopfronts and verandah walls.'),
    # ---------------- brick
    dict(name='brick_face_salmon', cat='brick', src='acg', id='Bricks101', tile=[1.8, 1.8], flatten=0.35,
         tags=['wall', 'facade', 'face-brick', 'salmon'],
         note='Salmon/red face brick, stretcher bond (Eastgate infill #b5957c, CABS, flats).'),
    dict(name='brick_face_red', cat='brick', src='acg', id='Bricks094', tile=[1.8, 0.9], flatten=0.35,
         tags=['wall', 'facade', 'face-brick', 'red-brown'],
         note='Darker red-brown face brick (Harare station #8a5c46, older warehouses).'),
    dict(name='brick_painted', cat='brick', src='acg', id='Bricks060', tile=[1.05, 1.05], flatten=0.5,
         tags=['wall', 'facade', 'painted', 'tintable', 'white'],
         note='Painted (white) brick; tint for painted back walls, lanes, low shops.'),
    dict(name='block_painted', cat='brick', src='acg', id='Bricks066', tile=[2.4, 2.4], flatten=0.6,
         tags=['wall', 'fence', 'block', 'painted', 'tintable', 'grey'],
         note='Painted concrete block wall: boundary walls, service yards, rooftop plant rooms.'),
    # ---------------- stone
    dict(name='granite_dark_tiles', cat='stone', src='ph', id='granite_tile', tile=None, flatten=0.4,
         tags=['wall', 'facade', 'cladding', 'granite', 'podium', 'dark'],
         note='Dark grey granite slabs with joints: bank podiums (RBZ podium #8f9593 when tinted up), plinths.'),
    dict(name='stone_cladding_sand', cat='stone', src='acg', id='Tiles139', tile=[2.0, 2.0], flatten=0.3,
         tags=['wall', 'facade', 'cladding', 'sandstone', 'beige'],
         note='Beige stone slab cladding (1960s-70s office podiums, Pearl House-type ochre when tinted).'),
    # ---------------- metal
    dict(name='metal_panel', cat='metal', src='acg', id='MetalPlates004', tile=[4.8, 4.8], flatten=0.5,
         grade=dict(gain=4.2, sat=0.5), metal=0.15, rough=dict(add=0.12, max=0.7),
         tags=['wall', 'facade', 'cladding', 'aluminium', 'metal', 'tintable'],
         note='Painted aluminium composite (ACP) panels with joints: shop fascias, modern refits, lift overruns. Metalness kept low (PVDF paint) so it tints like paint.'),
    dict(name='window_frame_aluminium', cat='metal', src='acg', id='Metal009', tile=[1.0, 1.0], flatten=0.6, out=512,
         tags=['window', 'frame', 'mullion', 'aluminium', 'metal', 'tintable'],
         note='Brushed / anodised aluminium for mullions, frames, handrails. Tint dark bronze or black as needed.'),
    dict(name='shutter_rolldown', cat='metal', src='ph', id='painted_metal_shutter', tile=None, flatten=0.5,
         tags=['shopfront', 'shutter', 'security', 'metal', 'tintable'],
         note='Painted steel roll-down shutter slats (closed shops, night). v runs across the slats.'),
    # ---------------- roofs
    dict(name='corrugated_galvanised', cat='roof', src='ph', id='corrugated_iron', tile=None, flatten=0.6,
         tags=['roof', 'corrugated', 'metal', 'galvanised', 'silver'],
         note='Clean galvanised corrugated iron (u across corrugations).'),
    dict(name='corrugated_weathered', cat='roof', src='ph', id='worn_corrugated_iron', tile=None, flatten=0.4,
         tags=['roof', 'corrugated', 'metal', 'weathered'],
         note='Dull, weathered galvanised corrugated sheet with streaks.'),
    dict(name='corrugated_rusty', cat='roof', src='ph', id='rusty_corrugated_iron', tile=None, flatten=0.3,
         tags=['roof', 'corrugated', 'metal', 'rust', 'kopje'],
         note='Rusted corrugated iron (Kopje/Mbare-side low roofs, lean-tos, vendor stalls).'),
    dict(name='ibr_sheet_painted', cat='roof', src='ph', id='box_profile_metal_sheet', tile=None, flatten=0.5,
         tags=['roof', 'ibr', 'box-profile', 'painted', 'metal', 'tintable', 'red'],
         note='Painted IBR (box-profile) roof sheeting, red oxide. Tint to green/charcoal via avgColor ratio.'),
    dict(name='fibre_cement_roof', cat='roof', src='ph', id='asbestos_sheet_02', tile=None, flatten=0.5,
         tags=['roof', 'corrugated', 'fibre-cement', 'grey'],
         note='Grey corrugated fibre-cement ("asbestos") roofing, very common on 1950s-70s buildings.'),
    dict(name='clay_tile_roof', cat='roof', src='acg', id='RoofingTiles012A', tile=[2.9, 2.9], flatten=0.3,
         tags=['roof', 'tiles', 'clay', 'terracotta', 'red-brown'],
         note='Interlocking clay roof tiles (Marseille type): station, Munhumutapa, colonial hip roofs.'),
    dict(name='clay_tile_roof_old', cat='roof', src='ph', id='clay_roof_tiles_02', tile=None, flatten=0.3,
         tags=['roof', 'tiles', 'clay', 'terracotta', 'weathered'],
         note='Weathered barrel clay tiles with colour variation (older houses, Avenues).'),
    dict(name='roof_membrane', cat='roof', src='ph', id='bitumen', tile=None, flatten=0.3,
         tags=['roof', 'flat-roof', 'bitumen', 'membrane', 'dark'],
         note='Torch-on bitumen membrane strips for flat roofs (large 20 m tile: seen from above / perches).'),
    dict(name='roof_gravel', cat='roof', src='acg', id='Gravel023', tile=[1.5, 1.5], flatten=0.5, nres=512,
         rough=dict(mul=0.8, add=0.4),  # source roughness mean 0.47 reads as wet / polished stone
         tags=['roof', 'flat-roof', 'gravel', 'light'],
         note='Pale gravel / chippings ballast for flat office roofs. Roughness raised from the source (mean 0.47) to ~0.78: dry stone chippings.'),
    # ---------------- road
    dict(name='asphalt_bleached', cat='road', src='acg', id='Asphalt031', res='2K', out=2048, tile=[2.5, 2.5], flatten=0.6, abudget=170_000,
         grade=dict(sat=0.6, mul=[1.19, 1.105, 1.0]),
         rough=dict(mul=0.8, add=0.35),  # source mean 0.52 gives a wet-looking sheen at grazing angles
         tags=['road', 'asphalt', 'sun-bleached', 'pale'],
         note='Main road surface: pale sun-bleached asphalt (#8f8c83-#9d998d in sun). Size estimated. 2K. Roughness raised from the source (mean 0.52) to ~0.77: dry, dusty, oxidised binder.'),
    dict(name='asphalt_cracked', cat='road', src='ph', id='asphalt_02', tile=None, flatten=0.5, ao_norm=True,
         grade=dict(sat=0.6, gain=1.25, mul=[1.08, 1.04, 1.0]),
         tags=['road', 'asphalt', 'worn', 'cracked'],
         note='Worn asphalt with longitudinal cracks (side streets, lanes, parking). Blend with asphalt_bleached; do not use alone on long roads (the crack pattern repeats every 3 m).'),
    dict(name='asphalt_patch', cat='road', src='ph', id='clean_asphalt', tile=None, flatten=0.6,
         tags=['road', 'asphalt', 'patch', 'dark', 'decal'],
         note='Darker, fresher asphalt for repair patches / trench reinstatements (blend over asphalt_bleached).'),
    dict(name='kerb_concrete', cat='road', src='ph', id='concrete_floor_worn_001', tile=None, flatten=0.6, out=512,
         grade=dict(gain=1.35, sat=0.8),
         tags=['kerb', 'curb', 'concrete', 'grey', 'tintable'],
         note='Worn precast kerb concrete. Painted kerb variants (black/white, yellow) are generated by gen_textures.py.'),
    # ---------------- paving
    dict(name='pavement_slabs', cat='paving', src='ph', id='concrete_pavement', res='2k', out=2048, tile=None, flatten=0.5, abudget=150_000,
         grade=dict(sat=0.5, gain=1.45),
         tags=['sidewalk', 'pavement', 'slabs', 'concrete', 'grey'],
         note='Grey concrete sidewalk slabs (#bfbdbc sunlit) — the CBD default pavement. 2K.'),
    dict(name='pavers_interlocking', cat='paving', src='acg', id='PavingStones071', res='2K', out=2048, tile=[0.9, 0.9], flatten=0.4, abudget=150_000,
         tags=['sidewalk', 'pavers', 'interlocking', 'concrete', 'grey'],
         note='Grey interlocking (zig-zag) concrete pavers: forecourts, parking, newer sidewalks. 2K.'),
    dict(name='pavers_herringbone_red', cat='paving', src='acg', id='PavingStones118', tile=[1.75, 1.75], flatten=0.3,
         tags=['sidewalk', 'pavers', 'herringbone', 'clay', 'red'],
         note='Red clay pavers in herringbone: First Street Mall / plazas / bank forecourts.'),
    # ---------------- ground
    dict(name='grass_dry', cat='ground', src='ph', id='withered_grass', tile=None, flatten=0.4,
         grade=dict(mul=[1.0, 0.97, 0.8]),
         tags=['ground', 'grass', 'dry', 'highveld', 'winter'],
         note='Dry, straw-coloured highveld grass (dry season May-Oct): verges, medians, vacant lots.'),
    dict(name='grass_patchy', cat='ground', src='ph', id='grass_ground', tile=None, flatten=0.4,
         tags=['ground', 'grass', 'patchy', 'olive'],
         note='Patchy olive grass with bare earth: park edges, road medians, Harare Gardens paths.'),
    dict(name='grass_green', cat='ground', src='acg', id='Grass004', tile=[1.4, 1.4], flatten=0.4,
         rough=dict(mul=0.7, add=0.62),  # source roughness mean 0.26 makes a lawn shine like plastic
         tags=['ground', 'grass', 'green', 'lawn', 'rainy-season'],
         note='Green lawn for watered parks (Africa Unity Square, Harare Gardens) and the rainy season. Roughness raised from the source (mean 0.26) to ~0.80.'),
    dict(name='soil_red', cat='ground', src='ph', id='red_laterite_soil_stones', tile=None, flatten=0.4, ao_norm=True,
         tags=['ground', 'soil', 'laterite', 'red', 'verge'],
         note='Red-brown laterite soil with stones (#7c6556): unkerbed verges, footpaths, construction sites.'),
    dict(name='dirt_dry', cat='ground', src='ph', id='dry_ground_rocks', tile=None, flatten=0.4, out=512, ao_norm=True,
         tags=['ground', 'dirt', 'dry', 'tan'],
         note='Dry tan dirt with pebbles: lanes, informal parking, kopje foot.'),
    dict(name='gravel_grey', cat='ground', src='acg', id='Gravel040', tile=[1.5, 1.5], flatten=0.4, out=512,
         rough=dict(mul=0.8, add=0.35),  # source mean ~0.53: too glossy for dry crushed stone
         tags=['ground', 'gravel', 'grey', 'rail-ballast'],
         note='Grey crushed-stone gravel: rail ballast, yards, rooftop ballast. Size estimated. Roughness raised from the source (mean ~0.53) to ~0.77.'),
    # ---------------- wood / bark
    dict(name='bark_grey', cat='wood', src='acg', id='Bark001', tile=[1.0, 2.0], flatten=0.3, out=512,
         tags=['bark', 'tree', 'jacaranda', 'grey'],
         note='Grey fissured bark (jacaranda, msasa, flamboyant trunks). Size estimated.'),
    dict(name='wood_planks_weathered', cat='wood', src='ph', id='weathered_brown_planks', tile=None, flatten=0.3, out=512,
         tags=['wood', 'planks', 'weathered', 'vendor', 'stall'],
         note='Weathered brown planks: vendor stalls, carts, hoardings, crates.'),
    dict(name='wood_planks_grey', cat='wood', src='ph', id='wood_planks_grey', tile=None, flatten=0.3, out=512,
         tags=['wood', 'planks', 'grey', 'weathered'],
         note='Sun-greyed planks: benches, market tables, doors.'),
    # ---------------- plastic
    dict(name='plastic_matte', cat='plastic', src='acg', id='Plastic010', tile=[1.0, 1.0], flatten=0.6, out=512,
         tags=['plastic', 'tintable', 'white'],
         note='Light matte plastic; tint for water tanks (#3f7d5a), crates, chairs, signage boxes.'),
]

BY_NAME = {m['name']: m for m in MATERIALS}


# ---------------------------------------------------------------- sources
def acg_fetch(mid, res='1K'):
    d = os.path.join(CACHE, 'acg', f'{mid}_{res}')
    if not glob.glob(os.path.join(d, '*_Color.*')):
        z = T.download(f'https://ambientcg.com/get?file={mid}_{res}-JPG.zip', os.path.join(CACHE, 'acg', f'{mid}_{res}.zip'))
        T.extract_zip(z, d)
        os.remove(z)

    def f(suffix):
        g = sorted(glob.glob(os.path.join(d, f'*_{suffix}.jpg')) + glob.glob(os.path.join(d, f'*_{suffix}.png')))
        return g[0] if g else None
    return dict(color=f('Color'), normal=f('NormalGL'), rough=f('Roughness'), ao=f('AmbientOcclusion'),
                metal=f('Metalness'), height=f('Displacement'),
                url=f'https://ambientcg.com/view?id={mid}', author=AUTHOR_ACG, license='CC0 1.0')


_ph_info = {}


def ph_fetch(pid, res='1k'):
    d = os.path.join(CACHE, 'ph', pid)
    os.makedirs(d, exist_ok=True)
    info_p = os.path.join(d, 'info.json')
    if not os.path.exists(info_p):
        info = T.http_get(f'https://api.polyhaven.com/info/{pid}').json()
        files = T.http_get(f'https://api.polyhaven.com/files/{pid}').json()
        json.dump(dict(info=info, files=files), open(info_p, 'w'))
    meta = json.load(open(info_p))
    files = meta['files']
    out = {}
    for key, mp in (('color', 'Diffuse'), ('normal', 'nor_gl'), ('arm', 'arm'), ('height', 'Displacement')):
        if mp not in files or res not in files[mp]:
            out[key] = None
            continue
        url = files[mp][res]['jpg']['url'] if 'jpg' in files[mp][res] else files[mp][res]['png']['url']
        out[key] = T.download(url, os.path.join(d, res, os.path.basename(url)))
    info = meta['info']
    out.update(url=f'https://polyhaven.com/a/{pid}', author=', '.join(info.get('authors', {}).keys()),
               license='CC0 1.0', dims_mm=info.get('dimensions'))
    return out


# ---------------------------------------------------------------- processing
def grade(albedo, g):
    if not g:
        return albedo
    lin = T.srgb_to_linear(albedo)
    if 'sat' in g:
        lum = (lin * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(axis=2, keepdims=True)
        lin = lum + (lin - lum) * g['sat']
    if 'mul' in g:
        lin = lin * np.array(g['mul'], np.float32)
    if 'gain' in g:
        lin = lin * g['gain']
    return T.linear_to_srgb(lin)


def remap_rough(r, g):
    if not g:
        return r
    r = r * g.get('mul', 1.0) + g.get('add', 0.0)
    return np.clip(r, g.get('min', 0.0), g.get('max', 1.0))


def load_sources(m):
    """Returns dict of float arrays at source resolution + provenance."""
    if m['src'] == 'acg':
        s = acg_fetch(m['id'], m.get('res', '1K'))
        color = T.load(s['color'])
        H, W = color.shape[:2]
        normal = T.load(s['normal'])
        rough = T.load(s['rough'], 'L') if s['rough'] else np.full((H, W), 0.8, np.float32)
        height = T.load(s['height'], 'L') if s['height'] else None
        if s['ao']:
            ao = T.load(s['ao'], 'L')
        elif height is not None:
            ao = T.ao_from_height(height, radius_px=max(3, W // 170))
        else:
            ao = np.ones((H, W), np.float32)
        metal = T.load(s['metal'], 'L') if s['metal'] else np.zeros((H, W), np.float32)
        src = dict(site='ambientCG', id=m['id'], url=s['url'], author=s['author'], license=s['license'])
        tile = m.get('tile')
    else:
        s = ph_fetch(m['id'], m.get('res', '1k'))
        color = T.load(s['color'])
        normal = T.load(s['normal'])
        arm = T.load(s['arm'])
        ao, rough, metal = arm[..., 0], arm[..., 1], arm[..., 2]
        height = T.load(s['height'], 'L') if s.get('height') else None
        src = dict(site='Poly Haven', id=m['id'], url=s['url'], author=s['author'], license=s['license'])
        tile = m.get('tile') or [round(s['dims_mm'][0] / 1000, 2), round(s['dims_mm'][1] / 1000, 2)]
    return dict(color=color, normal=normal, rough=rough, ao=ao, metal=metal, height=height, src=src, tile=tile)


def build(m, cwebp):
    S = load_sources(m)
    H, W = S['color'].shape[:2]
    out_w = m.get('out', 1024)
    out_h = int(round(out_w * H / W))
    size = (out_w, out_h)

    albedo = T.resize_albedo(S['color'], size)
    albedo = T.flatten_lowfreq(albedo, m.get('flatten', 0.0))
    albedo = grade(albedo, m.get('grade'))
    # normal: <= 1024 px wide, lightly pre-blurred (pixel noise costs a lot of bytes and aliases anyway)
    nw = min(out_w, m.get('nres', 1024))
    nsize = (nw, int(round(nw * H / W)))
    normal = T.resize_normal(S['normal'], nsize)
    if m.get('normalScale'):
        normal = T.scale_normal(normal, m['normalScale'])
    if m.get('detilt'):
        normal = T.detilt_normal(normal)
    # ORM at half the albedo resolution (AO / roughness / metalness are low-frequency signals)
    ow = m.get('ores', out_w // 2)
    osize = (ow, int(round(ow * H / W)))
    rough = T.flatten_scalar(T.resize(S['rough'], osize), m.get('flatten', 0.0) * 0.5)
    rough = remap_rough(rough, m.get('rough'))
    ao = np.clip(T.resize(S['ao'], osize), 0, 1)
    if m.get('ao_norm'):  # the open, unoccluded ground must read AO ~ 1 (some scans bake a global darkening)
        ao = np.clip(ao / max(float(np.percentile(ao, 99.5)), 1e-3), 0, 1)
    metal = np.clip(T.resize(S['metal'], osize), 0, 1)
    if m.get('metal') is not None:
        metal[:] = m['metal']
    orm = np.stack([ao, rough, metal], axis=2)

    d = os.path.join(OUT, m['cat'])
    base = os.path.join(d, m['name'])
    # byte budgets per map (scaled by pixel count relative to 1024^2 / 512^2)
    ka = out_w * out_h / 1024 ** 2
    kn = nsize[0] * nsize[1] / 1024 ** 2
    ko = osize[0] * osize[1] / 512 ** 2
    enc = {
        'albedo': T.write_webp_budget(albedo, base + '_albedo.webp', cwebp, m.get('abudget', 110_000) * ka ** 0.75),
        'normal': T.write_webp_budget(normal, base + '_normal.webp', cwebp, m.get('nbudget', 90_000) * kn ** 0.75, 'normal'),
        'orm': T.write_webp_budget(orm, base + '_orm.webp', cwebp, m.get('obudget', 35_000) * ko ** 0.75),
    }
    sizes = {k: v[0] for k, v in enc.items()}
    avg_hex, avg_lin = T.albedo_stats(base + '_albedo.webp')  # measured on the encoded file
    r_mean, m_mean = T.orm_stats(base + '_orm.webp')
    seam = T.seam_score(albedo)
    entry = dict(
        name=m['name'], category=m['cat'],
        files={k: f"{m['cat']}/{m['name']}_{k}.webp" for k in ('albedo', 'normal', 'orm')},
        size=[out_w, out_h],
        mapSizes=dict(albedo=[out_w, out_h], normal=list(nsize), orm=list(osize)),
        tileSizeMetres=S['tile'],
        avgColor=avg_hex,
        avgColorLinear=avg_lin,
        roughnessMean=r_mean,
        metalnessMean=m_mean,
        tags=m['tags'],
        bytes=sum(sizes.values()),
        source=S['src'],
        notes=m.get('note', ''),
    )
    print(f"{m['name']:28s} {out_w}x{out_h} {entry['bytes'] / 1024:5.0f} KB  avg {entry['avgColor']}  "
          f"seam {seam[0]:.2f}/{seam[1]:.2f}  tile {S['tile']}  enc " +
          ' '.join(f"{k[0]}:{v[0] // 1024}K/b{v[1]}/q{v[2]}" for k, v in enc.items()), flush=True)
    return entry


def write_manifest(entries):
    p = os.path.join(OUT, 'materials.json')
    old = json.load(open(p)) if os.path.exists(p) else {}
    by = {e['name']: e for e in old.get('materials', [])}
    for e in entries:
        by[e['name']] = e
    order = [m['name'] for m in MATERIALS]
    mats = sorted(by.values(), key=lambda e: (order.index(e['name']) if e['name'] in order else 999, e['category'], e['name']))
    man = dict(
        version=1,
        generator='tools/materials/build_textures.py + gen_textures.py',
        conventions=dict(
            albedo='sRGB (set texture.colorSpace = THREE.SRGBColorSpace)',
            normal='tangent space, OpenGL (+Y green up) - three.js default; linear',
            orm='R = ambient occlusion, G = roughness, B = metalness; linear. Use the same texture for aoMap, roughnessMap and metalnessMap',
            tileSizeMetres='real-world [u, v] size one texture repeat covers; texture.repeat = surfaceSizeMetres / tileSizeMetres',
            avgColor='mean albedo (sRGB hex; avgColorLinear in linear RGB). To tint a material to a target facade colour multiply albedo by target_linear / avgColorLinear',
        ),
        totalBytes=sum(e['bytes'] for e in mats),
        materials=mats,
    )
    json.dump(man, open(p, 'w'), indent=1)
    return man


def refresh_stats():
    """Re-measure every manifest entry from the files on disk (avgColor, avgColorLinear, roughness / metalness
    means, map sizes, bytes). Use after hand-editing a map or to repair a manifest written by an older script."""
    from PIL import Image
    p = os.path.join(OUT, 'materials.json')
    man = json.load(open(p))
    for e in man['materials']:
        f = {k: os.path.join(OUT, v) for k, v in e['files'].items()}
        e['avgColor'], e['avgColorLinear'] = T.albedo_stats(f['albedo'])
        e['roughnessMean'], e['metalnessMean'] = T.orm_stats(f['orm'])
        e['mapSizes'] = {k: list(Image.open(v).size) for k, v in f.items()}
        e['size'] = e['mapSizes']['albedo']
        e['bytes'] = sum(os.path.getsize(v) for v in f.values())
    man['totalBytes'] = sum(e['bytes'] for e in man['materials'])
    json.dump(man, open(p, 'w'), indent=1)
    print(f"re-measured {len(man['materials'])} materials, {man['totalBytes'] / 1e6:.2f} MB")


def main(argv):
    if '--refresh-stats' in argv:
        refresh_stats()
        return
    if '--list' in argv:
        for m in MATERIALS:
            print(m['cat'], m['name'], m['src'], m['id'])
        return
    names = [a for a in argv if not a.startswith('-')]
    todo = [BY_NAME[n] for n in names] if names else MATERIALS
    cwebp = T.cwebp_path(CACHE)
    entries = [build(m, cwebp) for m in todo]
    man = write_manifest(entries)
    print(f"total {man['totalBytes'] / 1e6:.2f} MB in {len(man['materials'])} materials")


if __name__ == '__main__':
    main(sys.argv[1:])
