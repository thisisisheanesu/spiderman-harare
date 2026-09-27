"""Procedural textures for the vehicles (PIL + numpy). Everything is generated; no third-party images.

Fonts: DejaVu Sans Bold (Bitstream Vera / DejaVu licence) and Liberation Sans Narrow Bold (SIL OFL 1.1),
both from the system font packages; only rasterised glyphs end up in the textures.
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_DIRS = ['/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/truetype/liberation',
             '/usr/share/fonts/truetype/freefont']


def font(name, size):
    for d in FONT_DIRS:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def bold(size):
    return font('DejaVuSans-Bold.ttf', size)


def narrow_bold(size):
    for n in ('LiberationSansNarrow-Bold.ttf', 'DejaVuSansCondensed-Bold.ttf', 'DejaVuSans-Bold.ttf'):
        for d in FONT_DIRS:
            if os.path.exists(os.path.join(d, n)):
                return ImageFont.truetype(os.path.join(d, n), size)
    return bold(size)


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def text_fit(draw, box, text, fnt_fn, fill, max_size=200, stretch=True, anchor='mm'):
    """Draw text centred in box (x0, y0, x1, y1), as large as fits."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    size = max_size
    while size > 6:
        f = fnt_fn(size)
        bb = draw.textbbox((0, 0), text, font=f)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        if tw <= w * 0.96 and th <= h * 0.9:
            break
        size -= 2
    draw.text(((x0 + x1) / 2, (y0 + y1) / 2), text, font=f, fill=fill, anchor=anchor)


def height_to_normal(h, strength=2.0):
    """h: float array (H, W) in [0,1]; returns uint8 RGB tangent-space normal map (OpenGL/glTF +Y up)."""
    gy, gx = np.gradient(h.astype(np.float32))
    nx = -gx * strength
    ny = gy * strength   # image rows go down; glTF normal maps are +Y up (green = up in UV v)
    nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / ln, ny / ln, nz / ln], axis=-1)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8), 'RGB')


# ---------------------------------------------------------------------------------------------------
# lamp atlas (shared layout, 512 x 512)
# ---------------------------------------------------------------------------------------------------
# cells in UV (u0, v0, u1, v1), v up (glTF/Blender UV)
LAMP_CELLS = {
    'head_modern': (0.0, 0.5, 0.5, 1.0),      # clear lens, chrome reflector + projector
    'head_rect': (0.5, 0.5, 1.0, 1.0),        # 1990s rectangular lens with prism grid
    'tail': (0.0, 0.0, 0.5, 0.5),             # red lens with segments, small white reverse section at bottom
    'indicator': (0.5, 0.25, 0.75, 0.5),      # amber
    'head_round': (0.75, 0.25, 1.0, 0.5),     # round sealed beam
    'fog': (0.5, 0.0, 0.75, 0.25),            # small round clear
    'tail_plain': (0.75, 0.0, 1.0, 0.25),     # plain red (bus / truck / markers)
}


