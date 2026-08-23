/**
 * Drag functionality for video controller
 * Uses pointer events for unified mouse + touch support
 */

window.VSC = window.VSC || {};

class DragHandler {
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

    const mediaRight = mediaRect.right ?? mediaRect.left + mediaRect.width;
    const mediaBottom = mediaRect.bottom ?? mediaRect.top + mediaRect.height;
    const draggableRight = draggableRect.right ?? draggableRect.left + draggableRect.width;
    const draggableBottom = draggableRect.bottom ?? draggableRect.top + draggableRect.height;

    let deltaX = 0;
    let deltaY = 0;

    if (draggableRect.width > mediaRect.width || draggableRect.left < mediaRect.left) {
      deltaX = mediaRect.left - draggableRect.left;
    } else if (draggableRight > mediaRight) {
      deltaX = mediaRight - draggableRight;
    }

    if (draggableRect.height > mediaRect.height || draggableRect.top < mediaRect.top) {
      deltaY = mediaRect.top - draggableRect.top;
    } else if (draggableBottom > mediaBottom) {
      deltaY = mediaBottom - draggableBottom;
    }

    if (deltaX !== 0) {
      const currentLeft = parseFloat(shadowController.style.left) || 0;
      shadowController.style.left = `${currentLeft + deltaX}px`;
    }
    if (deltaY !== 0) {
      const currentTop = parseFloat(shadowController.style.top) || 0;
      shadowController.style.top = `${currentTop + deltaY}px`;
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
