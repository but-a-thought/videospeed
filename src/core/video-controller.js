/**
 * Video Controller class for managing individual video elements
 *
 */

window.VSC = window.VSC || {};

class VideoController {
  constructor(target, parent, config, actionHandler, shouldStartHidden = false) {
    // Return existing controller if already attached
    if (target.vsc) {
      return target.vsc;
    }

    this.video = target;
    this.parent = target.parentElement || parent;
    this.config = config;
    this.actionHandler = actionHandler;
    // Lifecycle decisions come from the document coordinator, which shares
    // desired authority while keeping conflict state keyed by media element.
    // Standalone construction only uses lifecycle reads, so a local fallback
    // remains safe for controller-only tests.
    this.arbitration =
      (actionHandler && actionHandler.eventManager && actionHandler.eventManager.arbitration) ||
      new window.VSC.SpeedArbitration(config, null);
    this.controlsManager = new window.VSC.ControlsManager(actionHandler, config);
    this.shouldStartHidden = shouldStartHidden;

    // Generate unique controller ID for badge tracking
    this.controllerId = this.generateControllerId(target);

    // Transient reset memory (not persisted, instance-specific)
    this.speedBeforeReset = null;
    this.positionBeforeJump = null;
    this.controllerBaseline = { top: 0, left: 0 };

    // Attach controller to video element first (needed for adjustSpeed)
    target.vsc = this;

    // Register with state manager immediately after controller is attached
    if (window.VSC.stateManager) {
      window.VSC.stateManager.registerController(this);
    } else {
      window.VSC.logger.error('StateManager not available during VideoController initialization');
    }

    // Initialize speed
    this.initializeSpeed();

    // Create UI
    this.div = this.initializeControls();

    // Keep the draggable speed badge within the media rectangle, including
    // after responsive layout or speed text changes alter either box.
    this.setupControllerBounds();

    // A Hover Zoom DASH preview becomes one logical player once both its
    // video and audio controllers exist. Refresh both wrappers together so
    // only the primary video badge remains visible.
    this.refreshSynchronizedMediaState();

    // TikTok and similar virtualized players can preserve a media element
    // while reconciling away extension-owned children. Opted-in handlers get
    // a narrow parent observer that repairs the existing controller host.
    this.setupControllerPlacementRepair();

    // Set up event handlers
    this.setupEventHandlers();

    // Set up mutation observer for src changes
    this.setupMutationObserver();

    window.VSC.logger.info('VideoController initialized for video element');
  }

  /**
   * Initialize video speed based on settings.
   *
   * Lifecycle writes execute WRITE + SYNC_UI only — never PERSIST (cell 6,
   * persistence purity I2): re-asserting existing authority must not
   * refresh it or leak an initialization value into storage.
   * @private
   */
  initializeSpeed() {
    // Defer until metadata is loaded — setting playbackRate before the player
    // has initialized can race with the site's own init sequence. Recompute
    // the target at execution time because another player may claim a newer
    // shared authority while this media is still loading.
    if (this.video.readyState < 1) {
      window.VSC.logger.debug('Deferring initializeSpeed until loadedmetadata');
      this.handleLoadedMetadata = () => {
        this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
        this.handleLoadedMetadata = null;
        this.applyLifecycleSpeed('loadedmetadata');
      };
      this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata);
      return;
    }

