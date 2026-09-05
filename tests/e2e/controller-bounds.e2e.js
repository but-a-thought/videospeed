import { getFixtureUrl, launchChromeWithExtension } from './e2e-utils.js';

export default async function runControllerBoundsTests() {
  let browser;
  let passed = 0;
  let failed = 0;
  try {
    const launched = await launchChromeWithExtension();
    browser = launched.browser;
    const { page } = launched;
    const reset = async () => {
      await page.goto(getFixtureUrl('controller-bounds.html'));
      await page.waitForFunction(() => window.VSC_controller?.initialized, { timeout: 10000 });
      // Exercise TikTok's placement without relying on its remote feed or account.
      await page.evaluate(() => {
        const video = document.querySelector('video');
        const previous = video.vsc;
        const { config, actionHandler } = window.VSC_controller;
        previous?.remove();
        window.VSC.siteHandlerManager.currentHandler = new window.VSC.TikTokHandler();
        config.settings.controllerPosition = { x: 650, y: 500 };
        new window.VSC.VideoController(video, null, config, actionHandler);
      });
      // Flush the initial ResizeObserver delivery before testing later movement.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      await assertVisible();
    };
    const assertVisible = () =>
      page.waitForFunction(
        () => {
          const video = document.querySelector('video');
          const badge = video.vsc.div.shadowRoot
            .querySelector('.draggable')
            .getBoundingClientRect();
          const player = document.querySelector('.tiktok-web-player').getBoundingClientRect();
          const media = video.getBoundingClientRect();
          return (
            badge.width > 0 &&
            badge.height > 0 &&
            badge.left >= Math.max(0, player.left, media.left) - 1 &&
            badge.top >= Math.max(0, player.top, media.top) - 1 &&
            badge.right <= Math.min(innerWidth, player.right, media.right) + 1 &&
            badge.bottom <= Math.min(innerHeight, player.bottom, media.bottom) + 1
          );
        },
        { timeout: 2000 }
      );
    const run = async (name, change) => {
      try {
        await reset();
        await page.evaluate(change);
        await assertVisible();
        const saved = await page.evaluate(
          () => window.VSC_controller.config.settings.controllerPosition
        );
        if (saved.x !== 650 || saved.y !== 500) {
          throw new Error('Automatic bounds adjustment changed the saved offset');
        }
        console.log(`   ✅ ${name}`);
        passed++;
      } catch (error) {
        console.log(`   ❌ ${name}: ${error.message}`);
        console.log(
          await page.evaluate(() => {
            const video = document.querySelector('video');
            const controller = video?.vsc;
            return JSON.stringify({
              media: video?.getBoundingClientRect().toJSON(),
              badge: controller?.speedIndicator.getBoundingClientRect().toJSON(),
              position: controller?.div.shadowRoot.querySelector('#controller').style.cssText,
              box: controller?.div.shadowRoot
                .querySelector('#controller')
                .getBoundingClientRect()
                .toJSON(),
              width: controller?.div.shadowRoot.querySelector('#controller').offsetWidth,
              height: controller?.div.shadowRoot.querySelector('#controller').offsetHeight,
              frame: controller?.controllerBoundsFrame,
              layoutObserver: !!controller?.controllerLayoutObserver,
            });
          })
        );
        failed++;
      }
    };
    await run('Saved offset stays visible after landscape-to-portrait resizing', () => {
      document.querySelector('video').style.cssText = 'width: 180px; height: 500px';
      document.querySelector('.tiktok-web-player').style.cssText = 'width: 180px; height: 500px';
    });
    await run('Player clipping shrinks while the video element keeps its size', () => {
      document.querySelector('.tiktok-web-player').style.cssText = 'width: 180px; height: 250px';
    });
    await run('Video moves inside the player without resizing', () => {
      document.querySelector('video').style.transform = 'translate(-650px, -450px)';
    });
    await run('Scaled player converts corrections back into local coordinates', () => {
      document.querySelector('.tiktok-web-player').style.cssText =
        'transform: scale(0.5); width: 180px; height: 250px';
      document.querySelector('video').style.cssText = 'width: 180px; height: 250px';
    });
    await run('Scrolling a partially visible player keeps the badge in the viewport', () => {
      document.body.style.height = '2000px';
      document.querySelector('video').vsc.applyControllerPosition({ x: 50, y: 20 });
      window.scrollTo(0, 200);
    });
    await run(
      'Next feed video restores its chosen position after scrolling into view',
      async () => {
        const first = document.querySelector('[data-e2e="feed-video"]');
        const next = first.cloneNode(true);
        next.querySelectorAll('vsc-controller').forEach((host) => host.remove());
        first.after(next);
        document.body.style.height = '2400px';
        const video = next.querySelector('video');
        const { config, actionHandler } = window.VSC_controller;
        new window.VSC.VideoController(video, null, config, actionHandler);
        const nextTop = video.getBoundingClientRect().top + scrollY;
        const settle = () =>
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.scrollTo(0, nextTop - 650);
        await settle();
        window.scrollTo(0, nextTop - 50);
        await settle();
        const position = video.vsc.getControllerPositionOffset();
        if (Math.abs(position.x - 650) > 1 || Math.abs(position.y - 500) > 1) {
          throw new Error(`Next video lost its saved position: ${JSON.stringify(position)}`);
        }
        window.scrollTo(0, 0);
        next.remove();
        await settle();
      }
    );
    await run('Shrinking then growing a player restores its chosen position', async () => {
      const player = document.querySelector('.tiktok-web-player');
      const settle = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      player.style.cssText = 'width: 180px; height: 250px';
      await settle();
      player.style.cssText = '';
      await settle();
      const position = document.querySelector('video').vsc.getControllerPositionOffset();
      if (Math.abs(position.x - 650) > 1 || Math.abs(position.y - 500) > 1) {
        throw new Error(`Growing player lost its saved position: ${JSON.stringify(position)}`);
      }
    });
    await run('Hidden player is constrained when it reappears at a smaller size', async () => {
      const player = document.querySelector('.tiktok-web-player');
      player.style.display = 'none';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      player.style.cssText = 'width: 180px; height: 250px';
      document.querySelector('video').style.cssText = 'width: 180px; height: 250px';
    });
    await run('Recycled host observes the replacement player bounds', async () => {
      const player = document.querySelector('.tiktok-web-player');
      const replacement = player.cloneNode(false);
      player.replaceWith(replacement);
      replacement.appendChild(player.querySelector('.video-layer'));
      const video = document.querySelector('video');
      video.vsc.ensureAttached();
      await new Promise((resolve) => setTimeout(resolve, 50));
      replacement.style.cssText = 'width: 180px; height: 250px';
    });
  } catch (error) {
    console.log(`   ❌ Bounds test setup: ${error.message}`);
    failed++;
  } finally {
    await browser?.close();
  }
  return { passed, failed };
}
