"""Livery / decal textures (1024 x 1024 RGBA, alpha = decal mask). Each function returns the UV cells
(u0, v0, u1, v1; v up) of the decals it painted, keyed by name, and saves the PNG.

Brands: only 'ZUPCO' (the state bus company / franchise sticker the streets actually show), 'POLICE' / 'ZRP'
and 'TAXI' appear; businesses on the truck box are invented."""
from PIL import Image, ImageDraw

import textures as T

S = 1024
KOMBI_SLOGANS = ['MWARI VANOKWANISA', 'ZVICHANAKA', 'GOD IS ABLE', 'TATENDA', 'NO HURRY IN AFRICA', 'JEHOVAH JIREH']
BANNER_COLORS = ['#d6201f', '#1d4fb8', '#111111', '#e3b21b', '#1d7a3a', '#6a1b9a']
ROUTES = ['MBARE', 'CHITOWN', 'TOWN', 'GLEN VIEW', 'WARREN PARK', 'KUWADZANA', 'BUDIRIRO', 'HIGHFIELD']


def _box(cell):
    u0, v0, u1, v1 = cell
    return (int(u0 * S), int((1 - v1) * S), int(u1 * S) - 1, int((1 - v0) * S) - 1)


def kombi_layout():
    cells = {
        'stripe': (0.0, 0.94, 1.0, 1.0),
        'zupco_side': (0.0, 0.80, 0.5, 0.935),
        'zupco_wind': (0.5, 0.87, 1.0, 0.935),
        'zupco_round': (0.5, 0.80, 0.565, 0.865),
        'cargo_bag': (0.0, 0.0, 0.25, 0.2),
        'cargo_tarp': (0.25, 0.0, 0.5, 0.2),
        'cargo_sack': (0.5, 0.0, 0.75, 0.2),
        'cargo_box': (0.75, 0.0, 1.0, 0.2),
    }
    for i in range(len(KOMBI_SLOGANS)):
        cells[f'banner_{i}'] = (0.0, 0.775 - 0.05 * (i + 1), 1.0, 0.775 - 0.05 * i - 0.004)
    for i in range(len(ROUTES)):
        cells[f'route_{i}'] = ((i % 4) * 0.25, 0.36 - (i // 4) * 0.08, (i % 4) * 0.25 + 0.245, 0.435 - (i // 4) * 0.08)
    return cells


def kombi(path):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cells = kombi_layout()
    # factory waist stripe: faded gold/orange band over a thin dark line (Harare photos)
    c = cells['stripe']
    x0, y0, x1, y1 = _box(c)
    h = y1 - y0
    d.rectangle((x0, y0, x1, y0 + int(h * 0.62)), fill=(176, 120, 42, 255))
    d.rectangle((x0, y0 + int(h * 0.62), x1, y0 + int(h * 0.72)), fill=(236, 234, 226, 0))
    d.rectangle((x0, y0 + int(h * 0.72), x1, y1), fill=(40, 30, 22, 255))
    # ZUPCO franchise sticker for the sides
    c = cells['zupco_side']
    x0, y0, x1, y1 = _box(c)
    d.rounded_rectangle((x0 + 4, y0 + 4, x1 - 4, y1 - 4), radius=14, fill=(255, 255, 255, 255), outline=(28, 63, 148, 255), width=8)
    T.text_fit(d, (x0 + 20, y0 + 10, x1 - 20, y0 + (y1 - y0) * 0.72), 'ZUPCO', T.bold, (28, 63, 148, 255), 120)
    T.text_fit(d, (x0 + 30, y0 + (y1 - y0) * 0.68, x1 - 30, y1 - 12), 'FRANCHISE  -  REG 0419', T.bold, (200, 30, 30, 255), 30)
    # windscreen top strip 'ZUPCO'
    c = cells['zupco_wind']
    x0, y0, x1, y1 = _box(c)
    d.rectangle((x0, y0, x1, y1), fill=(255, 255, 255, 255))
    T.text_fit(d, (x0 + 10, y0 + 4, x1 - 10, y1 - 4), 'Z U P C O', T.bold, (28, 63, 148, 255), 60)
    # small round ZUPCO roundel for the rear window
    c = cells['zupco_round']
    x0, y0, x1, y1 = _box(c)
    d.ellipse((x0 + 2, y0 + 2, x1 - 2, y1 - 2), fill=(28, 63, 148, 255))
    T.text_fit(d, (x0 + 8, y0 + 8, x1 - 8, y1 - 8), 'ZUPCO', T.bold, (255, 255, 255, 255), 20)
    # slogan banners (windscreen top / rear window), 6 rows
    for i, text in enumerate(KOMBI_SLOGANS):
        c = cells[f'banner_{i}']
        x0, y0, x1, y1 = _box(c)
        bg = T.hex2rgb(BANNER_COLORS[i % len(BANNER_COLORS)])
        fg = (20, 20, 20) if BANNER_COLORS[i] == '#e3b21b' else (255, 255, 255)
        d.rectangle((x0, y0, x1, y1), fill=(*bg, 255))
        T.text_fit(d, (x0 + 24, y0 + 3, x1 - 24, y1 - 3), text, T.bold, (*fg, 255), 60)
    # route cards (yellow card, black letters) for the lower windscreen corner
    for i, r in enumerate(ROUTES):
        c = cells[f'route_{i}']
        x0, y0, x1, y1 = _box(c)
        d.rectangle((x0, y0, x1, y1), fill=(242, 205, 32, 255), outline=(30, 30, 30, 255), width=3)
        T.text_fit(d, (x0 + 8, y0 + 6, x1 - 8, y1 - 6), r, T.bold, (15, 15, 15, 255), 50)
    # roof-rack cargo: checked 'China bag', blue tarp, maize sack, brown box
    c = cells['cargo_bag']
    x0, y0, x1, y1 = _box(c)
    for i in range(x0, x1, 16):
        for j in range(y0, y1, 16):
            col = [(200, 40, 40), (40, 70, 170), (235, 235, 235)][((i - x0) // 16 + (j - y0) // 16) % 3]
            d.rectangle((i, j, i + 15, j + 15), fill=(*col, 255))
    c = cells['cargo_tarp']
    x0, y0, x1, y1 = _box(c)
    d.rectangle((x0, y0, x1, y1), fill=(38, 88, 170, 255))
    for j in range(y0, y1, 22):
        d.line((x0, j, x1, j + 8), fill=(30, 70, 140, 255), width=5)
    c = cells['cargo_sack']
    x0, y0, x1, y1 = _box(c)
    d.rectangle((x0, y0, x1, y1), fill=(214, 200, 160, 255))
    for i in range(x0, x1, 6):
        d.line((i, y0, i, y1), fill=(196, 182, 142, 255), width=2)
    T.text_fit(d, (x0 + 20, y0 + 50, x1 - 20, y1 - 50), 'MEALIE MEAL 50kg', T.bold, (40, 90, 40, 255), 30)
    c = cells['cargo_box']
    x0, y0, x1, y1 = _box(c)
    d.rectangle((x0, y0, x1, y1), fill=(160, 120, 75, 255))
    d.rectangle((x0, y0 + (y1 - y0) // 2 - 6, x1, y0 + (y1 - y0) // 2 + 6), fill=(200, 180, 120, 255))
    im.save(path)
    return cells




def cargo_layout():
    return {'cargo_bag': (0.0, 0.5, 0.5, 1.0), 'cargo_tarp': (0.5, 0.5, 1.0, 1.0),
            'cargo_sack': (0.0, 0.0, 0.5, 0.5), 'cargo_box': (0.5, 0.0, 1.0, 0.5)}


def cargo(path, size=512):
    """Loads for pickups / roof racks: checked 'China bag', blue tarp, maize-meal sack, cardboard box."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cells = cargo_layout()

    def box(c):
        u0, v0, u1, v1 = c
        return (int(u0 * size), int((1 - v1) * size), int(u1 * size) - 1, int((1 - v0) * size) - 1)
    x0, y0, x1, y1 = box(cells['cargo_bag'])
    for i in range(x0, x1, 16):
        for j in range(y0, y1, 16):
            col = [(200, 40, 40), (40, 70, 170), (235, 235, 235)][((i - x0) // 16 + (j - y0) // 16) % 3]
            d.rectangle((i, j, i + 15, j + 15), fill=(*col, 255))
    x0, y0, x1, y1 = box(cells['cargo_tarp'])
    d.rectangle((x0, y0, x1, y1), fill=(38, 88, 170, 255))
    for j in range(y0, y1, 22):
        d.line((x0, j, x1, j + 8), fill=(30, 70, 140, 255), width=5)
    x0, y0, x1, y1 = box(cells['cargo_sack'])
    d.rectangle((x0, y0, x1, y1), fill=(214, 200, 160, 255))
    for i in range(x0, x1, 6):
        d.line((i, y0, i, y1), fill=(196, 182, 142, 255), width=2)
    T.text_fit(d, (x0 + 20, y0 + 90, x1 - 20, y1 - 90), 'MEALIE MEAL 50kg', T.bold, (40, 90, 40, 255), 30)
    x0, y0, x1, y1 = box(cells['cargo_box'])
    d.rectangle((x0, y0, x1, y1), fill=(160, 120, 75, 255))
    d.rectangle((x0, y0 + (y1 - y0) // 2 - 6, x1, y0 + (y1 - y0) // 2 + 6), fill=(200, 180, 120, 255))
    im.save(path)
    return cells


def taxi_layout():
    return {
        'sign_face': (0.0, 0.75, 0.5, 1.0),      # roof sign front/back face
        'sign_side': (0.5, 0.75, 1.0, 1.0),      # roof sign side
        'door': (0.0, 0.45, 1.0, 0.72),          # door decal: TAXI + checker band
        'checker': (0.0, 0.38, 1.0, 0.44),       # plain checker strip
        'sign_body': (0.0, 0.0, 0.25, 0.25),     # plain yellow (sign housing)
    }


def taxi(path):
    """Metered-taxi decals: yellow roof sign, black/white checker band, TAXI door lettering."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    L = taxi_layout()
    yellow, black, white = (242, 200, 30, 255), (18, 18, 18, 255), (245, 245, 240, 255)
    x0, y0, x1, y1 = _box(L['sign_face'])
    d.rectangle((x0, y0, x1, y1), fill=yellow)
    T.text_fit(d, (x0 + 20, y0 + 20, x1 - 20, y1 - 20), 'TAXI', T.bold, black, 200)
    x0, y0, x1, y1 = _box(L['sign_side'])
    d.rectangle((x0, y0, x1, y1), fill=yellow)
    T.text_fit(d, (x0 + 30, y0 + 30, x1 - 30, y1 - 30), 'METERED', T.bold, black, 120)
    x0, y0, x1, y1 = _box(L['door'])
    h = y1 - y0
    # checker band across the bottom third, lettering above
    n = 40
    cw = (x1 - x0) / n
    for i in range(n):
        for r in range(2):
            col = black if (i + r) % 2 == 0 else white
            d.rectangle((x0 + i * cw, y1 - h * 0.34 + r * h * 0.17, x0 + (i + 1) * cw, y1 - h * 0.34 + (r + 1) * h * 0.17), fill=col)
    T.text_fit(d, (x0 + 60, y0 + 6, x1 - 60, y1 - h * 0.38), 'TAXI  -  24 HRS', T.bold, black, 160)
    x0, y0, x1, y1 = _box(L['checker'])
    h = y1 - y0
    n = 64
    cw = (x1 - x0) / n
    for i in range(n):
        for r in range(2):
            col = black if (i + r) % 2 == 0 else white
            d.rectangle((x0 + i * cw, y0 + r * h / 2, x0 + (i + 1) * cw, y0 + (r + 1) * h / 2), fill=col)
    x0, y0, x1, y1 = _box(L['sign_body'])
    d.rectangle((x0, y0, x1, y1), fill=yellow)
    im.save(path)
    return L


def police_layout():
    return {
        'band': (0.0, 0.88, 1.0, 1.0),           # blue band with yellow pinstripes (sides)
        'door': (0.0, 0.66, 0.6, 0.86),          # POLICE on the blue band (doors)
        'hood': (0.0, 0.5, 0.6, 0.64),           # POLICE on white (bonnet / tailgate)
        'crest': (0.62, 0.5, 0.82, 0.86),        # round ZRP badge
        'lightbar': (0.84, 0.5, 1.0, 0.86),      # light bar housing
    }


def police(path):
    """Zimbabwe Republic Police livery (approx): white body, blue side band with gold pinstripes, POLICE
    lettering, round ZRP badge on the front doors."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    L = police_layout()
    blue, gold, white = (27, 47, 107, 255), (224, 181, 33, 255), (248, 248, 246, 255)
    x0, y0, x1, y1 = _box(L['band'])
    h = y1 - y0
    d.rectangle((x0, y0, x1, y1), fill=blue)
    d.rectangle((x0, y0, x1, y0 + h * 0.12), fill=gold)
    d.rectangle((x0, y1 - h * 0.12, x1, y1), fill=gold)
    x0, y0, x1, y1 = _box(L['door'])
    h = y1 - y0
    d.rectangle((x0, y0, x1, y1), fill=blue)
    d.rectangle((x0, y0, x1, y0 + h * 0.08), fill=gold)
    d.rectangle((x0, y1 - h * 0.08, x1, y1), fill=gold)
    T.text_fit(d, (x0 + 20, y0 + h * 0.12, x1 - 20, y1 - h * 0.12), 'POLICE', T.bold, white, 200)
    x0, y0, x1, y1 = _box(L['hood'])
    T.text_fit(d, (x0 + 10, y0 + 6, x1 - 10, y1 - 6), 'POLICE', T.bold, blue, 200)
    x0, y0, x1, y1 = _box(L['crest'])
    d.ellipse((x0 + 4, y0 + 4, x1 - 4, y1 - 4), fill=gold)
    d.ellipse((x0 + 22, y0 + 22, x1 - 22, y1 - 22), fill=blue)
    T.text_fit(d, (x0 + 50, y0 + 60, x1 - 50, y1 - 60), 'ZRP', T.bold, gold, 120)
    x0, y0, x1, y1 = _box(L['lightbar'])
    d.rectangle((x0, y0, x1, y1), fill=(30, 30, 32, 255))
    im.save(path)
    return L


BUS_DESTS = ['CITY - MBARE', 'CITY - CHITUNGWIZA', 'CITY - GLEN VIEW', 'CITY - WARREN PARK', 'CITY - BUDIRIRO', 'CITY - EPWORTH']


def bus_layout():
    L = {
        'band': (0.0, 0.93, 1.0, 1.0),           # blue skirt band with gold top pinstripe
        'swoosh': (0.0, 0.86, 1.0, 0.925),       # gold swoosh stripe
        'zupco': (0.0, 0.70, 0.62, 0.85),        # ZUPCO lettering
        'zupco_full': (0.0, 0.62, 1.0, 0.69),    # 'ZIMBABWE UNITED PASSENGER COMPANY'
        'fleet': (0.64, 0.70, 0.84, 0.85),       # fleet number
        'logo': (0.86, 0.70, 1.0, 0.85),         # round logo
        'engine': (0.0, 0.0, 0.3, 0.3),          # rear engine grille
    }
    for i in range(len(BUS_DESTS)):
        L[f'dest_{i}'] = (0.0, 0.56 - 0.05 * (i + 1), 1.0, 0.56 - 0.05 * i - 0.004)
    return L


def bus(path):
    """ZUPCO city bus livery (2019+ white fleet with blue and gold, approx) + LED destination displays."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    L = bus_layout()
    blue, gold, white = (28, 63, 148, 255), (217, 165, 32, 255), (250, 250, 248, 255)
    x0, y0, x1, y1 = _box(L['band'])
    h = y1 - y0
    d.rectangle((x0, y0, x1, y1), fill=blue)
    d.rectangle((x0, y0, x1, y0 + h * 0.18), fill=gold)
    x0, y0, x1, y1 = _box(L['swoosh'])
    h = y1 - y0
    pts = [(x0, y1), (x0 + (x1 - x0) * 0.35, y1), (x0 + (x1 - x0) * 0.75, y0 + h * 0.2), (x1, y0), (x1, y0 + h * 0.45),
           (x0 + (x1 - x0) * 0.76, y0 + h * 0.62), (x0 + (x1 - x0) * 0.36, y1 - 1), (x0, y1 - 1)]
    d.polygon(pts, fill=gold)
    x0, y0, x1, y1 = _box(L['zupco'])
    T.text_fit(d, (x0 + 10, y0 + 6, x1 - 10, y1 - 6), 'ZUPCO', T.bold, blue, 200)
    x0, y0, x1, y1 = _box(L['zupco_full'])
    T.text_fit(d, (x0 + 10, y0 + 4, x1 - 10, y1 - 4), 'ZIMBABWE UNITED PASSENGER COMPANY', T.bold, blue, 60)
    x0, y0, x1, y1 = _box(L['fleet'])
    T.text_fit(d, (x0 + 6, y0 + 20, x1 - 6, y1 - 20), 'ZB 1147', T.bold, (20, 20, 20, 255), 80)
    x0, y0, x1, y1 = _box(L['logo'])
    d.ellipse((x0 + 4, y0 + 4, x1 - 4, y1 - 4), fill=blue)
    d.ellipse((x0 + 18, y0 + 18, x1 - 18, y1 - 18), outline=gold, width=8)
    T.text_fit(d, (x0 + 30, y0 + 40, x1 - 30, y1 - 40), 'Z', T.bold, white, 80)
    for i, t in enumerate(BUS_DESTS):
        x0, y0, x1, y1 = _box(L[f'dest_{i}'])
        d.rectangle((x0, y0, x1, y1), fill=(10, 10, 10, 255))
        T.text_fit(d, (x0 + 20, y0 + 4, x1 - 20, y1 - 4), t, lambda s: T.font('DejaVuSansMono-Bold.ttf', s), (255, 174, 26, 255), 60)
    x0, y0, x1, y1 = _box(L['engine'])
    d.rectangle((x0, y0, x1, y1), fill=(30, 30, 32, 255))
    for j in range(y0 + 8, y1, 14):
        d.rectangle((x0 + 8, j, x1 - 8, j + 6), fill=(8, 8, 8, 255))
    im.save(path)
    return L


def truck_layout():
    return {'box_side': (0.0, 0.5, 1.0, 1.0), 'box_rear': (0.0, 0.0, 0.5, 0.5), 'box_front': (0.5, 0.0, 1.0, 0.5)}


def truck(path):
    """Aluminium box body with an invented distributor's signage."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    L = truck_layout()
    for key in L:
        x0, y0, x1, y1 = _box(L[key])
        d.rectangle((x0, y0, x1, y1), fill=(214, 216, 218, 255))
        step = 24 if key == 'box_side' else 18
        for i in range(x0, x1, step):
            d.line((i, y0, i, y1), fill=(188, 190, 193, 255), width=3)
        d.rectangle((x0, y0, x1, y1), outline=(120, 122, 125, 255), width=6)
    x0, y0, x1, y1 = _box(L['box_side'])
    h = y1 - y0
    d.rectangle((x0 + 30, y0 + h * 0.22, x1 - 30, y0 + h * 0.62), fill=(250, 250, 250, 255))
    T.text_fit(d, (x0 + 50, y0 + h * 0.24, x1 - 50, y0 + h * 0.46), 'CHIPO & SONS', T.bold, (180, 30, 30, 255), 200)
    T.text_fit(d, (x0 + 120, y0 + h * 0.46, x1 - 120, y0 + h * 0.6), 'WHOLESALE DISTRIBUTORS  -  HARARE', T.bold, (30, 60, 140, 255), 80)
    d.rectangle((x0 + 30, y0 + h * 0.66, x1 - 30, y0 + h * 0.7), fill=(30, 60, 140, 255))
    x0, y0, x1, y1 = _box(L['box_rear'])
    h = y1 - y0
    d.line(((x0 + x1) // 2, y0, (x0 + x1) // 2, y1), fill=(90, 92, 95, 255), width=6)
    for yy in (0.15, 0.5, 0.85):
        for xx in (0.2, 0.8):
            cx, cy = x0 + (x1 - x0) * xx, y0 + h * yy
            d.rectangle((cx - 18, cy - 8, cx + 18, cy + 8), fill=(70, 72, 75, 255))
    T.text_fit(d, (x0 + 40, y0 + h * 0.3, x1 - 40, y0 + h * 0.42), 'HOW IS MY DRIVING?', T.bold, (30, 30, 30, 255), 40)
    im.save(path)
    return L
