#!/usr/bin/env python3
"""Inject the WSF HTML head into every page under apps/westayfit/dist.

WHAT THIS EMITS, and why it is a build step rather than app code.
The web app is a STATIC export: every route is a pre-rendered shell whose
<head> is written once, at build time. A link unfurler (iMessage, Slack,
WhatsApp, Facebook, X) never runs the bundle, so anything it is going to show
has to be in that shell. Until now the shell carried a title, a description
and `robots`, and a shared link therefore unfurled as a bare URL.

So this now emits a complete GLOBAL share identity on EVERY exported page:

  - <title> and <meta name="description">, per exported route (a small static
    table below). Nothing here is community, goal or member specific: this is
    the site-wide fallback tier. Route-specific share metadata (this
    community, this goal) needs a server that can look the route up, and is
    deliberately NOT here.
  - Open Graph: og:type, og:site_name, og:title, og:description, og:url,
    og:image (+ width, height, alt).
  - Twitter: summary_large_image, title, description, image.
  - theme-color, the icon / apple-touch-icon links and the web manifest link.
  - <link rel="canonical">.
  - <meta name="robots" content="noindex,nofollow">, unchanged. This site is
    not indexed; canonical and Open Graph are for share cards, not for search.

THE ORIGIN IS REQUIRED AND IS NEVER GUESSED. og:image must be an absolute
https URL — a relative one is simply dropped by every unfurler — and an
absolute URL needs the origin the artifact will be served from, which the
build cannot infer from the filesystem. It is resolved, in order, from:

  1. EXPO_PUBLIC_WSF_PUBLIC_ORIGIN — the origin this artifact is built for.
  2. The staging origin, when this is a staging build. A staging build is
     recognised exactly as src/stagingEnv.ts recognises one
     (EXPO_PUBLIC_WSF_ENV == "staging"), and its origin is derived from
     EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN, which stagingEnv.ts already
     requires to be "<EXPO_PUBLIC_WSF_STAGING_PROJECT_ID>.firebaseapp.com" —
     a Firebase Hosting origin for that project.
  3. Nothing. The build FAILS with the message below.

It fails rather than falling back to a default because a wrong absolute origin
in share metadata is worse than none: it points every share card, and every
canonical link, at somebody else's deployment.

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
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# The export directory. Overridable so the unit test can run this script over a
# fixture tree; the build never sets it.
DIST_ROOT = Path(os.environ.get("WSF_META_DIST_ROOT") or (REPO_ROOT / "apps" / "westayfit" / "dist"))

HOSTING_CONFIG = REPO_ROOT / "firebase.westayfit.json"
DYNAMIC_MARKER = "__dynamic"

# ---------------------------------------------------------------- brand facts

SITE_NAME = "WE STAY FIT"
TAGLINE = "Turn your community into a place that moves."
THEME_COLOR = "#0B1F3A"

SHARE_IMAGE_PATH = "/og/wsf-share.png"
SHARE_IMAGE_WIDTH = "1200"
SHARE_IMAGE_HEIGHT = "630"
SHARE_IMAGE_ALT = f"{SITE_NAME} — {TAGLINE}"

ICON_32 = "/icons/favicon-32.png"
ICON_512 = "/icons/icon-512.png"
APPLE_TOUCH_ICON = "/icons/apple-touch-icon-180.png"
MANIFEST_PATH = "/manifest.webmanifest"

ROBOTS = "noindex,nofollow"

# Staging designation. A staging card must never be mistaken for the product.
STAGING_TITLE_SUFFIX = " (staging)"
STAGING_DESCRIPTION_PREFIX = "Staging — test data. "

# ------------------------------------------------------------- per-route copy
#
# Keyed by the first path segment of the exported page. `""` is the Home page
# and is also the fallback for every route not named here. A route may give a
# title only, in which case it inherits Home's description.

HOME_TITLE = SITE_NAME
HOME_DESCRIPTION = "Shared challenges. More movement. Stronger communities."

ROUTE_META: dict[str, tuple[str, str | None]] = {
    "": (HOME_TITLE, HOME_DESCRIPTION),
    "join": (
        f"Join a community | {SITE_NAME}",
        f"Join a {SITE_NAME} community and move toward a shared goal.",
    ),
    "display": (
        f"Community goal | {SITE_NAME}",
        f"A community's shared progress on {SITE_NAME}.",
    ),
    "contribute": (f"Add your part | {SITE_NAME}", None),
    "kiosk": (f"Kiosk | {SITE_NAME}", None),
    # The expo routes. Titles only, and deliberately generic: a station, an
    # event chooser, a turn and a follow-along say nothing about which
    # community or which person is in front of the screen.
    "station": (f"Station | {SITE_NAME}", None),
    "event": (f"At the event | {SITE_NAME}", None),
    "queue": (f"Your turn | {SITE_NAME}", None),
    "move": (f"Follow along | {SITE_NAME}", None),
    "combined": (f"Combined goal | {SITE_NAME}", None),
}

# ------------------------------------------------------------------- failures


class MetaConfigError(Exception):
    """A build-stopping configuration problem, reported without a traceback."""


ORIGIN_HELP = (
    "WSF SHARE METADATA REFUSED — this build has no public origin.\n"
    "  Every exported page carries og:image, og:url and a canonical link, and\n"
    "  og:image must be an ABSOLUTE https URL or no unfurler will fetch it.\n"
    "  The origin cannot be inferred from the export, and is never guessed.\n"
    "\n"
    "  Set the origin this artifact is built for, e.g.\n"
    "    EXPO_PUBLIC_WSF_PUBLIC_ORIGIN=https://westayfit-app.web.app npm run build:web\n"
    "\n"
    "  A staging build (EXPO_PUBLIC_WSF_ENV=staging) instead takes its origin\n"
    "  from EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN."
)


# -------------------------------------------------------------------- origin


def _clean(value: str | None) -> str:
    """Trim like src/stagingEnv.ts's clean(), so both agree on ' staging '."""
    return value.strip() if isinstance(value, str) else ""


