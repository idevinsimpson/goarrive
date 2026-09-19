import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

// react-native-web maps a `dataSet` prop to `data-*` attributes on the DOM
// element; react-native's own types omit it. Declared here the same way
// app/community/[groupId]/challenge.tsx declares it for Pressable, so the
// browser spec can read the encoded URL off the element without `as any` at
// the call site.
declare module 'react-native' {
  interface ViewProps {
    dataSet?: Record<string, string>;
  }
}

import { wsfTheme } from '../theme';
import { encodeQr, qrSvgDataUriRaw } from './qr';

/**
 * The join link as a scannable QR, for the Champion tools sheet.
 *
 * WHAT IT IS AND IS NOT. It encodes the SAME `/join/<code>` URL the Copy link
 * control puts on the clipboard — it is that string in another shape, nothing
 * more. It carries no token, no identity and no authority: a scan opens the
 * join page, and the join page still requires an account, a verified address
 * and an adult profile before `wsfJoinCommunity` will admit anyone. Rendering
 * this is therefore not a new way in; it is a faster way to type a URL that is
 * already printable, copyable and shareable from the same screen.
 *
 * A code that does not admit anyone is never drawn. The caller passes `url:
 * null` for a private community — see `buildJoinUrl` — and this renders the
 * honest sentence instead of a symbol. A QR of a link that cannot admit is a
 * flyer that sends people to a dead end.
 *
 * CLIENT-SIDE ONLY, AFTER HYDRATION. The URL is derived from
 * `window.location.origin`, which the static export does not have at build
 * time, so a symbol drawn during the first render would be drawn from a
 * different string than the one the page settles on. `mounted` holds it back
 * one commit; until then the toggle is there and the symbol is not.
 */

const QR_PIXEL_SIZE = 220;

export const JOIN_QR_COPY = {
  show: 'Show QR code',
  hide: 'Hide QR code',
  /**
   * The honest note. Two facts, both of which a Champion pointing a phone at
   * this needs before they print it: scanning is not joining, and the link
   * under the symbol is the current one, not a permanent one.
   */
  caveat:
    'Scanning opens the join page — whoever scans it still has to sign in and finish setting up an account before they can join. Reset the link above and this code stops working; show this one again for the new link.',
  /**
   * Shown in place of the symbol when the policy admits no one by link.
   * It states the enforced fact and stops there: there is no control in this
   * product that changes how people join, so the sentence must not send a
   * Champion looking for one (clause 12, and clause 9 on unsupported copy).
   */
  notJoinable:
    'This community cannot be joined from a link, so there is no invite link or QR code to share.',
  failed:
    'This link could not be turned into a QR code. The link above still works — copy or share it instead.',
} as const;

