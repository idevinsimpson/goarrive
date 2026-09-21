# Posting visual evidence to the PR

The visual gate is decided on pixels, so a checkpoint whose images do not
render is a checkpoint that did not happen. This is what actually works, found
the hard way.

## There is no attachment upload

GitHub's REST API has **no endpoint for uploading an image attachment to a
comment**. That is a browser-only flow: the web editor posts to a private
upload endpoint and rewrites the markdown. Anything working through the API
cannot produce a `user-images.githubusercontent.com` attachment. Say so plainly
rather than going quiet, then use the fallback below.

## The fallback: raw URLs pinned to the commit SHA

This repository is public, so `raw.githubusercontent.com` serves committed
bytes anonymously and GitHub's image proxy can fetch them. Pin to the **commit
SHA**, never the branch, so the image cannot drift as work continues:

```
https://raw.githubusercontent.com/idevinsimpson/goarrive/<SHA>/<path>
```

Check each one before posting:

```
curl -s -o /dev/null -w "%{http_code}\n" "<url>"
```

## Two traps, both of which cost a review round

**1 · Creating a comment mangles image URLs. Editing does not.**

Posting a new comment injects backticks inside the link, in both syntaxes:

```
![alt](``https://…png)``                     <- markdown, renders blank
<img src="``https://…png"&gt;``               <- HTML, renders blank
```

Editing the same comment with the identical body stores it correctly. So:
**post, then immediately re-read the stored body, and repair by edit if the
URLs came back wrapped.** Use `<img>` rather than markdown — it survives the
edit cleanly and takes a `width` — but the edit-after-post is the part that
actually fixes it.

**2 · A 200 from the URL is not evidence the image renders.**

Fetching the URL proves the bytes are reachable. It proves nothing about the
markup that was stored. Both checks are required, and the second is the one
that was skipped three times running: the URL was verified, the format was
verified on an *edited* comment, and that was wrongly generalised to a *new*
one. **Verify the artifact you actually shipped — the stored comment body.**

## What a checkpoint carries

- The contact sheet inline, and the 2–4 frames most likely to drive the
  decision.
- The exact repository path printed under each image, so the committed PNG
  stays the durable source of truth.
- Never prose in place of the images, and never a request for a human to relay
  them.
