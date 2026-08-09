/**
 * Unit tests for TikTok-specific player integration.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

function setRect(element, { width = 640, height = 360, top = 0, left = 0 } = {}) {
  element.getBoundingClientRect = () => ({
    x: left,
    y: top,
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
  });
}

function buildFeedPlayer() {
  const feedCard = document.createElement('section');
  feedCard.dataset.e2e = 'feed-video';
  const player = document.createElement('div');
  player.className = 'tiktok-web-player';
  const layer = document.createElement('div');
  const video = document.createElement('video');
  layer.appendChild(video);
  player.appendChild(layer);
  feedCard.appendChild(player);
  document.body.appendChild(feedCard);
  setRect(feedCard);
  setRect(video);
  return { feedCard, player, layer, video };
}

describe('TikTokHandler', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    vi.stubGlobal('location', { hostname: 'www.tiktok.com' });
  });

  afterEach(() => {
    cleanupChromeMock();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('matches TikTok and real subdomains without accepting deceptive suffixes', () => {
    expect(window.VSC.TikTokHandler.matches('tiktok.com')).toBe(true);
    expect(window.VSC.TikTokHandler.matches('www.tiktok.com')).toBe(true);
    expect(window.VSC.TikTokHandler.matches('m.tiktok.com')).toBe(true);
    expect(window.VSC.TikTokHandler.matches('tiktok.com.example.test')).toBe(false);
    expect(window.VSC.TikTokHandler.matches('nottiktok.com')).toBe(false);
  });

  it('anchors the controller to xgplayer instead of React-owned feed children', () => {
    const { player, layer, video } = buildFeedPlayer();
    const result = new window.VSC.TikTokHandler().getControllerPosition(layer, video);

    expect(result).toEqual({
      insertionPoint: player,
      insertionMethod: 'firstChild',
      targetParent: player,
    });
  });

  it('falls back to the player and then the supplied parent', () => {
    const player = document.createElement('div');
    player.className = 'tiktok-web-player';
    const parent = document.createElement('div');
    const video = document.createElement('video');
    parent.appendChild(video);
    player.appendChild(parent);
    document.body.appendChild(player);
    const handler = new window.VSC.TikTokHandler();

    expect(handler.getControllerPosition(parent, video).targetParent).toBe(player);

    const plainParent = document.createElement('div');
    const plainVideo = document.createElement('video');
    plainParent.appendChild(plainVideo);
    document.body.appendChild(plainParent);
    expect(handler.getControllerPosition(plainParent, plainVideo).targetParent).toBe(plainParent);
  });

  it('uses the visible feed card when TikTok keeps the video transparent', () => {
    const { video } = buildFeedPlayer();
    video.style.opacity = '0';
    const handler = new window.VSC.TikTokHandler();
    const observer = new window.VSC.MediaElementObserver(
      { settings: { audioBoolean: false } },
      handler
    );

    expect(handler.getMediaVisibilityOverride(video)).toBe(true);
    expect(observer.shouldStartHidden(video)).toBe(false);
  });

  it('reports a hidden or zero-size feed card as not visible', () => {
    const { feedCard, video } = buildFeedPlayer();
    const handler = new window.VSC.TikTokHandler();

    feedCard.style.display = 'none';
    expect(handler.getMediaVisibilityOverride(video)).toBe(false);

    feedCard.style.display = 'block';
    setRect(feedCard, { width: 0, height: 0 });
    expect(handler.getMediaVisibilityOverride(video)).toBe(false);
  });

  it('scopes volume controls to their feed video without recording speed intent', () => {
    const { feedCard, video } = buildFeedPlayer();
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Volume');
    const icon = document.createElement('svg');
    button.appendChild(icon);
    feedCard.appendChild(button);
    const event = { target: icon, composedPath: () => [icon, button, feedCard, document.body] };

    const result = new window.VSC.TikTokHandler().classifyPageClick(event, [video]);

    expect(result).toEqual({
      media: video,
      recordIntent: false,
      normalResetSideEffect: true,
    });
  });

  it('keeps ordinary feed clicks as media-scoped intent evidence', () => {
    const { feedCard, video } = buildFeedPlayer();
    const control = document.createElement('button');
    feedCard.appendChild(control);
    const event = { target: control, composedPath: () => [control, feedCard, document.body] };

    expect(new window.VSC.TikTokHandler().classifyPageClick(event, [video])).toEqual({
      media: video,
      recordIntent: true,
      normalResetSideEffect: false,
    });
  });

  it('opts into volume-reset demotion only for TikTok', () => {
    const handler = new window.VSC.TikTokHandler();
    const rules = handler.getClassifierRules();
    expect(rules).toEqual({ volumeChangeResetsRate: true });
    expect(Object.isFrozen(rules)).toBe(true);
    expect(handler.shouldRepairControllerPlacement()).toBe(true);
    expect(handler.getRateRestoreDelay(null, 'volumechange')).toBe(100);
    expect(handler.getRateRestoreDelay(null, 'play')).toBeNull();
    expect(new window.VSC.BaseSiteHandler().getClassifierRules()).toBe(null);
    expect(new window.VSC.BaseSiteHandler().shouldRepairControllerPlacement()).toBe(false);
  });

  it('keeps TikTok playback and default rates aligned', () => {
    const video = document.createElement('video');
    const handler = new window.VSC.TikTokHandler();

    handler.handleSpeedChange(video, 1.75);

    expect(video.playbackRate).toBe(1.75);
    expect(video.defaultPlaybackRate).toBe(1.75);
  });
});