def is_staging_build(env: dict[str, str]) -> bool:
    """A staging build, recognised exactly as src/stagingEnv.ts recognises one."""
    return _clean(env.get("EXPO_PUBLIC_WSF_ENV")) == "staging"


HOSTNAME = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")


def _validated_origin(raw: str, source: str) -> str:
    """An https origin with no path, no query and no trailing slash."""
    origin = _clean(raw).rstrip("/")
    if not origin.startswith("https://"):
        raise MetaConfigError(
            f"{source} is {raw!r}, which is not an https origin.\n"
            f"  Share images and canonical links are fetched by third parties over https only."
        )
    host = origin[len("https://") :]
    if not HOSTNAME.match(host.lower()):
        raise MetaConfigError(
            f"{source} is {raw!r}. Expected a bare origin such as\n"
            f"  https://westayfit-app.web.app — scheme and host only, no path, port or query."
        )
    return origin


def resolve_origin(env: dict[str, str]) -> str:
    """The absolute https origin this artifact is built for. Never guessed."""
    explicit = _clean(env.get("EXPO_PUBLIC_WSF_PUBLIC_ORIGIN"))
    if explicit:
        return _validated_origin(explicit, "EXPO_PUBLIC_WSF_PUBLIC_ORIGIN")

    # The channel this artifact is actually served from. A Hosting preview
    # channel is NOT reachable at the Auth domain: authDomain identifies the
    # Firebase Auth handler, and deriving the site origin from it advertised
    # https://<project>.firebaseapp.com while the build was served from
    # https://<site>--<channel>-<hash>.web.app, so every og:image and canonical
    # pointed at a 404. The deploy workflow already exports the real channel
    # URL, so read it rather than inferring a host.
    channel = _clean(env.get("WSF_PUBLIC_CHANNEL_ORIGIN")) or _clean(env.get("STAGING_URL"))
    if channel:
        return _validated_origin(channel, "STAGING_URL (the deployed channel origin)")

    if is_staging_build(env):
        auth_domain = _clean(env.get("EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN"))
        project_id = _clean(env.get("EXPO_PUBLIC_WSF_STAGING_PROJECT_ID"))
        if not auth_domain:
            raise MetaConfigError(
                "EXPO_PUBLIC_WSF_ENV=staging but EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN is not set,\n"
                "  so this staging build has no origin to put in its share metadata.\n"
                "  Set EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN (or EXPO_PUBLIC_WSF_PUBLIC_ORIGIN\n"
                "  when the staging artifact is served from a different host)."
            )
        if project_id and auth_domain.lower() != f"{project_id.lower()}.firebaseapp.com":
            raise MetaConfigError(
                f"EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN is {auth_domain!r} but "
                f"EXPO_PUBLIC_WSF_STAGING_PROJECT_ID is {project_id!r}.\n"
                f"  Those name two different projects, so neither can be trusted as the\n"
                f"  staging origin. src/stagingEnv.ts refuses the same disagreement."
            )
        if "goarrive" in auth_domain.lower() or auth_domain.lower().startswith("413741232388."):
            raise MetaConfigError(
                f"EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN is {auth_domain!r}, which names the\n"
                f"  PRODUCTION project. A staging build may not advertise production's origin."
            )
        # Last resort for a staging build that carries no channel origin: the
        # project's default Hosting site, which does serve at this host.
        return _validated_origin(f"https://{auth_domain}", "EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN")

    declared = _declared_hosting_origin()
    if declared:
        return declared

    raise MetaConfigError(ORIGIN_HELP)


