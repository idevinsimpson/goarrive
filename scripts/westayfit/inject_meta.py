#!/usr/bin/env python3
"""Inject WSF-minimal HTML meta into apps/westayfit/dist/index.html.

Only injects:
  - <title>
  - <meta name="description">
  - <meta name="robots" content="noindex,nofollow">

Intentionally omits: PWA manifest, service worker, fonts, Safari CSS,
error handlers, analytics. WSF's meta needs are a strict subset of
GoArrive's; a smaller own-script is more auditable and cannot regress
GoArrive.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DIST_ROOT = REPO_ROOT / "apps" / "westayfit" / "dist"

TITLE = "We Stay Fit"
DESCRIPTION = "Universal communities that move together."
ROBOTS = '<meta name="robots" content="noindex,nofollow">'
DESCRIPTION_TAG = f'<meta name="description" content="{DESCRIPTION}">'


def inject(html: str) -> str:
    if "<title>" in html:
        html = re.sub(r"<title>.*?</title>", f"<title>{TITLE}</title>", html, count=1, flags=re.DOTALL)
    else:
        html = html.replace("<head>", f"<head>\n    <title>{TITLE}</title>", 1)

    if 'name="description"' in html:
        html = re.sub(
            r'<meta\s+name="description"[^>]*>',
            DESCRIPTION_TAG,
            html,
            count=1,
        )
    else:
        html = html.replace("</title>", f"</title>\n    {DESCRIPTION_TAG}", 1)

    if 'name="robots"' in html:
        html = re.sub(
            r'<meta\s+name="robots"[^>]*>',
            ROBOTS,
            html,
            count=1,
        )
    else:
        html = html.replace(DESCRIPTION_TAG, f"{DESCRIPTION_TAG}\n    {ROBOTS}", 1)

    return html


def main() -> int:
    if not DIST_ROOT.exists():
        print(f"ERROR: {DIST_ROOT} does not exist. Run `npm run build:web` first.", file=sys.stderr)
        return 1

    html_files = sorted(DIST_ROOT.glob("*.html"))
    if not html_files:
        print(f"ERROR: no *.html files under {DIST_ROOT}.", file=sys.stderr)
        return 1

    for path in html_files:
        original = path.read_text(encoding="utf-8")
        updated = inject(original)
        path.write_text(updated, encoding="utf-8")
        print(f"WSF meta injected into {path.relative_to(REPO_ROOT)}")

    print(f"  title: {TITLE}")
    print(f"  description: {DESCRIPTION}")
    print("  robots: noindex,nofollow")
    return 0


if __name__ == "__main__":
    sys.exit(main())