export function JoinQrCode({
  url,
  testIDPrefix = 'wsf-community-qr',
  caveat = JOIN_QR_COPY.caveat,
  showUrl = false,
}: {
  /** The join URL, or null when this community admits no one by link. */
  url: string | null;
  testIDPrefix?: string;
  /**
   * The note under the symbol. The default names the link-rotation control;
   * a surface that carries no such control passes a note that stops at what
   * scanning does, so the sentence never points at something that is not there.
   */
  caveat?: string;
  /**
   * Whether the URL is printed under the symbol.
   *
   * Contract clause 5 — invitation, not URL administration — forbids the raw
   * join URL as body copy on a member-facing surface, so the page's Invite
   * card passes `false`: Copy invite and Share invite are the ways the link
   * moves. `data-qr-url` on the symbol is unaffected either way, so a test
   * can still assert WHICH URL the symbol carries. The Champion's Manage
   * sheet, where the link is the administered object, keeps it printed.
   */
  /**
   * Print the link as selectable text under the symbol. Off by default:
   * clause 5 says the product shows Copy invite, Share invite and the QR, not
   * a raw URL as body copy, and no spec or hosted row reads the printed text
   * (they read `data-qr-url`). Left as a prop so a future surface that truly
   * needs a readable link can ask for one deliberately.
   */
  showUrl?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  /**
   * Keyed on the URL, so a join-code reset re-encodes rather than leaving the
   * old symbol on screen. That is the whole reason this derives from the URL
   * and holds no code of its own.
   */
  const encoded = useMemo(() => {
    if (!url) return null;
    try {
      return {
        // RAW markup: react-native-web's Image percent-encodes inline SVG
        // itself. Pre-encoding it here would be encoded twice and render
        // nothing. See qrSvgDataUriRaw.
        uri: qrSvgDataUriRaw(encodeQr(url), {
          dark: wsfTheme.colors.primary,
          light: '#FFFFFF',
        }),
      };
    } catch {
      // A URL too long for versions 1-10, or anything else the encoder
      // refuses. Never a partial symbol: a truncated QR scans cleanly and
      // sends the scanner somewhere wrong.
      return null;
    }
  }, [url]);

  if (!url) {
    // No toggle and no symbol here, so no leading gap either: the sentence is
    // the whole of this block and sits on its card's own rhythm.
    return (
      <View testID={`${testIDPrefix}-unavailable`}>
        <Text style={[styles.caveat, styles.caveatAlone]}>{JOIN_QR_COPY.notJoinable}</Text>
      </View>
    );
  }

  return (
    <View style={styles.block} testID={testIDPrefix}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.toggle}
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={open ? JOIN_QR_COPY.hide : JOIN_QR_COPY.show}
        testID={`${testIDPrefix}-toggle`}
      >
        <Text style={styles.toggleText}>{open ? JOIN_QR_COPY.hide : JOIN_QR_COPY.show}</Text>
      </Pressable>
      {open && mounted ? (
        encoded ? (
          <View
            style={styles.symbolBlock}
            testID={`${testIDPrefix}-symbol`}
            // The encoded string, on the element as `data-qr-url`, so a test
            // can assert WHICH URL the symbol carries rather than that some
            // picture appeared. A pixel comparison of a QR answers a weaker
            // question than this attribute does.
            dataSet={{ qrUrl: url }}
          >
            <Image
              source={{ uri: encoded.uri }}
              style={styles.symbol}
              resizeMode="contain"
              // It is a picture of the community's join link; the link
              // itself is never read out here (and, on the member-facing
              // card, never printed either).
              accessibilityLabel="QR code for this community's join link"
              testID={`${testIDPrefix}-image`}
            />
            {showUrl ? (
              <Text style={styles.url} selectable testID={`${testIDPrefix}-url`}>
                {url}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.error} testID={`${testIDPrefix}-error`}>
            {JOIN_QR_COPY.failed}
          </Text>
        )
      ) : null}
      {open ? (
        <Text style={styles.caveat} testID={`${testIDPrefix}-caveat`}>
          {caveat}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: wsfTheme.spacing.sm },
  toggle: {
    alignSelf: 'flex-start',
    backgroundColor: wsfTheme.colors.surface,
    borderWidth: 1.5,
    borderColor: wsfTheme.colors.primary,
    borderRadius: wsfTheme.radius.pill,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    marginTop: 6,
  },
  toggleText: {
    color: wsfTheme.colors.primary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  symbolBlock: {
    marginTop: wsfTheme.spacing.md,
    alignSelf: 'stretch',
    maxWidth: QR_PIXEL_SIZE,
  },
  // Square, and never wider than the column it sits in: a fixed 220 px box
  // extends past a 195 px viewport (invariant 4).
  symbol: {
    width: '100%',
    maxWidth: QR_PIXEL_SIZE,
    aspectRatio: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: wsfTheme.radius.sm,
  },
  url: {
    color: wsfTheme.colors.primary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    marginTop: wsfTheme.spacing.sm,
    maxWidth: 320,
  },
  caveat: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    lineHeight: wsfTheme.typography.caption.lineHeight,
    marginTop: wsfTheme.spacing.sm,
    maxWidth: 420,
    flexShrink: 1,
    minWidth: 0,
  },
  /** The sentence is the only thing in its block; it needs no leading gap. */
  caveatAlone: { marginTop: 0 },
  error: {
    color: '#B3261E',
    fontSize: wsfTheme.typography.caption.fontSize,
    lineHeight: wsfTheme.typography.caption.lineHeight,
    marginTop: wsfTheme.spacing.sm,
    maxWidth: 420,
  },
});