def _declared_hosting_origin() -> str | None:
    """The origin this repository itself says the artifact is deployed to.

    Not a guess and not a default: firebase.westayfit.json names the Hosting
    site this dist is published to, so `https://<site>.web.app` is the address
    an ordinary `npm run build:web` artifact is actually served from. An
    explicit EXPO_PUBLIC_WSF_PUBLIC_ORIGIN still wins, and a staging build has
    already been answered above, so this only covers the plain build every
    local gate, capture run and `scripts/westayfit/gate1.sh` performs.
    """
    try:
        config = json.loads(HOSTING_CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    hosting = config.get("hosting")
    entries = hosting if isinstance(hosting, list) else [hosting]
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        site = _clean(entry.get("site"))
        if site:
            return _validated_origin(f"https://{site}.web.app", "firebase.westayfit.json hosting.site")
    return None


# --------------------------------------------------------------- route lookup

BRACKET_SEGMENT = re.compile(r"^\[[^/\[\]]+\]$")
# An Expo Router route GROUP: `(tabs)`, `(home)`. A group contributes nothing to
# the URL, but the static export writes every route at every combination of
# including and excluding its group segments, so `(tabs)/(home)/community/
# [groupId].html` appears beside the `community/[groupId].html` the router
# actually serves. Those copies are addresses with literal parentheses that no
# navigation ever produces; demanding a Hosting rewrite for each one would fail
# every build that has a route group (W9's migration, 5791038123 B.2).
GROUP_SEGMENT = re.compile(r"^\([^/()]+\)$")


def has_group_segment(rel: Path) -> bool:
    """True when any directory segment of `rel` is a route group `(name)`."""
    return any(GROUP_SEGMENT.match(part) for part in rel.parts[:-1])


def _is_dynamic(rel: Path) -> bool:
    for i, part in enumerate(rel.parts):
        if i == len(rel.parts) - 1:
            stem, dot, _ = part.rpartition(".")
            if dot and BRACKET_SEGMENT.match(stem):
                return True
        if BRACKET_SEGMENT.match(part):
            return True
    return False


def route_key(rel: Path) -> str:
    """The first path segment, which is what the copy table is keyed by."""
    parts = rel.parts
    return parts[0] if len(parts) > 1 else ""


def route_path(rel: Path) -> str:
    """The path component of this page's canonical URL.

    A page exported for a DYNAMIC route (`join/[joinCode].html`) is one file
    serving many URLs, and this tier of metadata has no route data with which
    to name one of them — naming the template (`/join/[joinCode]`) or its
    hosting alias (`/join/__dynamic`) would put an internal artifact in front
    of a person. Such a page canonicalises to the site root, which is exactly
    as specific as its (global, route-independent) content.
    """
    if _is_dynamic(rel):
        return "/"
    stem = rel.as_posix()
    stem = stem[: -len(".html")] if stem.endswith(".html") else stem
    if stem == "index":
        return "/"
    if stem.endswith("/index"):
        stem = stem[: -len("/index")]
    # Expo's own special pages (`+not-found`, `+html`) are not addressable routes.
    if Path(stem).name.startswith("+"):
        return "/"
    return "/" + stem


def meta_for(rel: Path, staging: bool) -> tuple[str, str]:
    title, description = ROUTE_META.get(route_key(rel), ROUTE_META[""])
    if description is None:
        description = HOME_DESCRIPTION
    if staging:
        title = f"{title}{STAGING_TITLE_SUFFIX}"
        description = f"{STAGING_DESCRIPTION_PREFIX}{description}"
    return title, description


# ------------------------------------------------------------------ injection


def attr(value: str) -> str:
    """Escape for a double-quoted HTML attribute."""
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def head_block(rel: Path, origin: str, staging: bool) -> str:
    title, description = meta_for(rel, staging)
    url = origin + route_path(rel)
    image = origin + SHARE_IMAGE_PATH
    tags = [
        f"<title>{attr(title)}</title>",
        f'<meta name="description" content="{attr(description)}">',
        f'<meta name="robots" content="{ROBOTS}">',
        f'<link rel="canonical" href="{attr(url)}">',
        f'<meta name="theme-color" content="{THEME_COLOR}">',
        f'<link rel="icon" type="image/png" sizes="32x32" href="{ICON_32}">',
        f'<link rel="icon" type="image/png" sizes="512x512" href="{ICON_512}">',
        f'<link rel="apple-touch-icon" sizes="180x180" href="{APPLE_TOUCH_ICON}">',
        f'<link rel="manifest" href="{MANIFEST_PATH}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:site_name" content="{attr(SITE_NAME)}">',
        f'<meta property="og:title" content="{attr(title)}">',
        f'<meta property="og:description" content="{attr(description)}">',
        f'<meta property="og:url" content="{attr(url)}">',
        f'<meta property="og:image" content="{attr(image)}">',
        f'<meta property="og:image:width" content="{SHARE_IMAGE_WIDTH}">',
        f'<meta property="og:image:height" content="{SHARE_IMAGE_HEIGHT}">',
        f'<meta property="og:image:alt" content="{attr(SHARE_IMAGE_ALT)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{attr(title)}">',
        f'<meta name="twitter:description" content="{attr(description)}">',
        f'<meta name="twitter:image" content="{attr(image)}">',
    ]
    # Each tag carries its own leading newline+indent, and the block adds no
    # trailing whitespace, so removing the block gives back exactly the input:
    # re-running this script over an already-injected export is a no-op.
    return "".join(f"\n    {t}" for t in tags)


# Everything this script owns, removed wherever it already appears so a rebuild
# (or a tag Expo emitted from app.json) cannot leave a duplicate behind.
MANAGED_META = re.compile(
    r'(?:\r?\n[ \t]*)?'
    r'<meta\s+[^>]*(?:name|property)\s*=\s*"'
    r'(?:description|robots|theme-color|og:[A-Za-z0-9:_-]+|twitter:[A-Za-z0-9:_-]+)"[^>]*>',
    re.IGNORECASE,
)
MANAGED_LINK = re.compile(
    r'(?:\r?\n[ \t]*)?'
    r'<link\s+[^>]*rel\s*=\s*"(?:canonical|icon|shortcut icon|apple-touch-icon|manifest)"[^>]*>',
    re.IGNORECASE,
)
# Expo's own renderer emits an empty `<title data-rh="true">` that react-helmet
# owns at runtime. It is left alone; ours is inserted ahead of it, and the first
# title in the document is the one the browser and every crawler use.
OWNED_TITLE = re.compile(r'(?:\r?\n[ \t]*)?<title(?![^>]*data-rh)[^>]*>.*?</title>', re.IGNORECASE | re.DOTALL)
HEAD_OPEN = re.compile(r"<head[^>]*>", re.IGNORECASE)


def inject(html: str, rel: Path, origin: str, staging: bool) -> str:
    html = OWNED_TITLE.sub("", html)
    html = MANAGED_META.sub("", html)
    html = MANAGED_LINK.sub("", html)

    block = head_block(rel, origin, staging)
    match = HEAD_OPEN.search(html)
    if not match:
        raise MetaConfigError(
            f"{rel.as_posix()} has no <head> element, so no share metadata could be injected."
        )
    return html[: match.end()] + block + html[match.end() :]


# -------------------------------------------------------- dynamic route alias


def rewrite_destinations() -> set[str]:
    """Every `destination` declared in the WSF hosting config."""
    config = json.loads(HOSTING_CONFIG.read_text(encoding="utf-8"))
    rewrites = config.get("hosting", {}).get("rewrites", []) or []
    return {r["destination"] for r in rewrites if "destination" in r}


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
        if has_group_segment(rel):
            # The same page is also exported at the group-free path, which is
            # the one aliased and checked above or below; this copy is never
            # served under this address.
            print(f"WSF dynamic route skipped: {rel.as_posix()}  [route-group export duplicate]")
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


# ------------------------------------------------------------------- entry


def main() -> int:
    if not DIST_ROOT.exists():
        print(f"ERROR: {DIST_ROOT} does not exist. Run `npm run build:web` first.", file=sys.stderr)
        return 1

    env = dict(os.environ)
    try:
        origin = resolve_origin(env)
    except MetaConfigError as err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 1
    staging = is_staging_build(env)

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

    try:
        for path in html_files:
            rel = path.relative_to(DIST_ROOT)
            path.write_text(
                inject(path.read_text(encoding="utf-8"), rel, origin, staging), encoding="utf-8"
            )
            title, _ = meta_for(rel, staging)
            print(f"WSF meta injected into {rel.as_posix()}  [{title}]")
    except MetaConfigError as err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 1

    print(f"  origin: {origin}{'  (staging)' if staging else ''}")
    print(f"  share image: {origin}{SHARE_IMAGE_PATH} ({SHARE_IMAGE_WIDTH}x{SHARE_IMAGE_HEIGHT})")
    print(f"  robots: {ROBOTS}")
    print(f"  pages: {len(html_files)}")

    # Aliases are copies of already-injected pages, so they inherit the meta.
    return 1 if alias_dynamic_routes(html_files) else 0


if __name__ == "__main__":
    sys.exit(main())
