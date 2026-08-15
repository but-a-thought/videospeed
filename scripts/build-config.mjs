import path from 'path';
import process from 'process';

export const SUPPORTED_BROWSERS = ['chrome', 'firefox'];

export function parseBuildOptions(args = process.argv.slice(2), env = process.env) {
  let browser = 'chrome';
  let release = env.RELEASE === '1';
  let watch = false;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--watch') {
      watch = true;
    } else if (argument === '--release') {
      release = true;
    } else if (argument === '--browser') {
      browser = args[index + 1];
      index++;
    } else if (argument.startsWith('--browser=')) {
      browser = argument.slice('--browser='.length);
    } else {
      throw new Error(`Unknown build argument: ${argument}`);
    }
  }

  if (![...SUPPORTED_BROWSERS, 'all'].includes(browser)) {
    throw new Error(`Unsupported browser "${browser}". Expected chrome, firefox, or all.`);
  }
  if (watch && browser === 'all') {
    throw new Error('Watch mode requires one browser target.');
  }

  return { browser, release, watch };
}

export function createManifest(baseManifest, version, browser) {
  if (!SUPPORTED_BROWSERS.includes(browser)) {
    throw new Error(`Unsupported browser "${browser}".`);
  }

  const manifest = structuredClone(baseManifest);
  manifest.version = version;

  if (browser === 'firefox') {
    manifest.name = 'Video Speed Controller — Community';
    manifest.homepage_url = 'https://github.com/but-a-thought/videospeed';
    delete manifest.minimum_chrome_version;
    manifest.background = {
      scripts: ['background.js'],
    };
    manifest.browser_specific_settings = {
      gecko: {
        id: 'videospeed@but-a-thought.github',
        strict_min_version: '128.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    };
  }

  return manifest;
}

export function getOutputDirectory(browser, projectRoot) {
  if (!SUPPORTED_BROWSERS.includes(browser)) {
    throw new Error(`Unsupported browser "${browser}".`);
  }
  return path.join(projectRoot, 'dist', browser);
}