    this.applyLifecycleSpeed('initializeSpeed');
  }

  /**
   * Execute a lifecycle write only while this controller remains attached.
   * @param {string} eventType
   * @private
   */
  applyLifecycleSpeed(eventType) {
    if (this.video.vsc !== this || !this.actionHandler) {
      return;
    }

    // Mark the (re)initialization moment before deciding whether to write:
    // sites commonly answer this phase with their own playbackRate = 1.0,
    // which must not read as a user's menu choice even when no restore was
    // needed (classifier MEDIA_INIT_GRACE_MS).
    if (eventType === 'initializeSpeed' || eventType === 'loadedmetadata') {
      this.arbitration.classifier?.observeMediaInit(this.video, performance.now());
    }

    const targetSpeed = this.arbitration.lifecycleTarget(this.video);
    if (targetSpeed === null) {
      window.VSC.logger.debug(
        `${eventType}: no authoritative target, leaving playbackRate=${this.video.playbackRate}`
      );
      return;
    }
    if (targetSpeed === this.video.playbackRate) {
      return;
    }

    window.VSC.logger.info(`${eventType}: restoring speed to ${targetSpeed}`);
    this.actionHandler.writeRate(this.video, targetSpeed);
    this.actionHandler.syncIndicator(this.video, targetSpeed);
  }

  /**
   * Initialize video controller UI
   * @returns {HTMLElement} Controller wrapper element
   * @private
   */
  initializeControls() {
    window.VSC.logger.debug('initializeControls Begin');

    const document = this.video.ownerDocument;
    const speed = window.VSC.Constants.formatSpeed(this.video.playbackRate);

    window.VSC.logger.debug(`Speed variable set to: ${speed}`);

    // Create custom element wrapper to avoid CSS conflicts
    const wrapper = document.createElement('vsc-controller');
    // initializeControls() applies the persisted offset before it returns, so
    // expose the wrapper to the instance as soon as it exists.
    this.div = wrapper;

    // Apply all CSS classes at once to prevent race condition flash
    const cssClasses = ['vsc-controller'];

    // Only hide controller if video has no source AND is not ready/functional
    // This prevents hiding controllers for live streams or dynamically loaded videos
    if (!this.video.currentSrc && !this.video.src && this.video.readyState < 2) {
      cssClasses.push('vsc-nosource');
    }

    if (this.config.settings.startHidden || this.shouldStartHidden) {
      cssClasses.push('vsc-hidden');
      window.VSC.logger.debug('Starting controller hidden');
    }
    // When startHidden=false, use natural visibility (no special class needed)

    // Apply all classes at once to prevent visible flash
    wrapper.className = cssClasses.join(' ');
    wrapper.dataset.vscMediaType = this.video.tagName.toLowerCase();

    // IMPORTANT: Wrapper gets z-index ONLY — no position, no top, no left.
    // Position is controlled by inject.css (default: absolute; site overrides: relative).
    // Adding inline position here would defeat CSS site overrides via specificity.
    wrapper.style.cssText = 'z-index: 9999999 !important;';

    // Create shadow DOM with placeholder position (set after insertion)
    const shadow = window.VSC.ShadowDOMManager.createShadowDOM(wrapper, {
      top: '0px',
      left: '0px',
      speed: speed,
      opacity: this.config.settings.controllerOpacity,
      buttonSize: this.config.settings.controllerButtonSize,
      quickSpeeds: this.config.settings.quickSpeeds,
    });

    // Set up control events
    this.controlsManager.setupControlEvents(shadow, this.video);

    // Store speed indicator reference
    this.speedIndicator = window.VSC.ShadowDOMManager.getSpeedIndicator(shadow);

    this.unsubscribeSettingsChanges = this.config.onSettingsChanged?.((changes) => {
      if (changes.quickSpeeds && this.video.vsc === this) {
        window.VSC.ShadowDOMManager.updateQuickSpeedButtons(
          shadow,
          this.config.settings.quickSpeeds
        );
      }
      if (changes.controllerPosition && this.video.vsc === this) {
        this.applyControllerPosition(this.config.settings.controllerPosition);
      }
    });

    // Insert into DOM FIRST — position calculation needs the wrapper in the DOM
    this.insertIntoDOM(document, wrapper);

    // THEN compute position based on actual DOM state.
    // If a CSS override sets the wrapper to position:relative (e.g. YouTube, Netflix),
    // the inner controller stays at (0,0) and the CSS nudge handles placement.
    // Otherwise (wrapper is absolute), compute coordinates for generic sites.
    const computedPosition = getComputedStyle(wrapper).position;
    const innerController = window.VSC.ShadowDOMManager.getController(shadow);
    if (computedPosition !== 'relative') {
      const position = window.VSC.ShadowDOMManager.calculatePosition(this.video);
      innerController.style.top = position.top;
      innerController.style.left = position.left;
    }
    this.captureControllerBaseline(innerController);
    this.applyControllerPosition(this.config.settings.controllerPosition);

    window.VSC.logger.debug('initializeControls End');
    return wrapper;
  }

  /** Capture the controller's site-aware natural starting point. @private */
  captureControllerBaseline(innerController) {
    this.controllerBaseline = {
      top: Number.parseInt(innerController?.style.top, 10) || 0,
      left: Number.parseInt(innerController?.style.left, 10) || 0,
    };
  }

  /**
   * Apply a validated baseline-relative position, or reset to the baseline.
   * @param {{x: number, y: number}|null} position
   */
  applyControllerPosition(position) {
    const innerController = this.div?.shadowRoot?.querySelector('#controller');
    if (!innerController) {
      return;
    }
    const normalized = window.VSC.ControllerPosition.normalize(position) || { x: 0, y: 0 };
    innerController.style.left = `${this.controllerBaseline.left + normalized.x}px`;
    innerController.style.top = `${this.controllerBaseline.top + normalized.y}px`;
    this.captureRequestedControllerPosition();
    window.VSC.DragHandler.constrainToMedia(this.video);
  }

  /** Keep the user's chosen position separate from temporary bounds corrections. */
  captureRequestedControllerPosition() {
    const innerController = this.div?.shadowRoot?.querySelector('#controller');
    this.requestedControllerPosition = {
      left: parseFloat(innerController?.style.left) || 0,
      top: parseFloat(innerController?.style.top) || 0,
    };
  }

  /**
   * Read the current drag displacement from the natural baseline.
   * @returns {{x: number, y: number}}
   */
  getControllerPositionOffset() {
    const innerController = this.div?.shadowRoot?.querySelector('#controller');
    const left = Number.parseInt(innerController?.style.left, 10) || 0;
    const top = Number.parseInt(innerController?.style.top, 10) || 0;
    return {
      x: left - this.controllerBaseline.left,
      y: top - this.controllerBaseline.top,
    };
  }

  /**
   * Insert controller into DOM with site-specific positioning
   * @param {Document} document - Document object
   * @param {HTMLElement} wrapper - Wrapper element to insert
   * @private
   */
  insertIntoDOM(document, wrapper) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    // Media can be preserved while its surrounding player DOM is rebuilt.
    // Always resolve placement from the live parent instead of retaining a
    // container that may already have been detached.
    const currentParent = this.video.parentElement || this.parent;
    if (!currentParent) {
      window.VSC.logger.warn('Cannot insert controller without a media parent');
      return;
    }
    this.parent = currentParent;

    // Get site-specific positioning information
    const positioning = window.VSC.siteHandlerManager.getControllerPosition(
      currentParent,
      this.video
    );

    switch (positioning.insertionMethod) {
      case 'beforeParent':
        positioning.insertionPoint.parentElement.insertBefore(fragment, positioning.insertionPoint);
        break;

      case 'afterParent':
        positioning.insertionPoint.parentElement.insertBefore(
          fragment,
          positioning.insertionPoint.nextSibling
        );
        break;

      case 'firstChild':
      default:
        positioning.insertionPoint.insertBefore(fragment, positioning.insertionPoint.firstChild);
        break;
    }

    window.VSC.logger.debug(`Controller inserted using ${positioning.insertionMethod} method`);
  }

  /** Keep the speed badge inside the media as either element resizes. @private */
  setupControllerBounds() {
    const view = this.video.ownerDocument.defaultView;
    this.updateControllerBounds = () => {
      if (this.video.vsc === this && this.video.isConnected) {
        // An incoming feed item may briefly have only a thin visible strip.
        // Always constrain from the chosen position so that transient clipping
        // cannot become the starting point for every subsequent layout.
        const innerController = this.div.shadowRoot.querySelector('#controller');
        if (this.requestedControllerPosition) {
          innerController.style.left = `${this.requestedControllerPosition.left}px`;
          innerController.style.top = `${this.requestedControllerPosition.top}px`;
        }
        window.VSC.DragHandler.constrainToMedia(this.video);
      }
    };
    this.scheduleControllerBounds = () => {
      if (this.controllerBoundsFrame !== undefined) {
        return;
      }
      this.controllerBoundsFrame = view.requestAnimationFrame(() => {
        this.controllerBoundsFrame = undefined;
        this.updateControllerBounds();
      });
    };
    this.updateControllerBounds();

    if (typeof ResizeObserver !== 'undefined') {
      this.controllerBoundsObserver = new ResizeObserver(this.updateControllerBounds);
    }
    // ResizeObserver does not report translations or class/style changes that
    // move a same-size video within a clipped player.
    this.controllerLayoutObserver = new MutationObserver(this.scheduleControllerBounds);
    this.observeControllerBounds();
    view.addEventListener('resize', this.scheduleControllerBounds);
    view.addEventListener('scroll', this.scheduleControllerBounds, true);
    for (const event of ['loadedmetadata', 'resize']) {
      this.video.addEventListener(event, this.scheduleControllerBounds);
    }
    for (const event of ['transitionend', 'animationend']) {
      this.video.ownerDocument.addEventListener(event, this.scheduleControllerBounds, true);
    }
  }

  /** Refresh geometry observation after a virtualized player moves the host. */
  observeControllerBounds() {
    this.controllerBoundsObserver?.disconnect();
    this.controllerLayoutObserver.disconnect();
    const elements = window.VSC.DragHandler.getBoundsAncestors(this.video);
    elements.add(this.video);
    for (const element of elements) {
      this.controllerBoundsObserver?.observe(element);
      this.controllerLayoutObserver.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }
    this.controllerBoundsObserver?.observe(this.speedIndicator);
  }

  /** Set up proactive repair for sites that recycle player DOM around a live video. @private */
  setupControllerPlacementRepair() {
    if (!window.VSC.siteHandlerManager.shouldRepairControllerPlacement()) {
      return;
    }

    this.controllerPlacementObserver = new MutationObserver(() => this.ensureAttached());
    this.observeControllerParent();
  }

  /** Observe only the current host parent, avoiding a document-wide observer. @private */
  observeControllerParent() {
    if (!this.controllerPlacementObserver) {
      return;
    }
    this.controllerPlacementObserver.disconnect();
    if (this.div?.parentNode) {
      this.controllerPlacementObserver.observe(this.div.parentNode, { childList: true });
    }
  }

  /**
   * Reinsert a controller detached or stranded by a recycled player.
   * Explicit media rediscovery is safe for every site; only proactive parent
   * observation remains gated by shouldRepairControllerPlacement().
   */
  ensureAttached() {
    if (this.video.vsc !== this || !this.video.isConnected || !this.div) {
      return;
    }

    this.refreshSynchronizedMediaState();

    const placement = window.VSC.siteHandlerManager.getControllerPosition(
      this.video.parentElement || this.parent,
      this.video
    );
    const placementIsCurrent =
      this.div.isConnected &&
      (placement.insertionMethod === 'firstChild'
        ? this.div.parentNode === placement.insertionPoint
        : placement.insertionPoint?.parentNode === this.div.parentNode);
    if (placementIsCurrent || this.controllerRepairTimer !== undefined) {
      return;
    }

    this.controllerRepairTimer = setTimeout(() => {
      this.controllerRepairTimer = undefined;
      if (this.video.vsc !== this || !this.video.isConnected) {
        return;
      }
      this.insertIntoDOM(this.video.ownerDocument, this.div);
      this.observeControllerParent();
      this.observeControllerBounds();
      this.refreshSynchronizedMediaState();
      this.updateVisibility();
      this.updateControllerBounds();
      window.VSC.logger.info('Reattached controller after media DOM recycling');
    }, 0);
  }

  /**
   * Set up event handlers for media events
   * @private
   */
  setupEventHandlers() {
    const mediaEventAction = (event) => {
      this.applyLifecycleSpeed(event.type);
    };

    // Bind event handlers. Seek evidence is recorded before the readyState
    // restore guard so initialization-time seeks can explain a 1.0 reset.
    this.handlePlay = mediaEventAction.bind(this);
    this.handleSeekEvidence = (event) => {
      this.arbitration.classifier?.observeSeek(this.video, event.timeStamp);
    };
    this.handleSeek = (event) => {
      this.handleSeekEvidence(event);
      if (event.target.readyState < 2) {
        return;
      }
      mediaEventAction.call(this, event);
    };
    this.handleMediaInit = (event) => {
      this.arbitration.clearEchoTransaction(this.video);
      this.arbitration.classifier?.observeMediaInit(this.video, event.timeStamp);
    };
    this.handleVolumeChangeEvidence = (event) => {
      this.arbitration.classifier?.observeNormalResetSideEffect(this.video, event.timeStamp);
      const restoreDelay = window.VSC.siteHandlerManager.getRateRestoreDelay(
        this.video,
        event.type
      );
      if (restoreDelay !== null) {
        if (this.rateRestoreTimer !== undefined) {
          clearTimeout(this.rateRestoreTimer);
        }
        this.rateRestoreTimer = setTimeout(() => {
          this.rateRestoreTimer = undefined;
          this.restoreAuthoritativeSpeedAfterSiteControl(event.type);
        }, restoreDelay);
      }
    };

    // `seeking` covers resets during an active seek; `seeked` refreshes the
    // evidence window after slow seeks while retaining its lifecycle restore.
    // `loadstart` marks a resource boundary on a reused element; ordinary MSE
    // representation switches need not emit it.
    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('seeking', this.handleSeekEvidence);
    this.video.addEventListener('seeked', this.handleSeek);
    this.video.addEventListener('loadstart', this.handleMediaInit);
    if (this.arbitration.classifier?.rules?.volumeChangeResetsRate) {
      this.video.addEventListener('volumechange', this.handleVolumeChangeEvidence);
    }

    window.VSC.logger.debug(
      'Added media event handlers: play, seeking, seeked, loadstart, optional volumechange'
    );
  }

  /**
   * Set up mutation observer for src attribute changes
   * @private
   */
  setupMutationObserver() {
    this.targetObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'src' || mutation.attributeName === 'currentSrc')
        ) {
          window.VSC.logger.debug('Mutation of A/V element detected');
          const controller = this.div;
          if (!mutation.target.src && !mutation.target.currentSrc) {
            controller.classList.add('vsc-nosource');
          } else {
            controller.classList.remove('vsc-nosource');
          }
        }
      });
    });

    this.targetObserver.observe(this.video, {
      attributeFilter: ['src', 'currentSrc'],
    });
  }

  /**
   * Remove controller and clean up
   */
  remove() {
    window.VSC.logger.debug('Removing VideoController');

    const synchronizedViewer =
      this.video.closest?.('#hzViewer') ||
      this.parent?.closest?.('#hzViewer') ||
      this.synchronizedViewer ||
      null;

    // A detached controller must not be retained or mutated by a pending
    // visibility flash callback after its media/controller lifecycle ends.
    if (this.div?.flashTimer !== undefined) {
      clearTimeout(this.div.flashTimer);
      this.div.flashTimer = undefined;
    }
    const savePositionButton = this.div?.shadowRoot?.querySelector('button.save-position');
    if (savePositionButton?.positionSavedTimer !== undefined) {
      clearTimeout(savePositionButton.positionSavedTimer);
      savePositionButton.positionSavedTimer = undefined;
    }

    if (this.controllerRepairTimer !== undefined) {
      clearTimeout(this.controllerRepairTimer);
      this.controllerRepairTimer = undefined;
    }
    if (this.rateRestoreTimer !== undefined) {
      clearTimeout(this.rateRestoreTimer);
      this.rateRestoreTimer = undefined;
    }
    if (this.controllerPlacementObserver) {
      this.controllerPlacementObserver.disconnect();
      this.controllerPlacementObserver = null;
    }
    if (this.controllerBoundsObserver) {
      this.controllerBoundsObserver.disconnect();
      this.controllerBoundsObserver = null;
    }
    this.controllerLayoutObserver?.disconnect();
    this.controllerLayoutObserver = null;
    const view = this.video.ownerDocument.defaultView;
    if (this.controllerBoundsFrame !== undefined) {
      view.cancelAnimationFrame(this.controllerBoundsFrame);
      this.controllerBoundsFrame = undefined;
    }
    view.removeEventListener('resize', this.scheduleControllerBounds);
    view.removeEventListener('scroll', this.scheduleControllerBounds, true);
    for (const event of ['loadedmetadata', 'resize']) {
      this.video.removeEventListener(event, this.scheduleControllerBounds);
    }
    for (const event of ['transitionend', 'animationend']) {
      this.video.ownerDocument.removeEventListener(event, this.scheduleControllerBounds, true);
    }
    if (this.unsubscribeSettingsChanges) {
      this.unsubscribeSettingsChanges();
      this.unsubscribeSettingsChanges = null;
    }

    // Remove DOM element
    if (this.div && this.div.parentNode) {
      this.div.remove();
    }

    // Remove event listeners
    if (this.handlePlay) {
      this.video.removeEventListener('play', this.handlePlay);
      this.handlePlay = null;
    }
    if (this.handleSeek) {
      this.video.removeEventListener('seeked', this.handleSeek);
      this.handleSeek = null;
    }
    if (this.handleSeekEvidence) {
      this.video.removeEventListener('seeking', this.handleSeekEvidence);
      this.handleSeekEvidence = null;
    }
    if (this.handleMediaInit) {
      this.video.removeEventListener('loadstart', this.handleMediaInit);
      this.handleMediaInit = null;
    }
    if (this.handleVolumeChangeEvidence) {
      this.video.removeEventListener('volumechange', this.handleVolumeChangeEvidence);
      this.handleVolumeChangeEvidence = null;
    }
    if (this.handleLoadedMetadata) {
      this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
      this.handleLoadedMetadata = null;
    }

    // Disconnect mutation observer
    if (this.targetObserver) {
      this.targetObserver.disconnect();
    }

    // Remove from state manager
    if (window.VSC.stateManager) {
      window.VSC.stateManager.removeController(this.controllerId);
    }

    // Release per-media conflict/timer/echo state before detaching the
    // controller reference that EventManager uses to identify controlled media.
    this.actionHandler?.eventManager?.arbitration?.release(this.video);

    // Remove reference from video element
    delete this.video.vsc;

    // If one member left a live viewer, immediately clear or rebuild the
    // remaining controllers' roles from the viewer's current media contents.
    if (synchronizedViewer) {
      const remainingMedia = window.VSC.stateManager
        ?.getControlledElements()
        .find((media) => media.closest?.('#hzViewer') === synchronizedViewer);
      remainingMedia?.vsc?.refreshSynchronizedMediaState();
    }

    window.VSC.logger.debug('VideoController removed successfully');
  }

  /**
   * Recompute visible/secondary badge roles for one Hover Zoom viewer.
   * Existing roles are cleared first so ambiguous or broken groups fail open
   * with normal independent controllers instead of hiding usable controls.
   */
  refreshSynchronizedMediaState() {
    if (!this.div) {
      return;
    }

    const currentViewer = this.video.closest?.('#hzViewer') || null;
    const relevantViewer =
      currentViewer || this.parent?.closest?.('#hzViewer') || this.synchronizedViewer || null;

    if (!relevantViewer) {
      delete this.div.dataset.vscSyncRole;
      this.synchronizedViewer = null;
      return;
    }

    const controlledMedia = window.VSC.stateManager?.getControlledElements() || [];
    controlledMedia.forEach((media) => {
      const controller = media.vsc;
      if (
        controller?.div &&
        (media.closest?.('#hzViewer') === relevantViewer ||
          controller.synchronizedViewer === relevantViewer)
      ) {
        delete controller.div.dataset.vscSyncRole;
        controller.synchronizedViewer = null;
      }
    });

    const group = window.VSC.siteHandlerManager.getSynchronizedMediaGroup(this.video);
    if (!group || !group.primary.vsc?.div || !group.secondary.vsc?.div) {
      return;
    }

    group.primary.vsc.div.dataset.vscSyncRole = 'primary';
    group.secondary.vsc.div.dataset.vscSyncRole = 'secondary';
    group.primary.vsc.synchronizedViewer = group.viewer;
    group.secondary.vsc.synchronizedViewer = group.viewer;
    this.actionHandler?.synchronizeMediaGroupFromPrimary(group.primary);
  }

  /**
   * A site-declared normal control must not replace the user's speed
   * authority. Reclaiming the same value also clears any local fight state
   * created by the site's transient reset before this delayed callback.
   * @param {string} eventType
   * @private
   */
  restoreAuthoritativeSpeedAfterSiteControl(eventType) {
    if (this.video.vsc !== this || !this.video.isConnected || !this.actionHandler) {
      return;
    }
    const target = this.config.settings.lastSpeed;
    if (!Number.isFinite(target) || Math.abs(this.video.playbackRate - target) <= 0.01) {
      return;
    }

    window.VSC.logger.info(`${eventType}: restoring authoritative speed to ${target}`);
    this.arbitration.noteUserSet(this.video, target);
    this.actionHandler.writeRate(this.video, target);
    this.actionHandler.syncIndicator(this.video, target);
  }

  /**
   * Generate unique controller ID for badge tracking
   * @param {HTMLElement} target - Video/audio element
   * @returns {string} Unique controller ID
   * @private
   */
  generateControllerId(target) {
    const timestamp = Date.now();
    const src = target.currentSrc || target.src || 'no-src';
    const tagName = target.tagName.toLowerCase();

    // Create a simple hash from src for uniqueness
    const srcHash = src.split('').reduce((hash, char) => {
      hash = (hash << 5) - hash + char.charCodeAt(0);
      return hash & hash; // Convert to 32-bit integer
    }, 0);

    const random = Math.floor(Math.random() * 1000);
    return `${tagName}-${Math.abs(srcHash)}-${timestamp}-${random}`;
  }

  /**
   * Check if the video element is currently visible
   * @returns {boolean} True if video is visible
   */
  isVideoVisible() {
    // Check if video is still connected to DOM
    if (!this.video.isConnected) {
      return false;
    }

    const visibilityOverride = window.VSC.siteHandlerManager.getMediaVisibilityOverride(this.video);
    if (visibilityOverride !== null) {
      return visibilityOverride;
    }

    // Check computed style for visibility
    const style = window.getComputedStyle(this.video);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    // Check if video has reasonable dimensions
    const rect = this.video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return true;
  }

  /**
   * Update controller visibility based on video visibility
   * Called when video visibility changes
   */
  updateVisibility() {
    this.refreshSynchronizedMediaState();

    const isVisible = this.isVideoVisible();
    const isCurrentlyHidden = this.div.classList.contains('vsc-hidden');

    // Special handling for audio elements - don't hide controllers for functional audio
    if (this.video.tagName === 'AUDIO') {
      // Preserve startHidden; otherwise audio support controls automatic visibility.
      if (!this.config.settings.audioBoolean && !isCurrentlyHidden) {
        this.div.classList.add('vsc-hidden');
        window.VSC.logger.debug('Hiding audio controller - audio support disabled');
      } else if (
        this.config.settings.audioBoolean &&
        isCurrentlyHidden &&
        !this.config.settings.startHidden
      ) {
        // Keep the automatic layer current beneath any explicit override.
        this.div.classList.remove('vsc-hidden');
        window.VSC.logger.debug('Showing audio controller - audio support enabled');
      }
      return;
    }

    // Original logic for video elements
    if (isVisible && isCurrentlyHidden && !this.config.settings.startHidden) {
      // Keep automatic visibility current beneath any explicit override.
      this.div.classList.remove('vsc-hidden');
      window.VSC.logger.debug('Showing controller - video became visible');
    } else if (!isVisible && !isCurrentlyHidden) {
      // Video became invisible and controller is visible
      this.div.classList.add('vsc-hidden');
      window.VSC.logger.debug('Hiding controller - video became invisible');
    }
  }
}

// Create singleton instance
window.VSC.VideoController = VideoController;

// Global variables available for both browser and testing
