/**
 * THE GEOMETRY CONTRACT FOR THE MEMBER SHELL.
 *
 * WHY A CONTRACT AND NOT FOUR PAGE STYLESHEETS. The owner reported that "the
 * top composition jumps between routes". That was not an impression; it was
 * four different numbers, measured on the real routes before this change:
 *
 *   Home        kit.page paddingTop 16 + kit.chrome minHeight 44, centred in a
 *               640 column at paddingHorizontal 20; wordmark navy h22, and the
 *               only one that was not a link home.
 *   Community   page paddingTop 10 + a 44-high wordmark row, full width at
 *               paddingHorizontal 18; wordmark navy h22.
 *   Progress    the same as Community.
 *   You         a full-bleed NAVY card, paddingTop 26 / paddingBottom 22, 30px
 *               bottom corners and a hero shadow; wordmark WHITE h17.
 *   MOVE        no wordmark at all.
 *
 * Five routes, five compositions, because each one drew its own header. These
 * constants are the single answer, read by `MemberTopBar` and by the tab
 * layout, so "the same bar in the same place" is a property of the shell
 * rather than something four stylesheets happen to agree on until one drifts.
 */

/**
 * The bar's own height, ABOVE the device's safe-area top inset. The inset is
 * added at render time, exactly as the bottom bar already adds its own: the
 * notch belongs to the device, not to the bar, and a number baked in for "a
 * modern phone" is wrong on every phone that is not that one.
 *
 * 52 is the 44pt minimum touch target for the two controls plus 4 above and
 * below — comfortably tappable, still compact enough to read as native chrome
 * rather than a web header.
 */
export const MEMBER_TOP_BAR_BODY = 52;

/**
 * The distance from the bar's hairline to the first pixel of page content,
 * identical on every tab. This is the number that stops the page title jumping
 * vertically when a member switches tabs.
 */
export const MEMBER_FIRST_CONTENT = 14;
