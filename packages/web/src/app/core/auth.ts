import { runtimeToken } from './runtime';

/**
 * The local auth token: injected by the desktop shell (`window.__TFM__`) or passed
 * by the CLI as `?token=` when opening the browser.
 */
export function getAuthToken(): string | null {
  return runtimeToken();
}
