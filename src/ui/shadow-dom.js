/**
 * Shadow DOM creation and management
 */

window.VSC = window.VSC || {};

class ShadowDOMManager {
  /**
   * Create shadow DOM for video controller
   * @param {HTMLElement} wrapper - Wrapper element
   * @param {Object} options - Configuration options
   * @returns {ShadowRoot} Created shadow root
   */
  static createShadowDOM(wrapper, options = {}) {
    const {
      top = '0px',
      left = '0px',
      speed = '1.00',
      opacity = 0.3,
      buttonSize = 14,
      quickSpeeds = window.VSC.Constants.DEFAULT_QUICK_SPEEDS,
    } = options;

    const shadow = wrapper.attachShadow({ mode: 'open' });

    // Create style element with embedded CSS for immediate styling
    const style = document.createElement('style');
    style.textContent = `
      * {
        line-height: 1.8em;
        font-family: sans-serif;
        font-size: 13px;
      }
      
      :host(:hover) #controls {
        display: inline-block;
      }
      
      /* Hide the automatic layer without disturbing any explicit override. */
      :host(.vsc-hidden) #controller {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }

      /* Explicit show and temporary speed feedback outrank automatic hiding,
         including startHidden, media visibility, and site autohide. */
      :host([data-vsc-visibility="show"]) #controller,
      :host(.vsc-show) #controller {
        display: block !important;
        visibility: visible !important;
        opacity: ${opacity} !important;
      }

      /* Explicit hide and unavailable media are final: flashes and user show
         overrides must not reveal them. */
      :host([data-vsc-visibility="hide"]) #controller,
      :host(.vsc-nosource) #controller {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
      
      #controller {
        position: absolute;
        top: 0;
        left: 0;
        background: black;
        color: white;
        border-radius: 6px;
        padding: 4px;
        margin: 10px 10px 10px 15px;
        cursor: default;
        z-index: 9999999;
        white-space: nowrap;
      }
      
      #controller:hover {
        opacity: 0.7;
      }
      
      #controller:hover>.draggable {
        margin-right: 0.8em;
      }
      
      #controls {
        display: none;
        vertical-align: middle;
      }

      #quick-speeds {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        margin-right: 5px;
        vertical-align: middle;
      }
      
      #controller.dragging {
        cursor: -webkit-grabbing;
        opacity: 0.7;
      }
      
      #controller.dragging #controls {
        display: inline-block;
      }
      
      .draggable {
        cursor: -webkit-grab;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.8em;
        height: 1.4em;
        text-align: center;
        vertical-align: middle;
        box-sizing: border-box;
        touch-action: none;
      }
      
      .draggable:active {
        cursor: -webkit-grabbing;
      }
      
      button {
        opacity: 1;
        cursor: pointer;
        color: black;
        background: white;
        font-weight: normal;
        border-radius: 5px;
        padding: 1px 5px 3px 5px;
        font-size: inherit;
        line-height: inherit;
        border: 0px solid white;
        font-family: "Lucida Console", Monaco, monospace;
        margin: 0px 2px 2px 2px;
        transition: background 0.2s, color 0.2s;
      }
      
      button:focus {
        outline: 0;
      }
      
      button:hover {
        opacity: 1;
        background: #2196f3;
        color: #ffffff;
      }
      
      button:active {
        background: #2196f3;
        color: #ffffff;
        font-weight: bold;
      }
      
      button.rw {
        opacity: 0.65;
      }

      button.quick-speed {
        display: inline-block;
        width: 20px;
        min-width: 20px;
        height: 20px;
        padding: 0;
        margin: 0;
        border-radius: 50%;
        line-height: 20px;
        box-sizing: border-box;
      }

      button.save-position {
        min-width: 24px;
        padding-left: 4px;
        padding-right: 4px;
      }

      button.save-position.saved {
        background: #2e7d32;
        color: #ffffff;
      }
    `;
    shadow.appendChild(style);

    // Create controller div
    const controller = document.createElement('div');
    controller.id = 'controller';
    controller.style.cssText = `top:${top}; left:${left}; opacity:${opacity};`;

    // Quick-speed circles are always present whenever the controller is
    // visible. Their accessible names carry the values so the circles can
    // remain visually empty and compact.
    const quickSpeedControls = document.createElement('span');
    quickSpeedControls.id = 'quick-speeds';
    for (let index = 0; index < 2; index++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-speed';
      button.dataset.quickSpeedIndex = String(index);
      quickSpeedControls.appendChild(button);
    }
    controller.appendChild(quickSpeedControls);

    // Create draggable speed indicator
    const draggable = document.createElement('span');
    draggable.setAttribute('data-action', 'drag');
    draggable.className = 'draggable';
    draggable.style.cssText = `font-size: ${buttonSize}px;`;
    draggable.textContent = speed;
    controller.appendChild(draggable);

    // Create controls span
    const controls = document.createElement('span');
    controls.id = 'controls';
    controls.style.cssText = `font-size: ${buttonSize}px; line-height: ${buttonSize}px;`;

    // Create buttons
    const buttons = [
      { action: 'rewind', text: '«', class: 'rw' },
      { action: 'slower', text: '−', class: '' },
      { action: 'faster', text: '+', class: '' },
      { action: 'advance', text: '»', class: 'rw' },
      {
        action: 'SET_SPEED',
        speed: 1.0,
        text: '1',
        class: 'reset-speed',
        title: 'Reset speed to 1.0×',
        ariaLabel: 'Reset speed to 1.0×',
      },
      {
        action: 'save-position',
        text: '💾',
        class: 'save-position',
        title: 'Save controller position for this website',
        ariaLabel: 'Save controller position for this website',
      },
    ];

    buttons.forEach((btnConfig) => {
      const button = document.createElement('button');
      button.setAttribute('data-action', btnConfig.action);
      if (btnConfig.speed !== undefined) {
        button.dataset.speed = String(btnConfig.speed);
      }
      if (btnConfig.class) {
        button.className = btnConfig.class;
      }
      if (btnConfig.title) {
        button.title = btnConfig.title;
      }
      if (btnConfig.ariaLabel) {
        button.setAttribute('aria-label', btnConfig.ariaLabel);
      }
      button.textContent = btnConfig.text;
      controls.appendChild(button);
    });

    controller.appendChild(controls);
    shadow.appendChild(controller);
    this.updateQuickSpeedButtons(shadow, quickSpeeds);

    window.VSC.logger.debug('Shadow DOM created for video controller');
    return shadow;
  }

