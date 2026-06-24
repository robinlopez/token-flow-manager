import { Injectable, signal } from '@angular/core';

/** A request to open the cell picker, anchored to the clicked cell. */
export interface CellPickerTarget {
  tokenId: string;
  mode: string;
  /** Token type — drives which tabs show and how the Libraries list is filtered. */
  type: string;
  /** Current raw value (alias or literal) of the cell. */
  raw: unknown;
  /** Current resolved value (used to seed the colour picker). */
  resolved: unknown;
  /** Viewport rect of the cell, to anchor the popover. */
  anchor: { x: number; y: number; width: number; height: number };
  /** Initial tab. */
  tab: 'custom' | 'libraries';
  /**
   * When set, the chosen value (a CSS colour or an `{alias}`) is delivered here
   * instead of writing the token cell directly. Used to edit a composite
   * sub-property: the table reassembles and persists the whole `$value` object.
   */
  onPick?: (value: string) => void;
}

/** Shared state for the single cell picker (colour + alias) mounted in the shell. */
@Injectable({ providedIn: 'root' })
export class CellPickerService {
  readonly target = signal<CellPickerTarget | null>(null);

  open(target: CellPickerTarget): void {
    this.target.set(target);
  }
  close(): void {
    if (this.target()) this.target.set(null);
  }
}
