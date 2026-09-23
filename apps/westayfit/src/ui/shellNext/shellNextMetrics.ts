import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from '../MemberTabBar';

/**
 * THE GEOMETRY CONTRACT FOR THE PROPOSED MEMBER SHELL.
 *
 * PROTOTYPE ONLY. Nothing here is wired into a production route.
 *
 * WHY A CONTRACT AND NOT FOUR PAGE STYLESHEETS. The owner's finding was that
 * "the top composition jumps between routes". That is not an impression; it is
 * four different numbers, measured in the build at the start SHA:
 *
 *   Home        kit.page paddingTop 16 + kit.chrome minHeight 44, centred in a
 *               640-wide column at paddingHorizontal 20; wordmark navy h22,
 *               NOT tappable.
 *   Community   page paddingTop 10 + wordmarkTap minHeight 44, full width at
 *               paddingHorizontal 18; wordmark navy h22, tappable.
 *   Progress    page paddingTop 10 + wordmarkTap minHeight 44, full width at
 *               paddingHorizontal 18; wordmark navy h22, tappable.
 *   You         a full-bleed NAVY card, paddingTop 26 / paddingBottom 22, with
 *               30px bottom corners and a hero shadow; wordmark WHITE h17.
 *   MOVE        no wordmark at all.
 *
 * So the top of the app is 16+44, 10+44, 10+44, 26, and nothing — in a cream
 * column, two full-width cream pages, a navy card, and a bare screen. Five
 * routes, five compositions. A member moving between tabs is not watching one
 * app settle; they are watching five pages replace one another.
 *
 * These constants are the single answer. They are read by the prototype's top
 * bar and by every prototype page, so "same exact height and position" is a
 * property of the shell rather than a thing four stylesheets happen to agree
 * on and drift out of later.
 */

/**
 * The top bar's own height, ABOVE the device's safe-area top inset. The inset
 * is added by the bar at render time, exactly as the bottom bar already adds
 * its own: the notch is a property of the device, not of the bar, and baking a
 * number for "a modern phone" is wrong on every phone that is not that one.
 *
 * 52 is the 44pt minimum touch target for the two controls plus 4 above and
 * below, so the wordmark and the menu are both comfortably tappable and the
 * bar is still compact enough to read as native chrome rather than a web
 * header.
 */
export const SHELL_TOP_BAR_BODY = 52;

/**
 * The distance from the top bar's hairline to the first pixel of page content,
 * identical on every tab. This is the number that stops the page title jumping
 * vertically when a member switches tabs: the title is the first content on
 * every tab, and every tab's content starts here.
 */
export const SHELL_FIRST_CONTENT = 14;

/**
 * The horizontal page gutter. 18 rather than Home's 20, because three of the
 * four current destinations already use 18 and the fourth is the odd one out.
 */
export const SHELL_PAGE_GUTTER = 18;

/**
 * The reading column. Home already centres its content in a 640-wide column;
 * the other three run full-bleed. Keeping the column means the shell still
 * behaves on a tablet or a desktop browser, and at 390 wide — every viewport
 * in this packet's evidence — it is a no-op, because 390 minus two 18px
 * gutters is 354 and the column never binds.
 */
export const SHELL_COLUMN_MAX = 640;

/**
 * THE BOTTOM FOOTPRINT IS NOT REDEFINED HERE. It is imported from the shipping
 * bar, so "one bottom-bar footprint across member tabs" is provable rather
 * than asserted: if the production numbers move, the prototype moves with
 * them and any capture taken from it is still honest.
 */
export const SHELL_BOTTOM_BAR_BODY = MEMBER_TAB_BAR_BODY;
export const SHELL_MOVE_OVERHANG = MEMBER_TAB_MOVE_OVERHANG;

/**
 * What the bottom bar occludes, for a page that wants its last control to stay
 * reachable. The caller adds the live safe-area bottom inset.
 */
export const SHELL_BOTTOM_INSET = SHELL_BOTTOM_BAR_BODY + SHELL_MOVE_OVERHANG;
