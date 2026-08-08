import { createContext, useContext } from 'react';

/**
 * The context holding this user's ONE copy of app settings. The provider that
 * fills it — and the explanation of why "one copy" is the whole point — lives
 * in components/AppSettingsProvider.jsx.
 *
 * Split across two files only to satisfy react-refresh's rule that a module
 * exporting a component exports nothing else. The provider is the component;
 * this is everything else.
 */
export const AppSettingsContext = createContext(null);

/**
 * `settings` is null until the single fetch resolves. Treat that as "not known
 * yet" rather than substituting a local default — local defaults are how four
 * copies of this object came to exist in the first place.
 *
 * Returns { settings, loadError, updateSettings }. `updateSettings(patch)` is
 * optimistic, reverts on failure, and RE-THROWS so the caller can tell the user.
 */
export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error('useAppSettings must be used inside <AppSettingsProvider>');
  }
  return context;
}
