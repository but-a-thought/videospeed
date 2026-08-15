import esbuild from 'esbuild';
import process from 'process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import { createRequire } from 'module';
import {
  SUPPORTED_BROWSERS,
  createManifest,
  getOutputDirectory,
  parseBuildOptions,
} from './build-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const pkg = require(path.join(rootDir, 'package.json'));

function getEsbuildTarget(browser) {
  return browser === 'firefox' ? 'firefox128' : 'chrome114';
}

async function copyStaticFiles(browser, outDir, release) {
  await fs.emptyDir(outDir);

  const baseManifest = await fs.readJson(path.join(rootDir, 'manifest.json'));
  const manifest = createManifest(baseManifest, pkg.version, browser);
  await fs.writeJson(path.join(outDir, 'manifest.json'), manifest, { spaces: 2 });
  console.log(`✅ ${browser} manifest version set to ${pkg.version}${release ? ' (release)' : ''}`);

  const pathsToCopy = {
    'src/assets': path.join(outDir, 'assets'),
    'src/ui': path.join(outDir, 'ui'),
    'src/styles': path.join(outDir, 'styles'),
    LICENSE: path.join(outDir, 'LICENSE'),
    'CONTRIBUTING.md': path.join(outDir, 'CONTRIBUTING.md'),
    'PRIVACY.md': path.join(outDir, 'PRIVACY.md'),
    'README.md': path.join(outDir, 'README.md'),
  };

  for (const [source, destination] of Object.entries(pathsToCopy)) {
    await fs.copy(path.join(rootDir, source), destination, {
      filter: (sourcePath) => !path.basename(sourcePath).endsWith('.js'),
    });
  }
}

async function buildBrowser(browser, { release, watch }) {
  const outDir = getOutputDirectory(browser, rootDir);
  await copyStaticFiles(browser, outDir, release);

  const esbuildConfig = {
    bundle: true,
    sourcemap: false,
    minify: release,
    target: getEsbuildTarget(browser),
    platform: 'browser',
    legalComments: 'none',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    entryPoints: {
      'content-bridge': 'src/entries/content-bridge.js',
      inject: 'src/entries/inject-entry.js',
      background: 'src/background.js',
      'ui/popup/popup': 'src/ui/popup/popup.js',
      'ui/options/options': 'src/ui/options/options.js',
    },
    outdir: path.relative(rootDir, outDir),
  };

  if (watch) {
    const context = await esbuild.context(esbuildConfig);
    await context.watch();
    console.log(`🔧 Watching ${browser} build...`);
    return;
  }

  await esbuild.build(esbuildConfig);
  console.log(`✅ ${browser} build complete`);
}

export async function build(options = parseBuildOptions()) {
  const browsers = options.browser === 'all' ? SUPPORTED_BROWSERS : [options.browser];
  if (options.browser === 'all') {
    await fs.emptyDir(path.join(rootDir, 'dist'));
  }
  for (const browser of browsers) {
    await buildBrowser(browser, options);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  build().catch((error) => {
    console.error('❌ Build failed:', error);
    process.exit(1);
  });
}
