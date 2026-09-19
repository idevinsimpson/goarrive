/**
 * The brand assets the app loads. Every file here is a documented derivative
 * of an owner-supplied original — see assets/brand/README.md. Sizes are the
 * derived files' pixel sizes, used to keep the artwork's proportions exact.
 */
export const wordmarkNavyGreen = {
  source: require('../../assets/brand/derived/wordmark-navy-green.png') as number,
  width: 1200,
  height: 161,
};
export const wordmarkWhiteGreen = {
  source: require('../../assets/brand/derived/wordmark-white-green.png') as number,
  width: 1200,
  height: 165,
};
export const monogramFillGreen = require('../../assets/brand/derived/monogram-fill-green.png') as number;
/** Unfilled WE on light surfaces: brand navy, the owner's navy colourway. */
export const monogramUnfilledNavy =
  require('../../assets/brand/derived/monogram-unfilled-navy.png') as number;
/** Unfilled WE on the navy surface: white, the owner's white colourway. */
export const monogramUnfilledWhite =
  require('../../assets/brand/derived/monogram-unfilled-white.png') as number;

/** Owner-selected confirmed-progress green. */
export const PROGRESS_GREEN = '#91CB7D';
