#!/usr/bin/env python3
"""Sketchfab helper for the real-vehicle set: search, thumbnails, model metadata, GLB download.

    python3 sketchfab.py search  "toyota hiace" [--count 24] [--pages 1]   -> $VR_WORK/search/<slug>.json
    python3 sketchfab.py thumbs  <uid> [<uid> ...]                         -> $VR_WORK/thumbs/<uid>.jpg
    python3 sketchfab.py info    <uid> [<uid> ...]                         -> $VR_WORK/raw/<uid>.json
    python3 sketchfab.py download <uid> [<uid> ...]                        -> $VR_WORK/raw/<uid>.glb (+ .json)

The API token is NEVER stored in this file or printed. `download` reads it at runtime from the file named
by $SKETCHFAB_TOKEN_FILE (a one-line file that only the owner can read). Search, thumbnails and model info
need no token. Requests are rate-limited to <= 1 per second and back off on HTTP 429.

Raw downloads stay outside the repository ($VR_WORK, default ./vehicles-real-work); only processed,
credited GLBs go to public/models/vehicles_real/.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.sketchfab.com/v3'
WORK = os.environ.get('VR_WORK', os.path.abspath('vehicles-real-work'))
_last = [0.0]

# licences we may use (by label, as the search API returns only the label). NonCommercial and
# NoDerivatives are rejected outright; ShareAlike only as a last resort.
OK_LABELS = {'CC Attribution', 'CC0 Public Domain', 'Public Domain', 'CC0'}
SA_LABELS = {'CC Attribution-ShareAlike'}


def lic_ok(label):
    return 'OK' if label in OK_LABELS else ('SA' if label in SA_LABELS else 'no')


def _token():
    p = os.environ.get('SKETCHFAB_TOKEN_FILE')
    if not p or not os.path.exists(p):
        sys.exit('set SKETCHFAB_TOKEN_FILE to the file holding the API token')
    with open(p) as f:
        return f.read().strip()


def _get(url, auth=False, raw=False, tries=6):
    for i in range(tries):
        wait = 1.05 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        req = urllib.request.Request(url, headers={'User-Agent': 'spiderman-harare-asset-pipeline/1.0'})
        if auth:
            req.add_header('Authorization', 'Token ' + _token())
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
                return data if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                back = min(60, 4 * 2 ** i)
                print(f'  HTTP {e.code}, backing off {back}s', file=sys.stderr)
                time.sleep(back)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            print(f'  network error {e}, retry', file=sys.stderr)
            time.sleep(3 * (i + 1))
    raise RuntimeError('too many retries: ' + url.split('?')[0])


def _slim(m):
    lic = m.get('license') or {}
    thumbs = sorted((m.get('thumbnails') or {}).get('images', []), key=lambda t: t.get('width', 0))
    thumb = next((t['url'] for t in thumbs if t.get('width', 0) >= 400), thumbs[-1]['url'] if thumbs else None)
    return {
        'uid': m['uid'], 'name': m.get('name'),
        'licence': lic.get('label'), 'licence_slug': lic.get('slug'),
        'user': (m.get('user') or {}).get('username'), 'display': (m.get('user') or {}).get('displayName'),
        'faces': m.get('faceCount'), 'verts': m.get('vertexCount'),
        'url': m.get('viewerUrl'), 'thumb': thumb,
        'animated': m.get('animationCount', 0), 'published': m.get('publishedAt'),
        'likes': m.get('likeCount'), 'views': m.get('viewCount'),
    }


def search(q, count=24, pages=1):
    os.makedirs(os.path.join(WORK, 'search'), exist_ok=True)
    url = f'{API}/search?' + urllib.parse.urlencode({'type': 'models', 'q': q, 'downloadable': 'true', 'count': count})
    out = []
    for _ in range(pages):
        r = _get(url)
        out += [_slim(m) for m in r.get('results', [])]
        url = r.get('next')
        if not url:
            break
    slug = re.sub(r'[^a-z0-9]+', '_', q.lower()).strip('_')
    with open(os.path.join(WORK, 'search', slug + '.json'), 'w') as f:
        json.dump(out, f, indent=1)
    for m in out:
        print(f"{lic_ok(m['licence']):<3}{m['uid']}  {m['faces'] or 0:>8}f  {m['licence']!s:<32} {m['user']!s:<22} {m['name']}")
    return out


def thumbs(uids):
    os.makedirs(os.path.join(WORK, 'thumbs'), exist_ok=True)
    known = {}
    for fn in os.listdir(os.path.join(WORK, 'search')):
        for m in json.load(open(os.path.join(WORK, 'search', fn))):
            known[m['uid']] = m
    for uid in uids:
        dst = os.path.join(WORK, 'thumbs', uid + '.jpg')
        if os.path.exists(dst):
            continue
        m = known.get(uid) or _slim(_get(f'{API}/models/{uid}'))
        if not m.get('thumb'):
            continue
        with open(dst, 'wb') as f:
            f.write(_get(m['thumb'], raw=True))
        print('thumb', uid)


def info(uid):
    os.makedirs(os.path.join(WORK, 'raw'), exist_ok=True)
    m = _get(f'{API}/models/{uid}')
    keep = {k: m.get(k) for k in ('uid', 'name', 'description', 'viewerUrl', 'faceCount', 'vertexCount',
                                  'publishedAt', 'tags', 'categories', 'isDownloadable')}
    keep['license'] = m.get('license')
    keep['user'] = {k: (m.get('user') or {}).get(k) for k in ('username', 'displayName', 'profileUrl', 'uid')}
    keep['thumb'] = _slim(m)['thumb']
    with open(os.path.join(WORK, 'raw', uid + '.json'), 'w') as f:
        json.dump(keep, f, indent=1)
    return keep


def download(uid):
    meta = info(uid)
    label = (meta.get('license') or {}).get('label')
    if lic_ok(label) == 'no':
        print(f'SKIP {uid}: licence {label!r} not allowed')
        return None
    dst = os.path.join(WORK, 'raw', uid + '.glb')
    if os.path.exists(dst):
        print('have', dst)
        return dst
    d = _get(f'{API}/models/{uid}/download', auth=True)
    g = d.get('glb') or {}
    if not g.get('url'):
        print(f'no glb for {uid}: {list(d)}')
        return None
    # the signed URL expires within minutes: fetch at once (no auth header: it is a storage URL)
    data = _get(g['url'], raw=True)
    with open(dst, 'wb') as f:
        f.write(data)
    print(f'downloaded {uid} {len(data) / 1e6:.1f} MB  {meta["name"]}  [{meta["license"]["label"]}]')
    return dst


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'search':
        cnt = int(args[args.index('--count') + 1]) if '--count' in args else 24
        pages = int(args[args.index('--pages') + 1]) if '--pages' in args else 1
        search(args[0], cnt, pages)
    elif cmd == 'thumbs':
        thumbs(args)
    elif cmd == 'info':
        for u in args:
            print(json.dumps(info(u))[:300])
    elif cmd == 'download':
        for u in args:
            download(u)
    else:
        sys.exit(__doc__)
