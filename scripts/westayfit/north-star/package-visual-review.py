#!/usr/bin/env python3
"""
Package the canonical North Star images for a reviewer who can only open a
native file: original bytes, an exact allowlist, and a manifest that pins each
file to the source commit.

    python3 scripts/westayfit/north-star/package-visual-review.py <out-dir> [<source-sha>]

Copies the allowlisted PNGs from the working tree into <out-dir> at their
repository-relative paths, writes MANIFEST.json and MANIFEST.md beside them,
and exits non-zero if any allowlisted file is missing, is not a PNG, or if the
working tree's HEAD is not the requested source SHA. Standard library only: no
install, no build, no network. It never renders, resizes or otherwise touches
an image — the bytes in the package are the bytes in git.
"""
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys

REPO = 'idevinsimpson/goarrive'
NS = 'docs/design-target/north-star-final'
OWNER = 'docs/design-target/owner-north-star'

# The exact files, and what each one is. Nothing outside this list is packaged.
ALLOWLIST = [
    (f'{OWNER}/OWNER-BOARD-1-before-current-wsf-experience.png', 'OWNER BOARD (owner-supplied) · before: current WSF experience'),
    (f'{OWNER}/OWNER-BOARD-2-after-target-wsf-vision.png', 'OWNER BOARD (owner-supplied) · after / target: WSF vision'),
    (f'{NS}/INDEX.png', 'INDEX · navigation contact sheet rendered from the package directory (2x)'),
    (f'{NS}/board-00/WE_STAY_FIT_NORTH_STAR_BOARD_00_BRAND_FOUNDATION_FINAL.png', 'CANONICAL BOARD 00 · reconstructed reference (2x) · status per north-star-final/README.md'),
    (f'{NS}/board-01/WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_FINAL.png', 'CANONICAL BOARD 01 · current-build composite: real captures + labelled target/seam (2x) · status per README'),
    (f'{NS}/board-02/WE_STAY_FIT_NORTH_STAR_BOARD_02_MOVE_FINAL.png', 'CANONICAL BOARD 02 · accepted frames read in place + two captures (2x) · status per README'),
    (f'{NS}/board-03/WE_STAY_FIT_NORTH_STAR_BOARD_03_COMMUNITY_FINAL.png', 'CANONICAL BOARD 03 · accepted frames read in place (2x) · status per README'),
    (f'{NS}/board-04/WE_STAY_FIT_NORTH_STAR_BOARD_04_PROGRESS_FINAL.png', 'CANONICAL BOARD 04 · accepted frames read in place (2x) · status per README'),
    (f'{NS}/board-05/WE_STAY_FIT_NORTH_STAR_BOARD_05_YOU_FINAL.png', 'CANONICAL BOARD 05 · accepted frames read in place (2x) · status per README'),
    (f'{NS}/review-copies/WE_STAY_FIT_NORTH_STAR_INDEX_REVIEW_1x.png', 'REVIEW COPY · INDEX at 1x, same module (WSF_BOARD_SCALE=1)'),
    (f'{NS}/review-copies/WE_STAY_FIT_NORTH_STAR_BOARD_00_BRAND_FOUNDATION_FINAL_REVIEW_1x.png', 'REVIEW COPY · Board 00 at 1x, same module'),
    (f'{NS}/review-copies/WE_STAY_FIT_NORTH_STAR_BOARD_01_HOME_FINAL_REVIEW_1x.png', 'REVIEW COPY · Board 01 at 1x, same module'),
    (f'{NS}/review-copies/WE_STAY_FIT_NORTH_STAR_BOARD_02_MOVE_FINAL_REVIEW_1x.png', 'REVIEW COPY · Board 02 at 1x, same module'),
    (f'{NS}/review-copies/WE_STAY_FIT_NORTH_STAR_BOARD_03_COMMUNITY_FINAL_REVIEW_1x.png', 'REVIEW COPY · Board 03 at 1x, same module'),
    (f'{NS}/review-copies/WE_STAY_FIT_NORTH_STAR_BOARD_04_PROGRESS_FINAL_REVIEW_1x.png', 'REVIEW COPY · Board 04 at 1x, same module'),
    (f'{NS}/review-copies/WE_STAY_FIT_NORTH_STAR_BOARD_05_YOU_FINAL_REVIEW_1x.png', 'REVIEW COPY · Board 05 at 1x, same module'),
]

PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def png_dimensions(data):
    if data[:8] != PNG_MAGIC or data[12:16] != b'IHDR':
        raise ValueError('not a PNG')
    w, h = struct.unpack('>II', data[16:24])
    return w, h


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = sys.argv[1]
    head = git('rev-parse', 'HEAD')
    if len(sys.argv) > 2 and sys.argv[2] and sys.argv[2] != head:
        sys.exit(f'HEAD is {head}, not the requested source SHA {sys.argv[2]}')
    if git('status', '--porcelain', '--', NS, OWNER):
        sys.exit('the source tree has uncommitted changes under the packaged paths; refusing to package bytes that are not in git')
    os.makedirs(out, exist_ok=True)
    rows = []
    for rel, label in ALLOWLIST:
        if not os.path.isfile(rel):
            sys.exit(f'missing: {rel}')
        with open(rel, 'rb') as f:
            data = f.read()
        w, h = png_dimensions(data)
        blob = git('rev-parse', f'HEAD:{rel}')
        dest = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(rel, dest)
        rows.append({
            'path': rel,
            'label': label,
            'git_blob_sha1': blob,
            'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
            'width': w,
            'height': h,
        })
    manifest = {
        'repo': REPO,
        'source_sha': head,
        'source_ref_note': 'files copied byte-for-byte from this commit; nothing rendered or resized by the packager',
        'files': rows,
    }
    with open(os.path.join(out, 'MANIFEST.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
    with open(os.path.join(out, 'MANIFEST.md'), 'w') as f:
        f.write(f'# WE STAY FIT North Star — visual review package\n\n')
        f.write(f'Repository `{REPO}` · source commit `{head}` · original bytes, nothing regenerated.\n\n')
        f.write('| path | label | git blob | bytes | sha256 | w×h |\n| --- | --- | --- | ---: | --- | --- |\n')
        for r in rows:
            f.write(f"| `{r['path']}` | {r['label']} | `{r['git_blob_sha1'][:12]}` | {r['bytes']} | `{r['sha256']}` | {r['width']}×{r['height']} |\n")
    print(f'packaged {len(rows)} files from {head[:12]} into {out}')


if __name__ == '__main__':
    main()
