/**
 * SETTINGS → MOVE. Two switches, as the frozen camera-squat reference draws
 * them: "Camera rep counter", and under it, indented on a green rule and
 * shown only while the counter is on, "Show stick figure". The stick-figure
 * value is kept while hidden; it has no effect when the counter is off,
 * because the camera never opens.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ACTION_GREEN, NAVY, PROGRESS_GREEN, SURFACE } from '../ui/kit';
import { useMoveCameraSettings, writeMoveCameraSettings } from './settingsStore';

export function MoveCameraSettingsSection() {
  const settings = useMoveCameraSettings();
  return (
    <View style={s.section} testID="wsf-settings-move">
      <Text style={s.heading} {...({ role: 'heading', 'aria-level': 3 } as Record<string, unknown>)}>
        MOVE
      </Text>
      <Switch
        label="Camera rep counter"
        hint="Automatically count squats with your camera."
        on={settings.cameraCounter}
        onToggle={() => writeMoveCameraSettings({ cameraCounter: !settings.cameraCounter })}
        testID="wsf-settings-camera-counter"
      />
      {settings.cameraCounter ? (
        <View style={s.sub}>
          <Switch
            label="Show stick figure"
            hint="Show the body guide while you move."
            on={settings.stickFigure}
            onToggle={() => writeMoveCameraSettings({ stickFigure: !settings.stickFigure })}
            testID="wsf-settings-stick-figure"
          />
        </View>
      ) : null}
    </View>
  );
}

function Switch({
  label,
  hint,
  on,
  onToggle,
  testID,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
  testID: string;
}) {
  const hintId = `${testID}-hint`;
  // Space is the ARIA switch pattern's key; react-native-web's Pressable only answers Enter.
  const onKeyDown = (e: { nativeEvent: { key?: string }; preventDefault?: () => void }) => {
    const key = e.nativeEvent.key;
    if (key !== ' ' && key !== 'Spacebar') return;
    e.preventDefault?.();
    onToggle();
  };
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      aria-checked={on}
      aria-describedby={hintId}
      accessibilityLabel={label}
      style={s.row}
      testID={testID}
      {...({ onKeyDown, dataSet: { checked: on ? 'true' : 'false' } } as Record<string, unknown>)}
    >
      <View style={s.text}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.hint} id={hintId}>
          {hint}
        </Text>
      </View>
      <View style={[s.track, on ? s.trackOn : null]}>
        <View style={[s.knob, on ? s.knobOn : null]} />
      </View>
    </Pressable>
  );
}

/* The same switch tokens as the privacy panel (CommunityPrivacyPanelView). */
const MUTED_FG = '#4B5C71';
const BORDER = '#D7DFE7';
const INK = '#081D36';

const s = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 14, backgroundColor: SURFACE },
  heading: { color: INK, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  sub: { marginLeft: 14, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: PROGRESS_GREEN },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  text: { flex: 1, minWidth: 0 },
  label: { color: INK, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  hint: { color: MUTED_FG, fontSize: 11, lineHeight: 16, marginTop: 2 },
  track: { width: 48, height: 28, borderRadius: 20, backgroundColor: BORDER, justifyContent: 'center' },
  trackOn: { backgroundColor: ACTION_GREEN },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: 4,
    backgroundColor: SURFACE,
    shadowColor: NAVY,
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  knobOn: { marginLeft: 24 },
});
