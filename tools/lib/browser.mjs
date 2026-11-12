// A Chromium for the repository's tools (icons, the tutorial recorder), through playwright-core.
// Uses CHROME_PATH when set, otherwise the first Chrome, Edge, Chromium or Playwright browser it finds.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

export function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA || '', pf = process.env.PROGRAMFILES || 'C:\\Program Files', pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    join(pf, 'Google/Chrome/Application/chrome.exe'), join(pf86, 'Google/Chrome/Application/chrome.exe'), join(local, 'Google/Chrome/Application/chrome.exe'),
    join(pf86, 'Microsoft/Edge/Application/msedge.exe'), join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  // browsers installed by `npx playwright install chromium`
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32' ? join(local, 'ms-playwright') : join(process.env.HOME || '', process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright'));
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      candidates.push(join(pw, d, 'chrome-win64/chrome.exe'), join(pw, d, 'chrome-win/chrome.exe'), join(pw, d, 'chrome-linux64/chrome'), join(pw, d, 'chrome-linux/chrome'), join(pw, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'));
    }
  }
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error('No Chrome, Edge or Chromium found. Install one, or set CHROME_PATH.');
  return hit;
}

/** ffmpeg: FFMPEG_PATH, then the one Playwright downloads with its browsers, then ffmpeg on the PATH. */
export function findFfmpeg() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  const local = process.env.LOCALAPPDATA || '';
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32' ? join(local, 'ms-playwright') : join(process.env.HOME || '', process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright'));
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((x) => x.startsWith('ffmpeg-')).sort().reverse()) {
      for (const f of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) if (existsSync(join(pw, d, f))) return join(pw, d, f);
    }
  }
  return 'ffmpeg';
}

export const launch = (opts = {}) => chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb'], ...opts });
