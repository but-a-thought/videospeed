import crypto from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import AdmZip from 'adm-zip';
import { compareReleaseFiles } from './release-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = require(path.join(rootDir, 'package.json'));

const version = pkg.version;
const tag = `v${version}`;
const releaseDir = path.join(rootDir, 'release');
const zipName = `videospeed-${version}.zip`;
const firefoxZipName = `videospeed-firefox-${version}.zip`;
const sourceZipName = `videospeed-source-${version}.zip`;
const releaseFiles = [zipName, firefoxZipName, sourceZipName];
const curatedNotesPath = path.join(rootDir, 'docs', `release-${version}.md`);
const artifactName = 'videospeed-release-node-22.x';
const dryRun = process.argv.includes('--dry-run');

function runFile(command, args) {
  return execFileSync(command, args, { encoding: 'utf-8', cwd: rootDir }).trim();
}

function check(label, condition, message) {
  if (!condition) {
    throw new Error(`${label}: ${message}`);
  }
}

export function prepareReleaseNotes(source) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');

  if (/^#\s+Release\b/.test(lines[0] || '')) {
    lines.shift();
  }
  while (lines[0]?.trim() === '') {
    lines.shift();
  }
  if (/^Status:/i.test(lines[0] || '')) {
    lines.shift();
  }
  while (lines[0]?.trim() === '') {
    lines.shift();
  }

  return `${lines.join('\n').trim()}\n`;
}

export function parseGitHubRepo(remoteUrl) {
  const normalized = remoteUrl.trim().replace(/\.git$/, '');
  const scpMatch = normalized.match(/^git@github\.com:([^/:\s]+\/[^/\s]+)$/);
  if (scpMatch) {
    return scpMatch[1];
  }

  try {
    const url = new URL(normalized);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (url.hostname !== 'github.com' || pathParts.length !== 2) {
      return null;
    }
    return pathParts.join('/');
  } catch {
    return null;
  }
}

export function parseRemoteTagRefs(output, tagName) {
  const refs = { direct: null, peeled: null };

  for (const line of output.split('\n').filter(Boolean)) {
    const [commit, ref] = line.split(/\s+/);
    if (ref === `refs/tags/${tagName}^{}`) {
      refs.peeled = commit;
    } else if (ref === `refs/tags/${tagName}`) {
      refs.direct = commit;
    }
  }

  return refs;
}

export function findSuccessfulCiRun(runs, commit) {
  return runs.find(
    (run) =>
      run.headSha === commit &&
      run.event === 'push' &&
      run.status === 'completed' &&
      run.conclusion === 'success'
  );
}

export function inspectReleaseZip(archivePath, expectedVersion, browser = null) {
  const zip = new AdmZip(fs.readFileSync(archivePath), { readEntries: true });
  const zipEntries = zip.getEntries();
  const entries = zipEntries.map((entry) => entry.entryName);
  const unsafeEntry = entries.find(
    (entry) => entry.startsWith('/') || entry.split('/').includes('..')
  );
  check('Release zip', !unsafeEntry, `archive contains unsafe path ${unsafeEntry}`);
  check('Release zip', entries.includes('manifest.json'), 'manifest.json is missing');
  check(
    'Release zip',
    !entries.some((entry) => entry.endsWith('.map')),
    'source maps must not be published'
  );
  const { missing, unexpected } = compareReleaseFiles(entries);
  check('Release zip', missing.length === 0, `required files are missing: ${missing.join(', ')}`);
  check(
    'Release zip',
    unexpected.length === 0,
    `unexpected files are present: ${unexpected.join(', ')}`
  );

  const manifestEntry = zip.getEntry('manifest.json');
  const manifest = JSON.parse(Buffer.from(manifestEntry.getData()).toString('utf8'));
  check(
    'Release zip',
    manifest.version === expectedVersion,
    `manifest version is ${manifest.version}, expected ${expectedVersion}`
  );

  if (browser === 'chrome') {
    check(
      'Release zip',
      manifest.background?.service_worker === 'background.js' && !manifest.background?.scripts,
      'Chrome manifest background is invalid'
    );
  } else if (browser === 'firefox') {
    check(
      'Release zip',
      manifest.background?.scripts?.[0] === 'background.js' && !manifest.background?.service_worker,
      'Firefox manifest background is invalid'
    );
    check(
      'Release zip',
      manifest.browser_specific_settings?.gecko?.id === 'videospeed@but-a-thought.github',
      'Firefox manifest Gecko ID is invalid'
    );
  }

  for (const entry of zipEntries) {
    if (!entry.isDirectory && entry !== manifestEntry) {
      entry.getData();
    }
  }

  return {
    entries,
    manifest,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex'),
  };
}

