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
exports dynamic segments as literal bracket names — `[param].html` for flat
routes and `[param]/…` directories for nested routes — which no Firebase
Hosting rewrite can name cleanly, so a direct load 404s. For every html whose
relative path contains a `[param]` segment (file stem or directory), we write
a sibling copy with each such segment replaced by `__dynamic`, and require
firebase.westayfit.json to carry a rewrite pointing at it — checked here, so
a new dynamic route cannot ship silently broken the way `[groupId].tsx` did.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DIST_ROOT = REPO_ROOT / "apps" / "westayfit" / "dist"
HOSTING_CONFIG = REPO_ROOT / "firebase.westayfit.json"
DYNAMIC_MARKER = "__dynamic"

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


BRACKET_SEGMENT = re.compile(r"^\[[^/\[\]]+\]$")


def alias_parts(rel: Path) -> tuple[str, ...] | None:
    """Return the alias path parts for `rel`, or None if no `[param]` segment.

    Directory segments matching `[…]` collapse to `__dynamic`. A filename
    whose stem matches `[…]` collapses to `__dynamic.html`.
    """
    parts = rel.parts
    new_parts: list[str] = []
    changed = False
    for i, part in enumerate(parts):
        is_last = i == len(parts) - 1
        if is_last:
            stem, dot, suffix = part.rpartition(".")
            if dot and BRACKET_SEGMENT.match(stem):
                new_parts.append(f"{DYNAMIC_MARKER}.{suffix}")
                changed = True
                continue
        if BRACKET_SEGMENT.match(part):
            new_parts.append(DYNAMIC_MARKER)
            changed = True
        else:
            new_parts.append(part)
    return tuple(new_parts) if changed else None


def alias_dynamic_routes(html_files: list[Path]) -> int:
    """Copy each html whose relative path contains a `[param]` segment to a
    sibling path with those segments replaced by `__dynamic`, and verify a
    rewrite points at it. Returns a non-zero count of unrouted dynamic pages."""
    destinations = rewrite_destinations()
    unrouted = 0
    for path in html_files:
        rel = path.relative_to(DIST_ROOT)
        new_parts = alias_parts(rel)
        if new_parts is None:
            continue
        alias = DIST_ROOT.joinpath(*new_parts)
        alias.parent.mkdir(parents=True, exist_ok=True)
        alias.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        expected = "/" + alias.relative_to(DIST_ROOT).as_posix()
        status = "routed" if expected in destinations else "NO REWRITE"
        if expected not in destinations:
            unrouted += 1
        print(f"WSF dynamic route aliased: {rel.as_posix()} -> {expected}  [{status}]")

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

    # Recursive: nested routes (e.g. community/[groupId]/challenge.html) are
    # pages too, and this site is required to be noindex on every page it
    # serves. Exclude any prior-run aliases so re-runs don't cascade.
    def _is_alias(rel: Path) -> bool:
        return any(part == DYNAMIC_MARKER or part == f"{DYNAMIC_MARKER}.html" for part in rel.parts)

    html_files = sorted(
        p for p in DIST_ROOT.rglob("*.html") if not _is_alias(p.relative_to(DIST_ROOT))
    )
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
