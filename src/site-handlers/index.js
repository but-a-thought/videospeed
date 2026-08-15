/**
 * Site handler factory and manager
 */

window.VSC = window.VSC || {};

class SiteHandlerManager {
  constructor() {
    this.currentHandler = null;
    this.availableHandlers = [
      window.VSC.NetflixHandler,
      window.VSC.YouTubeHandler,
      window.VSC.FacebookHandler,
      window.VSC.AmazonHandler,
      window.VSC.AppleHandler,
      window.VSC.DailymotionHandler,
      window.VSC.TikTokHandler,
      window.VSC.FrameHandler,
    ];
  }

  /**
   * Get the appropriate handler for the current site
   * @returns {BaseSiteHandler} Site handler instance
   */
  getCurrentHandler() {
    if (!this.currentHandler) {
      this.currentHandler = this.detectHandler();
    }
    return this.currentHandler;
  }

  /**
   * Detect which handler to use for the current site
   * @returns {BaseSiteHandler} Site handler instance
   * @private
   */
  detectHandler() {
    for (const HandlerClass of this.availableHandlers) {
      if (HandlerClass.matches()) {
        window.VSC.logger.info(`Using ${HandlerClass.name} for ${location.hostname}`);
        return new HandlerClass();
      }
    }

    window.VSC.logger.debug(`Using BaseSiteHandler for ${location.hostname}`);
    return new window.VSC.BaseSiteHandler();
  }

  /**
   * Initialize the current site handler
   * @param {Document} document - Document object
   */
  initialize(document) {
    const handler = this.getCurrentHandler();
    handler.initialize(document);
  }

  /**
   * Get controller positioning for current site
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, video) {
    const handler = this.getCurrentHandler();
    return handler.getControllerPosition(parent, video);
  }

  /**
   * @param {HTMLMediaElement} media
   * @returns {boolean|null}
   */
  getMediaVisibilityOverride(media) {
    return this.getCurrentHandler().getMediaVisibilityOverride(media);
  }

  /** @returns {boolean} */
  shouldRepairControllerPlacement() {
    return this.getCurrentHandler().shouldRepairControllerPlacement();
  }

  /**
   * @param {HTMLMediaElement} media
   * @param {string} eventType
   * @returns {number|null}
   */
  getRateRestoreDelay(media, eventType) {
    return this.getCurrentHandler().getRateRestoreDelay(media, eventType);
  }

  /**
   * Handle speed change for current site
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Target speed
   */
  handleSpeedChange(video, speed) {
    const handler = this.getCurrentHandler();
    handler.handleSpeedChange(video, speed);
  }

  /**
   * Handle seeking for current site
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   * @returns {boolean} True if handled
   */
  handleSeek(video, seekSeconds) {
    const handler = this.getCurrentHandler();
    return handler.handleSeek(video, seekSeconds);
  }

  /**
   * Return Hover Zoom's split video/audio playback pair when the viewer is
   * unambiguous. Reddit DASH previews use one element for pictures and one for
   * sound; speed commands must treat them as one logical player.
   *
   * Nested viewers are excluded by checking each media element's closest
   * #hzViewer. Pairing also fails closed while the viewer is detached or when
   * either media type appears more than once.
   *
   * @param {HTMLMediaElement} media - Candidate media element
   * @returns {{viewer: HTMLElement, primary: HTMLVideoElement, secondary: HTMLAudioElement, media: HTMLMediaElement[]}|null}
   */
  getSynchronizedMediaGroup(media) {
    if (!media || (media.tagName !== 'VIDEO' && media.tagName !== 'AUDIO')) {
      return null;
    }

    const viewer = media.closest?.('#hzViewer');
    if (!viewer?.isConnected) {
      return null;
    }

    const inThisViewer = (candidate) => candidate.closest?.('#hzViewer') === viewer;
    const videos = Array.from(viewer.querySelectorAll('video')).filter(inThisViewer);
    const audios = Array.from(viewer.querySelectorAll('audio')).filter(inThisViewer);

    if (videos.length !== 1 || audios.length !== 1) {
      return null;
    }

    const primary = videos[0];
    const secondary = audios[0];
    if (media !== primary && media !== secondary) {
      return null;
    }

    return { viewer, primary, secondary, media: [primary, secondary] };
  }

  /**
   * Check if a video should be ignored
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(video) {
    const handler = this.getCurrentHandler();
    if (handler.shouldIgnoreVideo(video)) {
      return true;
    }

    // Detect gif-like videos: muted looping videos with no native controls.
    // Sites like Telegram, X, Imgur serve animated stickers/GIFs as <video
    // autoplay loop muted> elements. Showing a speed overlay on these is
    // visually noisy and not useful. Hover Zoom uses the same media signature
    // for an explicitly interactive preview, so keep that viewer controllable.
    const isHoverZoomVideo = video.tagName === 'VIDEO' && Boolean(video.closest?.('#hzViewer'));
    if (
      video.tagName === 'VIDEO' &&
      video.loop &&
      video.muted &&
      !video.controls &&
      !isHoverZoomVideo
    ) {
      window.VSC.logger.debug('Video ignored: gif-video pattern (loop + muted + no controls)');
      return true;
    }

    return false;
  }

  /**
   * Resolve a page gesture to one controlled media element when the current
   * site's player DOM supplies an unambiguous association.
   * @param {Event} event
   * @param {HTMLMediaElement[]} mediaElements
   * @returns {HTMLMediaElement|null}
   */
  resolveGestureMedia(event, mediaElements) {
    return this.getCurrentHandler().resolveGestureMedia(event, mediaElements);
  }

  /**
   * @param {Event} event
   * @param {HTMLMediaElement[]} mediaElements
   * @returns {{media: HTMLMediaElement|null, recordIntent: boolean, normalResetSideEffect: boolean}}
   */
  classifyPageClick(event, mediaElements) {
    return this.getCurrentHandler().classifyPageClick(event, mediaElements);
  }

  /**
   * Get site-declared intent-classifier rule activations
   * @returns {Object|null} Partial rule flags, or null for generic rules
   */
  getClassifierRules() {
    return this.getCurrentHandler().getClassifierRules();
  }

  /**
   * Get video container selectors for current site
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    const handler = this.getCurrentHandler();
    return handler.getVideoContainerSelectors();
  }

  /**
   * Detect special videos for current site
   * @param {Document} document - Document object
   * @returns {Array<HTMLMediaElement>} Additional videos found
   */
  detectSpecialVideos(document) {
    const handler = this.getCurrentHandler();
    return handler.detectSpecialVideos(document);
  }

  /**
   * Cleanup current handler
   */
  cleanup() {
    if (this.currentHandler) {
      this.currentHandler.cleanup();
      this.currentHandler = null;
    }
  }

  /**
   * Force refresh of current handler (useful for SPA navigation)
   */
  refresh() {
    this.cleanup();
    this.currentHandler = null;
  }
}

// Create singleton instance
window.VSC.siteHandlerManager = new SiteHandlerManager();
