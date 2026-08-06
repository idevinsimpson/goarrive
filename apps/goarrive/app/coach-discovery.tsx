import React from 'react';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import DiscoveryExperience from '../components/coach-discovery/DiscoveryExperience';

export default function CoachDiscoveryRoute() {
  return (
    <>
      <Head>
        <title>Build Your Coaching Future | GoArrive</title>
        <meta
          name="description"
          content="Discover a more human way to build an online fitness coaching practice with GoArrive."
        />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Build Your Coaching Future | GoArrive" />
        <meta
          property="og:description"
          content="A phone-first story about serving members well, growing with support, and building a coaching future that lasts."
        />
        <meta property="og:url" content="https://goarrive.fit/coach-discovery" />
        <meta property="og:image" content="https://goarrive.fit/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Build Your Coaching Future | GoArrive" />
        <meta
          name="twitter:description"
          content="A phone-first story about serving members well, growing with support, and building a coaching future that lasts."
        />
        <meta name="twitter:image" content="https://goarrive.fit/og-image.png" />
        <link
          rel="preload"
          href="/fonts/space-grotesk-latin-500-700.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/dm-sans-latin-400-700.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="canonical" href="https://goarrive.fit/coach-discovery" />
      </Head>
      <Stack.Screen
        options={{
          title: 'Build Your Coaching Future | GoArrive',
          headerShown: false,
        }}
      />
      <DiscoveryExperience />
    </>
  );
}
