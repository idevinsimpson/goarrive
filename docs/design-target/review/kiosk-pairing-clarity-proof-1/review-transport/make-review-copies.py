import hashlib, io, json, os, sys
from PIL import Image, ImageDraw, ImageFont
EV, OUT, LIMIT = sys.argv[1], sys.argv[2], 8000
ONLY = sys.argv[4] if len(sys.argv) > 4 else None
EDGE = ONLY == 'target'
os.makedirs(OUT, exist_ok=True)
EVC, TGC = '41a8653c', '9a506766'
srcs = []
for stage in ('before', 'after'):
    for f in sorted(os.listdir(os.path.join(EV, stage))):
        srcs.append((stage, f, os.path.join(EV, stage, f), EVC, f'docs/design-target/review/kiosk-pairing-clarity-proof-1/{stage}/{f}'))
TG = sys.argv[3]
for f in ('TARGET-station-pairing-waiting-1280x800.png', 'TARGET-station-pairing-expired-1280x800.png'):
    srcs.append(('target', f, os.path.join(TG, f), TGC, f'docs/design-target/review/batch-e-room-screens/{f}'))
font = ImageFont.load_default()
def enc(im):
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True); return b.getvalue()
def quant(im, n):
    return im.convert('RGB').quantize(colors=n, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
def blank_rows(im):
    px = im.convert('L'); w, h = px.size; d = px.load(); out = []
    for y in range(h):
        row = [d[x, y] for x in range(0, w, 2)]
        if EDGE:
            inner = row[5:-5]
            out.append(max(abs(inner[i+1]-inner[i]) for i in range(len(inner)-1)) < 40)
        else:
            out.append(max(row) - min(row) < 6)
    return out
def label(im, text):
    w = im.width; per = max(20, (w - 6) // 6)
    words, lines, cur = text.split(' '), [], ''
    for wd in words:
        if len(wd) > per:
            if cur: lines.append(cur); cur = ''
            for i in range(0, len(wd), per): lines.append(wd[i:i + per])
            continue
        if cur and len(cur) + len(wd) + 1 > per: lines.append(cur); cur = wd
        else: cur = (cur + ' ' + wd).strip()
    lines.append(cur)
    sh = 12 * len(lines) + 2
    strip = Image.new('RGB', (w, sh), (255, 236, 0)); dr = ImageDraw.Draw(strip)
    for i, ln in enumerate(lines): dr.text((3, 1 + 12 * i), ln, fill=(0, 0, 0), font=font)
    c = Image.new('RGB', (w, im.height + sh)); c.paste(strip, (0, 0)); c.paste(im.convert('RGB'), (0, sh)); return c
manifest = []
for stage, f, p, commit, rel in srcs:
    if ONLY and stage != ONLY: continue
    raw = open(p, 'rb').read(); sha = hashlib.sha256(raw).hexdigest()
    im = Image.open(p).convert('RGB'); ow, oh = im.size; scale = 1.0
    if ow > 1300:
        scale = 0.5; im = im.resize((ow // 2, oh // 2), Image.LANCZOS)
    blanks = blank_rows(im); h = im.height
    base = f'REVIEW-COPY-{stage}-{f[:-4]}'
    def fits(y0, y1, n, idx, tot):
        tag = f'REVIEW COPY {stage}/{f} sha256 {sha} @{commit}' + (f' scaled x{scale}' if scale != 1 else '') + f' {n}col' + (f' panel {idx}/{tot} rows {y0}-{y1}' if tot > 1 else '')
        data = enc(quant(label(im.crop((0, y0, im.width, y1)), tag), n)); return data
    done = False
    for n in (16, 12, 8):
        # greedy panels cut only at blank rows
        cuts, y0 = [], 0
        ok = True
        while y0 < h:
            best = None
            for y1 in range(h, y0, -1):
                if y1 != h and not blanks[y1]: continue
                if len(fits(y0, y1, n, 1, 2)) <= LIMIT - 400: best = y1; break
            if best is None: ok = False; break
            cuts.append((y0, best)); y0 = best
            while y0 < h and blanks[y0] and y0 > 0 and False: y0 += 1
        if ok: done = True; break
    if not done: print('FAILED', f); continue
    tot = len(cuts)
    for i, (y0, y1) in enumerate(cuts, 1):
        data = fits(y0, y1, n, i, tot)
        name = base + (f'-p{i}of{tot}' if tot > 1 else '') + '.png'
        open(os.path.join(OUT, name), 'wb').write(data)
        manifest.append({'file': name, 'bytes': len(data), 'width': im.width, 'height': Image.open(io.BytesIO(data)).height,
            'sha256': hashlib.sha256(data).hexdigest(), 'colors': n, 'scale': scale, 'panel': f'{i}/{tot}',
            'sourceRows': [y0, y1], 'original': {'path': rel, 'commit': commit, 'sha256': sha, 'bytes': len(raw), 'width': ow, 'height': oh}})
json.dump(manifest, open(os.path.join(OUT, 'review-manifest.json' if not ONLY else f'review-manifest-{ONLY}.json'), 'w'), indent=1)
print(len(manifest), 'files; max bytes', max(m['bytes'] for m in manifest))
for m in manifest: print(m['file'], m['bytes'], f"{m['width']}x{m['height']}", m['colors'])