def lamp_atlas(path, size=512):
    im = Image.new('RGB', (size, size), (0, 0, 0))
    d = ImageDraw.Draw(im)

    def cell(key):
        u0, v0, u1, v1 = LAMP_CELLS[key]
        return (int(u0 * size), int((1 - v1) * size), int(u1 * size), int((1 - v0) * size))
    # modern headlamp: dark housing, chrome reflector bowls with bright centres, black lower band, bezel
    x0, y0, x1, y1 = cell('head_modern')
    d.rectangle((x0, y0, x1, y1), fill=(52, 54, 58))
    w, h = x1 - x0, y1 - y0
    for i in range(0, w, 5):
        d.line((x0 + i, y0, x0 + i, y1), fill=(62, 64, 68))
    for cx, r in ((x0 + w * 0.3, h * 0.3), (x0 + w * 0.68, h * 0.24)):
        cy = y0 + h * 0.47
        for k in range(16, 0, -1):
            t = k / 16
            c = int(245 - 170 * t)
            d.ellipse((cx - r * t, cy - r * t, cx + r * t, cy + r * t), fill=(c, c, min(255, c + 8)))
        d.ellipse((cx - r * 0.3, cy - r * 0.3, cx + r * 0.3, cy + r * 0.3), fill=(255, 255, 248))
    d.rectangle((x0 + w * 0.86, y0 + h * 0.2, x1, y1 - h * 0.2), fill=(215, 125, 25))   # amber corner
    d.rectangle((x0, y1 - h * 0.14, x1, y1), fill=(20, 20, 22))
    d.rectangle((x0, y0, x1, y1), outline=(25, 25, 27), width=6)
    # 90s rectangular headlamp: prism grid
    x0, y0, x1, y1 = cell('head_rect')
    d.rectangle((x0, y0, x1, y1), fill=(205, 208, 210))
    for i in range(x0, x1, 10):
        d.line((i, y0, i, y1), fill=(150, 152, 156), width=2)
    for j in range(y0, y1, 12):
        d.line((x0, j, x1, j), fill=(160, 162, 166), width=2)
    cx, cy = (x0 + x1) / 2 - (x1 - x0) * 0.12, (y0 + y1) / 2
    r = (y1 - y0) * 0.32
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(245, 245, 240))
    d.rectangle((x1 - (x1 - x0) * 0.2, y0, x1, y1), fill=(230, 150, 40))  # amber side section
    # tail lamp: deep red lens with brighter inner rings, darker ribs, white reverse + amber strip below
    x0, y0, x1, y1 = cell('tail')
    d.rectangle((x0, y0, x1, y1), fill=(120, 8, 8))
    for i in range(x0, x1, 8):
        d.line((i, y0, i, y1), fill=(95, 5, 5), width=3)
    for k in range(3):
        cx = x0 + (x1 - x0) * (0.22 + 0.28 * k)
        cy = y0 + (y1 - y0) * 0.36
        r = (y1 - y0) * 0.2
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(200, 25, 20))
        d.ellipse((cx - r * 0.6, cy - r * 0.6, cx + r * 0.6, cy + r * 0.6), fill=(150, 12, 10))
    d.rectangle((x0, y0 + (y1 - y0) * 0.7, x0 + (x1 - x0) * 0.5, y1), fill=(225, 225, 228))
    d.rectangle((x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.7, x1, y1), fill=(200, 100, 15))
    d.rectangle((x0, y0, x1, y1), outline=(40, 5, 5), width=5)
    # indicator
    x0, y0, x1, y1 = cell('indicator')
    d.rectangle((x0, y0, x1, y1), fill=(235, 135, 20))
    for i in range(x0, x1, 7):
        d.line((i, y0, i, y1), fill=(210, 110, 10), width=2)
    # round headlamp
    x0, y0, x1, y1 = cell('head_round')
    d.rectangle((x0, y0, x1, y1), fill=(120, 122, 125))
    cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.48
    for k in range(14, 0, -1):
        t = k / 14
        c = int(255 - 70 * t)
        d.ellipse((cx - r * t, cy - r * t, cx + r * t, cy + r * t), fill=(c, c, c))
    for i in range(int(cx - r), int(cx + r), 9):
        d.line((i, cy - r, i, cy + r), fill=(215, 215, 215))
    # fog
    x0, y0, x1, y1 = cell('fog')
    d.rectangle((x0, y0, x1, y1), fill=(60, 60, 62))
    cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.42
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(240, 240, 230))
    # plain red
    x0, y0, x1, y1 = cell('tail_plain')
    d.rectangle((x0, y0, x1, y1), fill=(200, 20, 16))
    for j in range(y0, y1, 9):
        d.line((x0, j, x1, j), fill=(160, 10, 8), width=2)
    im.save(path)
    return path


# ---------------------------------------------------------------------------------------------------
# number plates
# ---------------------------------------------------------------------------------------------------

