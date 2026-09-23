import { Link } from 'expo-router';
import { StyleSheet } from 'react-native';

import { NAVY } from '../../../../../src/ui/kit';
import { ShellNextPage } from '../../../../../src/ui/shellNext/ShellNextPage';

/** Stands for production `/community`. */
export default function ShellNextCommunity() {
  return (
    <ShellNextPage id="community" title="Community" lede="Stands in for the real Community list.">
      <Link href="/design-target/shell-next/community/detail?groupId=demo-group" style={styles.link} testID="wsf-shell-next-community-to-group">
        Open demo-group
      </Link>
    </ShellNextPage>
  );
}

const styles = StyleSheet.create({
  link: { color: NAVY, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline', paddingVertical: 6 },
});
