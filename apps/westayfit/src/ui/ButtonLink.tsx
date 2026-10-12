import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

/**
 * A link that looks and lays out like a button. Expo Router's Link renders a
 * text anchor on web, so flex centring and minimum heights on it do nothing;
 * `asChild` hands the href and press handling to a Pressable that can carry
 * the button styles. The anchor keeps its href for cold loads and the testID
 * stays on the element a test clicks.
 */
export function ButtonLink({
  href,
  style,
  textStyle,
  testID,
  label,
  accessibilityLabel,
  onPress,
  replace = false,
}: {
  href: string;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  testID: string;
  label: string;
  /**
   * What a screen reader announces, when the visible label is not enough on
   * its own. A list of goals can each carry a button reading "Move" -- short
   * and clear beside its own title, and three identical announcements to
   * somebody who cannot see which row the button is in.
   */
  accessibilityLabel?: string;
  /** Runs before the navigation (Link calls the child's onPress first). */
  onPress?: () => void;
  /**
   * Replace the current route instead of pushing over it. A gate screen that
   * exists only to send the visitor somewhere (the kiosk's sign-in card) must
   * not stay in the stack underneath its own destination.
   */
  replace?: boolean;
}) {
  return (
    <Link href={href as never} asChild replace={replace}>
      {/*
        Flattened on purpose: Link asChild merges the child's style by object
        spread, so an ARRAY style would become {0: …, 1: …} and blank the route.
      */}
      <Pressable
        style={StyleSheet.flatten(style)}
        testID={testID}
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
      >
        <Text style={textStyle}>{label}</Text>
      </Pressable>
    </Link>
  );
}
