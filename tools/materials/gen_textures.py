#!/usr/bin/env python3
"""Procedural / composited materials that no CC0 library ships ready-made, added to materials.json:

  stone/granite_cladding_light   honed light-grey granite (ambientCG Granite002A) laid as 1.2 x 0.6 m stack-bond
                                 panels with 8 mm joints and per-panel tone variation  (RBZ piers/friezes, podiums)
  road/kerb_painted_bw           kerb concrete with alternating 1 m black / white paint blocks (Samora Machel medians)
  road/kerb_painted_yellow       kerb concrete painted yellow (ranks, bus stops, no-stopping zones)
  road/kerb_painted_rw           kerb / barrier concrete with red / white 1 m blocks (median noses, barrier blocks)
  glass/window_glass             glass surface layer for facade windows: albedo RGB = grime colour, albedo A = grime
                                 coverage, normal = subtle float-glass waviness, ORM G = smudge/streak roughness

Run after build_textures.py (uses its download cache and appends to public/textures/materials.json).
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as T  # noqa: E402
import build_textures as B  # noqa: E402

OUT = B.OUT


def noise(h, w, sigma, seed, octaves=1):
    """Tileable fractal noise in 0..1 (FFT-filtered white noise)."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = T.periodic_blur(rng.standard_normal((h, w)).astype(np.float32), sigma / (2 ** o))
        n /= max(n.std(), 1e-6)
        acc += amp * n
        tot += amp
        amp *= 0.5
    acc /= tot
    return np.clip(0.5 + acc * 0.18, 0, 1)


def emit(name, cat, albedo, normal, orm, tile, tags, note, source, budgets=(110_000, 90_000, 35_000), alpha=False):
    cw = T.cwebp_path(B.CACHE)
    base = os.path.join(OUT, cat, name)
    h, w = albedo.shape[:2]
    if alpha:
        a_bytes = T.write_webp(albedo, base + '_albedo.webp', cw, quality=82, alpha=True)
    else:
        a_bytes = T.write_webp_budget(albedo, base + '_albedo.webp', cw, budgets[0] * (w * h / 1024 ** 2) ** 0.75)[0]
    n_bytes = T.write_webp_budget(normal, base + '_normal.webp', cw, budgets[1] * (normal.shape[0] * normal.shape[1] / 1024 ** 2) ** 0.75, 'normal')[0]
    o_bytes = T.write_webp_budget(orm, base + '_orm.webp', cw, budgets[2] * (orm.shape[0] * orm.shape[1] / 512 ** 2) ** 0.75)[0]
    avg_hex, avg_lin = T.albedo_stats(base + '_albedo.webp')  # measured on the encoded file (RGB, alpha ignored)
    r_mean, m_mean = T.orm_stats(base + '_orm.webp')
    e = dict(
        name=name, category=cat,
        files={k: f'{cat}/{name}_{k}.webp' for k in ('albedo', 'normal', 'orm')},
        size=[w, h],
        mapSizes=dict(albedo=[w, h], normal=[normal.shape[1], normal.shape[0]], orm=[orm.shape[1], orm.shape[0]]),
        tileSizeMetres=tile,
        avgColor=avg_hex,
        avgColorLinear=avg_lin,
        roughnessMean=r_mean,
        metalnessMean=m_mean,
        tags=tags, bytes=a_bytes + n_bytes + o_bytes, source=source, notes=note,
    )
    print(f'{name:26s} {w}x{h} {e["bytes"] // 1024} KB avg {e["avgColor"]}')
    return e


