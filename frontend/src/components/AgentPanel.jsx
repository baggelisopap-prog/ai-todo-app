import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatIcon } from './icons';

/**
 * The agent as a wall of the desktop window, not a card floating over it.
 *
 * WHY A COLUMN. On a desktop the agent used to be a 512×600 dialog dimming the
 * whole app — the phone's sheet, enlarged. So you asked a question about your
 * tasks and the answer covered your tasks, and to see both you had to close the
 * conversation and reopen it for the next question. On a phone that trade is
 * forced; there is no room for two things. On a 1440px window there was about
 * 470px of empty gutter doing nothing at all.
 *
 * WHY IT IS DRAGGABLE, and this is not a flourish — the arithmetic demands it.
 * Take a 1440px window: 256 goes to SideNav, leaving 1184 to share. The task
 * list wants 800 for its natural width (a 768 column plus its padding); the
 * conversation wants about 400 to be comfortable. That is 1200. It does not
 * fit, and it never will on a laptop screen. Something must always give — and
 * WHICH thing should give changes within the same hour, depending on whether
 * you are reading the list or talking to the agent. A constant chosen here
 * would be wrong half the day, so the split belongs to the person looking at
 * it. The owner asked for exactly this.
 *
 * THE LIMITS ARE MEASURED, not picked:
 *   MIN_WIDTH 300 — below this the chat bubbles and the Send button start
 *     wrapping onto extra lines.
 *   COLLAPSE_AT 250 — dragged past this it does not squeeze into something
 *     useless, it closes, leaving the strip that brings it back.
 *   The maximum is whatever leaves the list MIN_MAIN. It is not a constant:
 *     it grows with the window, which is why it is recomputed on resize.
 *
 * WIDTH IS A PROPERTY OF THIS SCREEN, so it lives in localStorage rather than
 * in app settings — the same reasoning SwipeHint already uses. A number chosen
 * on a 27-inch monitor is not a number anyone wants on a laptop, and syncing
 * it would carry the wrong answer between them.
 */

const STORAGE_WIDTH = 'agent_panel_width';
const STORAGE_COLLAPSED = 'agent_panel_collapsed';

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const COLLAPSE_AT = 250;
const MIN_MAIN = 480;
const SIDENAV = 256;
const GRIP = 9;

// Below this the three columns stop being honest, so the panel starts closed
// on a window this size — closed, NOT absent. The strip is always there, and
// opening it is one click; nothing decides for you that you cannot want it.
const COMFORTABLE_WIDTH = 1280;

function maxWidthFor(windowWidth) {
  return Math.max(MIN_WIDTH, windowWidth - SIDENAV - GRIP - MIN_MAIN);
}

function readStoredWidth() {
  const stored = Number(localStorage.getItem(STORAGE_WIDTH));
  if (!stored) return DEFAULT_WIDTH;
  return Math.min(Math.max(stored, MIN_WIDTH), maxWidthFor(window.innerWidth));
}

function readStoredCollapsed() {
  const stored = localStorage.getItem(STORAGE_COLLAPSED);
  // No stored answer means this is the first desktop visit, and the window's
  // own width is the best guess anyone has.
  if (stored === null) return window.innerWidth < COMFORTABLE_WIDTH;
  return stored === 'true';
}

/**
 * Open/closed lives HERE and is handed to the panel, rather than living inside
 * it, because two controls open the same panel: its own strip, and the «Ρώτα»
 * button still in the desktop AppBar. A panel owning its own state could not
 * be opened by the second one, and duplicating the state would mean two places
 * writing one localStorage key — which is how they drift.
 */
export function useAgentPanel() {
  const [isCollapsed, setCollapsedState] = useState(readStoredCollapsed);

  const setCollapsed = useCallback((next) => {
    setCollapsedState(next);
    localStorage.setItem(STORAGE_COLLAPSED, String(next));
  }, []);

  return { isCollapsed, setCollapsed };
}