  /**
   * Get controller element from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {HTMLElement} Controller element
   */
  static getController(shadow) {
    return shadow.querySelector('#controller');
  }

  /**
   * Get controls container from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {HTMLElement} Controls element
   */
  static getControls(shadow) {
    return shadow.querySelector('#controls');
  }

  /**
   * Get draggable speed indicator from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {HTMLElement} Speed indicator element
   */
  static getSpeedIndicator(shadow) {
    return shadow.querySelector('.draggable');
  }

  /**
   * Get all buttons from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {NodeList} Button elements
   */
  static getButtons(shadow) {
    return shadow.querySelectorAll('button');
  }

  /**
   * Refresh quick-speed action values and accessible metadata.
   * @param {ShadowRoot} shadow
   * @param {*} speeds
   */
  static updateQuickSpeedButtons(shadow, speeds) {
    const normalized = window.VSC.Constants.normalizeQuickSpeeds(speeds);
    shadow.querySelectorAll('button.quick-speed').forEach((button, index) => {
      const speed = normalized[index];
      const displaySpeed = Number(speed.toFixed(2)).toString();
      const label = `Set speed to ${displaySpeed}×`;
      button.dataset.speed = String(speed);
      button.title = label;
      button.setAttribute('aria-label', label);
    });
  }

  /**
   * Update speed display in shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @param {number} speed - New speed value
   */
  static updateSpeedDisplay(shadow, speed) {
    const speedIndicator = this.getSpeedIndicator(shadow);
    if (speedIndicator) {
      speedIndicator.textContent = window.VSC.Constants.formatSpeed(speed);
    }
  }

  /**
   * Calculate position for controller based on video element
   * @param {HTMLVideoElement} video - Video element
   * @returns {Object} Position object with top and left properties
   */
  static calculatePosition(video) {
    const rect = video.getBoundingClientRect();

    // getBoundingClientRect is relative to the viewport; style coordinates
    // are relative to offsetParent, so we adjust for that here. offsetParent
    // can be null if the video has `display: none` or is not yet in the DOM.
    const offsetRect = video.offsetParent?.getBoundingClientRect();
    const top = `${Math.max(rect.top - (offsetRect?.top || 0), 0)}px`;
    const left = `${Math.max(rect.left - (offsetRect?.left || 0), 0)}px`;

    return { top, left };
  }
}

// Create singleton instance
window.VSC.ShadowDOMManager = ShadowDOMManager;
