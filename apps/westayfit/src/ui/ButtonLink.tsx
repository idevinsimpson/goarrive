import { Link } from 'expo-router';
import { Pressable, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

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
  onPress,
}: {
  href: string;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  testID: string;
  label: string;
  /** Runs before the navigation (Link calls the child's onPress first). */
  onPress?: () => void;
}) {
  return (
    <Link href={href as never} asChild>
      <Pressable style={style} testID={testID} accessibilityRole="link" onPress={onPress}>
        <Text style={textStyle}>{label}</Text>
      </Pressable>
    </Link>
  );
}
