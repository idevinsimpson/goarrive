/**
 * Shared pieces for the North Star board modules: the locked palette (Board
 * 00), the board chrome, and a phone frame that composites a REAL capture at
 * a stated width. Nothing here draws a screen; a board module names which
 * capture goes where and quotes its lock.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
const BRAND = path.join(REPO, 'apps/westayfit/assets/brand/derived');

export const asset = (f) => pathToFileURL(path.join(BRAND, f)).href;

/* ── locked palette (Board 00) ───────────────────────────────────────────── */
export const NAVY = '#0B1F3A';
export const CREAM = '#F7F5F0';
export const SURFACE = '#FFFFFF';
export const PROGRESS_GREEN = '#91CB7D';
export const ACTION_GREEN = '#22C55E';
export const INK_QUIET = '#6B7C93';
export const TEXT_MUTED = '#5A6B85';
export const HAIRLINE = '#E6E2DA';
export const ON_NAVY_MUTED = 'rgba(247,245,240,0.76)';
export const ON_NAVY_RULE = 'rgba(247,245,240,0.16)';

/** Pixel size from the PNG header, so a frame is scaled by what it IS. */
export function pngSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${file}`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/**
 * A capture at a given CSS width, aspect taken from the file itself. The
 * renderer refuses the board if the file does not load, so a wrong path is a
 * failed render rather than a blank phone.
 */
export function frameImg(file, width) {
  const { w, h } = pngSize(file);
  const hh = Math.round((h / w) * width);
  return `<img src="${pathToFileURL(file).href}" style="width:${width}px;height:${hh}px;display:block" alt="">`;
}

/** Pixel height a capture will take at a CSS width — for fixed caption baselines. */
export function frameHeight(file, width) {
  const { w, h } = pngSize(file);
  return Math.round((h / w) * width);
}

export const PHONE_W = 268;
export const SLOT_H = Math.round((844 / 390) * PHONE_W);

/**
 * One phone: the capture in a rounded shell inside a fixed-height slot (so a
 * 390×640 frame keeps the caption baseline of the 390×844 frames beside it),
 * a provenance tag, a title and a note.
 */
export function phone({ file, title, sub, tag = 'real', tagText, width = PHONE_W, slot = SLOT_H }) {
  const tags = {
    real: ['tag real', tagText ?? 'ACCEPTED BUILD · CAPTURED'],
    fresh: ['tag real', tagText ?? 'CURRENT BUILD · CAPTURED'],
    seam: ['tag seam', tagText ?? 'SEAM · NOT SHIPPED'],
  };
  const [cls, text] = tags[tag];
  return `<div class="phone" style="width:${width}px">
    <div class="slot" style="height:${slot}px"><div class="shell">${frameImg(file, width)}</div></div>
    <div><span class="${cls}">${text}</span></div>
    <div class="cap">${title}</div>
    <div class="sub">${sub}</div>
  </div>`;
}

export function css(width, height) {
  return `
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body {
    width: ${width}px; height: ${height}px; background: ${CREAM};
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: ${NAVY}; -webkit-font-smoothing: antialiased;
  }
  .board { padding: 44px 52px 36px; display: flex; flex-direction: column; gap: 22px; height: 100% }

  .eyebrow { font-size: 11px; font-weight: 900; letter-spacing: 1.6px; color: ${PROGRESS_GREEN} }
  .eyebrow.quiet { color: ${INK_QUIET} }
  .eyebrow.seam { color: ${ACTION_GREEN} }

  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 40px }
  header img { width: 300px; display: block }
  .boardname { text-align: right }
  .boardname .n { font-size: 13px; letter-spacing: 1.4px; font-weight: 900; color: ${INK_QUIET} }
  .boardname .t { font-size: 29px; line-height: 33px; font-weight: 800 }

  .copy { display: flex; align-items: baseline; justify-content: space-between; gap: 30px; padding-bottom: 6px; border-bottom: 1px solid ${HAIRLINE} }
  .copy .lead { font-size: 27px; line-height: 33px; font-weight: 800; letter-spacing: -0.3px; white-space: nowrap }
  .copy .gov { font-size: 11px; letter-spacing: 1.2px; font-weight: 800; color: ${INK_QUIET}; text-align: right; max-width: 430px; line-height: 16px }

  .sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; margin-bottom: 10px }
  .sec-head h3 { font-size: 18px; line-height: 24px; font-weight: 800; margin-top: 4px }
  .sec-head .how { font-size: 12px; line-height: 16px; color: ${TEXT_MUTED}; max-width: 620px; text-align: right }

  .phones { display: flex; gap: 34px; align-items: flex-start }
  .phone { display: flex; flex-direction: column; gap: 9px }
  .phone .slot { display: flex; align-items: flex-start }
  .shell { border-radius: 26px; overflow: hidden; border: 1px solid ${HAIRLINE}; background: ${CREAM};
           box-shadow: 0 10px 28px rgba(11,31,58,0.10) }
  .phone .cap { font-size: 14px; line-height: 19px; font-weight: 800 }
  .phone .sub { font-size: 12px; line-height: 16px; color: ${TEXT_MUTED} }
  .tag { display: inline-block; font-size: 10px; letter-spacing: 1.2px; font-weight: 900; padding: 3px 7px; border-radius: 6px }
  .tag.real { color: ${NAVY}; background: rgba(145,203,125,0.28) }
  .tag.seam { color: ${CREAM}; background: ${ACTION_GREEN} }

  .panel { background: ${SURFACE}; border: 1px solid ${HAIRLINE}; border-radius: 18px; padding: 20px 24px 22px }
  .panel.dark { background: ${NAVY}; border-color: ${NAVY}; color: ${CREAM} }
  .panel h3 { font-size: 18px; line-height: 24px; font-weight: 800; margin-top: 8px }
  .panel p.note { font-size: 13px; line-height: 18px; color: ${TEXT_MUTED} }
  .panel.dark p.note { color: ${ON_NAVY_MUTED} }
  .panel .rules { margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px }
  .panel .rules div { font-size: 12px; line-height: 16px; color: ${TEXT_MUTED} }
  .panel .rules div::before { content: '·  '; color: ${PROGRESS_GREEN}; font-weight: 900 }
  .panel.dark .rules div { color: ${ON_NAVY_MUTED} }
  .panel .rules b { color: ${NAVY} }
  .panel.dark .rules b { color: ${CREAM} }

  .two { display: grid; grid-template-columns: 1.15fr 1fr; gap: 22px; align-items: start }
  .side { display: grid; gap: 22px; align-items: start }

  table { width: 100%; border-collapse: collapse; margin-top: 10px }
  td { padding: 5px 0; font-size: 12.5px; line-height: 17px; vertical-align: top; border-bottom: 1px solid ${HAIRLINE} }
  tr:last-child td { border-bottom: 0 }
  td.k { font-weight: 800; width: 150px; padding-right: 10px }
  td.d { color: ${TEXT_MUTED} }

  footer { margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 48px;
           font-size: 11px; letter-spacing: 0.6px; color: ${INK_QUIET} }
  footer span:first-child { white-space: nowrap }
  footer span:last-child { text-align: right; max-width: 760px; line-height: 15px }
  `;
}

export function header(num, title) {
  return `<header>
    <img src="${asset('wordmark-navy-green.png')}" alt="WE STAY FIT">
    <div class="boardname">
      <div class="n">NORTH STAR · BOARD ${num}</div>
      <div class="t">${title}</div>
    </div>
  </header>`;
}

export function footer(filename, right) {
  return `<footer><span>${filename}</span><span>${right}</span></footer>`;
}

export function page({ width, height, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>${css(width, height)}</style></head>
<body><div class="board">${body}</div></body></html>`;
}
