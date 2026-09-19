import { forwardRef, useImperativeHandle, useRef, type ReactElement } from 'react';
import * as ReactNative from 'react-native';
import { Platform, TextInput } from 'react-native';

import { wsfTheme } from '../theme';
import { kit } from './kit';

// On the web, `react-native` resolves to react-native-web, whose index also
// exports `unstable_createElement` (a DOM element with react-native-web's
// prop and style handling). The react-native typings do not name it and the
// package ships no typings of its own, so it is read off the namespace with
// the one shape this component uses; anywhere it is missing, the TextInput
// fallback renders.
type CreateElement = (component: string, props?: Record<string, unknown>) => ReactElement;
const createDomElement: CreateElement | undefined = (
  ReactNative as unknown as { unstable_createElement?: CreateElement }
).unstable_createElement;

/**
 * A date-and-time field for a Champion, not a syntax to type. On the web it
 * is the browser's own `datetime-local` control (a calendar and a clock on a
 * phone, a picker on a desktop); anywhere else it falls back to a TextInput
 * that takes the same value.
 *
 * The value is the control's own shape, `YYYY-MM-DDTHH:mm` in the device's
 * local time, or '' when nothing is chosen. The caller reads it with a Date
 * parser; nothing here interprets it.
 */

export type DateTimeFieldHandle = { focus: () => void };

export type DateTimeFieldProps = {
  value: string;
  onChange: (next: string) => void;
  testID: string;
  editable?: boolean;
  accessibilityLabel?: string;
};

// The browser control on the kit's input look. `System` is the font stack
// react-native-web gives every TextInput; the box sizing and full width are
// what a raw <input> needs to sit in the column like one.
const webInputStyle: Record<string, unknown> = {
  fontFamily: 'System',
  width: '100%',
  minWidth: 0,
  margin: 0,
  boxSizing: 'border-box',
};

export const DateTimeField = forwardRef<DateTimeFieldHandle, DateTimeFieldProps>(
  function DateTimeField({ value, onChange, testID, editable = true, accessibilityLabel }, ref) {
    const nodeRef = useRef<{ focus?: () => void } | null>(null);
    useImperativeHandle(ref, () => ({ focus: () => nodeRef.current?.focus?.() }), []);

    if (Platform.OS === 'web' && createDomElement) {
      return createDomElement('input', {
        ref: nodeRef,
        type: 'datetime-local',
        value,
        onChange: (e: { currentTarget: { value: string } }) => onChange(e.currentTarget.value),
        disabled: !editable,
        'aria-label': accessibilityLabel,
        testID,
        style: [kit.input, webInputStyle],
      });
    }

    return (
      <TextInput
        ref={(node) => {
          nodeRef.current = node;
        }}
        value={value}
        onChangeText={onChange}
        editable={editable}
        accessibilityLabel={accessibilityLabel}
        placeholder="2026-09-25T14:00"
        placeholderTextColor={wsfTheme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={kit.input}
        testID={testID}
      />
    );
  }
);
