/**
 * Web builds (the demo page) have no keychain: use localStorage, and carry on without it when the
 * browser blocks storage (private windows, embedded previews).
 */
const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const storage = {
  get: async (key: string) => safe(() => window.localStorage.getItem(key), null),
  set: async (key: string, value: string) => safe(() => window.localStorage.setItem(key, value), undefined),
  remove: async (key: string) => safe(() => window.localStorage.removeItem(key), undefined),
};
