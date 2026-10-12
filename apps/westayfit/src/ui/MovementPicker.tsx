import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MOVEMENTS, toggleMovement, type MovementKey } from '../movementSelection';
import { CREAM, kit, NAVY, TEXT_MUTED } from './kit';

/**
 * MOVEMENT PILLS — pick a supported movement, or several, or "Something else".
 *
 * Reusable on purpose: `/goals/new` mounts it for a community goal, and the
 * kiosk setup can mount the same component with its own contract. It owns no
 * goal state and calls nothing; it reports the next selection and the screen
 * decides what that selection means (`mapMovementSelection`).
 *
 * TWO MODES. `single` (what `/goals/new` uses today) is a radio group: one
 * choice at a time, because the existing goal contract can persist only one
 * movement (Director #456 `5834379218`). `multiple` is a checkbox group for a
 * screen whose contract can keep several; the mapping still refuses to turn
 * several into a payload until that contract exists.
 *
 * "SOMETHING ELSE" is an explicit choice, not the absence of one: it is how a
 * Champion reaches their own typed words at any time, including after picking
 * a movement. The screen keeps the typed draft; this component only reports
 * the press.
 *
 * ACCESSIBILITY. The group is labelled; each pill is a radio (single) or a
 * checkbox (multiple) with aria-checked, at least 44 px tall, and toggles on
 * Space as well as Enter on web. Selection changes shape as well as colour —
 * a tick is drawn inside a selected pill.
 *
 * THE LEADING MARK is the Activity pulse the Lovable reference puts beside
 * MOVE, drawn from Views because the app has no icon library and adding one is
 * the owner's call. It is decoration and is hidden from assistive tech.
 */

export type MovementPickerProps = {
  selected: readonly MovementKey[];
  onChange: (next: MovementKey[]) => void;
  /** `single` is a radio group; `multiple` a checkbox group. */
  mode?: 'single' | 'multiple';
  /** The explicit route to the Champion's own words. Omit to hide it. */
  somethingElse?: { selected: boolean; onPress: () => void };
  /** One line under the pills; say only what the screen really supports. */
  hint?: string;
  disabled?: boolean;
  /** The group's accessible name and visible label. */
  label?: string;
  testID?: string;
};

export function MovementPicker({
  selected,
  onChange,
  mode = 'multiple',
  somethingElse,
  hint,
  disabled = false,
  label = 'Movements',
  testID = 'wsf-movement-picker',
}: MovementPickerProps) {
  const single = mode === 'single';
  const choose = (key: MovementKey) =>
    onChange(single ? [key] : toggleMovement(selected, key));
  return (
    <View
      style={styles.group}
      testID={testID}
      accessibilityRole={(single ? 'radiogroup' : 'group') as never}
      accessibilityLabel={label}
    >
      <View style={styles.heading}>
        <ActivityGlyph color={NAVY} />
        <Text style={kit.fieldLabel}>{label}</Text>
      </View>
      <View style={styles.pills}>
        {MOVEMENTS.map((m) => (
          <Pill
            key={m.key}
            label={m.label}
            on={selected.includes(m.key)}
            single={single}
            disabled={disabled}
            onPress={() => choose(m.key)}
            testID={`${testID}-${m.key}`}
          />
        ))}
        {somethingElse ? (
          <Pill
            label="Something else"
            on={somethingElse.selected}
            single={single}
            disabled={disabled}
            onPress={somethingElse.onPress}
            testID={`${testID}-something-else`}
          />
        ) : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function Pill({
  label,
  on,
  single,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  on: boolean;
  single: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={single ? 'radio' : 'checkbox'}
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      testID={testID}
      dataSet={{ selected: on ? 'true' : 'false' }}
      // react-native-web does not turn accessibilityState.checked into
      // aria-checked, and activates a Pressable on Space only for
      // role="button"; both are carried here for web, as OptionRow and the
      // route's duration pills do. Native has neither key events nor ARIA.
      {...({
        'aria-checked': on,
        onKeyDown: (e: { key?: string; preventDefault?: () => void }) => {
          if (disabled || (e.key !== ' ' && e.key !== 'Spacebar')) return;
          e.preventDefault?.();
          onPress();
        },
      } as Record<string, unknown>)}
      style={[kit.pill, styles.pill, on && kit.pillSelected, disabled && styles.disabled]}
    >
      {on ? <CheckMark /> : null}
      <Text style={[kit.pillText, on && kit.pillTextSelected]}>{label}</Text>
    </Pressable>
  );
}

/** A tick: two strokes, cream on the navy of a selected pill. */
function CheckMark() {
  return (
    <View style={styles.check} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.checkShort} />
      <View style={styles.checkLong} />
    </View>
  );
}

/**
 * The Activity pulse: the reference icon's own polyline (the lucide
 * "activity" path, 24-unit grid: 22,12 → 18,12 → 15,21 → 9,3 → 6,12 → 2,12),
 * drawn as five absolutely positioned strokes inside its own box so nothing
 * spills into the label beside it.
 */
const PULSE: ReadonlyArray<readonly [number, number]> = [
  [2, 12],
  [6, 12],
  [9, 3],
  [15, 21],
  [18, 12],
  [22, 12],
];
const GLYPH = 18;
const STROKE = 2;

export function ActivityGlyph({ color }: { color: string }) {
  const k = GLYPH / 24;
  return (
    <View style={styles.glyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {PULSE.slice(1).map(([x2, y2], i) => {
        const [x1, y1] = PULSE[i]!;
        const dx = (x2 - x1) * k;
        const dy = (y2 - y1) * k;
        const length = Math.hypot(dx, dy) + STROKE / 2;
        const midX = ((x1 + x2) / 2) * k;
        const midY = ((y1 + y2) / 2) * k;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: midX - length / 2,
              top: midY - STROKE / 2,
              width: length,
              height: STROKE,
              borderRadius: STROKE / 2,
              backgroundColor: color,
              transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  disabled: { opacity: 0.5 },
  hint: { color: TEXT_MUTED, fontSize: 13 },
  check: { width: 14, height: 14, position: 'relative' },
  checkShort: {
    position: 'absolute',
    left: 1,
    top: 7,
    width: 6,
    height: 2,
    backgroundColor: CREAM,
    transform: [{ rotate: '45deg' }],
  },
  checkLong: {
    position: 'absolute',
    left: 4,
    top: 5,
    width: 10,
    height: 2,
    backgroundColor: CREAM,
    transform: [{ rotate: '-50deg' }],
  },
  glyph: { width: GLYPH, height: GLYPH, position: 'relative', overflow: 'hidden' },
});
