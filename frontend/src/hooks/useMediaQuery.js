import { useCallback, useSyncExternalStore } from 'react';

/**
 * 1024px, matching Tailwind's own `lg` breakpoint so a class written as
 * `lg:max-w-none` and a branch written as `useMediaQuery(DESKTOP_QUERY)` can
 * never disagree about where the desktop starts. The owner chose this width:
 * below it — a tablet held upright — the 256px sidebar would take a quarter of
 * the screen away from the task list, so that case keeps the phone's nav.
 */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Whether the window currently matches a CSS media query.
 *
 * A JS branch rather than `hidden lg:flex` classes, because the two
 * navigations are not just two skins: the desktop one owns the add-task
 * button, which mounts a microphone and two file pickers. Rendering both trees
 * and hiding one with CSS would mount that machinery twice on every screen.
 * Here exactly one of them exists at a time.
 *
 * Built on useSyncExternalStore rather than useState + useEffect, which is
 * what this was first. That version had to re-read the query inside the effect
 * to cover the gap between the first render and the listener being attached —
 * a tablet rotated in that window would have been missed — and re-reading
 * meant calling setState from an effect, which React 19 flags. This hook reads
 * the value on every render and again right after subscribing, so the gap
 * closes without the extra write.
 */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onStoreChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
