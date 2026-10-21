import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { ButtonLink } from './ButtonLink';

/**
 * INT-29 (W12-14) — "Sign in" from a sheet, on a phone.
 *
 * The contribution sheet is a transparent modal over the member's tabs. On
 * iOS a sign-in pushed from it is presented as an orphaned page sheet over
 * the sheet (and a 'card' presentation would hide it under the sheet). So on
 * iOS and Android, from a sheet only, the button closes everything above the
 * tabs (router.dismissAll()) and then pushes /signin as an ordinary page.
 * A page, a kiosk and the web keep the ButtonLink (an anchor to /signin on
 * the web), with the same label and testID.
 */
export function SignInLink({
  fromSheet,
  style,
  textStyle,
  testID,
  label,
  replace,
}: {
  /** The screen is presented as a sheet over the member's tabs. */
  fromSheet: boolean;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  testID: string;
  label: string;
  replace?: boolean;
}) {
  if (Platform.OS === 'web' || !fromSheet) {
    return <ButtonLink href="/signin" style={style} textStyle={textStyle} testID={testID} label={label} replace={replace} />;
  }
  return (
    <Pressable
      onPress={() => {
        router.dismissAll();
        router.push('/signin' as never);
      }}
      style={StyleSheet.flatten(style)}
      testID={testID}
      accessibilityRole="button"
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}