export function inspectSourceZip(archivePath, expectedVersion) {
  const zip = new AdmZip(fs.readFileSync(archivePath), { readEntries: true });
  const zipEntries = zip.getEntries();
  const entries = zipEntries.map((entry) => entry.entryName);
  for (const requiredFile of [
    'package.json',
    'package-lock.json',
    'manifest.json',
    'scripts/build-config.mjs',
    'scripts/build.mjs',
    'scripts/release-config.mjs',
    'src/entries/content-bridge.js',
    'docs/firefox-reviewer-build.md',
    'docs/release.md',
  ]) {
    check('Source zip', entries.includes(requiredFile), `${requiredFile} is missing`);
  }
  check(
    'Source zip',
    !entries.some((entry) => entry.startsWith('node_modules/') || entry.startsWith('dist/')),
    'generated dependencies or build output must not be published as reviewer source'
  );

  const packageEntry = zip.getEntry('package.json');
  const sourcePackage = JSON.parse(Buffer.from(packageEntry.getData()).toString('utf8'));
  check(
    'Source zip',
    sourcePackage.version === expectedVersion,
    `package version is ${sourcePackage.version}, expected ${expectedVersion}`
  );
  for (const entry of zipEntries) {
    if (!entry.isDirectory && entry !== packageEntry) {
      entry.getData();
    }
  }

  return {
    entries,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex'),
  };
}

