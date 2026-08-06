// Web-only root HTML template for Expo Router static rendering.
// Learn more: https://docs.expo.dev/router/reference/static-rendering/#root-html
//
// KEY RULE: All text inputs, textareas, and selects MUST render at font-size
// >= 16px on mobile web. iOS Safari auto-zooms the viewport whenever a focused
// input has a font-size below 16px. The global CSS rule below prevents that
// focus zoom while preserving intentional pinch-to-zoom for accessibility.
import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        {/* PWA / App identity */}
        <meta name="application-name" content="GoArrive" />
        <meta name="theme-color" content="#0E1117" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="GoArrive" />

        {/* PWA Manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Favicon */}
        <link rel="icon" type="image/png" href="/favicon.png" />

        {/* iOS home screen icon */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

        <ScrollViewStyleReset />
        {/*
          Global rule: every input, textarea, and select must be at least 16px.
          iOS zooms when font-size < 16px; this avoids the focus jump without
          limiting the user's accessibility zoom controls.
          Going forward, any new input component added to the app inherits this
          rule automatically — no per-component override needed.
        */}
        <style>{`
          input, textarea, select {
            font-size: 16px !important;
          }
          /*
            iOS Safari hijacks long-press on media: the Share/Save callout on
            images and the text-selection magnifier both fire before our
            600ms drag gesture activates. Suppressing them globally is safe
            here — this is an app shell, not a document site, so users never
            need to save/select tile media.
          */
          img, video {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
            -webkit-user-drag: none;
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
