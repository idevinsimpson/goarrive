/** The beta entry shares the scheduled player and its single consent/lifecycle owner. */
import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { workoutReturnPath } from '../../lib/workoutReturnPath';
export default function JoinScheduledSession() {
  const { sessionInstanceId } = useLocalSearchParams<{ sessionInstanceId: string }>();
  const { user, loading, claims } = useAuth();
  if (loading) return null;
  const destination = workoutReturnPath(`/live-session/${sessionInstanceId}`);
  if (!destination) return <Text>Invalid session link.</Text>;
  if (!user) return <Redirect href={{ pathname: '/login', params: { returnTo: destination } }} />;
  if (claims?.role === 'coach') return <Redirect href={`/live-view/${sessionInstanceId}` as any} />;
  return <Redirect href={destination as any} />;
}
