export const RELEASE_FILES = [
  'CONTRIBUTING.md',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  'assets/icons/icon128.png',
  'assets/icons/icon16.png',
  'assets/icons/icon19.png',
  'assets/icons/icon19_disabled.png',
  'assets/icons/icon38.png',
  'assets/icons/icon38_disabled.png',
  'assets/icons/icon48.png',
  'assets/icons/icon48_disabled.png',
  'background.js',
  'content-bridge.js',
  'inject.js',
  'manifest.json',
  'styles/inject.css',
  'ui/options/options.css',
  'ui/options/options.html',
  'ui/options/options.js',
  'ui/popup/popup.css',
  'ui/popup/popup.html',
  'ui/popup/popup.js',
];

export function compareReleaseFiles(entries) {
  const files = entries.filter((entry) => !entry.endsWith('/'));
  const expected = new Set(RELEASE_FILES);
  const actual = new Set(files);
  return {
    missing: RELEASE_FILES.filter((entry) => !actual.has(entry)),
    unexpected: files.filter((entry) => !expected.has(entry)),
  };
}
