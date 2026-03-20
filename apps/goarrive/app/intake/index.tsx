/**
 * Intake index — Redirect to login if no coachId provided
 */
import { Redirect } from 'expo-router';

export default function IntakeIndex() {
  return <Redirect href="/(auth)/login" />;
}
