import {
  CONTROLLER_POSITION_LIMIT,
  getControllerPositionScope,
  getControllerPositionStorageKey,
  normalizeControllerPosition,
  parseControllerPositionStorageKey,
} from '../../../src/utils/controller-position.js';

describe('controller position utilities', () => {
  it('normalizes hostnames and gives all local files one scope', () => {
    expect(getControllerPositionScope({ protocol: 'https:', hostname: 'WWW.TikTok.com' })).toBe(
      'tiktok.com'
    );
    expect(getControllerPositionStorageKey({ protocol: 'https:', hostname: 'm.tiktok.com' })).toBe(
      'controllerPosition:m.tiktok.com'
    );
    expect(getControllerPositionStorageKey({ protocol: 'file:', hostname: '' })).toBe(
      'controllerPosition:file:'
    );
    expect(parseControllerPositionStorageKey('controllerPosition:tiktok.com')).toBe('tiktok.com');
  });

  it('accepts bounded integer offsets including negative values', () => {
    expect(normalizeControllerPosition({ x: -25, y: 150 })).toEqual({ x: -25, y: 150 });
    expect(
      normalizeControllerPosition({ x: CONTROLLER_POSITION_LIMIT, y: -CONTROLLER_POSITION_LIMIT })
    ).toEqual({ x: CONTROLLER_POSITION_LIMIT, y: -CONTROLLER_POSITION_LIMIT });
  });

  it.each([
    null,
    [],
    { x: 1.5, y: 2 },
    { x: 1, y: Number.NaN },
    { x: CONTROLLER_POSITION_LIMIT + 1, y: 0 },
    { x: '1', y: 2 },
  ])('rejects malformed or excessive offsets: %j', (value) => {
    expect(normalizeControllerPosition(value)).toBeNull();
  });
});
