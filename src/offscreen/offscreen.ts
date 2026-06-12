// Theme watcher. The service worker has no `matchMedia`, so this tiny offscreen
// document is the only place that can read the OS light/dark preference. It
// reports the current scheme to the background on load, on every change, and
// whenever the SW asks (it may restart and lose the last value). The background
// then swaps the toolbar icon to the light- or dark-optimized PNG set.

import type { ThemeReport } from '../types/messages';

const media = matchMedia('(prefers-color-scheme: dark)');

function report(): void {
  const msg: ThemeReport = { action: 'XCLIPPER_THEME', dark: media.matches };
  chrome.runtime.sendMessage(msg).catch(() => {
    // SW may be asleep mid-send; it re-queries on its next startup.
  });
}

media.addEventListener('change', report);

// The SW pings when it (re)starts and finds the document already open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === 'XCLIPPER_THEME_QUERY') report();
  return false;
});

report();
