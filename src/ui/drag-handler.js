/**
 * Drag functionality for video controller
 * Uses pointer events for unified mouse + touch support
 */

window.VSC = window.VSC || {};

class DragHandler {
  /** Ancestors that can move or clip the media and its separately placed host. */
  static getBoundsAncestors(media) {
    const ancestors = new Set();
    for (const element of [media, media?.vsc?.div]) {
      let parent = element?.parentElement;
      while (parent) {
        ancestors.add(parent);
        parent = parent.parentElement;
      }
    }
    return ancestors;
  }

  /** Intersect the video box with the viewport and ancestor overflow clips. */
  static getVisibleMediaRect(media, mediaRect) {
    const view = media.ownerDocument.defaultView;
    let left = Math.max(0, mediaRect.left);
    let top = Math.max(0, mediaRect.top);
    let right = Math.min(view.innerWidth, mediaRect.right ?? mediaRect.left + mediaRect.width);
    let bottom = Math.min(view.innerHeight, mediaRect.bottom ?? mediaRect.top + mediaRect.height);

    for (const ancestor of DragHandler.getBoundsAncestors(media)) {
      const style = view.getComputedStyle(ancestor);
      const clipsX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX);
      const clipsY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY);
      if (!clipsX && !clipsY) {
        continue;
      }
      const rect = ancestor.getBoundingClientRect();
      const scaleX = ancestor.offsetWidth ? rect.width / ancestor.offsetWidth : 1;
      const scaleY = ancestor.offsetHeight ? rect.height / ancestor.offsetHeight : 1;
      const clipLeft = rect.left + ancestor.clientLeft * scaleX;
      const clipTop = rect.top + ancestor.clientTop * scaleY;
      if (clipsX) {
        left = Math.max(left, clipLeft);
        right = Math.min(right, clipLeft + ancestor.clientWidth * scaleX);
      }
      if (clipsY) {
        top = Math.max(top, clipTop);
        bottom = Math.min(bottom, clipTop + ancestor.clientHeight * scaleY);
      }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  /**
   * Keep the draggable speed badge inside its associated media element.
   * The expanded controls are intentionally excluded from the bounds check.
   * @param {HTMLMediaElement} media - Video or audio element
   */
  static constrainToMedia(media) {
    const shadow = media?.vsc?.div?.shadowRoot;
    const shadowController = shadow?.querySelector('#controller');
    const draggable = shadow?.querySelector('.draggable');

    if (!shadowController || !draggable) {
      return;
    }

    const mediaRect = media.getBoundingClientRect();
    const draggableRect = draggable.getBoundingClientRect();

    // Hidden or not-yet-laid-out elements have no useful geometry. Their
    // ResizeObserver callback will constrain them once they become visible.
    if (
      !Number.isFinite(mediaRect.width) ||
      !Number.isFinite(mediaRect.height) ||
      !Number.isFinite(draggableRect.width) ||
      !Number.isFinite(draggableRect.height) ||
      mediaRect.width <= 0 ||
      mediaRect.height <= 0 ||
      draggableRect.width <= 0 ||
      draggableRect.height <= 0
    ) {
      return;
    }

    const bounds = DragHandler.getVisibleMediaRect(media, mediaRect);
    // Do not move controllers belonging to completely offscreen feed items.
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }
    const draggableRight = draggableRect.right ?? draggableRect.left + draggableRect.width;
    const draggableBottom = draggableRect.bottom ?? draggableRect.top + draggableRect.height;

    let deltaX = 0;
    let deltaY = 0;

    if (draggableRect.width > bounds.width || draggableRect.left < bounds.left) {
      deltaX = bounds.left - draggableRect.left;
    } else if (draggableRight > bounds.right) {
      deltaX = bounds.right - draggableRight;
    }

