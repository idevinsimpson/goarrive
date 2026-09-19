import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DEVICE_CHOICE_HEADING,
  DEVICE_CHOICE_INTRO,
  DEVICE_CHOICE_NOTE,
  DEVICE_CHOICE_PERSONAL_DESCRIPTION,
  DEVICE_CHOICE_PERSONAL_LABEL,
  DEVICE_CHOICE_SHARED_DESCRIPTION,
  DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP,
  DEVICE_CHOICE_SHARED_LABEL,
  DEVICE_SHARED_BODY,
  DEVICE_SHARED_CONTINUE,
  DEVICE_SHARED_RESET,
  DEVICE_SHARED_TITLE,
} from '../deviceMode';
import { kit } from './kit';

/**
 * The question a scanned screen asks before it does anything else, and the
 * standing answer a screen that has already answered "shared" shows instead.
 *
 * Two buttons, not two radio rows: each answer ACTS immediately — one carries
 * on, one hands off to the kiosk — so a control that only records a selection
 * and waits for a submit would be describing something that is not happening.
 * They are `accessibilityRole="button"` for the same reason.
 *
 * The wording lives in src/deviceMode.ts so the spec and the screen read the
 * same literals. Nothing here animates, suppresses a focus ring or sets a
 * fixed width; each option is a full-width card well past 44 px, and every
 * text child shrinks so the whole thing wraps at 195 px.
 */

export type DeviceChoiceProps = {
  onChoosePersonal: () => void;
  onChooseShared: () => void;
  /** True on a page whose next step would be CREATING an account. The shared
   * option then says what will not happen, instead of describing a
   * contribution the visitor cannot make yet. */
  signupAhead?: boolean;
  testID: string;
};

export function DeviceChoice({
  onChoosePersonal,
  onChooseShared,
  signupAhead = false,
  testID,
}: DeviceChoiceProps) {
  return (
    <View style={styles.block} testID={testID}>
      <Text
        style={kit.heading}
        accessibilityRole="header"
        {...({ 'aria-level': 1 } as Record<string, unknown>)}
      >
        {DEVICE_CHOICE_HEADING}
      </Text>
      <Text style={kit.intro}>{DEVICE_CHOICE_INTRO}</Text>
      <View style={styles.options}>
        <ChoiceCard
          label={DEVICE_CHOICE_PERSONAL_LABEL}
          description={DEVICE_CHOICE_PERSONAL_DESCRIPTION}
          onPress={onChoosePersonal}
          testID={`${testID}-personal`}
        />
        <ChoiceCard
          label={DEVICE_CHOICE_SHARED_LABEL}
          description={
            signupAhead ? DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP : DEVICE_CHOICE_SHARED_DESCRIPTION
          }
          onPress={onChooseShared}
          testID={`${testID}-shared`}
        />
      </View>
      <Text style={kit.caption} testID={`${testID}-note`}>
        {DEVICE_CHOICE_NOTE}
      </Text>
    </View>
  );
}

function ChoiceCard({
  label,
  description,
  onPress,
  testID,
}: {
  label: string;
  description: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[kit.card, styles.choiceCard]}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${description}`}
    >
      <Text style={[kit.cardTitle, styles.shrink]} testID={`${testID}-label`}>
        {label}
      </Text>
      <Text style={[kit.cardMeta, styles.shrink]} testID={`${testID}-description`}>
        {description}
      </Text>
    </Pressable>
  );
}

export type SharedScreenNoticeProps = {
  /** Hand off to the kiosk start screen for this goal. */
  onContinue: () => void;
  /** The way back for a phone that answered "shared" by mistake: forget the
   * answer and ask again. Without it, re-scanning the same QR would send a
   * personal phone to the shared screen's page for ever. */
  onUseOwnPhone: () => void;
  testID: string;
};

export function SharedScreenNotice({ onContinue, onUseOwnPhone, testID }: SharedScreenNoticeProps) {
  return (
    <View style={styles.block} testID={testID}>
      <View style={kit.card}>
        <Text
          style={[kit.cardTitle, styles.shrink]}
          accessibilityRole="header"
          {...({ 'aria-level': 1 } as Record<string, unknown>)}
        >
          {DEVICE_SHARED_TITLE}
        </Text>
        <Text style={[kit.body, styles.shrink]}>{DEVICE_SHARED_BODY}</Text>
      </View>
      <View style={styles.options}>
        <Pressable
          onPress={onContinue}
          style={kit.primaryButton}
          testID={`${testID}-continue`}
          accessibilityRole="button"
        >
          <Text style={kit.primaryButtonText}>{DEVICE_SHARED_CONTINUE}</Text>
        </Pressable>
        <Pressable
          onPress={onUseOwnPhone}
          style={kit.tertiaryButton}
          testID={`${testID}-reset`}
          accessibilityRole="button"
        >
          <Text style={kit.tertiaryButtonText}>{DEVICE_SHARED_RESET}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 14, width: '100%' },
  options: { gap: 10, width: '100%' },
  // The card look plus a comfortable target; a two-line card is far past 44.
  choiceCard: { minHeight: 44, width: '100%' },
  shrink: { flexShrink: 1, minWidth: 0 },
});
