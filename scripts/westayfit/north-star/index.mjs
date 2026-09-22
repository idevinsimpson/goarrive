/**
 * INDEX — a contact sheet of the canonical North Star package.
 *
 * Real thumbnails of every board that exists, in order, and a restrained
 * labelled PENDING slot for every board that does not. It is navigation, not
 * a substitute for opening the full board, and it never shows a fabricated
 * screenshot: a slot is either the board's own PNG or the word PENDING.
 *
 * Which boards exist is read from disk at render time, so this sheet cannot
 * claim a board the directory does not hold.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, header, footer, page, pngSize, NAVY, CREAM, INK_QUIET, TEXT_MUTED, HAIRLINE, PROGRESS_GREEN, SURFACE } from './lib.mjs';

const ROOT = path.join(REPO, 'docs/design-target/north-star-final');

const BOARDS = [
  ['00', 'Brand foundation'], ['01', 'Home'], ['02', 'MOVE'], ['03', 'Community'],
  ['04', 'Progress'], ['05', 'You'], ['06', 'Create / join / auth'], ['07', 'Champion management'],
  ['08', 'Goal setup'], ['09', 'Lifecycle / history'], ['10', 'Public display family'], ['11', 'Single-goal kiosk'],
  ['12', '—'], ['13', '—'], ['14', '—'], ['15', '—'], ['16', '—'], ['17', '—'],
];

/** The board's rendered PNG, if its directory holds one named for it. */
function boardPng(num) {
  const dir = path.join(ROOT, `board-${num}`);
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((n) => n.startsWith(`WE_STAY_FIT_NORTH_STAR_BOARD_${num}_`) && n.endsWith('.png'));
  return f ? path.join(dir, f) : null;
}

/*
   THE STATUS COMES FROM THE MANIFEST, NEVER FROM THE FILENAME.

   `_FINAL` in a filename is the lock verdict's canonical name for the
   artifact, not an acceptance status -- the manifest says so in three places,
   and W2's audit (D-IX.1) caught this sheet printing FINAL for five boards the
   manifest lists as SELF-CHECKED with independent review pending. The word
   under each thumbnail is now read from the manifest's status column at
   render time, so the two cannot disagree; a board with a PNG but no manifest
   row says so rather than borrowing a word.
*/
const MANIFEST = path.join(ROOT, 'README.md');
function manifestStatus(num) {
  const rows = readFileSync(MANIFEST, 'utf8').split('\n');
  const row = rows.find((l) => l.startsWith(`| ${num} |`));
  if (!row) return 'NOT IN MANIFEST';
  const cells = row.split('|').map((c) => c.trim());
  // | # | Title | Status | ...
  // The manifest cites the verdict comment in parentheses; the contact sheet
  // has room for the status, not the citation.
  return (cells[3] || 'NOT IN MANIFEST').replace(/\*\*/g, '').replace(/\s*\([^)]*\)/g, '').trim();
}

const CELL_W = 176;
const THUMB_H = 200;

function cell([num, title]) {
  const png = boardPng(num);
  const status = png ? manifestStatus(num) : 'PENDING';
  let thumb;
  if (png) {
    const { w, h } = pngSize(png);
    // Fit inside the thumb box, anchored top — a board is read from the top.
    const scale = Math.min(CELL_W / w, THUMB_H / h);
    thumb = `<div class="thumb"><img src="${pathToFileURL(png).href}" style="width:${Math.round(w * scale)}px;height:${Math.round(h * scale)}px" alt=""></div>`;
  } else {
    thumb = `<div class="thumb pending"><span>PENDING</span></div>`;
  }
  return `<div class="cell">
    ${thumb}
    <div class="num">BOARD ${num}</div>
    <div class="ttl">${title}</div>
    <div class="st ${status === 'PENDING' ? 'p' : /REVIEWED|ACCEPTED/.test(status) ? 'f' : 'r'}">${status}</div>
  </div>`;
}

export const width = 1280;
export const height = 1180;

export const html = page({
  width,
  height,
  body: `
  <style>
    .grid { display: grid; grid-template-columns: repeat(6, ${CELL_W}px); gap: 22px 24px; justify-content: space-between }
    .cell { display: flex; flex-direction: column; gap: 5px }
    .thumb { height: ${THUMB_H}px; background: ${SURFACE}; border: 1px solid ${HAIRLINE}; border-radius: 10px; overflow: hidden;
             display: flex; align-items: flex-start; justify-content: center }
    .thumb img { display: block }
    .thumb.pending { align-items: center; border-style: dashed; background: transparent }
    .thumb.pending span { font-size: 11px; letter-spacing: 1.4px; font-weight: 900; color: ${INK_QUIET} }
    .num { font-size: 10px; letter-spacing: 1.3px; font-weight: 900; color: ${INK_QUIET}; margin-top: 4px }
    .ttl { font-size: 14px; line-height: 18px; font-weight: 800; color: ${NAVY} }
    .st { font-size: 10px; letter-spacing: 1.2px; font-weight: 900 }
    .st.f { color: ${PROGRESS_GREEN} } .st.r { color: ${NAVY} } .st.p { color: ${INK_QUIET} }
    .intro { font-size: 13px; line-height: 18px; color: ${TEXT_MUTED}; max-width: 760px }
  </style>
  ${header('INDEX', 'The canonical package')}
  <div class="copy">
    <div class="lead">Eighteen boards. Ten exist. None is a placeholder presented as final.</div>
    <div class="gov">NAVIGATION ONLY — OPEN THE FULL BOARD BEFORE EDITING PRODUCT UI.</div>
  </div>
  <p class="intro">Each thumbnail is the board's own rendered PNG, read from <b style="color:${NAVY}">docs/design-target/north-star-final/</b> at render time. A slot is a real board or the word PENDING — nothing in between. Boards 00–11 are locked in review; 12–17 are not started.</p>
  <div class="grid">${BOARDS.map(cell).join('')}</div>
  ${footer('WE_STAY_FIT_NORTH_STAR_INDEX', 'rendered from the package directory · a board appears here only once its PNG exists')}
  `,
});
