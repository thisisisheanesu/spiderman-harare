"""Shared helpers for the material / prop asset pipeline (tools/materials/*).

Image maths is done in float32 numpy arrays:
  * albedo is resized and filtered in *linear* light and written back as sRGB;
  * normal maps are OpenGL convention (+Y up / green up), resized as vectors and renormalised;
  * ORM = R ambient occlusion, G roughness, B metalness (glTF / three.js convention).

WebP is written with Google's `cwebp` (sharp YUV conversion keeps normal/ORM channels cleaner than
Pillow's encoder). If `cwebp` is not on PATH and $CWEBP is unset, the official libwebp release is
downloaded once into the cache directory.
"""
import io
import os
import shutil
import subprocess
import tarfile
import tempfile
import time
import zipfile

import numpy as np
import requests
from PIL import Image

UA = 'SpiderManHarareFanGame/0.2 (https://github.com/thisisisheanesu/spiderman-harare)'
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': UA})
LIBWEBP_URL = 'https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.5.0-linux-x86-64.tar.gz'


def http_get(url, retries=6, **kw):
    """GET with polite back-off on 429 / 5xx."""
    for i in range(retries):
        try:
            r = SESSION.get(url, timeout=120, **kw)
        except requests.RequestException:
            time.sleep(3 * (i + 1))
            continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(int(r.headers.get('Retry-After', 5 * (i + 1))))
            continue
        r.raise_for_status()
        return r
    raise RuntimeError(f'GET failed after {retries} tries: {url}')


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    r = http_get(url)
    tmp = dest + '.part'
    with open(tmp, 'wb') as f:
        f.write(r.content)
    os.replace(tmp, dest)
    time.sleep(0.3)
    return dest


def cwebp_path(cache_dir):
    p = os.environ.get('CWEBP') or shutil.which('cwebp')
    if p:
        return p
    local = os.path.join(cache_dir, 'libwebp', 'bin', 'cwebp')
    if os.path.exists(local):
        return local
    os.makedirs(os.path.join(cache_dir, 'libwebp'), exist_ok=True)
    data = http_get(LIBWEBP_URL).content
    with tarfile.open(fileobj=io.BytesIO(data)) as tf:
        for m in tf.getmembers():
            if m.isfile() and '/bin/' in m.name:
                m.name = 'bin/' + os.path.basename(m.name)
                tf.extract(m, os.path.join(cache_dir, 'libwebp'))
    os.chmod(local, 0o755)
    return local


# ---------------------------------------------------------------- colour space
def srgb_to_linear(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def to_hex(rgb_srgb):
    return '#%02x%02x%02x' % tuple(int(round(float(c) * 255)) for c in rgb_srgb)


# ---------------------------------------------------------------- I/O
def load(path, mode='RGB'):
    im = Image.open(path)
    if im.mode in ('I;16', 'I;16B', 'I', 'F'):
        a = np.asarray(im, dtype=np.float32)
        a = a / (65535.0 if a.max() > 255 else 255.0)
        return a if mode == 'L' else np.repeat(a[..., None], 3, axis=2)
    im = im.convert(mode)
    return np.asarray(im, dtype=np.float32) / 255.0


def resize(a, size):
    """Resize float array (H,W[,C]) to size=(w,h) channel-wise with Lanczos (area-correct for downscale)."""
    w, h = size
    if a.shape[1] == w and a.shape[0] == h:
        return a.astype(np.float32)
    if a.ndim == 2:
        return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((w, h), Image.LANCZOS), dtype=np.float32)
    return np.stack([resize(a[..., c], size) for c in range(a.shape[2])], axis=2)


def resize_albedo(srgb, size):
    return linear_to_srgb(resize(srgb_to_linear(srgb), size))


def resize_normal(n01, size):
    v = n01 * 2 - 1
    v = resize(v, size)
    v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
    return v * 0.5 + 0.5


def periodic_blur(a, sigma):
    """Gaussian blur that wraps around the edges (keeps a tileable texture tileable). sigma in pixels."""
    if sigma <= 0:
        return a
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2)).astype(np.float32)
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)
    return np.stack([periodic_blur(a[..., c], sigma) for c in range(a.shape[2])], axis=2)


def flatten_lowfreq(srgb, strength=0.7, sigma_frac=1 / 10):
    """Remove large blotches (what makes a repeated tile obvious from far away) while keeping fine detail.
    Works per channel in linear light: a *= (mean / blur(a)) ** strength."""
    if strength <= 0:
        return srgb
    lin = srgb_to_linear(srgb)
    sigma = sigma_frac * max(lin.shape[:2])
    low = periodic_blur(lin, sigma)
    mean = lin.reshape(-1, lin.shape[2]).mean(axis=0)
    ratio = (mean / np.maximum(low, 1e-4)) ** strength
    return linear_to_srgb(lin * ratio)


def flatten_scalar(a, strength=0.7, sigma_frac=1 / 10):
    if strength <= 0:
        return a
    low = periodic_blur(a, sigma_frac * max(a.shape[:2]))
    return np.clip(a - strength * (low - a.mean()), 0, 1)


def ao_from_height(h, radius_px=6, strength=2.5):
    """Cheap cavity AO from a height map (0..1): how far a point sits below its neighbourhood."""
    h = (h - h.min()) / max(1e-6, h.max() - h.min())
    ao = 1 - strength * np.maximum(0, periodic_blur(h, radius_px) - h)
    return np.clip(ao, 0.25, 1).astype(np.float32)