# ------------------------------------------------------------------ granite cladding
def granite_cladding():
    s = B.acg_fetch('Granite002A', '1K')
    col = T.resize_albedo(T.load(s['color']), (512, 512))
    col = T.flatten_lowfreq(col, 0.8)
    nor = T.resize_normal(T.load(s['normal']), (512, 512))
    rough = T.resize(T.load(s['rough'], 'L'), (512, 512))
    # 1024 px = 2.4 m; granite repeats twice (1.2 m); panels 1.2 w x 0.6 h, stack bond, 8 mm joints
    S = 1024
    col = np.tile(col, (2, 2, 1))
    nor = np.tile(nor, (2, 2, 1))
    rough = np.tile(rough, (2, 2))
    pxm = S / 2.4
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    pw, ph = 1.2 * pxm, 0.6 * pxm
    jx = np.minimum(xx % pw, pw - (xx % pw))
    jy = np.minimum(yy % ph, ph - (yy % ph))
    jd = np.minimum(jx, jy)  # distance to nearest joint centre line (px)
    half = 0.004 * pxm  # 4 mm half joint
    height = np.clip((jd - half) / 1.2, 0, 1)  # 0 in joint, 1 on panel, ~1 px bevel
    # per-panel tone variation (granite batches differ slightly)
    rng = np.random.default_rng(7)
    ix = (xx // pw).astype(int)
    iy = (yy // ph).astype(int)
    tone = rng.normal(0, 0.035, (8, 8, 3)).astype(np.float32)
    tone[..., :] += rng.normal(0, 0.03, (8, 8, 1))
    lin = T.srgb_to_linear(col) * (1 + tone[iy % 8, ix % 8])
    joint_col = np.array([0.16, 0.16, 0.155], np.float32)
    lin = lin * height[..., None] + joint_col * (1 - height[..., None])
    albedo = T.linear_to_srgb(lin)
    n_join = T.normal_from_height(height, strength=2.5)
    normal = T.blend_normals(n_join, T.scale_normal(nor, 0.6))
    r = 0.42 + (rough - rough.mean()) * 0.5
    r = r * height + 0.9 * (1 - height)
    ao = 1 - 0.45 * (1 - T.periodic_blur(height, 1.5))
    orm = np.stack([ao, r, np.zeros_like(r)], axis=2)
    orm = T.resize(orm, (512, 512))
    return emit('granite_cladding_light', 'stone', albedo, normal, orm, [2.4, 2.4],
                ['wall', 'facade', 'cladding', 'granite', 'light', 'podium', 'tintable'],
                'Honed light-grey granite in 1.2 x 0.6 m stack-bond panels with 8 mm joints (RBZ piers and friezes '
                '#aeb0ac, bank halls, podium cladding). Panel joints fall on u = 0, 0.5 and v = 0, .25, .5, .75.',
                dict(site='ambientCG + procedural', id='Granite002A', url='https://ambientcg.com/view?id=Granite002A',
                     author=B.AUTHOR_ACG + '; joints generated by tools/materials/gen_textures.py', license='CC0 1.0'))


# ------------------------------------------------------------------ painted kerbs
def kerb_base(W, H, seed=3):
    """Procedural kerb concrete, tileable, W x H px covering 2.0 x 0.5 m."""
    grain = noise(H, W, 0.8, seed)
    mottle = noise(H, W, 18, seed + 1, octaves=3)
    pores = (noise(H, W, 0.7, seed + 2) < 0.2).astype(np.float32)
    g = 0.47 + (mottle - 0.5) * 0.25 + (grain - 0.5) * 0.12 - pores * 0.08
    col = np.stack([g, g * 0.99, g * 0.96], axis=2)
    height = 0.6 * grain + 0.4 * mottle - 0.5 * pores
    return col, height


def kerb_variant(name, blocks, tags, note, seed):
    W, H = 1024, 256  # 2.0 m along the kerb (u) x 0.5 m across (v)
    col, height = kerb_base(W, H, seed)
    xx = np.arange(W)[None, :].repeat(H, 0)
    n_blocks = len(blocks)
    idx = (xx * n_blocks // W)
    paint = np.array(blocks, np.float32)[idx]  # (H, W, 3) sRGB
    # paint wear: speckled loss + patches, a bit more near the long edges (v = 0 / 1, the arrises)
    wear_n = noise(H, W, 6, seed + 5, octaves=3)
    edge = np.abs(np.linspace(-1, 1, H))[:, None] ** 6
    speck = noise(H, W, 0.9, seed + 6)
    coverage = np.clip((wear_n - 0.30 - 0.2 * edge) * 30, 0, 1) * (speck > 0.2)
    # joints between precast kerb units every 1 m (dark line), align with block changes
    joint = (np.minimum(xx % (W // 2), (W // 2) - (xx % (W // 2))) < 1.5).astype(np.float32)
    base_lin = T.srgb_to_linear(col)
    paint_lin = T.srgb_to_linear(paint) * (0.93 + 0.14 * noise(H, W, 3, seed + 7))[..., None]
    lin = base_lin * (1 - coverage[..., None]) + paint_lin * coverage[..., None]
    lin = lin * (1 - 0.6 * joint[..., None])
    albedo = T.linear_to_srgb(lin)
    h = height * (1 - 0.5 * coverage) + 0.15 * coverage - 0.8 * joint
    normal = T.normal_from_height(T.periodic_blur(h, 0.6), strength=3.0)
    rough = 0.88 - 0.25 * coverage
    ao = 1 - 0.4 * joint
    orm = T.resize(np.stack([ao, rough, np.zeros_like(rough)], axis=2), (512, 128))
    return emit(name, 'road', albedo, normal, orm, [2.0, 0.5], tags, note,
                dict(site='procedural', id='gen_textures.py', url='https://github.com/thisisisheanesu/spiderman-harare',
                     author='Spider-Man: Harare contributors (generated)', license='CC0 1.0'),
                budgets=(60_000, 50_000, 20_000))


# ------------------------------------------------------------------ window glass
def window_glass():
    S = 1024  # 3.0 m x 3.0 m
    wav = noise(S, S, 60, 11, octaves=2)
    normal = T.normal_from_height(wav, strength=9.0)  # very gentle (float-glass waviness)
    # grime = even dust film + soft vertical run-off streaks + a few large smudges; kept low-contrast so the
    # glass reads as glass (not stone) when the sun lights the grime layer from far away
    film = 0.10 + 0.08 * (noise(S, S, 60, 12, octaves=2) - 0.5) * 4
    st = noise(8, S, 1.5, 13)[0][None, :]          # 1-D tileable along u
    fade = noise(S, 8, 50, 14)[:, 0][:, None]      # 1-D tileable along v
    streak = np.clip((st - 0.6) * 4, 0, 1) * np.clip((fade - 0.4) * 3, 0, 1)
    smudge = np.clip((noise(S, S, 28, 15, octaves=2) - 0.62) * 5, 0, 1)
    grime = np.clip(film + 0.18 * streak + 0.14 * smudge, 0, 0.4)
    grime = T.periodic_blur(grime, 2.0)
    rough = 0.04 + 0.35 * grime + 0.02 * noise(S, S, 4, 16)
    grime_col = np.array([0.46, 0.43, 0.38], np.float32)  # dusty beige-grey (Harare dry-season dust)
    rgb = np.broadcast_to(T.linear_to_srgb(grime_col), (S, S, 3))
    albedo = T.resize(np.concatenate([rgb, grime[..., None]], axis=2), (512, 512))  # grime is soft: 512 is plenty
    orm = T.resize(np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], axis=2), (512, 512))
    e = emit('window_glass', 'glass', albedo, normal, orm, [3.0, 3.0],
             ['window', 'glass', 'facade', 'reflection', 'grime'],
             'Surface layer for facade glass (not the glass colour itself). albedo.rgb = dust/grime colour, '
             'albedo.a = grime coverage (~0.05 .. 0.4, mean ~0.1). ORM.g = roughness 0.04 clean .. ~0.4 smudged; '
             'normal = gentle float-glass waviness that breaks up reflections. Tint glass per building '
             '(RBZ #5b808c, Karigamombe #5177a4, Joina #5a7189, Monomotapa #5f6c73). See README "Windows".',
             dict(site='procedural', id='gen_textures.py', url='https://github.com/thisisisheanesu/spiderman-harare',
                  author='Spider-Man: Harare contributors (generated)', license='CC0 1.0'),
             budgets=(110_000, 40_000, 35_000), alpha=True)
    return e


def main():
    entries = [
        granite_cladding(),
        kerb_variant('kerb_painted_bw', [(0.10, 0.10, 0.10), (0.86, 0.86, 0.83)] * 1,
                     ['kerb', 'curb', 'painted', 'black-white', 'median'],
                     'Kerb with alternating black / white 1 m paint blocks (Samora Machel medians). u runs along the '
                     'kerb (one repeat = 2 m = black + white), v across it (0.5 m: map the kerb face + top into v).', 21),
        kerb_variant('kerb_painted_yellow', [(0.85, 0.66, 0.13)],
                     ['kerb', 'curb', 'painted', 'yellow', 'rank', 'bus-stop'],
                     'Kerb painted yellow (kombi ranks, bus stops, no-stopping zones). Same mapping as kerb_painted_bw.', 22),
        kerb_variant('kerb_painted_rw', [(0.62, 0.12, 0.10), (0.86, 0.86, 0.83)],
                     ['kerb', 'barrier', 'painted', 'red-white', 'median-nose'],
                     'Red / white 1 m blocks for median noses and precast barrier blocks. Same mapping as kerb_painted_bw.', 23),
        window_glass(),
    ]
    man = B.write_manifest(entries)
    print(f"total {man['totalBytes'] / 1e6:.2f} MB in {len(man['materials'])} materials")


if __name__ == '__main__':
    main()
