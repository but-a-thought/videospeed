/**
 * Basic E2E tests for Video Speed Controller extension
 */

import {
  launchChromeWithExtension,
  getFixtureUrl,
  waitForExtension,
  waitForVideo,
  waitForController,
  getVideoSpeed,
  controlVideo,
  controlQuickSpeed,
  testKeyboardShortcut,
  getControllerSpeedDisplay,
  takeScreenshot,
  assert,
  sleep,
} from './e2e-utils.js';

export default async function runBasicE2ETests() {
  console.log('🎭 Running Basic E2E Tests...\n');

  let browser;
  let passed = 0;
  let failed = 0;

  const runTest = async (testName, testFn) => {
    try {
      console.log(`   🧪 ${testName}`);
      await testFn();
      console.log(`   ✅ ${testName}`);
      passed++;
    } catch (error) {
      console.log(`   ❌ ${testName}: ${error.message}`);
      failed++;
    }
  };

  try {
    const {
      browser: chromeBrowser,
      page,
      browserName,
      extensionOrigin,
    } = await launchChromeWithExtension();
    browser = chromeBrowser;

    if (browserName === 'chrome') {
      await runTest(`Background, options, and popup should load in ${browserName}`, async () => {
        assert.exists(extensionOrigin, 'Extension background target should expose an origin');
        for (const extensionPagePath of ['ui/options/options.html', 'ui/popup/popup.html']) {
          const extensionPage = await browser.newPage();
          try {
            await extensionPage.goto(`${extensionOrigin}/${extensionPagePath}`, {
              waitUntil: 'domcontentloaded',
            });
            const hasContent = await extensionPage.evaluate(
              () => document.body.childElementCount > 0
            );
            assert.true(hasContent, `${extensionPagePath} should render content`);
          } finally {
            await extensionPage.close();
          }
        }
      });
    } else {
      await runTest('Firefox extension should install through WebDriver BiDi', async () => {
        assert.true(
          extensionOrigin.startsWith('moz-extension://'),
          'Firefox should have a test-profile extension origin'
        );
      });
    }

    await runTest(`Initial settings handshake should complete in ${browserName}`, async () => {
      // Navigate to our test HTML file with video
      const testPagePath = getFixtureUrl('test-video.html');
      await page.goto(testPagePath, { waitUntil: 'domcontentloaded' });
      await sleep(3000); // Give extension time to inject

      const extensionLoaded = await waitForExtension(page, 8000);
      assert.true(extensionLoaded, 'Extension should be loaded');
    });

    await runTest('Video element should be detected', async () => {
      const videoReady = await waitForVideo(page, 'video', 10000);
      assert.true(videoReady, 'Video should be ready');
    });

    await runTest('Speed controller should appear on video', async () => {
      const controllerFound = await waitForController(page, 10000);
      assert.true(controllerFound, 'Speed controller should appear');
    });

    await runTest('Initial video speed should be 1.0x', async () => {
      const speed = await getVideoSpeed(page);
      assert.equal(speed, 1, 'Initial speed should be 1.0x');
    });

    await runTest('Controller should display initial speed', async () => {
      const speedDisplay = await getControllerSpeedDisplay(page);
      assert.exists(speedDisplay, 'Speed display should exist');
      // Speed display should show something like "1.00"
      assert.true(speedDisplay.includes('1.'), 'Speed display should show 1.x');
    });

    await runTest(
      'Quick-speed circles should stay visible beside the draggable speed',
      async () => {
        const state = await page.evaluate(() => {
          const shadow = document.querySelector('.vsc-controller')?.shadowRoot;
          const controller = shadow?.querySelector('#controller');
          const quickSpeeds = shadow?.querySelector('#quick-speeds');
          const buttons = Array.from(shadow?.querySelectorAll('button.quick-speed') || []);
          return {
            childOrder: Array.from(controller?.children || []).map(
              (child) => child.id || child.className
            ),
            labels: buttons.map((button) => button.textContent),
            titles: buttons.map((button) => button.title),
            sizes: buttons.map((button) => {
              const style = getComputedStyle(button);
              return { width: style.width, height: style.height, radius: style.borderRadius };
            }),
            quickDisplay: quickSpeeds ? getComputedStyle(quickSpeeds).display : null,
            dragAction: shadow?.querySelector('.draggable')?.dataset.action,
          };
        });

        assert.equal(state.childOrder[0], 'quick-speeds', 'Quick speeds should render first');
        assert.true(
          state.childOrder[1].includes('draggable'),
          'Current speed should remain the drag handle'
        );
        assert.equal(state.childOrder[2], 'controls', 'Hover controls should remain last');
        assert.equal(state.labels.join(''), '', 'Quick-speed circles should be visually empty');
        assert.equal(state.titles[0], 'Set speed to 1.5×', 'First tooltip should expose its speed');
        assert.equal(state.titles[1], 'Set speed to 2×', 'Second tooltip should expose its speed');
        assert.equal(state.sizes[0].width, '20px', 'Quick-speed width should be 20px');
        assert.equal(state.sizes[0].height, '20px', 'Quick-speed height should be 20px');
        assert.equal(state.sizes[0].radius, '50%', 'Quick-speed button should be circular');
        assert.equal(
          state.quickDisplay,
          'inline-flex',
          'Quick speeds should not be hover-collapsed'
        );
        assert.equal(state.dragAction, 'drag', 'Current-speed number should remain draggable');
      }
    );

    await runTest('Quick-speed circles should set their independent default speeds', async () => {
      assert.true(await controlQuickSpeed(page, 0), 'First quick-speed circle should exist');
      assert.equal(await getVideoSpeed(page), 1.5, 'First quick speed should default to 1.5x');
      assert.true(await controlQuickSpeed(page, 1), 'Second quick-speed circle should exist');
      assert.equal(await getVideoSpeed(page), 2.0, 'Second quick speed should default to 2.0x');
    });

    if (browserName === 'chrome') {
      await runTest('Options should validate, export, import, and reset quick speeds', async () => {
        const optionsPage = await browser.newPage();
        try {
          await optionsPage.goto(`${extensionOrigin}/ui/options/options.html`, {
            waitUntil: 'domcontentloaded',
          });
          await optionsPage.waitForFunction(
            () =>
              document.querySelector('#quickSpeed1')?.value &&
              document.querySelector('#quickSpeed2')?.value,
            { timeout: 10000 }
          );

          const invalidStatus = await optionsPage.evaluate(async () => {
            document.querySelector('#quickSpeed1').value = '0.01';
            document.querySelector('#quickSpeed2').value = '2.25';
            document.querySelector('#save').click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            return document.querySelector('#status').textContent;
          });
          assert.true(
            invalidStatus.includes('must be between 0.07 and 16'),
            'Out-of-range quick speeds should be rejected'
          );

          await optionsPage.evaluate(() => {
            document.querySelector('#quickSpeed1').value = '1.11';
            document.querySelector('#quickSpeed2').value = '2.22';
            document.querySelector('#save').click();
          });
          await optionsPage.waitForFunction(
            () =>
              window.VSC?.videoSpeedConfig?.settings?.quickSpeeds?.[0] === 1.11 &&
              window.VSC?.videoSpeedConfig?.settings?.quickSpeeds?.[1] === 2.22,
            { timeout: 10000 }
          );

          const exportedQuickSpeeds = await optionsPage.evaluate(async () => {
            const capture = {};
            window.__quickSpeedExportCapture = capture;
            URL.createObjectURL = (blob) => {
              capture.blob = blob;
              return 'blob:quick-speed-test';
            };
            URL.revokeObjectURL = (url) => {
              capture.revokedUrl = url;
            };
            HTMLAnchorElement.prototype.click = function () {
              capture.download = this.download;
            };
            document.querySelector('#export').click();
            while (!capture.blob) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            const exported = JSON.parse(await capture.blob.text());
            return {
              quickSpeeds: exported.quickSpeeds,
              download: capture.download,
              revokedUrl: capture.revokedUrl,
            };
          });
          assert.equal(
            JSON.stringify(exportedQuickSpeeds.quickSpeeds),
            JSON.stringify([1.11, 2.22]),
            'Export should include both quick speeds'
          );
          assert.equal(
            exportedQuickSpeeds.download,
            'videospeed-settings.json',
            'Export should retain the settings filename'
          );
          assert.equal(
            exportedQuickSpeeds.revokedUrl,
            'blob:quick-speed-test',
            'Export should release its object URL'
          );

          await optionsPage.evaluate(() => {
            const settings = {
              ...window.VSC.videoSpeedConfig.settings,
              quickSpeeds: [1.23, 3.45],
            };
            const file = new File([JSON.stringify(settings)], 'settings.json', {
              type: 'application/json',
            });
            const transfer = new DataTransfer();
            transfer.items.add(file);
            const input = document.querySelector('#importFile');
            Object.defineProperty(input, 'files', {
              configurable: true,
              value: transfer.files,
            });
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await optionsPage.waitForFunction(
            () =>
              document.querySelector('#quickSpeed1')?.value === '1.23' &&
              document.querySelector('#quickSpeed2')?.value === '3.45',
            { timeout: 10000 }
          );

          await optionsPage.evaluate(() => document.querySelector('#restore').click());
          await optionsPage.waitForFunction(
            () =>
              document.querySelector('#quickSpeed1')?.value === '1.5' &&
              document.querySelector('#quickSpeed2')?.value === '2',
            { timeout: 10000 }
          );
        } finally {
          await optionsPage.close();
        }
      });
    }

    await runTest(
      'Quick-speed settings should update existing controllers without reload',
      async () => {
        if (browserName === 'chrome') {
          const optionsPage = await browser.newPage();
          try {
            await optionsPage.goto(`${extensionOrigin}/ui/options/options.html`, {
              waitUntil: 'domcontentloaded',
            });
            await optionsPage.waitForFunction(
              () =>
                document.querySelector('#quickSpeed1')?.value &&
                document.querySelector('#quickSpeed2')?.value,
              { timeout: 10000 }
            );
            await optionsPage.evaluate(() => {
              const first = document.querySelector('#quickSpeed1');
              const second = document.querySelector('#quickSpeed2');
              first.value = '1.37';
              second.value = '2.25';
              first.dispatchEvent(new Event('input', { bubbles: true }));
              second.dispatchEvent(new Event('input', { bubbles: true }));
              document.querySelector('#save').click();
            });
            await optionsPage.waitForFunction(
              () =>
                window.VSC?.videoSpeedConfig?.settings?.quickSpeeds?.[0] === 1.37 &&
                window.VSC?.videoSpeedConfig?.settings?.quickSpeeds?.[1] === 2.25,
              { timeout: 10000 }
            );
          } finally {
            await optionsPage.close();
          }
        } else {
          // Firefox WebDriver BiDi does not permit direct moz-extension://
          // navigation. Exercise the same inbound storage-change relay that an
          // already-open options page triggers after chrome.storage.sync.set().
          await page.evaluate(() => {
            document.documentElement.dispatchEvent(
              new CustomEvent('VSC_STORAGE_CHANGED', {
                detail: {
                  quickSpeeds: {
                    oldValue: [1.5, 2.0],
                    newValue: [1.37, 2.25],
                  },
                },
              })
            );
          });
        }

        await page.waitForFunction(
          () => {
            const config = window.VSC_controller?.config;
            const buttons = document
              .querySelector('.vsc-controller')
              ?.shadowRoot?.querySelectorAll('button.quick-speed');
            return (
              config?.settings?.quickSpeeds?.[0] === 1.37 &&
              buttons?.[0]?.dataset.speed === '1.37' &&
              buttons?.[1]?.title === 'Set speed to 2.25×'
            );
          },
          { timeout: 10000 }
        );

        assert.true(
          await controlQuickSpeed(page, 0),
          'Updated first quick-speed circle should work'
        );
        assert.equal(
          await getVideoSpeed(page),
          1.37,
          'Updated speed should apply without reloading'
        );
      }
    );

    await runTest('Faster button should increase speed', async () => {
      const initialSpeed = await getVideoSpeed(page);
      const success = await controlVideo(page, 'faster');
      assert.true(success, 'Faster button should work');

      const newSpeed = await getVideoSpeed(page);
      assert.true(newSpeed > initialSpeed, 'Speed should increase');
    });

    await runTest('Slower button should decrease speed', async () => {
      const initialSpeed = await getVideoSpeed(page);
      const success = await controlVideo(page, 'slower');
      assert.true(success, 'Slower button should work');

      const newSpeed = await getVideoSpeed(page);
      assert.true(newSpeed < initialSpeed, 'Speed should decrease');
    });

    await runTest('Reset key should restore normal speed', async () => {
      // First change speed
      await controlVideo(page, 'faster');
      await controlVideo(page, 'faster');

      // Then reset using R key
      await testKeyboardShortcut(page, 'KeyR');
      await sleep(500);

      const speed = await getVideoSpeed(page);
      assert.approximately(speed, 1.0, 0.1, 'Speed should be approximately 1.0 after reset');
    });

    await runTest('Keyboard shortcuts should work', async () => {
      // Reset extension state to clear any stored preferences
      await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) {
          video.playbackRate = 1.0;
        }

        // Reset the extension's stored reset key binding to default
        if (window.VSC_controller && window.VSC_controller.config) {
          window.VSC_controller.config.setKeyBinding('reset', 1.0);
        }
      });
      await sleep(200);

      // Test 'D' key for faster
      const initialSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Initial speed: ${initialSpeed}`);
      await testKeyboardShortcut(page, 'KeyD');

      const newSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Speed after D key: ${newSpeed}`);
      assert.true(newSpeed > initialSpeed, 'D key should increase speed');

      // Test 'S' key for slower
      await testKeyboardShortcut(page, 'KeyS');
      const slowerSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Speed after S key: ${slowerSpeed}`);
      assert.true(slowerSpeed < newSpeed, 'S key should decrease speed');

      // Test 'R' key for reset (should change speed from current)
      const speedBeforeReset = await getVideoSpeed(page);
      await testKeyboardShortcut(page, 'KeyR');
      await sleep(200); // Give time for reset to process
      const resetSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Speed before R key: ${speedBeforeReset}, after R key: ${resetSpeed}`);
      assert.true(
        resetSpeed !== speedBeforeReset,
        `R key should change speed from ${speedBeforeReset}, got ${resetSpeed}`
      );
    });

    await runTest('Storage updates should round-trip across the bridge', async () => {
      const observedSpeed = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              document.documentElement.removeEventListener('VSC_STORAGE_CHANGED', onChanged);
              reject(new Error('Timed out waiting for the bridged storage update'));
            }, 5000);
            const onChanged = (event) => {
              const speed = event.detail?.lastSpeed?.newValue;
              if (speed !== 1.37) {
                return;
              }
              clearTimeout(timeout);
              document.documentElement.removeEventListener('VSC_STORAGE_CHANGED', onChanged);
              resolve(speed);
            };
            document.documentElement.addEventListener('VSC_STORAGE_CHANGED', onChanged);
            document.documentElement.dispatchEvent(
              new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 1.37 } })
            );
          })
      );
      assert.equal(observedSpeed, 1.37, 'The storage bridge should return the saved speed');
      await page.evaluate(() => {
        document.documentElement.dispatchEvent(
          new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 1 } })
        );
      });
    });

    await runTest(
      `Page ${browserName === 'firefox' ? 'wheel' : 'legacy mousewheel'} handlers should receive trusted input`,
      async () => {
        const eventType = browserName === 'firefox' ? 'wheel' : 'mousewheel';
        const point = await page.evaluate((trustedEventType) => {
          const video = document.querySelector('video');
          video.muted = false;
          video.volume = 0.5;
          window.__legacyMousewheelCount = 0;
          document.addEventListener(trustedEventType, (event) => {
            if (!event.isTrusted) {
              return;
            }
            window.__legacyMousewheelCount++;
            const increase = event.wheelDelta ? event.wheelDelta > 0 : event.deltaY < 0;
            video.volume = Math.min(1, video.volume + (increase ? 0.03 : -0.03));
          });
          const rect = video.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          };
        }, eventType);

        // CDP-backed mouse input is trusted browser input. Synthetic dispatchEvent()
        // bypasses Chromium's wheel/mousewheel compatibility selection and would
        // not catch the document-level listener regression from #1598.
        await page.mouse.move(point.x, point.y);
        await page.mouse.wheel({ deltaY: -120 });
        await sleep(200);

        const result = await page.evaluate(() => ({
          count: window.__legacyMousewheelCount,
          volume: document.querySelector('video').volume,
        }));
        assert.true(result.count > 0, `Page should receive trusted ${eventType} input`);
        assert.true(result.volume > 0.5, `Page ${eventType} handler should change volume`);
      }
    );

    await runTest('Hover Zoom muted preview should receive a controller', async () => {
      await page.goto(getFixtureUrl('hoverzoom.html'), { waitUntil: 'domcontentloaded' });
      await sleep(2500);
      assert.true(await waitForExtension(page, 8000), 'Extension should initialize');
      assert.true(
        await waitForVideo(page, '#hoverzoom-video', 10000),
        'Hover Zoom preview should load'
      );
      assert.true(await waitForController(page, 10000), 'Hover Zoom preview should be controlled');
      await page.waitForFunction(
        () =>
          Boolean(
            document.querySelector('#hoverzoom-video')?.vsc &&
            document.querySelector('#hoverzoom-audio')?.vsc
          ),
        { timeout: 10000 }
      );

      const state = await page.evaluate(() => {
        const preview = document.querySelector('#hoverzoom-video');
        const audio = document.querySelector('#hoverzoom-audio');
        const primaryController = preview.vsc?.div;
        const secondaryController = audio.vsc?.div;
        window.hoverZoomFixture.rememberController();
        return {
          muted: preview.muted,
          loop: preview.loop,
          controls: preview.controls,
          controllerCount: document.querySelectorAll('vsc-controller').length,
          visibleControllerCount: Array.from(document.querySelectorAll('vsc-controller')).filter(
            (controller) => getComputedStyle(controller).display !== 'none'
          ).length,
          controllerParent: primaryController?.parentElement?.id,
          audioControllerParent: secondaryController?.parentElement?.id,
          primaryType: primaryController?.dataset.vscMediaType,
          secondaryType: secondaryController?.dataset.vscMediaType,
          primaryRole: primaryController?.dataset.vscSyncRole,
          secondaryRole: secondaryController?.dataset.vscSyncRole,
          primaryTop: getComputedStyle(primaryController).top,
          secondaryDisplay: getComputedStyle(secondaryController).display,
          ordinaryGifControlled: Boolean(document.querySelector('#ordinary-gif')?.vsc),
        };
      });

      assert.true(state.muted && state.loop && !state.controls, 'Preview should match GIF media');
      assert.equal(state.controllerCount, 2, 'Both split media elements should remain controlled');
      assert.equal(state.visibleControllerCount, 1, 'Only one speed badge should be visible');
      assert.equal(
        state.controllerParent,
        'hzContainer',
        'Controller should share the preview container'
      );
      assert.equal(
        state.audioControllerParent,
        'hzContainer',
        'Hidden audio controller should share the preview container'
      );
      assert.equal(state.primaryType, 'video', 'Visible badge should belong to the video');
      assert.equal(state.secondaryType, 'audio', 'Hidden badge should belong to the audio');
      assert.equal(state.primaryRole, 'primary', 'Video should be the synchronized primary');
      assert.equal(state.secondaryRole, 'secondary', 'Audio should be the hidden secondary');
      assert.equal(state.primaryTop, '60px', 'Visible badge should be moved down');
      assert.equal(state.secondaryDisplay, 'none', 'Audio badge should be hidden');
      assert.false(state.ordinaryGifControlled, 'Ordinary GIF-like video should remain ignored');
    });

    await runTest('Hover Zoom visible badge should synchronize video and audio speed', async () => {
      const result = await page.evaluate(async () => {
        const fixture = window.hoverZoomFixture;
        fixture.video.playbackRate = 1.3;
        fixture.audio.playbackRate = 0.75;
        const button = fixture.controllerNode?.shadowRoot?.querySelector(
          'button[data-action="faster"]'
        );
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        return {
          clicked: Boolean(button),
          videoSpeed: fixture.video.playbackRate,
          audioSpeed: fixture.audio.playbackRate,
          videoIndicator: fixture.controller?.speedIndicator?.textContent,
          audioIndicator: fixture.audioController?.speedIndicator?.textContent,
        };
      });

      assert.true(result.clicked, 'Visible video badge should expose the faster button');
      assert.equal(result.videoSpeed, 1.4, 'Visible badge should calculate from the video speed');
      assert.equal(result.audioSpeed, 1.4, 'Audio speed should follow the visible badge');
      assert.equal(result.videoIndicator, '1.40', 'Video indicator should show synchronized speed');
      assert.equal(
        result.audioIndicator,
        '1.40',
        'Hidden audio indicator should stay synchronized'
      );
    });

    await runTest('Hover Zoom visible badge wheel should synchronize both streams', async () => {
      const controllerPoint = await page.evaluate(() => {
        const controller =
          window.hoverZoomFixture.controllerNode?.shadowRoot?.querySelector('#controller');
        const rect = controller?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      });
      assert.exists(controllerPoint, 'Visible controller should have a rendered wheel target');

      await page.mouse.move(0, 0);
      await page.mouse.move(controllerPoint.x, controllerPoint.y);
      await sleep(400);
      await page.mouse.wheel({ deltaY: -120 });
      await sleep(300);

      const rates = await page.evaluate(() => ({
        video: window.hoverZoomFixture.video.playbackRate,
        audio: window.hoverZoomFixture.audio.playbackRate,
      }));
      assert.equal(rates.video, 1.5, 'Wheel should increase the primary video speed once');
      assert.equal(rates.audio, 1.5, 'Wheel should apply the same speed to hidden audio');
    });

    await runTest(
      'Hover Zoom quick speed should synchronize both streams exactly once',
      async () => {
        const result = await page.evaluate(async () => {
          const fixture = window.hoverZoomFixture;
          const button = fixture.controllerNode?.shadowRoot?.querySelector(
            'button.quick-speed[data-quick-speed-index="1"]'
          );
          button?.click();
          await new Promise((resolve) => setTimeout(resolve, 250));
          return {
            clicked: Boolean(button),
            videoSpeed: fixture.video.playbackRate,
            audioSpeed: fixture.audio.playbackRate,
            videoIndicator: fixture.controller?.speedIndicator?.textContent,
            audioIndicator: fixture.audioController?.speedIndicator?.textContent,
          };
        });

        assert.true(result.clicked, 'Visible badge should expose the second quick-speed circle');
        const expectedSpeed = browserName === 'chrome' ? 2.25 : 2.0;
        const expectedIndicator = expectedSpeed.toFixed(2);
        assert.equal(result.videoSpeed, expectedSpeed, 'Quick speed should set the primary video');
        assert.equal(
          result.audioSpeed,
          expectedSpeed,
          'Quick speed should set hidden audio exactly once'
        );
        assert.equal(
          result.videoIndicator,
          expectedIndicator,
          'Video indicator should show the quick speed'
        );
        assert.equal(
          result.audioIndicator,
          expectedIndicator,
          'Audio indicator should remain synchronized'
        );
      }
    );

    await runTest('Hover Zoom lock should preserve and reattach the controller', async () => {
      const speedBeforeLock = await page.evaluate(() => ({
        video: window.hoverZoomFixture.video.playbackRate,
        audio: window.hoverZoomFixture.audio.playbackRate,
      }));

      await page.evaluate(() => window.hoverZoomFixture.lock());
      await page.waitForFunction(
        () => {
          const fixture = window.hoverZoomFixture;
          return (
            fixture.locked &&
            fixture.video.vsc === fixture.controller &&
            fixture.video.vsc?.div === fixture.controllerNode &&
            fixture.audio.vsc === fixture.audioController &&
            fixture.audio.vsc?.div === fixture.audioControllerNode &&
            fixture.controllerNode?.parentElement === fixture.container &&
            fixture.audioControllerNode?.parentElement === fixture.container
          );
        },
        { timeout: 10000 }
      );

      const state = await page.evaluate(() => ({
        controls: window.hoverZoomFixture.video.controls,
        speed: window.hoverZoomFixture.video.playbackRate,
        audioControls: window.hoverZoomFixture.audio.controls,
        audioSpeed: window.hoverZoomFixture.audio.playbackRate,
        controllerCount: document.querySelectorAll('vsc-controller').length,
        visibleControllerCount: Array.from(document.querySelectorAll('vsc-controller')).filter(
          (controller) => getComputedStyle(controller).display !== 'none'
        ).length,
        controllerParent: window.hoverZoomFixture.controllerNode?.parentElement?.id,
        audioControllerParent: window.hoverZoomFixture.audioControllerNode?.parentElement?.id,
      }));
      assert.true(state.controls, 'Locked preview should enable native controls');
      assert.true(state.audioControls, 'Locked audio should enable native controls');
      assert.equal(state.speed, speedBeforeLock.video, 'Locking should preserve video speed');
      assert.equal(state.audioSpeed, speedBeforeLock.audio, 'Locking should preserve audio speed');
      assert.equal(state.controllerCount, 2, 'Locking should not duplicate either controller');
      assert.equal(state.visibleControllerCount, 1, 'Locking should retain one visible badge');
      assert.equal(
        state.controllerParent,
        'hzContainer',
        'Controller should move to the new container'
      );
      assert.equal(
        state.audioControllerParent,
        'hzContainer',
        'Hidden audio controller should move to the new container'
      );
    });

    await runTest('Removing the Hover Zoom viewer should clean up its controller', async () => {
      await page.evaluate(() => window.hoverZoomFixture.removeViewer());
      await page.waitForFunction(
        () =>
          !window.hoverZoomFixture.video.vsc &&
          !window.hoverZoomFixture.audio.vsc &&
          document.querySelectorAll('vsc-controller').length === 0,
        { timeout: 10000 }
      );

      const ordinaryGifControlled = await page.evaluate(() =>
        Boolean(document.querySelector('#ordinary-gif')?.vsc)
      );
      assert.false(ordinaryGifControlled, 'Ordinary GIF-like video should remain ignored');
    });

    if (browserName === 'chrome') {
      await runTest('Popup disable should tear down until the page reloads', async () => {
        const popupPage = await browser.newPage();
        try {
          await popupPage.goto(`${extensionOrigin}/ui/popup/popup.html`, {
            waitUntil: 'domcontentloaded',
          });
          await popupPage.waitForSelector('#disable');
          await popupPage.click('#disable');
          await popupPage.waitForFunction(() =>
            document.querySelector('#disable')?.classList.contains('disabled')
          );
          await page.waitForFunction(
            () =>
              !window.VSC_controller?.initialized &&
              document.querySelectorAll('.vsc-controller').length === 0,
            { timeout: 5000 }
          );

          await popupPage.click('#disable');
          await popupPage.waitForFunction(
            () => !document.querySelector('#disable')?.classList.contains('disabled')
          );
          await popupPage.close();
          await page.bringToFront();
          await page.reload({ waitUntil: 'domcontentloaded' });
          assert.true(
            await waitForController(page, 10000),
            'Controller should return after reload'
          );
        } finally {
          if (!popupPage.isClosed()) {
            await popupPage.close();
          }
        }
      });
    }

    // Take a screenshot for verification
    await takeScreenshot(page, 'basic-test-final.png');
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`\n   📊 Basic E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
