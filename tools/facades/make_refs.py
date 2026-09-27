#!/usr/bin/env python3
"""Write tools/facades/refs.json: the reference photos behind each facade type (with licence / author / URL
taken from the photo metadata) and the credits of the downloaded attachments.

    FACADE_PHOTOS=<dir with commons_meta.json + openverse_meta.json> FACADE_WORK=<scratch> python3 tools/facades/make_refs.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTOS = os.environ.get('FACADE_PHOTOS', '')
WORK = os.environ.get('FACADE_WORK', '/tmp/facade-work')

# type -> [(photo file, what it shows / what the kit took from it)]
REFS = {
    'ribbon': [
        ('wc_Harare_Zimbabwe_04.jpg', 'Throgmorton House: mint-teal spandrel panels under continuous white aluminium ribbon windows, '
                                      'face-brick end wall with vertical letters, window AC units, pavement canopy'),
        ('ov_e504fe94_Harare_4.jpg', 'slab tower with orange-tan spandrel bands and grey mosaic end walls'),
        ('ov_8b8ae35f_Harare_3.jpg', 'tan ribbon-window slab tower above the jacaranda canopy'),
        ('wc_Harare_CBD.jpg', 'Batanai Gardens (Jason Moyo / First St): continuous sloped green sunshade hoods over ribbon windows (bay_hood)'),
        ('wc_Mapillary_138205998291259_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg', 'beige office slab with sloped hoods, AC units and a cantilevered pavement canopy'),
    ],
    'fins': [
        ('ov_7ee7b21e_P1000988.jpg', 'left: beige office block with close full-height concrete fins; right: tan block with deep fins'),
        ('wc_First_Street_Harare_Zimbabwe.jpg', 'left: grey 1970s block with angled sawtooth fins (bay_angled)'),
        ('wc_Harare_Downtown1.jpg', 'left: grey office block with fins and deep spandrels (Samora Machel)'),
    ],
    'eggcrate': [
        ('wc_Harare_CBD.jpg', 'tower behind Edgars: deep concrete egg-crate grid of shelves and fins'),
        ('wc_First_Street_Harare_Zimbabwe_2.jpg', 'white egg-crate grid (top right, First Street Mall)'),
        ('wc_Harare.jpg', 'left: white grid block with brick end walls (1995)'),
        ('wc_Mapillary_138205998291259_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg', 'left: white balcony / grid tower on a brick base'),
    ],
    'curtain': [
        ('wc_Harare_Zimbabwe_04.jpg', 'blue reflective curtain-wall tower with wide light-grey corner piers'),
        ('wc_The_Avenues_Harare.jpg', 'blue-glass tower with a white needle spire (probably Karigamombe Centre)'),
        ('ov_7ee7b21e_P1000988.jpg', 'Reserve Bank: teal curtain glass between slim granite piers'),
        ('wc_Harare_Zimbabwe_02.jpg', 'curved blue curtain-wall office on Samora Machel Ave'),
        ('wc_Downtown_Harare.jpg', 'dark glass curtain-wall block (left)'),
    ],
    'glassgranite': [
        ('ov_70b81282_Harare_5.jpg', 'grey granite piers and spandrels with recessed blue glass ribbons and set-back galleries'),
        ('wc_Harare_2024_6.jpg', 'right: beige panel spandrels + blue glass, 1990s office'),
        ('ov_4dff88b3_P1000987.jpg', 'banded white / dark-glass offices along Samora Machel'),
        ('ov_6ef347af_P1000984.jpg', 'Kingdom Bank block: granite, glass and a fan canopy'),
    ],
    'brick': [
        ('wc_First_Street_Harare_Zimbabwe.jpg', 'CABS building on First Street Mall: red-brown face brick, punched grid of white-framed windows, '
                                                'light concrete corner piers, blade signs'),
        ('wc_Harare_Zimbabwe_03.jpg', 'Union Buildings: brown face brick, white steel windows with AC units, concrete window surround bay'),
        ('ov_8b8ae35f_Harare_3.jpg', 'large red-brown brick slab with punched windows'),
        ('ov_e504fe94_Harare_4.jpg', 'brick towers with punched windows (right)'),
        ('wc_Harare_2024_5.jpg', 'two-storey face-brick shops with a first-floor gallery and pavement canopy'),
    ],
    'colonial': [
        ('wc_Stanley_Avenue_Salisbury_1936.jpg', 'Stanley Ave (Jason Moyo) 1936: pavement verandahs on slender posts, giant-order colonnades, parapet names'),
        ('wc_Harare_Zimbabwe_03.jpg', 'left: cream neo-classical block with maroon trim, pilasters, cornice and round-arched ground windows with burglar bars'),
        ('ov_cef77ace_Harare_1.jpg', 'low cream shops with fascia signs and canopies'),
        ('wc_Harare_Downtown1.jpg', 'right: white colonial offices with hip roofs, pilasters and sash windows'),
        ('ov_5a87b2d6_Station_Furnishers.jpg', 'Station Furnishers: verandah fascia with shop name, shopfront glazing (NON-COMMERCIAL: looked at only)'),
        ('ov_7d6a94d3_Robert_Mugabe_Road_First_Street_Harare_Zimbabwe_20.jpg', 'cream cast-iron verandah column with lace spandrels (NON-COMMERCIAL: looked at only)'),
    ],
    'deco': [
        ('ov_d706b8c1_Harare_2.jpg', 'cream rendered 1930s-50s blocks with ground-floor arcades; grey block with deep horizontal ledges'),
        ('ov_cef77ace_Harare_1.jpg', 'cream render walk-ups with steel windows and AC units'),
        ('wc_Harare.jpg', 'Pearl House: golden ochre render with vertical window strips'),
        ('wc_Harare_Zimbabwe_03.jpg', 'left: rendered corner block with cornice and pilasters'),
    ],
    'avenues': [
        ('wc_Mapillary_196761335623742_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg', 'Avenues flat block: cream render, recessed balconies with solid parapets; brick walk-up'),
        ('ov_cef77ace_Harare_1.jpg', 'flat blocks with blue-painted projecting balcony slabs and AC units'),
        ('wc_Harare.jpg', 'left: balcony grid block with brick end walls'),
        ('wc_Mapillary_138205998291259_6Rd1ig7CTn2kV9_YgGdUEw_rubynikki_2.jpg', 'left: white balcony tower'),
    ],
}


def main():
    meta = {}
    for fn in ('commons_meta.json', 'openverse_meta.json'):
        p = os.path.join(PHOTOS, fn)
        if os.path.exists(p):
            meta.update(json.load(open(p)))
    out = {'types': {}, 'attachments': []}
    for t, lst in REFS.items():
        rows = []
        for f, what in lst:
            m = meta.get(f, {})
            lic = m.get('license', '')
            if m.get('license_version'):
                lic = f"CC {lic.upper()} {m['license_version']}" if lic not in ('pdm', 'cc0') else ('Public Domain Mark' if lic == 'pdm' else 'CC0')
            nc = 'NC' in lic.upper()
            rows.append(dict(photo=f, shows=what, title=m.get('title', '').replace('File:', ''),
                             author=m.get('author') or m.get('creator'), licence=lic, url=m.get('page'),
                             reference_only=nc))
        out['types'][t] = rows
    raw = os.path.join(WORK, 'raw')
    if os.path.isdir(raw):
        for d in sorted(os.listdir(raw)):
            p = os.path.join(raw, d, 'info.json')
            if os.path.exists(p):
                i = json.load(open(p))
                out['attachments'].append(dict(source=i['source'], title=i['title'], authors=i['authors'], url=i['url'],
                                               licence=i['licence'], licence_url=i.get('licence_url'), use=i['use']))
    json.dump(out, open(os.path.join(HERE, 'refs.json'), 'w'), indent=1)
    print('refs.json', {t: len(v) for t, v in out['types'].items()}, len(out['attachments']), 'attachments')


if __name__ == '__main__':
    main()
