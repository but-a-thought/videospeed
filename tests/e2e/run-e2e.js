#!/usr/bin/env node

/**
 * Cross-browser E2E runner.
 * Usage: node tests/e2e/run-e2e.js [suite] [--browser=chrome|firefox|all] [--headless]
 */

import { pathToFileURL, fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { startFixtureServer } from './fixture-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  await import('puppeteer');
} catch {
  console.error('❌ Puppeteer not found. Install it with: npm install');
  process.exit(1);
}

const suites = {
  youtube: 'youtube.e2e.js',
  basic: 'basic.e2e.js',
  settings: 'settings-injection.e2e.js',
  display: 'display-toggle.e2e.js',
  arbitration: 'speed-arbitration.e2e.js',
  lifecycle: 'lifecycle.e2e.js',
  bounds: 'controller-bounds.e2e.js',
};
const chromeDefault = [
  suites.basic,
  suites.display,
  suites.arbitration,
  suites.lifecycle,
  suites.bounds,
];
const firefoxDefault = [suites.basic, suites.display];

function parseArguments(args) {
  const browserArgument = args.find((argument) => argument.startsWith('--browser='));
  const browser = browserArgument?.slice('--browser='.length) || 'chrome';
  const headless = args.includes('--headless');
  const suite = args.find((argument) => !argument.startsWith('--')) || null;

  if (!['chrome', 'firefox', 'all'].includes(browser)) {
    throw new Error(`Unsupported browser "${browser}".`);
  }
  if (suite && !suites[suite] && suite !== 'all') {
    throw new Error(`Unknown E2E suite "${suite}".`);
  }
  return { browser, headless, suite };
}

function selectTestFiles(browser, suite) {
  if (suite && suite !== 'all') {
    return [suites[suite]];
  }
  return browser === 'firefox' ? firefoxDefault : chromeDefault;
}

async function runE2ETests() {
  const { browser, headless, suite } = parseArguments(process.argv.slice(2));
  if (headless) {
    process.env.VSC_HEADLESS = '1';
  }
  const browsers = browser === 'all' ? ['chrome', 'firefox'] : [browser];
  let totalPassed = 0;
  let totalFailed = 0;
  const fixtureServer = await startFixtureServer();
  process.env.VSC_FIXTURE_ORIGIN = fixtureServer.origin;

  console.log('🎭 Video Speed Controller - Cross-browser E2E Test Runner\n');
  console.log(`Serving local fixtures from ${fixtureServer.origin}\n`);

  for (const browserName of browsers) {
    process.env.VSC_BROWSER = browserName;
    const testFiles = selectTestFiles(browserName, suite);
    console.log(`Running ${testFiles.length} suite(s) in ${browserName}...\n`);

    for (const testFile of testFiles) {
      try {
        const testPath = join(__dirname, testFile);
        if (!existsSync(testPath)) {
          console.log(`   ⚠️  Test file not found: ${testFile}\n`);
          totalFailed++;
          continue;
        }

        console.log(`🎭 Running ${testFile} in ${browserName}...`);
        const testModule = await import(pathToFileURL(testPath).href);
        const testRunner = testModule.default || testModule.run;
        if (typeof testRunner !== 'function') {
          console.log(`   ⚠️  No test runner found in ${testFile}\n`);
          totalFailed++;
          continue;
        }

        const results = await testRunner();
        totalPassed += results.passed || 0;
        totalFailed += results.failed || 0;
        const status = (results.failed || 0) === 0 ? '✅' : '❌';
        console.log(`   ${status} ${results.passed || 0} passed, ${results.failed || 0} failed\n`);
      } catch (error) {
        console.log(`   💥 Error running ${testFile}: ${error.message}\n`);
        totalFailed++;
      }
    }
  }

  await fixtureServer.close();
  console.log('📊 E2E Test Summary');
  console.log('===================');
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

runE2ETests().catch((error) => {
  console.error(`💥 E2E test runner failed: ${error.message}`);
  process.exit(1);
});
