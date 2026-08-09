/**
 * TikTok-specific handler
 */

window.VSC = window.VSC || {};

class TikTokHandler extends window.VSC.BaseSiteHandler {
  static matches(hostname = location.hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === 'tiktok.com' || normalized.endsWith('.tiktok.com');
  }

  /**
   * TikTok's immediate video wrapper has zero height and is frequently
   * recycled. Anchor the controller to xgplayer's stable player container;
   * the feed card remains a fallback for alternate layouts.
   */
  getControllerPosition(parent, video) {
    const targetParent =
      video?.closest?.('.tiktok-web-player') ||
      video?.closest?.('[data-e2e="feed-video"]') ||
      parent;

    return {
      insertionPoint: targetParent,
      insertionMethod: 'firstChild',
      targetParent,
    };
  }

  /**
   * TikTok may keep an active, fully ready <video> at opacity:0 while a
   * surrounding player/poster layer presents the visible media. The feed card
   * is the reliable visibility surface in that layout.
   */
  getMediaVisibilityOverride(media) {
    const feedCard = media?.closest?.('[data-e2e="feed-video"]');
    if (!feedCard) {
      return null;
    }
    if (!feedCard.isConnected) {
      return false;
    }

    const style = window.getComputedStyle(feedCard);
    const rect = feedCard.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  getClassifierRules() {
    return TikTokHandler.CLASSIFIER_RULES;
  }

  shouldRepairControllerPlacement() {
    return true;
  }

  getRateRestoreDelay(_media, eventType) {
    return eventType === 'volumechange' ? TikTokHandler.VOLUME_RESTORE_DELAY_MS : null;
  }

  /**
   * xgplayer consults the default register during parts of its control
   * lifecycle. Keep both media-rate registers aligned so volume changes and
   * recycled feed players do not manufacture a 1.0 default.
   */
  handleSpeedChange(video, speed) {
    video.defaultPlaybackRate = speed;
    video.playbackRate = speed;
  }

  resolveGestureMedia(event, mediaElements) {
    const feedCard = this.findGestureFeedCard(event);
    if (!feedCard) {
      return null;
    }
    const matches = mediaElements.filter((media) => feedCard.contains(media));
    return matches.length === 1 ? matches[0] : null;
  }

  classifyPageClick(event, mediaElements) {
    const media = this.resolveGestureMedia(event, mediaElements);
    const isVolumeControl = !!media && this.isVolumeControlGesture(event);
    return {
      media,
      recordIntent: !isVolumeControl,
      normalResetSideEffect: isVolumeControl,
    };
  }

  /** @private */
  findGestureFeedCard(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (!node?.closest) {
        continue;
      }
      const feedCard = node.closest('[data-e2e="feed-video"]');
      if (feedCard) {
        return feedCard;
      }
    }
    return null;
  }

  /** @private */
  isVolumeControlGesture(event) {
    const selector = [
      'button[aria-label="Volume"]',
      '[role="slider"][aria-label*="volume" i]',
      'input[type="range"][aria-label*="volume" i]',
      '[data-e2e*="volume" i]',
    ].join(',');
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    return path.some((node) => node?.matches?.(selector) || node?.closest?.(selector));
  }
}

TikTokHandler.CLASSIFIER_RULES = Object.freeze({ volumeChangeResetsRate: true });
TikTokHandler.VOLUME_RESTORE_DELAY_MS = 100;

window.VSC.TikTokHandler = TikTokHandler;
