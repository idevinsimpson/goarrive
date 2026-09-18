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
  /** Shown in place of the symbol when the policy admits no one by link. */
  notJoinable:
    'This community cannot be joined from a link, so there is no code to scan. Change how people join to share one.',
  failed:
    'This link could not be turned into a QR code. The link above still works — copy or share it instead.',
} as const;

export function JoinQrCode({
  url,
  testIDPrefix = 'wsf-community-qr',
}: {
  /** The join URL, or null when this community admits no one by link. */
  url: string | null;
  testIDPrefix?: string;
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
    return (
      <View style={styles.block} testID={`${testIDPrefix}-unavailable`}>
        <Text style={styles.caveat}>{JOIN_QR_COPY.notJoinable}</Text>
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
              // The symbol is a picture of the URL printed directly beneath
              // it, so announcing it again would read the same string twice.
              accessibilityLabel="QR code for this community's join link"
              testID={`${testIDPrefix}-image`}
            />
            <Text style={styles.url} selectable testID={`${testIDPrefix}-url`}>
              {url}
            </Text>
          </View>
        ) : (
          <Text style={styles.error} testID={`${testIDPrefix}-error`}>
            {JOIN_QR_COPY.failed}
          </Text>
        )
      ) : null}
      {open ? (
        <Text style={styles.caveat} testID={`${testIDPrefix}-caveat`}>
          {JOIN_QR_COPY.caveat}
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
  symbolBlock: { marginTop: wsfTheme.spacing.md, alignSelf: 'flex-start' },
  symbol: {
    width: QR_PIXEL_SIZE,
    height: QR_PIXEL_SIZE,
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
  },
  error: {
    color: '#B3261E',
    fontSize: wsfTheme.typography.caption.fontSize,
    lineHeight: wsfTheme.typography.caption.lineHeight,
    marginTop: wsfTheme.spacing.sm,
    maxWidth: 420,
  },
});
