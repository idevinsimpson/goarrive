import { router } from 'expo-router';
import { signOut } from 'firebase/auth';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { forgetCurrentCommunity } from '../src/currentCommunity';
import { getFirebaseAuth } from '../src/firebase';
import { kit } from '../src/ui/kit';
import { WsfWordmark } from '../src/ui/WsfWordmark';

/**
 * YOU — identity, and the way out.
 *
 * Deliberately small. Everything a person might look for here that the
 * product does not yet have — a photo, a profile a stranger could read, a
 * setting that changes what others see — is absent because it does not exist,
 * not because it did not fit. Nothing on this screen is a placeholder for a
 * feature that has not been built.
 */
export default function YouScreen() {
  const { ready, user } = useWsfAuth();
  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} testID="wsf-you">
      <View style={kit.columnNarrow}>
        {/* The wordmark returns Home from every surface that carries it. */}
        <Pressable
          onPress={() => router.replace('/')}
          accessibilityRole="link"
          accessibilityLabel="We Stay Fit, go Home"
          style={{ minHeight: 44, justifyContent: 'center' }}
          testID="wsf-you-wordmark-home"
        >
          <WsfWordmark variant="navy" height={22} testID="wsf-you-wordmark" />
        </Pressable>

        <Text style={kit.heading} testID="wsf-you-title">You</Text>

        {!ready ? (
          <Text style={kit.statusText} testID="wsf-you-loading">Loading…</Text>
        ) : user ? (
          <>
            <View style={kit.cardQuiet} testID="wsf-you-identity">
              <Text style={kit.eyebrow}>Signed in as</Text>
              {/* The email, because it is the identity they signed in with
                  and the one thing they can check. It is theirs, on their own
                  device, and it appears on no public surface. */}
              <Text style={kit.body} testID="wsf-you-email">{user.email ?? 'this device'}</Text>
            </View>

            <Pressable
              onPress={() => {
                // Forget which community was open before the account goes:
                // the next person to sign in on this device starts from their
                // own communities, not from a trace of the last one.
                forgetCurrentCommunity(user.uid);
                void signOut(getFirebaseAuth()).then(() => router.replace('/'));
              }}
              style={kit.secondaryButton}
              testID="wsf-you-signout"
              accessibilityRole="button"
            >
              <Text style={kit.secondaryButtonText}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <View style={kit.cardQuiet} testID="wsf-you-signed-out">
            <Text style={kit.body}>You are not signed in.</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

