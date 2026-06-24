import { Injectable, signal } from '@angular/core';
import { getAuthToken } from './auth';
import { apiBase } from './runtime';
import type { RealtimeEvent } from './models';

/** Maintains a WebSocket to the server and exposes the latest push event as a signal. */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  readonly lastEvent = signal<RealtimeEvent | null>(null);
  readonly connected = signal(false);
  private socket: WebSocket | null = null;
  private retry = 0;

  connect(): void {
    if (this.socket) return;
    this.open();
  }

  private open(): void {
    const token = getAuthToken();
    const query = token ? `?token=${token}` : '';
    // Desktop shell: connect to the injected server origin; else same-origin.
    const base = apiBase();
    const wsBase = base
      ? base.replace(/^http/, 'ws')
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
    const socket = new WebSocket(`${wsBase}/ws${query}`);
    this.socket = socket;

    socket.onopen = () => {
      this.connected.set(true);
      this.retry = 0;
    };
    socket.onmessage = (msg) => {
      try {
        this.lastEvent.set(JSON.parse(msg.data) as RealtimeEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = () => {
      this.connected.set(false);
      this.socket = null;
      // Exponential backoff reconnect, capped at 5s.
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
    socket.onerror = () => socket.close();
  }
}