    if (draggableRect.height > bounds.height || draggableRect.top < bounds.top) {
      deltaY = bounds.top - draggableRect.top;
    } else if (draggableBottom > bounds.bottom) {
      deltaY = bounds.bottom - draggableBottom;
    }

    // Rects use viewport pixels; left/top use the controller's local CSS pixels.
    // A scaled player otherwise under-corrects or overshoots the visible edge.
    const controllerRect = shadowController.getBoundingClientRect();
    const style = media.ownerDocument.defaultView.getComputedStyle(shadowController);
    // offsetWidth/Height round to integers. That rounding can leave a badge
    // several pixels outside the bounds after a large position correction.
    const borderBoxSize = (dimension, edges) => {
      const size = parseFloat(style[dimension]);
      return style.boxSizing === 'border-box'
        ? size
        : size + edges.reduce((sum, edge) => sum + (parseFloat(style[edge]) || 0), 0);
    };
    const width = borderBoxSize('width', [
      'paddingLeft',
      'paddingRight',
      'borderLeftWidth',
      'borderRightWidth',
    ]);
    const height = borderBoxSize('height', [
      'paddingTop',
      'paddingBottom',
      'borderTopWidth',
      'borderBottomWidth',
    ]);
    const scaleX = width > 0 ? controllerRect.width / width : 1;
    const scaleY = height > 0 ? controllerRect.height / height : 1;
    if (deltaX !== 0) {
      const currentLeft = parseFloat(shadowController.style.left) || 0;
      shadowController.style.left = `${currentLeft + deltaX / (scaleX || 1)}px`;
    }
    if (deltaY !== 0) {
      const currentTop = parseFloat(shadowController.style.top) || 0;
      shadowController.style.top = `${currentTop + deltaY / (scaleY || 1)}px`;
    }
  }

  /**
   * Handle dragging of video controller via pointer events
   * @param {HTMLMediaElement} video - Video or audio element
   * @param {PointerEvent|MouseEvent} e - Pointer/mouse event
   */
  static handleDrag(video, e) {
    const controller = video.vsc.div;
    const shadowController = controller.shadowRoot.querySelector('#controller');

    video.classList.add('vcs-dragging');
    shadowController.classList.add('dragging');

    const initialXY = [e.clientX, e.clientY];
    const initialControllerXY = [
      parseFloat(shadowController.style.left) || 0,
      parseFloat(shadowController.style.top) || 0,
    ];

    const draggable = e.target;

    // Capture pointer so all move/up events route here regardless of position
    if (e.pointerId !== undefined) {
      draggable.setPointerCapture(e.pointerId);
    }

    const onMove = (ev) => {
      const dx = ev.clientX - initialXY[0];
      const dy = ev.clientY - initialXY[1];
      shadowController.style.left = `${initialControllerXY[0] + dx}px`;
      shadowController.style.top = `${initialControllerXY[1] + dy}px`;
      DragHandler.constrainToMedia(video);
      video.vsc.captureRequestedControllerPosition();
    };

    const onEnd = () => {
      draggable.removeEventListener('pointermove', onMove);
      draggable.removeEventListener('pointerup', onEnd);
      draggable.removeEventListener('pointercancel', onEnd);
      // Mouse fallbacks
      draggable.removeEventListener('mousemove', onMove);
      draggable.removeEventListener('mouseup', onEnd);

      shadowController.classList.remove('dragging');
      video.classList.remove('vcs-dragging');

      window.VSC.logger.debug('Drag operation completed');
    };

    if (e.pointerId !== undefined) {
      draggable.addEventListener('pointermove', onMove);
      draggable.addEventListener('pointerup', onEnd);
      draggable.addEventListener('pointercancel', onEnd);
    } else {
      // Fallback for environments without pointer events
      draggable.addEventListener('mousemove', onMove);
      draggable.addEventListener('mouseup', onEnd);
    }

    window.VSC.logger.debug('Drag operation started');
  }
}

// Create singleton instance
window.VSC.DragHandler = DragHandler;
