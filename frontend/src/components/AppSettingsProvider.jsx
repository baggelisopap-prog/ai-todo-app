import { useEffect, useRef, useState, useCallback } from 'react';
import { getAppSettings, updateAppSettings } from '../api';
import { AppSettingsContext } from '../hooks/useAppSettings';

/**
 * The single copy of this user's app settings.
 *
 * It exists because there used to be four. TodayView, CalendarView and TWO
 * sections inside SettingsModal each called getAppSettings() and kept their own
 * useState copy — and those two Settings sections were mounted at the same
 * time, because the accordion holding them hid collapsed content with a CSS
 * class instead of unmounting it. `PATCH /settings` takes the WHOLE AppSettings
 * object and writes all seven fields, and each section sent
 * `{...itsOwnCopy, theFieldItChanged}`.
 *
 * So: turn notifications off (server now correct), then toggle a calendar
 * setting, and the calendar section posts its snapshot from mount — in which
 * notifications are still on. They came back on, silently, with the toggle that
 * showed them still reading "off". Two toggles in one sitting was enough.
 *
 * The fix is not "be careful"; it is that there is now nowhere to keep a second
 * copy. scripts/settings-store.test.mjs runs that exact sequence against both
 * the old model and this one.
 */
export function AppSettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Mirrors `settings` so updateSettings merges into the LATEST value rather
  // than into whatever its closure captured. This is not premature: a stale
  // closure here would rebuild the exact bug this file exists to remove, one
  // component further in.
  const settingsRef = useRef(null);

  const setSettings = useCallback((value) => {
    settingsRef.current = value;
    setSettingsState(value);
  }, []);

  useEffect(() => {
    getAppSettings()
      .then(setSettings)
      .catch((err) => {
        console.error('Failed to load settings:', err);
        setLoadError(err.message);
      });
  }, [setSettings]);

  /**
   * Applies a partial change. Optimistic, because every one of these is a
   * toggle and waiting on the network to move a switch feels broken — but it
   * reverts on failure and RE-THROWS, so the caller can tell the user. The old
   * code swallowed the error into console.error, which meant a failed write
   * looked like a switch flipping itself back for no reason.
   */
  const updateSettings = useCallback(async (patch) => {
    const previous = settingsRef.current;
    if (!previous) return; // still loading; nothing to merge into

    const next = { ...previous, ...patch };
    setSettings(next);
    try {
      const saved = await updateAppSettings(next);
      setSettings(saved);
    } catch (err) {
      setSettings(previous);
      throw err;
    }
  }, [setSettings]);

  return (
    <AppSettingsContext.Provider value={{ settings, loadError, updateSettings }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export default AppSettingsProvider;