def plate(path, text='AEZ 4821', bg='#e3b61f', fg='#111111', w=512, h=128):
    """Zimbabwe 2006-series layout: ABC [coat of arms] 1234, 'ZW' bottom left. Yellow per the Harare photos."""
    im = Image.new('RGB', (w, h), hex2rgb(bg))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((3, 3, w - 4, h - 4), radius=10, outline=hex2rgb(fg), width=5)
    letters, digits = (text.split(' ') + [''])[:2]
    # Letters left of the emblem, digits right of it. Each group is fitted into its own box so the
    # emblem never overlaps a character (reviewer fix: the 4-digit group used to run under the emblem).
    size = int(h * 0.78)
    boxes = ((w * 0.035, w * 0.455), (w * 0.545, w * 0.965))
    while size > 20:
        f = narrow_bold(size)
        if all(d.textlength(t, font=f) <= (b1 - b0) for t, (b0, b1) in zip((letters, digits), boxes)):
            break
        size -= 2
    for t, (b0, b1) in zip((letters, digits), boxes):
        d.text(((b0 + b1) / 2, h * 0.52), t, font=f, fill=hex2rgb(fg), anchor='mm')
    # emblem placeholder (small bird/shield shape) in the middle
    cx, cy = w * 0.5, h * 0.5
    d.ellipse((cx - 13, cy - 20, cx + 13, cy + 16), fill=(60, 110, 60))
    d.polygon([(cx - 8, cy - 26), (cx + 8, cy - 26), (cx, cy - 12)], fill=(200, 60, 40))
    d.text((18, h - 16), 'ZW', font=bold(18), fill=hex2rgb(fg), anchor='lm')
    im.save(path)
    return path


def random_plate(rng):
    letters = 'ABCDEFGHJKLMNPRSTUVWXYZ'
    return 'A' + rng.choice('BCDEFG') + rng.choice(letters) + ' ' + f'{rng.randint(1000, 9999)}'


# ---------------------------------------------------------------------------------------------------
# tyre normal map (one tile = 1/12 of the circumference; v: 0 outer bead .. 0.5 tread centre .. 1 inner bead)
# ---------------------------------------------------------------------------------------------------

