import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  createManifest,
  getOutputDirectory,
  parseBuildOptions,
} from '../../../scripts/build-config.mjs';

const baseManifest = {
  name: 'Video Speed Controller',
  version: '0.0.0',
  manifest_version: 3,
  minimum_chrome_version: '111',
  homepage_url: 'https://github.com/igrigorik/videospeed',
  background: {
    service_worker: 'background.js',
  },
  permissions: ['storage'],
};

describe('browser build configuration', () => {
  it('defaults to a non-release Chrome build and supports explicit Firefox release builds', () => {
    expect(parseBuildOptions([], {})).toEqual({ browser: 'chrome', release: false, watch: false });
    expect(parseBuildOptions(['--browser=firefox', '--release'], {})).toEqual({
      browser: 'firefox',
      release: true,
      watch: false,
    });
  });

  it('rejects unsupported targets and multi-browser watch mode', () => {
    expect(() => parseBuildOptions(['--browser=safari'], {})).toThrow('Unsupported browser');
    expect(() => parseBuildOptions(['--browser=all', '--watch'], {})).toThrow(
      'Watch mode requires one browser target'
    );
  });

  it('keeps the Chrome manifest unchanged apart from version injection', () => {
    const manifest = createManifest(baseManifest, '1.2.3', 'chrome');

    expect(manifest).toEqual({ ...baseManifest, version: '1.2.3' });
    expect(manifest.background).toEqual({ service_worker: 'background.js' });
    expect(manifest.browser_specific_settings).toBeUndefined();
    expect(baseManifest.version).toBe('0.0.0');
  });

  it('generates the Firefox 128+ manifest and stable AMO identity', () => {
    const manifest = createManifest(baseManifest, '1.2.3', 'firefox');

    expect(manifest).toMatchObject({
      name: 'Video Speed Controller — Community',
      version: '1.2.3',
      homepage_url: 'https://github.com/but-a-thought/videospeed',
      background: { scripts: ['background.js'] },
      browser_specific_settings: {
        gecko: {
          id: 'videospeed@but-a-thought.github',
          strict_min_version: '128.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    });
    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(manifest.background.service_worker).toBeUndefined();
  });

  it('separates Chrome and Firefox output directories', () => {
    const projectRoot = path.join('workspace', 'videospeed');
    expect(getOutputDirectory('chrome', projectRoot)).toBe(
      path.join(projectRoot, 'dist', 'chrome')
    );
    expect(getOutputDirectory('firefox', projectRoot)).toBe(
      path.join(projectRoot, 'dist', 'firefox')
    );
  });
});
