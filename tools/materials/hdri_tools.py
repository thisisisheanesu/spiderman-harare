#!/usr/bin/env python3
"""Environment map for image-based lighting (IBL).

Downloads the Poly Haven HDRI (CC0) and writes a *sun-clamped* copy for the game:

    public/textures/env/harare_day_ibl_1k.hdr   1024 x 512 equirect, Radiance RGBE (RLE)
    public/textures/env/env.json                 source, sun direction in the map, mean sky/ground colours

Why clamp the sun: in the source HDRI the 4-pixel sun disc carries ~66 % of all the light. The game already has a
DirectionalLight sun (src/world/sky.js), so leaving the disc in the environment would light everything twice and
put a second, wrongly-placed sun glint in every glass facade. Pixels brighter than CLAMP (relative luminance) are
scaled down to CLAMP, keeping their hue; the sky, clouds, trees and street are untouched.

    python3 tools/materials/hdri_tools.py [polyhaven_id]
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as T  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'textures', 'env')
CACHE = os.environ.get('MAT_CACHE', '/tmp/spiderman-materials-cache')
CLAMP = 12.0


def read_hdr(path):
    data = open(path, 'rb').read()
    pos = 0
    header = []
    while True:
        end = data.index(b'\n', pos)
        line = data[pos:end].decode('ascii', 'replace')
        pos = end + 1
        if line.startswith('-Y') or line.startswith('+Y'):
            parts = line.split()
            h, w = int(parts[1]), int(parts[3])
            break
        header.append(line)
    out = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        if data[pos] == 2 and data[pos + 1] == 2 and ((data[pos + 2] << 8) | data[pos + 3]) == w:
            pos += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = data[pos]
                    pos += 1
                    if n > 128:
                        n -= 128
                        out[y, x:x + n, c] = data[pos]
                        pos += 1
                    else:
                        out[y, x:x + n, c] = np.frombuffer(data, np.uint8, n, pos)
                        pos += n
                    x += n
        else:  # flat scanline
            out[y] = np.frombuffer(data, np.uint8, w * 4, pos).reshape(w, 4)
            pos += w * 4
    e = out[..., 3].astype(np.int32)
    f = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0).astype(np.float32)
    return out[..., :3].astype(np.float32) * f[..., None] + np.where(e[..., None] > 0, 0.5 * f[..., None], 0), header


def write_hdr(path, rgb):
    h, w = rgb.shape[:2]
    m = rgb.max(axis=2)
    mant, ex = np.frexp(m)
    scale = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0)
    rgbe = np.zeros((h, w, 4), np.uint8)
    rgbe[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(m > 1e-32, ex + 128, 0).astype(np.uint8)
    buf = bytearray(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nSOFTWARE=spiderman-harare tools/materials/hdri_tools.py\n\n')
    buf += f'-Y {h} +X {w}\n'.encode()
    for y in range(h):
        buf += bytes([2, 2, w >> 8, w & 255])
        for c in range(4):
            row = rgbe[y, :, c]
            x = 0
            while x < w:
                # run?
                r = 1
                while x + r < w and r < 127 and row[x + r] == row[x]:
                    r += 1
                if r >= 4:
                    buf += bytes([128 + r, row[x]])
                    x += r
                    continue
                # literal until next run of >= 4 or 128 bytes
                s = x
                while x < w and x - s < 128:
                    if x + 3 < w and row[x] == row[x + 1] == row[x + 2] == row[x + 3]:
                        break
                    x += 1
                buf += bytes([x - s]) + row[s:x].tobytes()
    open(path, 'wb').write(buf)
    return len(buf)


def main(pid='wide_street_01'):
    info = T.http_get(f'https://api.polyhaven.com/info/{pid}').json()
    files = T.http_get(f'https://api.polyhaven.com/files/{pid}').json()
    src = T.download(files['hdri']['1k']['hdr']['url'], os.path.join(CACHE, 'hdri', f'{pid}_1k.hdr'))
    rgb, _ = read_hdr(src)
    h, w = rgb.shape[:2]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    y, x = np.unravel_index(np.argmax(lum), lum.shape)
    sun_u, sun_v = (x + 0.5) / w, (y + 0.5) / h
    elev = 90 - sun_v * 180
    th = (np.arange(h) + 0.5) / h * math.pi
    wgt = np.repeat(np.sin(th)[:, None], w, 1)

    def wmean(a, rows):
        ww = wgt[rows]
        return (a[rows] * ww[..., None]).sum((0, 1)) / ww.sum()

    k = np.minimum(1.0, CLAMP / np.maximum(lum, 1e-6))
    out = rgb * k[..., None]
    # Below the horizon the source shows a foreign street (parked cars, tree shadows). Sharp, it shows up as
    # dark speckle in every downward reflection (glass seen from swing height). Blur it progressively from
    # 3 deg below the horizon so only a soft ground tone remains; the sky and horizon silhouettes stay sharp.
    vv = (np.arange(h) + 0.5) / h
    wgt_g = np.clip((vv - 0.5 - 3 / 180) / (12 / 180), 0, 1)[:, None, None]
    ground = T.periodic_blur(out, 18)
    out = out * (1 - wgt_g) + ground * wgt_g
    share = float(((lum - np.minimum(lum, CLAMP)) * wgt).sum() / (lum * wgt).sum())
    os.makedirs(OUT, exist_ok=True)
    name = 'harare_day_ibl_1k.hdr'
    size = write_hdr(os.path.join(OUT, name), out)
    # three.js direction of the (removed) sun for this map: equirectUv() uses u = atan(d.z, d.x) / 2pi + 0.5,
    # v = asin(d.y) / pi + 0.5 (HDRLoader sets flipY), so u = 0.5 is +X and u = 0.75 is +Z
    phi = (sun_u - 0.5) * 2 * math.pi
    th_e = math.radians(elev)
    sun_dir = [round(math.cos(th_e) * math.cos(phi), 3), round(math.sin(th_e), 3), round(math.cos(th_e) * math.sin(phi), 3)]
    meta = dict(
        file=name, bytes=size, size=[w, h], format='Radiance RGBE (RLE), linear, equirectangular',
        source=dict(site='Poly Haven', id=pid, url=f'https://polyhaven.com/a/{pid}', author=', '.join(info.get('authors', {})),
                    license='CC0 1.0', whitebalance=info.get('whitebalance'), evs=info.get('evs_cap')),
        processing=f'sun disc clamped to relative luminance {CLAMP} (removed {share * 100:.0f} % of the total energy); '
                   'ground below -3 deg progressively blurred (sigma 18 px) so reflections show a soft ground tone, '
                   'not the source street; sky and horizon unchanged',
        sunInSource=dict(u=round(sun_u, 4), v=round(sun_v, 4), elevationDeg=round(elev, 1),
                         threeDirectionDefaultMapping=sun_dir,
                         note='direction the removed sun came from with THREE.EquirectangularReflectionMapping and '
                              'scene.environmentRotation = (0,0,0); rotate the environment about Y so this matches the '
                              'game sun (sky.sunDirection) if you want the bright sky side to agree with the key light'),
        meanSkyLinear=[round(float(v), 3) for v in wmean(out, slice(0, h // 2))],
        meanGroundLinear=[round(float(v), 3) for v in wmean(out, slice(h // 2, h))],
    )
    json.dump(meta, open(os.path.join(OUT, 'env.json'), 'w'), indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == '__main__':
    main(*(sys.argv[1:2]))