function getReleaseContext() {
  runFile('gh', ['--version']);
  runFile('gh', ['auth', 'status', '--hostname', 'github.com']);

  check(
    'Git worktree',
    runFile('git', ['status', '--porcelain', '--untracked-files=all']) === '',
    'tracked or untracked changes remain; commit or remove them before creating a release'
  );

  const notesRelativePath = path.relative(rootDir, curatedNotesPath).split(path.sep).join('/');
  check('Curated notes', fs.existsSync(curatedNotesPath), `${notesRelativePath} not found`);
  try {
    runFile('git', ['ls-files', '--error-unmatch', notesRelativePath]);
  } catch {
    check('Curated notes', false, `${notesRelativePath} is not tracked by Git`);
  }

  const curatedNotes = fs.readFileSync(curatedNotesPath, 'utf8');
  check(
    'Curated notes',
    !/^Status:\s*DRAFT\b/im.test(curatedNotes),
    'remove the Status: DRAFT marker before creating the release'
  );
  const notes = prepareReleaseNotes(curatedNotes);
  check('Curated notes', notes.trim().length > 0, 'release notes are empty');

  const originUrl = runFile('git', ['remote', 'get-url', 'origin']);
  const repoPath = parseGitHubRepo(originUrl);
  check('Git remote', Boolean(repoPath), `origin is not a supported GitHub URL: ${originUrl}`);
  const repo = `github.com/${repoPath}`;

  const headCommit = runFile('git', ['rev-parse', 'HEAD']);
  const remoteMasterOutput = runFile('git', ['ls-remote', 'origin', 'refs/heads/master']);
  const remoteMasterCommit = remoteMasterOutput.split(/\s+/)[0] || null;
  check('Remote master', Boolean(remoteMasterCommit), 'origin/master not found');
  check(
    'Remote master',
    remoteMasterCommit === headCommit,
    `origin/master is ${remoteMasterCommit}, not HEAD ${headCommit}`
  );

  const tagType = runFile('git', ['cat-file', '-t', tag]);
  check('Git tag', tagType === 'tag', `${tag} must be an annotated tag`);
  const tagCommit = runFile('git', ['rev-parse', `${tag}^{commit}`]);
  const tagObject = runFile('git', ['rev-parse', tag]);
  check('Git tag', tagCommit === headCommit, `${tag} does not point at HEAD ${headCommit}`);

  const remoteTagOutput = runFile('git', [
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  const remoteTagRefs = parseRemoteTagRefs(remoteTagOutput, tag);
  check('Remote tag', Boolean(remoteTagRefs.direct), `${tag} has not been pushed to origin`);
  check('Remote tag', Boolean(remoteTagRefs.peeled), `origin/${tag} is not annotated`);
  check(
    'Remote tag',
    remoteTagRefs.direct === tagObject,
    `origin/${tag} is not the local annotated tag object`
  );
  check(
    'Remote tag',
    remoteTagRefs.peeled === headCommit,
    `origin/${tag} resolves to ${remoteTagRefs.peeled}, not HEAD ${headCommit}`
  );

  const runs = JSON.parse(
    runFile('gh', [
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      'CI',
      '--commit',
      headCommit,
      '--limit',
      '10',
      '--json',
      'databaseId,headSha,event,status,conclusion,url',
    ])
  );
  const ciRun = findSuccessfulCiRun(runs, headCommit);
  check('Exact-commit CI', Boolean(ciRun), `no successful CI push run found for ${headCommit}`);

  return { repo, headCommit, notes, ciRun };
}

async function createRelease() {
  const { repo, notes, ciRun } = getReleaseContext();
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), `vsc-release-${ciRun.databaseId}-`));
  const notesFile = path.join(artifactDir, 'release-notes.md');

  try {
    runFile('gh', [
      'run',
      'download',
      String(ciRun.databaseId),
      '--repo',
      repo,
      '--name',
      artifactName,
      '--dir',
      artifactDir,
    ]);
    for (const fileName of releaseFiles) {
      check(
        'CI artifact',
        await fs.pathExists(path.join(artifactDir, fileName)),
        `${fileName} was not present in ${artifactName}`
      );
    }

    const chromeArchive = inspectReleaseZip(path.join(artifactDir, zipName), version, 'chrome');
    const firefoxArchive = inspectReleaseZip(
      path.join(artifactDir, firefoxZipName),
      version,
      'firefox'
    );
    const sourceArchive = inspectSourceZip(path.join(artifactDir, sourceZipName), version);
    console.log(`✅ Exact-commit CI: ${ciRun.url}`);
    console.log(`✅ Chrome SHA-256: ${chromeArchive.sha256}`);
    console.log(`✅ Firefox SHA-256: ${firefoxArchive.sha256}`);
    console.log(`✅ Reviewer source SHA-256: ${sourceArchive.sha256}`);

    const args = [
      'release',
      'create',
      tag,
      ...releaseFiles.map((fileName) => path.join(releaseDir, fileName)),
      '--repo',
      repo,
      '--title',
      tag,
      '--notes-file',
      notesFile,
      '--draft',
      '--verify-tag',
    ];

    if (dryRun) {
      console.log(`✅ Release inputs verified for ${tag}`);
      console.log(`   Would create a draft in ${repo} with the verified CI artifact.`);
      return;
    }

    await fs.ensureDir(releaseDir);
    for (const fileName of releaseFiles) {
      await fs.copy(path.join(artifactDir, fileName), path.join(releaseDir, fileName), {
        overwrite: true,
      });
    }
    await fs.writeFile(notesFile, notes);
    const result = runFile('gh', args);
    console.log(`✅ Draft release created: ${result}`);
    console.log(
      '   Review the tag, notes, archive, manifest version, and checksum before publishing.'
    );
  } finally {
    await fs.remove(artifactDir);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createRelease().catch((error) => {
    console.error(`❌ Release creation failed: ${error.message}`);
    process.exit(1);
  });
}
