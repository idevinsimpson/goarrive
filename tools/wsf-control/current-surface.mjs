#!/usr/bin/env node
/**
 * Build the snapshot's `currentSurface` entry from the CURRENT comment exactly as
 * fetched from GitHub. This is how the program-director skill produces that
 * part of the snapshot; it is never written by hand.
 *
 *   node tools/wsf-control/current-surface.mjs <commentId> <body file>   # the fetched comment body
 *   node tools/wsf-control/current-surface.mjs <commentId> --missing     # the comment does not exist
 *
 * Prints { commentId, exists, markerHead, bodySha256 } as JSON. markerHead is
 * read from the body's first line (null when there is no control marker), and
 * bodySha256 is the SHA-256 of the exact body with CRLF normalised to LF (a
 * comment store may add carriage returns; nothing else is normalised).
 * Reconcile then accepts the surface only when that hash is a rendering this
 * ledger produced; anything else is an exception.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './schema.mjs';
import { MARKER } from './render-current.mjs';

/** The snapshot entry for a CURRENT comment whose fetched body is `body` (null: the comment is missing). */
export function surfaceEvidence(commentId, body) {
  if (body === null || body === undefined) return { commentId, exists: false, markerHead: null, bodySha256: null };
  const text = String(body).replace(/\r\n/g, '\n');
  const m = MARKER.exec(text);
  return { commentId, exists: true, markerHead: m ? m[1] : null, bodySha256: sha256(text) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [id, file] = process.argv.slice(2);
  const commentId = Number(id);
  if (!Number.isInteger(commentId) || commentId < 1 || !file) {
    console.error('usage: current-surface.mjs <commentId> <body file> | --missing');
    process.exit(2);
  }
  let body = null;
  if (file !== '--missing') {
    try { body = fs.readFileSync(file, 'utf8'); } catch { console.error(`::error::cannot read ${file}`); process.exit(2); }
  }
  process.stdout.write(`${JSON.stringify(surfaceEvidence(commentId, body))}\n`);
}
