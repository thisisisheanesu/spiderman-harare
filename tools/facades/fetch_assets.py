#!/usr/bin/env python3
"""Download the real (scanned / modelled) facade attachments used by the Harare facade kit.

    FACADE_WORK=<scratch dir> SKETCHFAB_TOKEN_FILE=<token file> python3 tools/facades/fetch_assets.py

Poly Haven (CC0): glTF + 1k textures via api.polyhaven.com (no key).
Sketchfab (CC BY): model metadata is public; the download link needs an API token, which is read at runtime
from $SKETCHFAB_TOKEN_FILE and never printed, logged or written anywhere.
Everything lands in $FACADE_WORK/raw/<id>/ (outside the repo) together with info.json (title, author, URL,
licence), which tools/facades/write_credits.py turns into public/models/facades/CREDITS.md.
Requests are rate limited to <= 1 per second.
"""
import json
import os
import sys
import time
import urllib.request
import zipfile

WORK = os.environ.get('FACADE_WORK', '/tmp/facade-work')
RAW = os.path.join(WORK, 'raw')
UA = 'spiderman-harare-facade-kit/1.0 (asset pipeline)'
_last = [0.0]

# Poly Haven ids -> what the kit uses them for
POLYHAVEN = {
    'rollershutter_door': 'shopfront roll-down steel shutter + shutter box (ground-floor shop bays)',
    'modular_metal_gutter': 'downpipe, offset bend, shoe and hopper (drainpipe attachments)',
}
# Sketchfab uids (licence re-checked from the API before download: only CC BY / CC0 accepted)
SKETCHFAB = {
    'df7687570458444cb66fecdbfea2adc4': 'window / through-wall box air conditioner (ac_window attachment)',
    '11d7c77bfe804f448a516928adf3f05d': 'weathered split-system outdoor unit (ac_split attachment)',
}
OK_LICENCES = {'CC Attribution', 'CC0 Public Domain', 'Public Domain'}


def get(url, auth=False, raw=False):
    for i in range(6):
        wait = 1.05 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        if auth:
            with open(os.environ['SKETCHFAB_TOKEN_FILE']) as f:
                req.add_header('Authorization', 'Token ' + f.read().strip())
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
                return data if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(min(60, 4 * 2 ** i))
                continue
            raise
    raise RuntimeError('too many retries: ' + url.split('?')[0])


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(get(url, raw=True))
    return path


def fetch_polyhaven(pid, use):
    d = os.path.join(RAW, pid)
    os.makedirs(d, exist_ok=True)
    info_p = os.path.join(d, 'info.json')
    if not os.path.exists(info_p):
        info = get(f'https://api.polyhaven.com/info/{pid}')
        files = get(f'https://api.polyhaven.com/files/{pid}')
        g = files['gltf']['1k']['gltf']
        download(g['url'], os.path.join(d, os.path.basename(g['url'])))
        for rel, inc in g['include'].items():
            download(inc['url'], os.path.join(d, rel))
        json.dump({
            'source': 'Poly Haven', 'id': pid, 'title': info.get('name', pid),
            'authors': list(info.get('authors', {}).keys()), 'url': f'https://polyhaven.com/a/{pid}',
            'licence': 'CC0 1.0', 'licence_url': 'https://creativecommons.org/publicdomain/zero/1.0/',
            'gltf': os.path.basename(g['url']), 'use': use,
        }, open(info_p, 'w'), indent=1)
    print('polyhaven', pid, 'ok')


def fetch_sketchfab(uid, use):
    d = os.path.join(RAW, uid)
    os.makedirs(d, exist_ok=True)
    info_p = os.path.join(d, 'info.json')
    if os.path.exists(info_p):
        print('sketchfab', uid, 'cached')
        return
    m = get(f'https://api.sketchfab.com/v3/models/{uid}')
    lic = (m.get('license') or {}).get('label')
    if lic not in OK_LICENCES:
        print('REJECT', uid, m.get('name'), lic)
        return
    dl = get(f'https://api.sketchfab.com/v3/models/{uid}/download', auth=True)
    fmt = 'glb' if 'glb' in dl else 'gltf'
    url = dl[fmt]['url']
    out = download(url, os.path.join(d, 'model.' + ('glb' if fmt == 'glb' else 'zip')))
    if fmt == 'gltf':
        with zipfile.ZipFile(out) as z:
            z.extractall(d)
    json.dump({
        'source': 'Sketchfab', 'id': uid, 'title': m.get('name'),
        'authors': [(m.get('user') or {}).get('displayName') or (m.get('user') or {}).get('username')],
        'author_url': (m.get('user') or {}).get('profileUrl'),
        'url': m.get('viewerUrl'), 'licence': lic, 'licence_url': (m.get('license') or {}).get('url'),
        'format': fmt, 'faces': m.get('faceCount'), 'use': use,
    }, open(info_p, 'w'), indent=1)
    print('sketchfab', uid, m.get('name'), lic, 'ok')


if __name__ == '__main__':
    for pid, use in POLYHAVEN.items():
        fetch_polyhaven(pid, use)
    if os.environ.get('SKETCHFAB_TOKEN_FILE'):
        for uid, use in SKETCHFAB.items():
            fetch_sketchfab(uid, use)
    else:
        print('SKETCHFAB_TOKEN_FILE not set: Sketchfab downloads skipped', file=sys.stderr)
