import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { ZipArchive } from 'archiver';
import { compareReleaseFiles } from './release-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = require(path.join(rootDir, 'package.json'));

const releaseDir = path.join(rootDir, 'release');
const CWS_SIZE_LIMIT = 128 * 1024 * 1024;
const AMO_SIZE_LIMIT = 200 * 1024 * 1024;

export const releaseArtifacts = [
  {
    browser: 'chrome',
    sourceDir: path.join(rootDir, 'dist', 'chrome'),
    zipName: `videospeed-${pkg.version}.zip`,
    sizeLimit: CWS_SIZE_LIMIT,
    storeName: 'Chrome Web Store',
  },
  {
    browser: 'firefox',
    sourceDir: path.join(rootDir, 'dist', 'firefox'),
    zipName: `videospeed-firefox-${pkg.version}.zip`,
    sizeLimit: AMO_SIZE_LIMIT,
    storeName: 'Firefox Add-ons',
  },
];

const sourceZipName = `videospeed-source-${pkg.version}.zip`;
const sourcePatterns = [
  '.github/**/*',
  '.husky/**/*',
  'docs/**/*',
  'scripts/**/*',
  'specs/**/*',
  'src/**/*',
  'tests/**/*',
  '.editorconfig',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  'CONTRIBUTING.md',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  'eslint.config.js',
  'manifest.json',
  'package.json',
  'package-lock.json',
  'vitest.config.js',
];
const sourceExcludes = [
  '**/.DS_Store',
  'tests/e2e/screenshots/**',
  'specs/states/**',
  'specs/*_TTrace_*',
];

async function writeZip(zipPath, appendEntries) {
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);
  appendEntries(archive);
  await archive.finalize();
  await done;
}

async function validateBrowserBuild(artifact) {
  if (!(await fs.pathExists(artifact.sourceDir))) {
    throw new Error(
      `${artifact.browser} dist directory not found. Run "npm run build:release" first.`
    );
  }

  const manifest = await fs.readJson(path.join(artifact.sourceDir, 'manifest.json'));
  const buildEntries = [];
  async function collectFiles(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await collectFiles(path.join(directory, entry.name), relativePath);
      } else {
        buildEntries.push(relativePath);
      }
    }
  }
  await collectFiles(artifact.sourceDir);
  const { missing, unexpected } = compareReleaseFiles(buildEntries);
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${artifact.browser} build contents are invalid (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}).`
    );
  }
  if (manifest.version !== pkg.version) {
    throw new Error(
      `${artifact.browser} manifest has ${manifest.version}; package.json has ${pkg.version}`
    );
  }
  if (artifact.browser === 'chrome' && manifest.background?.service_worker !== 'background.js') {
    throw new Error('Chrome manifest is missing background.service_worker.');
  }
  if (
    artifact.browser === 'firefox' &&
    (manifest.background?.scripts?.[0] !== 'background.js' ||
      manifest.browser_specific_settings?.gecko?.id !== 'videospeed@but-a-thought.github')
  ) {
    throw new Error('Firefox manifest is missing its background script or stable Gecko ID.');
  }
}

async function packageBrowser(artifact) {
  await validateBrowserBuild(artifact);
  const zipPath = path.join(releaseDir, artifact.zipName);

  await writeZip(zipPath, (archive) => {
    archive.directory(artifact.sourceDir, false, (entry) => {
      if (entry.name.endsWith('.map') || entry.name === '.DS_Store') {
        return false;
      }
      return entry;
    });
  });

  const stats = await fs.stat(zipPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  if (stats.size > artifact.sizeLimit) {
    console.warn(
      `⚠️  ${artifact.zipName} is ${sizeMB} MB (${artifact.storeName} limit is ${
        artifact.sizeLimit / (1024 * 1024)
      } MB)`
    );
  }
  console.log(`✅ Packaged ${artifact.zipName} (${sizeMB} MB) → release/`);
}

async function packageSource() {
  const zipPath = path.join(releaseDir, sourceZipName);
  await writeZip(zipPath, (archive) => {
    for (const pattern of sourcePatterns) {
      archive.glob(pattern, {
        cwd: rootDir,
        dot: true,
        ignore: sourceExcludes,
      });
    }
  });

  const stats = await fs.stat(zipPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`✅ Packaged ${sourceZipName} (${sizeMB} MB) → release/`);
}

export async function packageRelease() {
  await fs.ensureDir(releaseDir);
  for (const artifact of releaseArtifacts) {
    await packageBrowser(artifact);
  }
  await packageSource();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageRelease().catch((error) => {
    console.error(`❌ Packaging failed: ${error.message}`);
    process.exit(1);
  });
}