def normal_from_height(h, strength=2.0):
    """OpenGL (+Y up) normal from a tileable height field (0..1), strength in 'pixels of height'."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength
    # image rows go down; +Y (green) points up the texture, so dh/dv = -dy
    n = np.stack([-dx, dy, np.ones_like(h)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return (n * 0.5 + 0.5).astype(np.float32)


def detilt_normal(n01):
    """Remove a planar tilt baked into a scanned normal map. A tileable height field has zero mean gradient, so a
    non-zero mean slope is a capture artefact (the scan plane was not level); it makes a whole facade shade as if
    rotated by that angle. Works in gradient space, then renormalises."""
    v = n01 * 2 - 1
    nz = np.maximum(v[..., 2], 0.05)
    gx, gy = v[..., 0] / nz, v[..., 1] / nz
    gx -= gx.mean()
    gy -= gy.mean()
    n = np.stack([gx, gy, np.ones_like(gx)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return (n * 0.5 + 0.5).astype(np.float32)


def blend_normals(base01, detail01):
    """Whiteout blend of two OpenGL normal maps."""
    a = base01 * 2 - 1
    b = detail01 * 2 - 1
    n = np.stack([a[..., 0] + b[..., 0], a[..., 1] + b[..., 1], a[..., 2] * b[..., 2]], axis=2)
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    return n * 0.5 + 0.5


def scale_normal(n01, k):
    """Scale normal-map intensity (k<1 flatter, k>1 stronger)."""
    v = n01 * 2 - 1
    v[..., 0] *= k
    v[..., 1] *= k
    v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
    return v * 0.5 + 0.5


def seam_score(a):
    """Ratio of the wrap-around edge difference to the typical neighbour difference (≈1 means seamless;
    > 2 shows a visible seam). Returns (horizontal, vertical)."""
    g = a.mean(axis=2) if a.ndim == 3 else a
    inner_x = np.abs(np.diff(g, axis=1)).mean()
    inner_y = np.abs(np.diff(g, axis=0)).mean()
    edge_x = np.abs(g[:, 0] - g[:, -1]).mean()
    edge_y = np.abs(g[0, :] - g[-1, :]).mean()
    return float(edge_x / max(inner_x, 1e-6)), float(edge_y / max(inner_y, 1e-6))


def write_webp(a, path, cwebp, quality=82, lossless=False, alpha=False):
    """a: float array 0..1 (H,W,3) or (H,W,4)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    arr = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    mode = 'RGBA' if arr.ndim == 3 and arr.shape[2] == 4 else ('L' if arr.ndim == 2 else 'RGB')
    if mode == 'L':
        arr = np.repeat(arr[..., None], 3, axis=2)
        mode = 'RGB'
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tf:
        Image.fromarray(arr, mode).save(tf.name)
        src = tf.name
    try:
        args = [cwebp, '-quiet', '-mt', '-m', '6', '-metadata', 'none']
        if lossless:
            args += ['-lossless', '-z', '9']
        else:
            args += ['-q', str(quality), '-sharp_yuv', '-af']
        if mode == 'RGBA':
            args += ['-exact', '-alpha_q', '90']
        subprocess.run(args + [src, '-o', path], check=True)
    finally:
        os.unlink(src)
    return os.path.getsize(path)


def albedo_stats(path):
    """Mean colour of an encoded albedo file, measured AFTER encoding: the budget blur and lossy WebP lower the
    linear mean of high-contrast textures by a few percent, and avgColorLinear is used as a tint divisor.
    Returns (hex sRGB of the linear mean, [r, g, b] linear rounded to 4 places)."""
    a = load(path, 'RGB')
    lin = srgb_to_linear(a).reshape(-1, 3).mean(axis=0)
    return to_hex(linear_to_srgb(lin)), [round(float(c), 4) for c in lin]


def orm_stats(path):
    """(roughness mean, metalness mean) of an encoded ORM file."""
    a = load(path, 'RGB')
    return round(float(a[..., 1].mean()), 3), round(float(a[..., 2].mean()), 3)


def extract_zip(zpath, dest):
    with zipfile.ZipFile(zpath) as z:
        z.extractall(dest)


BUDGET_LADDER = [(0.0, 82), (0.0, 76), (0.45, 76), (0.6, 70), (0.8, 66), (1.0, 60), (1.25, 55), (1.5, 50)]


def write_webp_budget(a, path, cwebp, max_bytes, kind='color', ladder=BUDGET_LADDER):
    """Encode with the best (least blurred, highest quality) ladder step that fits max_bytes.
    Pixel-level grain is what makes photo textures expensive in WebP and it is never visible
    once the GPU picks mip 1-2 at game distances, so a sub-pixel blur is the cheapest saving.
    kind='normal' blurs the vectors and renormalises. Returns (bytes, blur, quality)."""
    size = None
    for blur, q in ladder:
        b = a
        if blur > 0:
            if kind == 'normal':
                v = periodic_blur(a * 2 - 1, blur)
                v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
                b = v * 0.5 + 0.5
            else:
                b = periodic_blur(a, blur)
        size = write_webp(b, path, cwebp, quality=q)
        if size <= max_bytes:
            return size, blur, q
    return size, blur, q
