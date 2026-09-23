import { Link } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { NAVY } from '../../../../src/ui/kit';
import { ShellNextPage } from '../../../../src/ui/shellNext/ShellNextPage';

/** Stands for production `/`. The URL here is /design-target/shell-next —
 *  the `(tabs)` group contributes no segment. */
export default function ShellNextHome() {
  return (
    <ShellNextPage
      id="home"
      title="Home"
      lede="Stands in for the real Home. This packet proposes the shell around the page, not the page."
    >
      <Link href="/design-target/shell-next/community/detail?groupId=demo-group" style={styles.link} testID="wsf-shell-next-home-to-group">
        Open a community detail (proves /community/&lt;id&gt; deep-links)
      </Link>
    </ShellNextPage>
  );
}

const styles = StyleSheet.create({
  link: { color: NAVY, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline', paddingVertical: 6 },
});
