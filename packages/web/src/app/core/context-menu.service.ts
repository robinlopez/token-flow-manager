import { Injectable, signal } from '@angular/core';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Single floating context menu shared across the app (one open at a time). */
@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  readonly state = signal<ContextMenuState | null>(null);

  open(event: MouseEvent, items: ContextMenuItem[]): void {
    event.preventDefault();
    event.stopPropagation();
    this.state.set({ x: event.clientX, y: event.clientY, items });
  }

  close(): void {
    if (this.state()) this.state.set(null);
  }
}