def tyre_normal(path, w=256, h=256, style='road'):
    H = np.zeros((h, w), np.float32)
    ys = np.arange(h)[:, None] / (h - 1)       # 0 at top row = v 1
    v = 1 - ys
    xs = np.arange(w)[None, :] / w
    tread = (v > 0.37) & (v < 0.63)
    H += 0.6 * tread
    # circumferential grooves
    for g in (0.43, 0.5, 0.57):
        H -= 0.6 * (np.abs(v - g) < 0.008) * tread
    # lateral sipes / block edges
    phase = (xs * 8 + (v > 0.5) * 0.5 + np.where((v > 0.43) & (v < 0.57), 0.25, 0)) % 1
    H -= 0.45 * ((phase < 0.09) & tread)
    if style == 'offroad':
        blocks = ((xs * 6 + (v * 6).astype(int) * 0.5) % 1) < 0.3
        H -= 0.5 * blocks * tread
    # sidewall: fine concentric ribs + a raised lettering band
    side = (v < 0.34) | (v > 0.66)
    H += 0.05 * np.sin(v * 300) * side
    band = ((v > 0.14) & (v < 0.22)) | ((v > 0.78) & (v < 0.86))
    rnd = np.random.default_rng(3)
    letters = (rnd.random((1, 24)) > 0.35).repeat(w // 24 + 1, axis=1)[:, :w]
    H += 0.2 * band * letters
    img = Image.fromarray((H.clip(-1, 1) * 127 + 128).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    Hs = np.asarray(img).astype(np.float32) / 255.0
    height_to_normal(Hs, strength=5.0).save(path)
    return path


# ---------------------------------------------------------------------------------------------------
# paint detail (greyscale multiplier) + normal map in body-shell UV space
# ---------------------------------------------------------------------------------------------------

class PaintCanvas:
    """Draw panel gaps and grime in body UV space. `uvf(y, kf, side)` maps a body surface position
    (forward y, fractional ring key, side +1/-1) to UV (see vkit.Body.uv)."""

    # Supersampling factor: PIL draws lines without anti-aliasing, so everything is drawn at SS x the
    # final size and downsampled in save() (reviewer fix: 2 px aliased door lines read as staircases
    # at street-level camera distances).
    SS = 4

    def __init__(self, size, uvf, cap_uv=None):
        """cap_uv(x, z, 'front'|'rear') -> UV on the end caps."""
        self.out_size = size
        size = size * self.SS
        self.S = size
        self.uvf = uvf
        self.col = Image.new('L', (size, size), 255)
        self.hgt = Image.new('L', (size, size), 128)
        self.dc = ImageDraw.Draw(self.col)
        self.dh = ImageDraw.Draw(self.hgt)
        self.cap_uv = cap_uv

    def px(self, uv):
        return (uv[0] * self.S, (1 - uv[1]) * self.S)

    def line(self, pts, sides=(1, -1), width=2, dark=70, depth=40):
        """pts: [(y, kf)] polyline on the body; drawn on both sides by default."""
        k = self.SS
        for sd in sides:
            P = [self.px(self.uvf(y, kf, sd)) for y, kf in pts]
            self.dc.line(P, fill=dark, width=width * k, joint='curve')
            self.dh.line(P, fill=128 - depth, width=(width + 1) * k, joint='curve')

    def cap_line(self, pts_xz, which, width=2, dark=70, depth=40, mirror=False):
        k = self.SS
        for m in ((1, -1) if mirror else (1,)):
            P = [self.px(self.cap_uv(x * m, z, which)) for x, z in pts_xz]
            self.dc.line(P, fill=dark, width=width * k, joint='curve')
            self.dh.line(P, fill=128 - depth, width=(width + 1) * k, joint='curve')

    def rect(self, y0, y1, k0, k1, sides=(1, -1), fill=90, depth=30, outline=None):
        for sd in sides:
            a = self.px(self.uvf(y0, k0, sd))
            b = self.px(self.uvf(y1, k1, sd))
            box = (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))
            if outline is not None:
                self.dc.rectangle(box, outline=outline, width=2 * self.SS)
                self.dh.rectangle(box, outline=128 - depth, width=2 * self.SS)
            else:
                self.dc.rectangle(box, fill=fill)
                self.dh.rectangle(box, fill=128 - depth)

    def handle(self, y, kf, length=0.14, sides=(1, -1)):
        """Door handle recess (darker pocket + highlight)."""
        for sd in sides:
            a = self.px(self.uvf(y - length / 2, kf - 0.12, sd))
            b = self.px(self.uvf(y + length / 2, kf + 0.12, sd))
            box = (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))
            self.dc.rounded_rectangle(box, radius=3 * self.SS, fill=150)
            self.dh.rounded_rectangle(box, radius=3 * self.SS, fill=100)

    def grime(self, amount=0.3, seed=1):
        """Darken towards the bottom of the sides (road dust) and add faint speckle."""
        S = self.S
        a = np.asarray(self.col).astype(np.float32)
        v = 1 - np.arange(S)[:, None] / S
        # both side bands: lower part of each band is near the rocker
        for v0, v1 in ((0.02, 0.49), (0.51, 0.98)):
            t = ((v - v0) / (v1 - v0)).clip(0, 1)
            band = ((v >= v0) & (v <= v1)).astype(np.float32)
            dirt = np.exp(-((t - 0.12) / 0.14) ** 2) * amount * 70 * band
            a -= dirt
        rnd = np.random.default_rng(seed)
        noise = rnd.normal(0, 1, (self.out_size // 8, self.out_size // 8)).astype(np.float32)
        noise = np.asarray(Image.fromarray(((noise * 20) + 128).clip(0, 255).astype(np.uint8)).resize((S, S), Image.BILINEAR)).astype(np.float32) - 128
        a += noise * amount * 0.25
        self.col = Image.fromarray(a.clip(0, 255).astype(np.uint8))
        self.dc = ImageDraw.Draw(self.col)

    def save(self, path_col, path_nrm, strength=3.0):
        n = self.out_size
        col = self.col.resize((n, n), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.35))
        col.convert('RGB').save(path_col)
        hgt = self.hgt.resize((n, n), Image.LANCZOS)
        h = np.asarray(hgt.filter(ImageFilter.GaussianBlur(1.0))).astype(np.float32) / 255.0
        height_to_normal(h, strength=strength).save(path_nrm)
        return path_col, path_nrm
