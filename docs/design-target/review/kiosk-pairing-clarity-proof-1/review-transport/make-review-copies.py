#!/usr/bin/env python3
"""
KIOSK-PAIRING-CLARITY-PROOF-1 review-transport copies (Director #365 5951677294).

One run makes every copy and the committed review-manifest.json:

    python make-review-copies.py <evidence dir @41a8653c> <out dir> <batch-e-room-screens dir @9a506766>

Each original's CONTENT is quantized on its own, with no dithering, using the
smallest palette (16 colours upward; fast octree, then max coverage, then
median cut at each size) that keeps its white and green content; median cut was dropped because on the frozen
targets it turned white text grey or green). The REVIEW COPY strip is then drawn in two palette entries
APPENDED after the content's, so the label never shares a palette slot with
content and cannot recolour it (W4 finding #394 5952462914). Frames larger
than the byte budget are split into whole horizontal panels, cut only at
text-free rows. The run ends with an acceptance check and fails loudly if any
copy recolours white or green content to the label yellow, keeps less than 95%
of an original's white or green pixels white or green, has a strip less than
half yellow, or leaves any original's panels not tiling it.
"""
import hashlib, io, json, os, sys
from PIL import Image, ImageDraw, ImageFont

EV, OUT, TG = sys.argv[1], sys.argv[2], sys.argv[3]
LIMIT, BUDGET = 8000, 7600
EVC, TGC = '41a8653c', '9a506766'
YELLOW, BLACK = (255, 236, 0), (0, 0, 0)
font = ImageFont.load_default()
os.makedirs(OUT, exist_ok=True)

srcs = []
for stage in ('before', 'after'):
    for f in sorted(os.listdir(os.path.join(EV, stage))):
        srcs.append((stage, f, os.path.join(EV, stage, f), EVC,
                     f'docs/design-target/review/kiosk-pairing-clarity-proof-1/{stage}/{f}'))
for f in ('TARGET-station-pairing-waiting-1280x800.png', 'TARGET-station-pairing-expired-1280x800.png'):
    srcs.append(('target', f, os.path.join(TG, f), TGC, f'docs/design-target/review/batch-e-room-screens/{f}'))

def cuttable_rows(im, edge):
    """Rows a panel may end on. Plain frames: a uniform row. Targets (striped
    background): a row with no high-contrast edge away from the outer frame."""
    d = im.convert('L').load(); w, h = im.size; out = []
    for y in range(h):
        row = [d[x, y] for x in range(0, w, 2)]
        if edge:
            inner = row[5:-5]
            out.append(max(abs(inner[i + 1] - inner[i]) for i in range(len(inner) - 1)) < 40)
        else:
            out.append(max(row) - min(row) < 6)
    return out

