import { useSyncExternalStore } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

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
  DEVICE_SHARED_FACTS,
  DEVICE_SHARED_RESET,
  DEVICE_SHARED_TITLE,
  deviceModeMayBeRemembered,
  subscribeDeviceModeMayBeRemembered,
} from '../deviceMode';
import {
  ACTION_GREEN,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  SURFACE,
  elevation,
  kit,
} from './kit';

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
  /**
   * `'sheet'` draws the accepted Batch B form: each answer is a labelled card
   * carrying its own real action, rather than a card that is itself a tap
   * target with no visible control.
   *
   * IT IS OPT-IN, AND THAT IS DELIBERATE. This component is shared with
   * `/event/[goalId]`, which is Batch D and not authorized. Defaulting to the
   * existing presentation means the event route is untouched by construction
   * rather than by my remembering not to touch it.
   */
  variant?: 'legacy' | 'sheet';
  testID: string;
};

export function DeviceChoice({
  onChoosePersonal,
  onChooseShared,
  signupAhead = false,
  variant = 'legacy',
  testID,
}: DeviceChoiceProps) {
  const sharedDescription = signupAhead
    ? DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP
    : DEVICE_CHOICE_SHARED_DESCRIPTION;
  /*
    W16-3 ST-04. THE NOTE SAYS THE ANSWER IS REMEMBERED ONLY WHEN IT CAN BE.
    On a phone the device may refuse the save, or its stored answer may be
    unreadable; then "remembered on this device only" would be untrue, so the
    note is not shown (src/deviceMode.ts `deviceModeMayBeRemembered`, W13-3,
    followed as it changes). On the web it is always true: the note stays.
  */
  const remembered = useSyncExternalStore(
    subscribeDeviceModeMayBeRemembered,
    deviceModeMayBeRemembered,
    deviceModeMayBeRemembered,
  );
  const note = remembered ? (
    <Text style={kit.caption} testID={`${testID}-note`}>
      {DEVICE_CHOICE_NOTE}
    </Text>
  ) : null;

  if (variant === 'sheet') {
    return (
      <View style={styles.sheetBlock} testID={testID}>
        {/*
          THE REAL DISTINCTION, SAID IN EACH CARD RATHER THAN INFERRED.
          A personal phone makes an account and counts your part to you; a
          shared screen makes no account at all and goes to the event, where
          nothing is kept about who added what. Those are different enough
          that the screen should not make somebody guess which they picked.
        */}
        <View style={styles.sheetCard}>
          <Text style={styles.sheetLabel}>{DEVICE_CHOICE_PERSONAL_LABEL}</Text>
          <Text style={styles.sheetBody} {...nativeHidden()}>
            {DEVICE_CHOICE_PERSONAL_DESCRIPTION}
          </Text>
          <Pressable
            onPress={onChoosePersonal}
            style={styles.sheetPrimary}
            testID={`${testID}-personal`}
            accessibilityRole="button"
            {...choiceA11y(SHEET_PERSONAL_ACTION, DEVICE_CHOICE_PERSONAL_DESCRIPTION, `${DEVICE_CHOICE_PERSONAL_LABEL}. ${DEVICE_CHOICE_PERSONAL_DESCRIPTION}`)}
          >
            <Text style={styles.sheetPrimaryText}>{SHEET_PERSONAL_ACTION}</Text>
          </Pressable>
        </View>
        <View style={styles.sheetCardQuiet}>
          <Text style={styles.sheetLabel}>{DEVICE_CHOICE_SHARED_LABEL}</Text>
          <Text style={styles.sheetBody} {...nativeHidden()}>
            {sharedDescription}
          </Text>
          <Pressable
            onPress={onChooseShared}
            style={styles.sheetSecondary}
            testID={`${testID}-shared`}
            accessibilityRole="button"
            {...choiceA11y(SHEET_SHARED_ACTION, sharedDescription, `${DEVICE_CHOICE_SHARED_LABEL}. ${sharedDescription}`)}
          >
            <Text style={styles.sheetSecondaryText}>{SHEET_SHARED_ACTION}</Text>
          </Pressable>
        </View>
        {note}
      </View>
    );
  }

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
          description={sharedDescription}
          onPress={onChooseShared}
          testID={`${testID}-shared`}
        />
      </View>
      {note}
    </View>
  );
}

/** The sheet's two buttons, as they read: the visible words are the native label. */
const SHEET_PERSONAL_ACTION = 'This is my phone';
const SHEET_SHARED_ACTION = 'We’re sharing this screen';

