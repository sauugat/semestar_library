// Preload for legacy regression suites: never contact Expo/Supabase/other
// external HTTP services while checking the local Phase 2A backend.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('External fetch disabled by local cohort test harness');
  return originalFetch(input, init);
};
