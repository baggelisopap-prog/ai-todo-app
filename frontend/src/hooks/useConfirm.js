import { useCallback, useRef, useState } from 'react';

/**
 * Asking "are you sure?" and getting an answer back, the way window.confirm did.
 *
 * WHY THIS SHAPE. window.confirm is a function call that BLOCKS and returns a
 * boolean, so every caller reads `if (!window.confirm(...)) return;` — one line,
 * at the top of the handler, right where the decision belongs. A React dialog
 * cannot block, and the obvious replacement is to scatter the decision: a piece
 * of state for "which dialog is open", another for "what it was about", and the
 * real work moved into a callback somewhere else. Seven call sites rewritten
 * that way is seven chances to get the wiring wrong.
 *
 * So the promise does the blocking instead, and the call site keeps its shape:
 *
 *     if (!(await confirm.ask({ title, body, confirmLabel }))) return;
 *
 * The component renders `<ConfirmDialog request={confirm.request}
 * onAnswer={confirm.onAnswer} />` once, anywhere in its tree.
 *
 * The pending `resolve` lives in a ref rather than in state, and `onAnswer`
 * reads it outside the state updater. Resolving a promise from inside a
 * setState callback is a side effect in a place React is allowed to run twice —
 * which in development it does, and the second run would resolve an already
 * settled promise. Silent today, and exactly the kind of thing that surfaces
 * once as an action that fired twice.
 *
 * Not a provider: a dialog belongs to the screen that asked the question, and a
 * shared one would need a second answer for what happens when two screens ask
 * at once. Every caller here has exactly one question in flight.
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const pending = useRef(null);

  const ask = useCallback((options) => new Promise((resolve) => {
    // If something is somehow still waiting, answer it "no" rather than
    // stranding it: an awaited promise that never settles is a handler that
    // never finishes and a `busy` flag that never clears.
    pending.current?.(false);
    pending.current = resolve;
    setRequest(options);
  }), []);

  const onAnswer = useCallback((answer) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(answer);
  }, []);

  return { ask, request, onAnswer };
}
