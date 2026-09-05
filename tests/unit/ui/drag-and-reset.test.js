/**
 * Tests for unified pointer-based drag and double-click-to-reset
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
import { vi } from 'vitest';
let mockDOM;

const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const pointerEvent = (type, clientX, clientY, pointerId = 1) => {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: pointerId },
  });
  return event;
};

describe('DragAndReset', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();

    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }
    if (window.VSC && window.VSC.siteHandlerManager) {
      window.VSC.siteHandlerManager.initialize(document);
    }
  });

  afterEach(() => {
    cleanupChromeMock();
    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }
    document.querySelectorAll('video, audio').forEach((el) => el.remove());
    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  // --- DragHandler tests ---

  it('DragHandler.handleDrag uses pointer capture when pointerId is present', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    const shadowController = controller.div.shadowRoot.querySelector('#controller');
    const draggable = controller.div.shadowRoot.querySelector('.draggable');

    let captured = false;
    draggable.setPointerCapture = () => {
      captured = true;
    };
    draggable.releasePointerCapture = () => {};

    // Simulate pointerdown with pointerId
    const pointerEvent = new Event('pointerdown', { bubbles: true });
    pointerEvent.clientX = 100;
    pointerEvent.clientY = 100;
    pointerEvent.pointerId = 1;
    Object.defineProperty(pointerEvent, 'target', { value: draggable, writable: true });

    window.VSC.DragHandler.handleDrag(mockVideo, pointerEvent);

    expect(captured).toBe(true);
    expect(shadowController.classList.contains('dragging')).toBe(true);
  });

  it('DragHandler.handleDrag falls back to mouse events without pointerId', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    const shadowController = controller.div.shadowRoot.querySelector('#controller');
    const draggable = controller.div.shadowRoot.querySelector('.draggable');

    // Simulate mousedown without pointerId
    const mouseEvent = new Event('mousedown', { bubbles: true });
    mouseEvent.clientX = 50;
    mouseEvent.clientY = 50;
    Object.defineProperty(mouseEvent, 'target', { value: draggable, writable: true });

    window.VSC.DragHandler.handleDrag(mockVideo, mouseEvent);

    expect(shadowController.classList.contains('dragging')).toBe(true);
  });

  it('clamps pointer dragging to all four edges of the media', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    const shadowController = controller.div.shadowRoot.querySelector('#controller');
    const draggable = controller.div.shadowRoot.querySelector('.draggable');

    mockVideo.getBoundingClientRect = () => rect(100, 50, 200, 100);
    draggable.getBoundingClientRect = () => {
      const left = parseFloat(shadowController.style.left) || 0;
      const top = parseFloat(shadowController.style.top) || 0;
      return rect(left, top, 40, 20);
    };
    shadowController.style.left = '120px';
    shadowController.style.top = '70px';
    draggable.setPointerCapture = () => {};

    draggable.dispatchEvent(pointerEvent('pointerdown', 120, 70));
    draggable.dispatchEvent(pointerEvent('pointermove', 500, 500));

    expect(shadowController.style.left).toBe('260px');
    expect(shadowController.style.top).toBe('130px');

    // A later layout check must retain an unsaved drag instead of restoring
    // the position loaded when this controller was created.
    controller.updateControllerBounds();
    expect(shadowController.style.left).toBe('260px');
    expect(shadowController.style.top).toBe('130px');

    draggable.dispatchEvent(pointerEvent('pointermove', -300, -300));

    expect(shadowController.style.left).toBe('100px');
    expect(shadowController.style.top).toBe('50px');
    draggable.dispatchEvent(pointerEvent('pointerup', -300, -300));
  });

  it('leaves an in-bounds badge unchanged without considering the expanded controller', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    const shadowController = controller.div.shadowRoot.querySelector('#controller');
    const draggable = controller.div.shadowRoot.querySelector('.draggable');

    mockVideo.getBoundingClientRect = () => rect(100, 50, 200, 100);
    draggable.getBoundingClientRect = () => rect(120, 70, 40, 20);
    shadowController.getBoundingClientRect = () => rect(120, 70, 400, 200);
    shadowController.style.left = '120px';
    shadowController.style.top = '70px';

    window.VSC.DragHandler.constrainToMedia(mockVideo);

    expect(shadowController.style.left).toBe('120px');
    expect(shadowController.style.top).toBe('70px');
  });

  it('aligns an oversized badge with the leading media edges', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    const shadowController = controller.div.shadowRoot.querySelector('#controller');
    const draggable = controller.div.shadowRoot.querySelector('.draggable');

    mockVideo.getBoundingClientRect = () => rect(100, 50, 50, 40);
    draggable.getBoundingClientRect = () => rect(200, 140, 80, 60);
    shadowController.style.left = '200px';
    shadowController.style.top = '140px';

    window.VSC.DragHandler.constrainToMedia(mockVideo);

    expect(shadowController.style.left).toBe('100px');
    expect(shadowController.style.top).toBe('50px');
  });

  it('clamps a saved controller offset when it is applied', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    const shadowController = controller.div.shadowRoot.querySelector('#controller');
    const draggable = controller.div.shadowRoot.querySelector('.draggable');

    mockVideo.getBoundingClientRect = () => rect(100, 50, 200, 100);
    draggable.getBoundingClientRect = () => {
      const left = parseFloat(shadowController.style.left) || 0;
      const top = parseFloat(shadowController.style.top) || 0;
      return rect(left, top, 40, 20);
    };

    controller.applyControllerPosition({ x: 500, y: 500 });

    expect(shadowController.style.left).toBe('260px');
    expect(shadowController.style.top).toBe('130px');
  });

  // --- Double-click-to-reset tests ---

  it('ControlsManager sets up dblclick handler on draggable', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Change speed away from 1.0
    mockVideo.playbackRate = 2.0;
    if (mockVideo.vsc.speedIndicator) {
      mockVideo.vsc.speedIndicator.textContent = '2.00';
    }

    // Track if reset was called
    let resetCalled = false;
    const origRunAction = actionHandler.runAction.bind(actionHandler);
    actionHandler.runAction = (action, value, e) => {
      if (action === 'reset') {
        resetCalled = true;
      }
      return origRunAction(action, value, e);
    };

    // Dispatch dblclick on the draggable
    const draggable = controller.div.shadowRoot.querySelector('.draggable');
    const dblClickEvent = new Event('dblclick', { bubbles: true, cancelable: true });
    Object.defineProperty(dblClickEvent, 'target', { value: draggable, writable: true });
    draggable.dispatchEvent(dblClickEvent);

    expect(resetCalled).toBe(true);
  });

  it('Draggable element has touch-action: none in style', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Check that the shadow DOM style contains touch-action: none for .draggable
    const style = controller.div.shadowRoot.querySelector('style');
    expect(style.textContent.includes('touch-action: none')).toBe(true);
  });

  it('restores and reads a saved offset relative to the natural baseline', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.controllerPosition = { x: -25, y: 150 };
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    const inner = controller.div.shadowRoot.querySelector('#controller');

    expect(controller.getControllerPositionOffset()).toEqual({ x: -25, y: 150 });
    expect(Number.parseInt(inner.style.left, 10)).toBe(controller.controllerBaseline.left - 25);
    expect(Number.parseInt(inner.style.top, 10)).toBe(controller.controllerBaseline.top + 150);
  });

  it('layers the saved inner offset on player-targeted relative host CSS', async () => {
    const style = document.createElement('style');
    style.textContent = `
      .tiktok-web-player vsc-controller {
        position: relative !important;
        top: 150px !important;
      }
    `;
    document.head.appendChild(style);
    const player = document.createElement('div');
    player.className = 'tiktok-web-player';
    document.body.appendChild(player);

    try {
      const config = window.VSC.videoSpeedConfig;
      await config.load();
      config.settings.controllerPosition = { x: 12, y: 40 };
      const eventManager = new window.VSC.EventManager(config, null);
      const actionHandler = new window.VSC.ActionHandler(config, eventManager);
      const mockVideo = createMockVideo();
      player.appendChild(mockVideo);

      const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
      const inner = controller.div.shadowRoot.querySelector('#controller');

      expect(getComputedStyle(controller.div).position).toBe('relative');
      expect(getComputedStyle(controller.div).top).toBe('150px');
      expect(controller.controllerBaseline).toEqual({ top: 0, left: 0 });
      expect(inner.style.left).toBe('12px');
      expect(inner.style.top).toBe('40px');
    } finally {
      player.remove();
      style.remove();
    }
  });

  it('saves the current displacement and shows success feedback', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const saveSpy = vi.spyOn(config, 'saveControllerPosition').mockResolvedValue(true);
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    const inner = controller.div.shadowRoot.querySelector('#controller');
    inner.style.left = `${controller.controllerBaseline.left + 35}px`;
    inner.style.top = `${controller.controllerBaseline.top - 40}px`;

    const button = controller.div.shadowRoot.querySelector('button.save-position');
    button.click();
    await Promise.resolve();

    expect(saveSpy).toHaveBeenCalledWith({ x: 35, y: -40 });
    expect(button.textContent).toBe('✓');
    expect(button.classList.contains('saved')).toBe(true);
  });

  it('applies a saved-position change to every controller in the document', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const firstVideo = createMockVideo();
    const secondVideo = createMockVideo();
    mockDOM.container.append(firstVideo, secondVideo);
    const first = new window.VSC.VideoController(firstVideo, null, config, actionHandler);
    const second = new window.VSC.VideoController(secondVideo, null, config, actionHandler);

    config.settings.controllerPosition = { x: 60, y: -20 };
    config._notifySettingsChanged({
      controllerPosition: { oldValue: null, newValue: config.settings.controllerPosition },
    });

    expect(first.getControllerPositionOffset()).toEqual({ x: 60, y: -20 });
    expect(second.getControllerPositionOffset()).toEqual({ x: 60, y: -20 });

    config.settings.controllerPosition = null;
    config._notifySettingsChanged({
      controllerPosition: { oldValue: { x: 60, y: -20 }, newValue: null },
    });
    expect(first.getControllerPositionOffset()).toEqual({ x: 0, y: 0 });
    expect(second.getControllerPositionOffset()).toEqual({ x: 0, y: 0 });
  });
});
