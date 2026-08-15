#!/usr/bin/env node

/** Validate the generated extension without launching a browser. */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareReleaseFiles, RELEASE_FILES } from '../../scripts/release-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const browser =
  process.argv.find((argument) => argument.startsWith('--browser='))?.split('=')[1] || 'chrome';

if (!['chrome', 'firefox'].includes(browser)) {
  throw new Error(`Unsupported browser "${browser}".`);
}

const distDir = join(rootDir, 'dist', browser);
let failures = 0;

function check(label, condition) {
  console.log(`${condition ? '✅' : '❌'} ${label}`);
  if (!condition) {
    failures++;
  }
}

for (const file of RELEASE_FILES) {
  check(`${browser}: ${file}`, existsSync(join(distDir, file)));
}

const actualFiles = [];
function collectFiles(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectFiles(join(directory, entry.name), relativePath);
    } else {
      actualFiles.push(relativePath);
    }
  }
}
collectFiles(distDir);
const releaseContents = compareReleaseFiles(actualFiles);
check('No unexpected build files', releaseContents.unexpected.length === 0);

const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8'));
check('Manifest V3', manifest.manifest_version === 3);
check('Storage permission', manifest.permissions?.includes('storage'));
check(
  'MAIN-world script',
  manifest.content_scripts?.some((script) => script.world === 'MAIN')
);

if (browser === 'chrome') {
  check('Chrome service worker', manifest.background?.service_worker === 'background.js');
  check('No Firefox metadata', manifest.browser_specific_settings === undefined);
} else {
  check('Firefox background script', manifest.background?.scripts?.[0] === 'background.js');
  check(
    'Stable Gecko ID',
    manifest.browser_specific_settings?.gecko?.id === 'videospeed@but-a-thought.github'
  );
  check(
    'Firefox 128 minimum',
    manifest.browser_specific_settings?.gecko?.strict_min_version === '128.0'
  );
  check('No Chrome minimum', manifest.minimum_chrome_version === undefined);
}

process.exit(failures > 0 ? 1 : 0);
