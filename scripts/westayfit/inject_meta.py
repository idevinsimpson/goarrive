#!/usr/bin/env python3
"""Inject WSF-minimal HTML meta into every page under apps/westayfit/dist.

Only injects:
  - <title>
  - <meta name="description">
  - <meta name="robots" content="noindex,nofollow">

Intentionally omits: PWA manifest, service worker, fonts, Safari CSS,
error handlers, analytics. WSF's meta needs are a strict subset of
GoArrive's; a smaller own-script is more auditable and cannot regress
GoArrive.

Also emits a hosting-addressable alias for each Expo dynamic route. Expo
exports `app/community/[groupId].tsx` to the literal file
`dist/community/[groupId].html`, which no Firebase Hosting rewrite can name
cleanly, so a direct load of /community/<id> 404s. We copy each such file to a
sibling `__dynamic.html` and require firebase.westayfit.json to carry a rewrite
pointing at it — checked here, so a new dynamic route cannot ship silently
broken the way this one did.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DIST_ROOT = REPO_ROOT / "apps" / "westayfit" / "dist"
HOSTING_CONFIG = REPO_ROOT / "firebase.westayfit.json"
DYNAMIC_ALIAS = "__dynamic.html"

TITLE = "We Stay Fit"
DESCRIPTION = "Turn your community into a place that moves."
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


def rewrite_destinations() -> set[str]:
    """Every `destination` declared in the WSF hosting config."""
    config = json.loads(HOSTING_CONFIG.read_text(encoding="utf-8"))
    rewrites = config.get("hosting", {}).get("rewrites", []) or []
    return {r["destination"] for r in rewrites if "destination" in r}


def alias_dynamic_routes(html_files: list[Path]) -> int:
    """Copy each `[param].html` to a sibling `__dynamic.html` and verify a
    rewrite points at it. Returns a non-zero count of unrouted dynamic pages."""
    dynamic = [p for p in html_files if p.name.startswith("[") and p.name.endswith("].html")]
    if not dynamic:
        return 0

    destinations = rewrite_destinations()
    unrouted = 0
    for path in dynamic:
        alias = path.with_name(DYNAMIC_ALIAS)
        alias.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        expected = "/" + alias.relative_to(DIST_ROOT).as_posix()
        status = "routed" if expected in destinations else "NO REWRITE"
        if expected not in destinations:
            unrouted += 1
        print(f"WSF dynamic route aliased: {path.name} -> {expected}  [{status}]")

    if unrouted:
        print(
            f"ERROR: {unrouted} dynamic route(s) have no rewrite in "
            f"{HOSTING_CONFIG.name}. Without one, a direct load or refresh of "
            f"that URL returns 404. Add a rewrite whose destination is the "
            f"path printed above.",
            file=sys.stderr,
        )
    return unrouted


def main() -> int:
    if not DIST_ROOT.exists():
        print(f"ERROR: {DIST_ROOT} does not exist. Run `npm run build:web` first.", file=sys.stderr)
        return 1

    # Recursive: nested routes (e.g. community/[groupId].html) are pages too,
    # and this site is required to be noindex on every page it serves.
    html_files = sorted(p for p in DIST_ROOT.rglob("*.html") if p.name != DYNAMIC_ALIAS)
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
    print(f"  pages: {len(html_files)}")

    # Aliases are copies of already-injected pages, so they inherit the meta.
    return 1 if alias_dynamic_routes(html_files) else 0


if __name__ == "__main__":
    sys.exit(main())
