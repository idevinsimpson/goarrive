import { Text, View } from 'react-native';

import { ButtonLink } from '../../../src/ui/ButtonLink';
import { CREAM, kit } from '../../../src/ui/kit';

/**
 * A FOCUSED FLOW THAT LEAVES FOR THE COMMUNITY LIST. A TEST FIXTURE, gated by
 * this prototype's layout like every route beside it, so it renders only in
 * an emulator build.
 *
 * WHY IT EXISTS. `/start-community`'s unconfirmed-create screen sends the
 * member to `/?view=communities` with a plain `ButtonLink`, and that is the
 * navigation whose address lost its query (W7 `5800444443`, Q2). That screen
 * is W4's and is not on the app-shell head yet, so the regression that has to
 * fail on `f2f901a` needs another screen outside the tab navigator leaving for
 * the list the same way. This is that screen and nothing more: the same
 * component, the same href, from outside the tabs.
 *
 * It says nothing about what the list or the create flow contain.
 */
export default function LeaveForListFixture() {
  return (
    <View style={{ flex: 1, backgroundColor: CREAM, padding: 24, gap: 16, justifyContent: 'center' }}>
      <Text style={kit.statusText}>A focused flow outside the member tabs.</Text>
      <ButtonLink
        href="/?view=communities"
        style={kit.primaryButton}
        textStyle={kit.primaryButtonText}
        testID="wsf-w9-fixture-leave-for-list"
        label="Check your communities"
      />
    </View>
  );
}
