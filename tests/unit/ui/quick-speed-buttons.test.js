import { vi } from 'vitest';

describe('QuickSpeedButtons', () => {
  function createControls(quickSpeeds = [1.5, 2.0]) {
    const wrapper = document.createElement('vsc-controller');
    document.body.appendChild(wrapper);
    const shadow = window.VSC.ShadowDOMManager.createShadowDOM(wrapper, {
      speed: '1.00',
      quickSpeeds,
    });
    return { wrapper, shadow };
  }

  afterEach(() => {
    document.querySelectorAll('vsc-controller').forEach((controller) => controller.remove());
  });

  it('renders two empty 20px circles before the speed and hover controls', () => {
    const { shadow } = createControls();
    const controller = shadow.querySelector('#controller');
    const quickContainer = shadow.querySelector('#quick-speeds');
    const buttons = quickContainer.querySelectorAll('button.quick-speed');

    expect(controller.children[0]).toBe(quickContainer);
    expect(controller.children[1].classList.contains('draggable')).toBe(true);
    expect(controller.children[2].id).toBe('controls');
    expect(buttons).toHaveLength(2);
    expect(Array.from(buttons).map((button) => button.textContent)).toEqual(['', '']);
    expect(buttons[0].title).toBe('Set speed to 1.5×');
    expect(buttons[1].getAttribute('aria-label')).toBe('Set speed to 2×');

    const css = shadow.querySelector('style').textContent;
    expect(css).toContain('width: 20px');
    expect(css).toContain('height: 20px');
    expect(css).toContain('border-radius: 50%');
    expect(css).toContain('#quick-speeds');
  });

  it('routes each circle through an absolute SET_SPEED action without page propagation', () => {
    const actionHandler = { runAction: vi.fn(), adjustSpeed: vi.fn() };
    const config = { settings: { quickSpeeds: [1.5, 2.0] }, getKeyBinding: vi.fn() };
    const controls = new window.VSC.ControlsManager(actionHandler, config);
    const video = document.createElement('video');
    const { wrapper, shadow } = createControls(config.settings.quickSpeeds);
    const pageClick = vi.fn();
    document.body.addEventListener('click', pageClick);
    controls.setupControlEvents(shadow, video);

    const buttons = shadow.querySelectorAll('button.quick-speed');
    buttons[0].click();
    buttons[1].click();

    expect(actionHandler.runAction).toHaveBeenNthCalledWith(1, 'SET_SPEED', 1.5, expect.any(Event));
    expect(actionHandler.runAction).toHaveBeenNthCalledWith(2, 'SET_SPEED', 2.0, expect.any(Event));
    expect(pageClick).not.toHaveBeenCalled();
    expect(wrapper.shadowRoot.querySelector('.draggable').dataset.action).toBe('drag');

    document.body.removeEventListener('click', pageClick);
  });

  it('refreshes action values and accessible metadata without adding buttons', () => {
    const { shadow } = createControls();

    window.VSC.ShadowDOMManager.updateQuickSpeedButtons(shadow, [1.37, 2.25]);

    const buttons = shadow.querySelectorAll('button.quick-speed');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].dataset.speed).toBe('1.37');
    expect(buttons[0].title).toBe('Set speed to 1.37×');
    expect(buttons[1].dataset.speed).toBe('2.25');
    expect(buttons[1].getAttribute('aria-label')).toBe('Set speed to 2.25×');
  });
});
