/**
 * Shared validation and storage-key helpers for saved controller positions.
 */

export const CONTROLLER_POSITION_KEY_PREFIX = 'controllerPosition:';
export const CONTROLLER_POSITION_LIMIT = 10000;

/**
 * Normalize a location-like object into the device-local persistence scope.
 * @param {{protocol?: string, hostname?: string}} locationLike
 * @returns {string|null}
 */
export function getControllerPositionScope(locationLike = window.location) {
  if (locationLike?.protocol === 'file:') {
    return 'file:';
  }

  const hostname = String(locationLike?.hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  return hostname || null;
}

/**
 * Build the chrome.storage.local key for a location.
 * @param {{protocol?: string, hostname?: string}} locationLike
 * @returns {string|null}
 */
export function getControllerPositionStorageKey(locationLike = window.location) {
  const scope = getControllerPositionScope(locationLike);
  return scope ? `${CONTROLLER_POSITION_KEY_PREFIX}${scope}` : null;
}

/**
 * Extract the user-facing scope from a position storage key.
 * @param {string} key
 * @returns {string|null}
 */
export function parseControllerPositionStorageKey(key) {
  if (typeof key !== 'string' || !key.startsWith(CONTROLLER_POSITION_KEY_PREFIX)) {
    return null;
  }
  return key.slice(CONTROLLER_POSITION_KEY_PREFIX.length) || null;
}

/**
 * Validate a persisted baseline-relative pixel offset.
 * @param {*} value
 * @returns {{x: number, y: number}|null}
 */
export function normalizeControllerPosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const { x, y } = value;
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    Math.abs(x) > CONTROLLER_POSITION_LIMIT ||
    Math.abs(y) > CONTROLLER_POSITION_LIMIT
  ) {
    return null;
  }

  return { x, y };
}

// Page-context modules use the existing global namespace and cannot import
// directly from one another after bundling.
window.VSC = window.VSC || {};
window.VSC.ControllerPosition = {
  KEY_PREFIX: CONTROLLER_POSITION_KEY_PREFIX,
  LIMIT: CONTROLLER_POSITION_LIMIT,
  getScope: getControllerPositionScope,
  getStorageKey: getControllerPositionStorageKey,
  parseStorageKey: parseControllerPositionStorageKey,
  normalize: normalizeControllerPosition,
};