function AgentPanel({ isCollapsed, onCollapsedChange, children }) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(readStoredWidth);
  // Two of the same fact, on purpose. The state drives the handle's colour and
  // must go through a render; the ref is read inside pointermove, which fires
  // far faster than React re-renders and would otherwise read a stale value.
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  // The last unclamped drag target, so release can tell "I stopped at the
  // minimum" apart from "I shoved it off the edge".
  const rawWidthRef = useRef(null);
  // What the panel measured when the hand landed, so a drag that ends in a
  // collapse can put it back rather than leaving the clamped value behind.
  const widthAtDragStartRef = useRef(DEFAULT_WIDTH);
  const gripRef = useRef(null);

  /**
   * Sizes the panel and nothing else. Collapsing is NOT its job, and that
   * separation is the fix for a real defect: while this function also
   * collapsed, dragging past the threshold unmounted the very handle under the
   * pointer, which killed the gesture — so overshooting inwards left you
   * unable to drag back out, and the only way back was clicking the strip.
   * Now the drag clamps at MIN_WIDTH and stays put, and whether to collapse is
   * decided once, on release.
   */
  const applyWidth = useCallback((next, { persist = true } = {}) => {
    const clamped = Math.min(Math.max(next, MIN_WIDTH), maxWidthFor(window.innerWidth));
    setWidth(clamped);
    // Persisted at the end of a drag, never during: writing on every
    // pointermove would put hundreds of writes through localStorage for one
    // sweep of the hand.
    if (persist) localStorage.setItem(STORAGE_WIDTH, String(Math.round(clamped)));
  }, []);

  // The ceiling moves with the window, so a panel left at 700px on a maximised
  // window has to come down when that window is halved — otherwise the list
  // disappears entirely rather than merely narrowing.
  useEffect(() => {
    function handleResize() {
      setWidth((current) => Math.min(Math.max(current, MIN_WIDTH), maxWidthFor(window.innerWidth)));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  function handlePointerDown(e) {
    e.preventDefault();
    // Capture is a CONVENIENCE, not the switch. It keeps events coming while
    // the pointer runs off a 9px target mid-drag, and it is allowed to fail —
    // some inputs and some environments simply do not grant it. What decides
    // whether we are dragging is the flag below, because gating the move on
    // `hasPointerCapture` means a refused capture makes the handle silently
    // dead rather than merely less smooth. That is exactly how this broke the
    // first time it was tested.
    gripRef.current?.setPointerCapture?.(e.pointerId);
    isDraggingRef.current = true;
    widthAtDragStartRef.current = width;
    setIsDragging(true);
  }

  function handlePointerMove(e) {
    if (!isDraggingRef.current) return;
    // Measured from the window's right edge, so the number IS the panel's
    // width and no layout has to be read back mid-drag. The unclamped figure
    // is kept because release needs to know how far past the edge the hand
    // actually went, which the clamped width can no longer say.
    const raw = window.innerWidth - e.clientX;
    rawWidthRef.current = raw;
    applyWidth(raw, { persist: false });
  }

  function handlePointerUp(e) {
    if (!isDraggingRef.current) return;
    gripRef.current?.releasePointerCapture?.(e.pointerId);
    isDraggingRef.current = false;
    setIsDragging(false);

    // The one decision made on release rather than during: dragged well past
    // the minimum and let go, you meant to close it, not to sit at 300px.
    if (rawWidthRef.current !== null && rawWidthRef.current < COLLAPSE_AT) {
      // Closing must not also resize. On the way past the edge the drag
      // clamped the width down to the minimum, and leaving it there would
      // mean the panel silently reopens narrower than you left it — so the
      // width goes back to what it was when the hand landed on the handle.
      setWidth(widthAtDragStartRef.current);
      onCollapsedChange(true);
    } else {
      // The drag itself never wrote to storage; this is the one write, with
      // whatever width the hand finished on.
      applyWidth(width);
    }
    rawWidthRef.current = null;
  }

  // The same handle, from the keyboard. A control that only answers to a mouse
  // does not exist for anyone not holding one — and this one governs how much
  // of the screen they can see.
  function handleKeyDown(e) {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') applyWidth(width + step);
    else if (e.key === 'ArrowRight') applyWidth(width - step);
    else if (e.key === 'Home') applyWidth(DEFAULT_WIDTH);
    else return;
    e.preventDefault();
  }

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => onCollapsedChange(false)}
        aria-label={t('agent.panel.expand')}
        className="flex-shrink-0 w-9 flex items-center justify-center gap-2 bg-[var(--bg-card)] border-l border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        {/* Vertical, because a 36px strip has height and no width to spell a
            word across. The label stays: an unlabelled icon on the edge of the
            screen is exactly the control nobody ever finds. */}
        <span className="flex items-center gap-2 [writing-mode:vertical-rl] text-xs font-semibold">
          <ChatIcon className="w-4 h-4 text-[var(--brand-primary)]" />
          {t('agent.short_label')}
        </span>
      </button>
    );
  }

  return (
    <>
      <button
        ref={gripRef}
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('agent.panel.resize')}
        aria-valuenow={Math.round(width)}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={Math.round(maxWidthFor(window.innerWidth))}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => applyWidth(DEFAULT_WIDTH)}
        // agent-grip carries the 1px rule and the wider invisible grab zone:
        // a handle you have to aim at is a handle nobody uses.
        className={`agent-grip flex-shrink-0 ${isDragging ? 'is-dragging' : ''}`}
      />
      <aside
        style={{ width, flex: `0 0 ${width}px` }}
        aria-label={t('agent.title')}
        className="h-screen sticky top-0 flex-shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden"
      >
        {children}
      </aside>
    </>
  );
}

export default AgentPanel;