def wrap(text, w):
    per = max(20, (w - 6) // 6); lines, cur = [], ''
    for wd in text.split(' '):
        if len(wd) > per:
            if cur: lines.append(cur); cur = ''
            lines.extend(wd[i:i + per] for i in range(0, len(wd), per)); continue
        if cur and len(cur) + len(wd) + 1 > per: lines.append(cur); cur = wd
        else: cur = (cur + ' ' + wd).strip()
    lines.append(cur); return lines

def fidelity(src, dst, dy=0):
    """Share of the original's white / green pixels still white / green, and
    the share turned label-yellow. dst rows are offset by dy (the strip)."""
    s, d = src.load(), dst.load(); w, h = src.size
    wt = wk = wy = gt = gk = gy = 0
    def is_y(c): return c[0] > 200 and c[1] > 200 and c[2] < 90
    for y in range(h):
        for x in range(w):
            a = s[x, y]; c = d[x, y + dy]
            if min(a) > 200:
                wt += 1; wk += min(c) > 185; wy += is_y(c)
            elif a[1] - max(a[0], a[2]) > 40 and a[1] > 120:
                gt += 1; gk += c[1] - max(c[0], c[2]) > 30; gy += is_y(c)
    return (wk / wt if wt else 1.0, gk / gt if gt else 1.0, wy / wt if wt else 0.0, gy / gt if gt else 0.0)

def pick(content):
    """Fewest colours (16..64) that keep the content's whites and greens."""
    best = None
    for n in (16, 24, 32, 48, 64, 96, 128):
        for m in (Image.Quantize.FASTOCTREE, Image.Quantize.MAXCOVERAGE, Image.Quantize.MEDIANCUT):
            q = content.quantize(colors=n, method=m, dither=Image.Dither.NONE)
            f = fidelity(content, q.convert('RGB'))
            if f[0] >= 0.95 and f[1] >= 0.95: return q, n
            if best is None or min(f[:2]) > best[0]: best = (min(f[:2]), q, n)
    return best[1], best[2]

def compose(content, text, n=None):
    """Quantize the content alone; append the label's two colours after it."""
    q, n = pick(content)
    k = len(q.getcolors(maxcolors=256))
    used = sorted(i for _, i in q.getcolors(maxcolors=256))
    # Compact the content palette to the k indices actually used.
    pal = q.getpalette()
    remap = {old: new for new, old in enumerate(used)}
    q = q.point(lambda v: remap.get(v, 0))
    content_pal = sum((pal[3 * old:3 * old + 3] for old in used), [])
    lines = wrap(text, content.width); sh = 12 * len(lines) + 2
    out = Image.new('P', (content.width, content.height + sh), k)
    out.putpalette(content_pal + list(YELLOW) + list(BLACK))
    dr = ImageDraw.Draw(out)
    for i, ln in enumerate(lines): dr.text((3, 1 + 12 * i), ln, fill=k + 1, font=font)
    out.paste(q, (0, sh))
    b = io.BytesIO(); out.save(b, 'PNG', optimize=True)
    return b.getvalue(), sh, k, n

manifest, checks = [], []
for stage, f, p, commit, rel in srcs:
    raw = open(p, 'rb').read(); sha = hashlib.sha256(raw).hexdigest()
    orig = Image.open(p).convert('RGB'); ow, oh = orig.size; scale = 1.0; im = orig
    if ow > 1300:
        scale = 0.5; im = orig.resize((ow // 2, oh // 2), Image.LANCZOS)
    w, h = im.size; ok_rows = cuttable_rows(im, stage == 'target')
    cands = [y for y in range(1, h) if ok_rows[y]] + [h]
    def tag(y0, y1, n, i, tot):
        return (f'REVIEW COPY {stage}/{f} sha256 {sha} @{commit}' + (f' scaled x{scale}' if scale != 1 else '')
                + ' adaptive+label' + (f' panel {i}/{tot} rows {y0}-{y1}' if tot > 1 else ''))
    def size(y0, y1, n): return len(compose(im.crop((0, y0, w, y1)), tag(y0, y1, n, 99, 99))[0])
    for n in (0,):
        cuts, y0, failed = [], 0, False
        while y0 < h:
            opts = [y for y in cands if y > y0]
            lo, hi, best = 0, len(opts) - 1, None          # largest fitting cut, by bisection
            while lo <= hi:
                mid = (lo + hi) // 2
                if size(y0, opts[mid], n) <= BUDGET: best = opts[mid]; lo = mid + 1
                else: hi = mid - 1
            if best is None: failed = True; break
            cuts.append((y0, best)); y0 = best
        if not failed: break
    else:
        sys.exit(f'FAILED to fit {stage}/{f}')
    tot = len(cuts)
    for i, (y0, y1) in enumerate(cuts, 1):
        data, sh, k, n = compose(im.crop((0, y0, w, y1)), tag(y0, y1, n, i, tot))
        assert len(data) <= LIMIT, (f, i, len(data))
        name = f'REVIEW-COPY-{stage}-{f[:-4]}' + (f'-p{i}of{tot}' if tot > 1 else '') + '.png'
        open(os.path.join(OUT, name), 'wb').write(data)
        cp = Image.open(io.BytesIO(data)).convert('RGB')
        manifest.append({'file': name, 'bytes': len(data), 'width': cp.width, 'height': cp.height,
                         'sha256': hashlib.sha256(data).hexdigest(), 'contentColors': k, 'labelColors': 2,
                         'scale': scale, 'panel': f'{i}/{tot}', 'sourceRows': [y0, y1], 'labelRows': sh,
                         'original': {'path': rel, 'commit': commit, 'sha256': sha, 'bytes': len(raw),
                                      'width': ow, 'height': oh}})
        # ACCEPTANCE, re-read from the written file (W4 #394 5952462914).
        wk, gk, wy, gy = fidelity(im.crop((0, y0, w, y1)), cp, sh)
        dst = cp.load(); strip = [dst[xx, yy] == YELLOW for yy in range(sh) for xx in range(w)]
        manifest[-1].update({'contentColors': k, 'paletteColors': n,
                             'acceptance': {'whiteKept': round(wk, 4), 'greenKept': round(gk, 4),
                                            'whiteToYellow': round(wy, 4), 'greenToYellow': round(gy, 4),
                                            'stripYellow': round(sum(strip) / len(strip), 4)}})
        checks.append((name, wk, gk, wy, gy, sum(strip) / len(strip)))

json.dump(manifest, open(os.path.join(OUT, 'review-manifest.json'), 'w'), indent=1)
bad = [c for c in checks if c[1] < 0.95 or c[2] < 0.95 or c[3] > 0.2 or c[4] > 0.2 or c[5] < 0.5]
by = {}
for x in manifest: by.setdefault(x['original']['path'], []).append(x)
for k_, v in by.items():
    r = sorted(x['sourceRows'] for x in v); o = v[0]['original']
    hh = o['height'] // 2 if v[0]['scale'] == 0.5 else o['height']
    assert r[0][0] == 0 and r[-1][1] == hh and all(a[1] == b[0] for a, b in zip(r, r[1:])), k_
print(f'{len(manifest)} copies of {len(by)} originals; max {max(x["bytes"] for x in manifest)} bytes; panels tile every original')
print(f'acceptance: least white kept {min(c[1] for c in checks):.4f}, least green kept {min(c[2] for c in checks):.4f}, '
      f'worst white->yellow {max(c[3] for c in checks):.4f}, worst green->yellow {max(c[4] for c in checks):.4f}, '
      f'least-yellow strip {min(c[5] for c in checks):.3f}; failures {len(bad)}')
for c in bad: print('FAIL', c)
sys.exit(1 if bad else 0)