/**
 * W16-3 (MF-18). On a phone a button is read by its label and then its hint,
 * so the label is the words on the button and the hint is the description;
 * the description's own Text is hidden there, so it is not read twice. The
 * web keeps today's single aria-label ("<label>. <description>").
 */
function choiceA11y(visible: string, description: string, webLabel: string) {
  return Platform.OS === 'web'
    ? { accessibilityLabel: webLabel }
    : { accessibilityLabel: visible, accessibilityHint: description };
}
function nativeHidden() {
  return Platform.OS === 'web' ? {} : ({ accessible: false, importantForAccessibility: 'no' } as const);
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
      {...choiceA11y(label, description, `${label}. ${description}`)}
    >
      <Text style={[kit.cardTitle, styles.shrink]} testID={`${testID}-label`}>
        {label}
      </Text>
      <Text style={[kit.cardMeta, styles.shrink]} testID={`${testID}-description`} {...nativeHidden()}>
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
  /**
   * `'sheet'` draws the accepted Batch B form: the consequences as a card of
   * facts, then the one action. The way back out is NOT drawn here in that
   * form — the caller puts it at the foot of the shell, where every other
   * Batch B surface keeps its way out.
   *
   * OPT-IN for the same reason `DeviceChoice`'s is: `/event/[goalId]` shares
   * this component and is Batch D.
   */
  variant?: 'legacy' | 'sheet';
  testID: string;
};

export function SharedScreenNotice({
  onContinue,
  onUseOwnPhone,
  variant = 'legacy',
  testID,
}: SharedScreenNoticeProps) {
  if (variant === 'sheet') {
    return (
      <View style={styles.sheetBlock} testID={testID}>
        <View style={styles.factCard}>
          <Text style={styles.factTitle}>What that means</Text>
          {DEVICE_SHARED_FACTS.map((fact) => (
            <View key={fact} style={styles.factRow}>
              <View style={styles.factDot} />
              <Text style={[styles.factText, styles.shrink]}>{fact}</Text>
            </View>
          ))}
        </View>
        <Pressable
          onPress={onContinue}
          style={styles.sheetPrimary}
          testID={`${testID}-continue`}
          accessibilityRole="button"
        >
          <Text style={styles.sheetPrimaryText}>{DEVICE_SHARED_CONTINUE}</Text>
        </Pressable>
      </View>
    );
  }

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

/** The recommended card's outline: the action green, darkened enough to hold
 *  a 1.5 pt line against the cream ground without glowing. */
const ACTION_GREEN_RING = '#2E9E5B';

const styles = StyleSheet.create({
  /* The accepted Batch B form: a card per answer, each with its own action. */
  sheetBlock: { gap: 12 },
  sheetCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1.5,
    /* The likely answer is outlined in the action colour, so the pair reads as
       a recommendation with an alternative rather than as two equal options
       a visitor has to weigh. */
    borderColor: ACTION_GREEN_RING,
    padding: 14,
    gap: 6,
    ...elevation.card,
  },
  /* The shared answer is deliberately quieter — it is the less common one,
     and it must not read as the recommended path on somebody's own phone. */
  sheetCardQuiet: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    padding: 14,
    gap: 6,
  },
  sheetLabel: { color: NAVY, fontSize: 15, fontWeight: '900' },
  sheetBody: { color: INK_QUIET, fontSize: 13, lineHeight: 19 },
  sheetPrimary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...elevation.action,
  },
  sheetPrimaryText: { color: '#04260F', fontSize: 16, fontWeight: '900' },
  /* A text control, not a second box. Two outlined buttons on one screen
     compete; the shared answer is the alternative, and it should look like
     one. Still a full-width 46 pt target. */
  sheetSecondary: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  sheetSecondaryText: { color: NAVY, fontSize: 15, fontWeight: '800' },

  /* The consequences card: a dot per fact, in the action colour, so three
     statements read as a list rather than as a paragraph broken up. */
  factCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 16,
    gap: 9,
    ...elevation.card,
  },
  factTitle: { color: NAVY, fontSize: 15, fontWeight: '900' },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  factDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACTION_GREEN,
    marginTop: 6,
  },
  factText: { color: NAVY, fontSize: 14, lineHeight: 20 },

  block: { gap: 14, width: '100%' },
  options: { gap: 10, width: '100%' },
  // The card look plus a comfortable target; a two-line card is far past 44.
  choiceCard: { minHeight: 44, width: '100%' },
  shrink: { flexShrink: 1, minWidth: 0 },
});
