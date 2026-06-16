import type { HttpInterceptorFn } from '@angular/common/http';

/**
 * Runtime config injected by the desktop (Tauri) shell before the app boots:
 * `window.__TFM__ = { api: 'http://127.0.0.1:PORT', token: '…' }`.
 *
 * In the plain browser / CLI case it is absent and the app talks to its own
 * origin with a `?token=` query param, exactly as before.
 */
interface TfmRuntime {
  api?: string;
  token?: string;
}

function runtime(): TfmRuntime {
  return (window as unknown as { __TFM__?: TfmRuntime }).__TFM__ ?? {};
}

/** Origin of the API/WS server, or '' when same-origin (browser/CLI). */
export function apiBase(): string {
  return runtime().api ?? '';
}

/** Auth token, from the injected runtime or the `?token=` query param. */
export function runtimeToken(): string | null {
  return runtime().token ?? new URLSearchParams(window.location.search).get('token');
}

/** Prefix relative `/api` requests with the injected server origin (desktop shell). */
export const apiBaseInterceptor: HttpInterceptorFn = (req, next) => {
  const base = apiBase();
  if (base && req.url.startsWith('/api')) {
    return next(req.clone({ url: base + req.url }));
  }
  return next(req);
};
