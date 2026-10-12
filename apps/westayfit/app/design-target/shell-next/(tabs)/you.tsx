import { ShellNextPage } from '../../../../src/ui/shellNext/ShellNextPage';

/**
 * Stands for production `/you`.
 *
 * THE ONE THING THIS FRAME IS ACTUALLY SHOWING is that You now starts where
 * the other three tabs start. In the shipping build this route opens with a
 * full-bleed NAVY card — paddingTop 26, 30px bottom corners, a hero shadow and
 * a WHITE 17px wordmark — so the top of the app changes colour, height and
 * wordmark treatment the moment a member reaches this tab. Here it is the same
 * cream bar at the same height with the same navy wordmark, and the identity
 * belongs to the page beneath it.
 *
 * The identity CONTENT is W8's, not W9's. Nothing about what You contains is
 * proposed here.
 */
export default function ShellNextYou() {
  return (
    <ShellNextPage
      id="you"
      title="You"
      lede="Stands in for the real You page. Identity content belongs to W8; only the chrome is proposed here."
    />
  );
}
