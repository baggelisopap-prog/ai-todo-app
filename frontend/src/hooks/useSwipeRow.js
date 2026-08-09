import { useRef, useState } from 'react';

const DIRECTION_LOCK_PX = 10; // how far before we decide horizontal vs vertical
const TRIGGER_PX = 72;        // how far before a release counts as a swipe
const MAX_DRAG_PX = 120;      // how far the row is allowed to follow the finger

/**
 * Horizontal swipe on a list row, without stealing vertical scrolling.
 *
 * Two things make this safe rather than the usual gesture that fights the page:
 *
 * The direction lock. Nothing moves until the pointer has travelled
 * DIRECTION_LOCK_PX, and then only if the movement is more horizontal than
 * vertical. A finger that is mostly going down is a scroll, and we let go of it
 * for the rest of the gesture rather than reconsidering every frame.
 *
 * `touch-action: pan-y` on the element (Tailwind's `touch-pan-y`, applied by
 * the caller). That is what tells the browser to keep handling vertical
 * scrolling itself while leaving horizontal movement to us. Without it the
 * browser claims the whole gesture and these handlers see almost nothing.
 *
 * Pointer events rather than touch events, so a mouse drag works identically —
 * which is also the only way this is testable on a desktop.
 *
 * Note for anyone adding drag-and-drop to a list: @dnd-kit is confined to
 * CalendarView, which has no swipe. If the two ever meet, dnd-kit's sensors and
 * this both listen to pointerdown and will need an explicit activation
 * constraint to share.
 */
export function useSwipeRow({ onSwipeRight, onSwipeLeft, enabled = true }) {
  const [dx, setDx] = useState(0);
  const gesture = useRef({ startX: 0, startY: 0, axis: null, pointerId: null });

  function reset() {
    gesture.current = { startX: 0, startY: 0, axis: null, pointerId: null };
    setDx(0);
  }

  function onPointerDown(e) {
    if (!enabled || e.pointerType === 'mouse' && e.button !== 0) return;
    gesture.current = { startX: e.clientX, startY: e.clientY, axis: null, pointerId: e.pointerId };
  }

  function onPointerMove(e) {
    const g = gesture.current;
    if (g.pointerId === null || g.axis === 'vertical') return;

    const deltaX = e.clientX - g.startX;
    const deltaY = e.clientY - g.startY;

    if (g.axis === null) {
      if (Math.abs(deltaX) < DIRECTION_LOCK_PX && Math.abs(deltaY) < DIRECTION_LOCK_PX) return;
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        g.axis = 'vertical'; // it's a scroll — hands off for the rest of this gesture
        return;
      }
      g.axis = 'horizontal';
      // Capture so the row keeps receiving moves even if the finger slides off
      // it, which is common on a short row and otherwise leaves it stuck
      // mid-swipe with no pointerup.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }

    const clamped = Math.max(-MAX_DRAG_PX, Math.min(MAX_DRAG_PX, deltaX));
    setDx(clamped);
  }

  function onPointerUp() {
    const g = gesture.current;
    if (g.axis === 'horizontal') {
      if (dx >= TRIGGER_PX) onSwipeRight?.();
      else if (dx <= -TRIGGER_PX) onSwipeLeft?.();
    }
    reset();
  }

  return {
    dx,
    // Derived from dx alone, not from the ref. Reading gesture.current here
    // would be a render-time ref read — it would not re-render when the axis
    // changed, and the answer is the same anyway: dx is only ever non-zero
    // inside a horizontal gesture, and returns to 0 on release and on cancel.
    isSwiping: dx !== 0,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: reset,
    },
  };
}

export default useSwipeRow;
