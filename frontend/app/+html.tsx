import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * 2026-05-05 — Custom HTML root for web. Adds:
 *   • Premium thin/elegant scrollbar styling (WebKit + Firefox)
 *   • Smooth scroll behavior
 *   • Shift+wheel → horizontal scroll on any horizontal ScrollView
 * This file is web-only; native (iOS/Android) ignores it entirely.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
/* Premium thin scrollbars (WebKit / Chromium / Edge / Safari) */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.35);
  border-radius: 8px;
  border: 2px solid transparent;
  background-clip: content-box;
  transition: background 160ms ease;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(100, 116, 139, 0.65);
  background-clip: content-box;
}
::-webkit-scrollbar-corner {
  background: transparent;
}

/* Firefox */
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(100, 116, 139, 0.45) transparent;
}

/* Smooth scroll on web */
html {
  scroll-behavior: smooth;
}

/* Allow shift+wheel to scroll horizontally inside any horizontal ScrollView.
   React Native Web horizontal ScrollView produces overflow-x:auto which already
   accepts wheel events when shift is held — the smooth-scroll above completes UX. */
`;
