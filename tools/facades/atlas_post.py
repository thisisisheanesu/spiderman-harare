#!/usr/bin/env python3
"""Post-process the Cycles bake passes of the facade kit into game textures (numpy + Pillow + scipy).

    FACADE_WORK=<scratch> python3 tools/facades/atlas_post.py [types...]

Input : $FACADE_WORK/kit_raw/<type>_{atlas,imp}_{albedo,normal,orm,mask,glass,depth}.png + <type>.json
Output: public/models/facades/tex/<type>_atlas_{albedo,normal,orm,mask}.webp   (LOD1 atlas, 1024 / 512 px)
        public/models/facades/tex/<type>_imp_{albedo,normal,orm,mask}.webp     (impostor, 256 x 512 px)

  albedo  sRGB RGB. Ambient occlusion is partly multiplied in (x (0.7 + 0.3 AO)) so recesses stay dark in sun
          where a flat LOD1 quad cannot self-shadow. Glass texels keep the dark glass colour.
  normal  tangent space, OpenGL (+Y up), RGB = the baked micro detail of the PBR normal maps combined with a
          normal derived from the depth pass (reveals, frames, fins become soft bevels);
          ALPHA = height above the wall plane: h = (a - 0.5) * 3 m (for parallax / POM if wanted).
  orm     R = ambient occlusion, G = roughness, B = metalness (glTF packing).
  mask    R/G/B = weight of the tintable roles wall / trim / accent (re-tint per building:
          albedo * (1 + sum_i mask_i * (tint_i / defaultTint_i - 1)) in linear space), A = glass (1 = window pane:
          use it for night-time lit windows and glass reflections). Lossless.
Transparent padding between atlas cells is filled by nearest-texel dilation so mipmaps do not bleed.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
WORK = os.environ.get('FACADE_WORK', '/tmp/facade-work')
RAW = os.path.join(WORK, 'kit_raw')
OUT = os.path.join(REPO, 'public', 'models', 'facades', 'tex')
DEPTH_RANGE = 1.5
IMP_W, IMP_H = 256, 512


def load(path):
    im = Image.open(path)
    a = np.asarray(im).astype(np.float32)
    a /= 65535.0 if a.max() > 255 else 255.0
    if a.ndim == 2:
        a = a[..., None]
    return a


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def dilate(arr, cover):
    """Fill texels where cover < 0.5 with the nearest covered texel."""
    hole = cover < 0.5
    if not hole.any():
        return arr
    _, (iy, ix) = ndimage.distance_transform_edt(hole, return_indices=True)
    return arr[iy, ix]


def height_normal(depth, px_m, blur=1.2, max_slope=1.6):
    h = (depth - 0.5) * 2 * DEPTH_RANGE  # metres, outward positive
    hs = ndimage.gaussian_filter(h, blur)
    dx = ndimage.sobel(hs, axis=1) / (8 * px_m)
    dy = -ndimage.sobel(hs, axis=0) / (8 * px_m)  # rows go down, tangent +Y goes up
    dx = np.clip(dx, -max_slope, max_slope)
    dy = np.clip(dy, -max_slope, max_slope)
    return dx, dy


def process(prefix, px_m, size=None, orm_size=None, mask_size=None, norm_size=None):
    alb = load(prefix + '_albedo.png')
    cover = alb[..., 3]
    nrm = load(prefix + '_normal.png')[..., :3] * 2 - 1
    orm = load(prefix + '_orm.png')[..., :3]
    mask = load(prefix + '_mask.png')[..., :3]
    glass = load(prefix + '_glass.png')[..., 0]
    depth = load(prefix + '_depth.png')[..., 0]
    # albedo with part of the AO multiplied in (not on glass)
    lin = srgb_to_lin(alb[..., :3])
    ao = orm[..., 0]
    k = (0.7 + 0.3 * ao)[..., None]
    lin = np.where(glass[..., None] > 0.5, lin, lin * k)
    albedo = lin_to_srgb(lin)
    # normal: detail slopes + depth slopes
    hx, hy = height_normal(depth, px_m)
    # combine slopes: detail normal n -> dh/dx = -n.x / n.z; height map -> dh/dx = hx;
    # normal of a height field = normalize(-dh/dx, -dh/dy, 1)
    nz = np.maximum(nrm[..., 2], 0.2)
    n = np.stack([nrm[..., 0] / nz - hx, nrm[..., 1] / nz - hy, np.ones_like(hx)], -1)
    n = n / np.linalg.norm(n, axis=-1, keepdims=True)
    normal = np.concatenate([n * 0.5 + 0.5, depth[..., None]], -1)
    out = dict(albedo=albedo, normal=normal, orm=orm, mask=np.concatenate([mask, glass[..., None]], -1))
    for key in out:
        out[key] = dilate(out[key], cover)
    return out


def save(arr, path, size=None, lossless=False, quality=88):
    a = (np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)
    mode = 'RGBA' if a.shape[-1] == 4 else 'RGB'
    im = Image.fromarray(a, mode)
    if size and tuple(size) != im.size:
        im = im.resize(size, Image.LANCZOS)
    if lossless:
        im.save(path, 'WEBP', lossless=True, quality=100, method=6)
    else:
        im.save(path, 'WEBP', quality=quality, method=6, alpha_quality=100)
    return os.path.getsize(path)


def main(types):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for t in types:
        meta_p = os.path.join(RAW, f'{t}.json')
        if not os.path.exists(meta_p):
            continue
        meta = json.load(open(meta_p))
        if 'atlas' not in meta:
            continue
        A = meta['atlas']
        res = {}
        out = process(os.path.join(RAW, f'{t}_atlas'), 1.0 / A['px_per_m'])
        R = A['res']
        res['atlas'] = {
            'albedo': save(out['albedo'], os.path.join(OUT, f'{t}_atlas_albedo.webp'), quality=86),
            'normal': save(out['normal'], os.path.join(OUT, f'{t}_atlas_normal.webp'), size=(R // 2, R // 2), quality=90),
            'orm': save(out['orm'], os.path.join(OUT, f'{t}_atlas_orm.webp'), size=(R // 2, R // 2), quality=86),
            'mask': save(out['mask'], os.path.join(OUT, f'{t}_atlas_mask.webp'), size=(R // 2, R // 2), lossless=True),
        }
        I = meta['impostor']
        rx, ry = I['render']
        out = process(os.path.join(RAW, f'{t}_imp'), I['height_m'] / ry)
        res['impostor'] = {
            'albedo': save(out['albedo'], os.path.join(OUT, f'{t}_imp_albedo.webp'), size=(IMP_W, IMP_H), quality=88),
            'normal': save(out['normal'], os.path.join(OUT, f'{t}_imp_normal.webp'), size=(IMP_W // 2, IMP_H // 2), quality=90),
            'orm': save(out['orm'], os.path.join(OUT, f'{t}_imp_orm.webp'), size=(IMP_W // 2, IMP_H // 2), quality=88),
            'mask': save(out['mask'], os.path.join(OUT, f'{t}_imp_mask.webp'), size=(IMP_W, IMP_H), lossless=True),
        }
        b = sum(res['atlas'].values()) + sum(res['impostor'].values())
        total += b
        meta['texBytes'] = res
        json.dump(meta, open(meta_p, 'w'), indent=1)
        print(t, res, f'{b / 1024:.0f} KB')
    print(f'total {total / 1024:.0f} KB')


if __name__ == '__main__':
    import glob
    ts = sys.argv[1:] or sorted({os.path.basename(p).split('_atlas_')[0] for p in glob.glob(os.path.join(RAW, '*_atlas_albedo.png'))})
    main(ts)
