import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { kit } from './kit';

/**
 * One selectable option row: the control every guided decision uses
 * (community type, who can join, how long, how members take part, time zone).
 *
 * A row is a full-width card with a leading radio indicator, a label and an
 * optional one-line consequence. Selection is a navy ring + filled dot and a
 * navy border on a faint tint — never a navy fill, so the text keeps its
 * contrast and the state reads without colour. The indicator and the
 * description are always laid out, so a row's height does not change when
 * it is picked; the option list never shifts under the thumb.
 *
 * Nothing here clips, animates, or sets a fixed width beyond the 22 px
 * indicator, so a row wraps cleanly at 195 px.
 */

export type OptionRowProps = {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  /** A short uppercase tag next to the label, e.g. "Recommended". */
  badge?: string;
};

export function OptionRow({
  label,
  description,
  selected,
  onPress,
  testID,
  disabled = false,
  badge,
}: OptionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[kit.optionRow, selected ? kit.optionRowSelected : null, disabled ? styles.disabled : null]}
      testID={testID}
      accessibilityRole="radio"
      // `checked` only. react-native-web maps accessibilityState.selected to
      // aria-selected, and aria-selected is not an attribute ARIA allows on
      // role="radio" (axe: aria-allowed-attr) — aria-checked is the one that
      // role takes. Every row of every guided decision used to emit both.
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      // accessibilityState carries it on native; the raw attribute is for
      // browsers, which only read the DOM.
      {...({ 'aria-checked': selected } as Record<string, unknown>)}
    >
      <View style={kit.optionIndicator} testID={`${testID}-indicator`}>
        {selected ? <View style={kit.optionIndicatorDot} testID={`${testID}-indicator-dot`} /> : null}
      </View>
      <View style={styles.textColumn}>
        <View style={styles.labelRow}>
          <Text style={[kit.optionLabel, styles.shrink]} testID={`${testID}-label`}>
            {label}
          </Text>
          {badge ? <Text style={kit.badge}>{badge}</Text> : null}
        </View>
        {description ? (
          <Text style={[kit.optionDescription, styles.shrink]} testID={`${testID}-description`}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export type OptionGroupProps = {
  /** What the choice is, for screen readers: e.g. "Who can join". */
  accessibilityLabel: string;
  children: ReactNode;
  testID?: string;
};

/** The rows of one decision, stacked with a steady 10 px gap. */
export function OptionGroup({ accessibilityLabel, children, testID }: OptionGroupProps) {
  return (
    <View
      style={styles.group}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {children}
    </View>
  );
}

// Layout only this control needs; the look lives in kit.
const styles = StyleSheet.create({
  group: { gap: 10, width: '100%' },
  textColumn: { flex: 1, minWidth: 0, gap: 4 },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  shrink: { flexShrink: 1, minWidth: 0 },
  disabled: { opacity: 0.6 },
});
