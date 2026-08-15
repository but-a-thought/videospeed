// @vitest-environment node

import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { ZipArchive } from 'archiver';
import {
  findSuccessfulCiRun,
  inspectReleaseZip,
  inspectSourceZip,
  parseGitHubRepo,
  parseRemoteTagRefs,
  prepareReleaseNotes,
} from '../../../scripts/github-release.js';
import { RELEASE_FILES } from '../../../scripts/release-config.mjs';

const temporaryDirectories = [];

async function createZip(entries) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vsc-release-test-'));
  temporaryDirectories.push(directory);
  const zipPath = path.join(directory, 'release.zip');
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);
  for (const [name, contents] of Object.entries(entries)) {
    archive.append(contents, { name });
  }
  await archive.finalize();
  await done;
  return zipPath;
}

function releaseEntries(manifest, extraEntries = {}) {
  return {
    ...Object.fromEntries(RELEASE_FILES.map((name) => [name, 'fixture'])),
    'manifest.json': JSON.stringify(manifest),
    ...extraEntries,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('GitHub release helpers', () => {
  it('removes repository-only title and status lines from curated notes', () => {
    const source = [
      '# Release 0.11.0',
      '',
      'Status: Released 2026-08-01.',
      '',
      '## Playback',
      '',
      '- Fixed playback.',
      '',
    ].join('\r\n');

    expect(prepareReleaseNotes(source)).toBe('## Playback\n\n- Fixed playback.\n');
  });

  it('derives the GitHub repository from HTTPS and SSH origin URLs', () => {
    expect(parseGitHubRepo('https://github.com/igrigorik/videospeed.git')).toBe(
      'igrigorik/videospeed'
    );
    expect(parseGitHubRepo('git@github.com:igrigorik/videospeed.git')).toBe('igrigorik/videospeed');
    expect(parseGitHubRepo('ssh://git@github.com/igrigorik/videospeed.git')).toBe(
      'igrigorik/videospeed'
    );
  });

  it('rejects lookalike hosts and malformed GitHub paths', () => {
    expect(parseGitHubRepo('https://notgithub.com/igrigorik/videospeed.git')).toBeNull();
    expect(parseGitHubRepo('https://github.com/igrigorik/videospeed/extra.git')).toBeNull();
  });

  it('keeps direct and peeled remote tag refs distinct', () => {
    const output = ['aaaaaaaa refs/tags/v0.11.0', 'bbbbbbbb refs/tags/v0.11.0^{}'].join('\n');

    expect(parseRemoteTagRefs(output, 'v0.11.0')).toEqual({
      direct: 'aaaaaaaa',
      peeled: 'bbbbbbbb',
    });
  });

  it('does not mistake a lightweight tag for an annotated tag', () => {
    expect(parseRemoteTagRefs('aaaaaaaa refs/tags/v0.11.0', 'v0.11.0')).toEqual({
      direct: 'aaaaaaaa',
      peeled: null,
    });
  });

  it('selects only successful push CI for the exact commit', () => {
    const runs = [
      { headSha: 'target', event: 'pull_request', status: 'completed', conclusion: 'success' },
      { headSha: 'other', event: 'push', status: 'completed', conclusion: 'success' },
      { headSha: 'target', event: 'push', status: 'completed', conclusion: 'success' },
    ];

    expect(findSuccessfulCiRun(runs, 'target')).toBe(runs[2]);
  });

  it('validates the embedded manifest version and release contents', async () => {
    const zipPath = await createZip(releaseEntries({ version: '0.11.0' }));

    const result = inspectReleaseZip(zipPath, '0.11.0');
    expect(result.manifest.version).toBe('0.11.0');
    expect(result.entries).toContain('inject.js');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects wrong-version archives and source maps', async () => {
    const wrongVersion = await createZip(releaseEntries({ version: '0.10.2' }));
    const sourceMap = await createZip(
      releaseEntries({ version: '0.11.0' }, { 'inject.js.map': '{}' })
    );

    expect(() => inspectReleaseZip(wrongVersion, '0.11.0')).toThrow(
      'manifest version is 0.10.2, expected 0.11.0'
    );
    expect(() => inspectReleaseZip(sourceMap, '0.11.0')).toThrow(
      'source maps must not be published'
    );
  });

  it('rejects unexpected release files', async () => {
    const zipPath = await createZip(
      releaseEntries({ version: '0.11.0' }, { 'unexpected.txt': 'nope' })
    );

    expect(() => inspectReleaseZip(zipPath, '0.11.0')).toThrow(
      'unexpected files are present: unexpected.txt'
    );
  });

  it('validates browser-specific release manifests', async () => {
    const chromeZip = await createZip(
      releaseEntries({
        version: '0.11.0',
        background: { service_worker: 'background.js' },
      })
    );
    const firefoxZip = await createZip(
      releaseEntries({
        version: '0.11.0',
        background: { scripts: ['background.js'] },
        browser_specific_settings: {
          gecko: { id: 'videospeed@but-a-thought.github' },
        },
      })
    );

    expect(inspectReleaseZip(chromeZip, '0.11.0', 'chrome').manifest.background).toEqual({
      service_worker: 'background.js',
    });
    expect(inspectReleaseZip(firefoxZip, '0.11.0', 'firefox').manifest.background).toEqual({
      scripts: ['background.js'],
    });
  });

  it('validates the reproducible AMO reviewer source archive', async () => {
    const sourceZip = await createZip({
      'package.json': JSON.stringify({ version: '0.11.0' }),
      'package-lock.json': '{}',
      'manifest.json': '{}',
      'scripts/build-config.mjs': 'export {};',
      'scripts/build.mjs': 'export {};',
      'scripts/release-config.mjs': 'export {};',
      'src/entries/content-bridge.js': 'export {};',
      'docs/firefox-reviewer-build.md': '# Firefox reviewer build',
      'docs/release.md': '# Release',
    });

    const result = inspectSourceZip(sourceZip, '0.11.0');
    expect(result.entries).toContain('src/entries/content-bridge.js');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
