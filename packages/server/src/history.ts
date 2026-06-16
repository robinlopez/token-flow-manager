/**
 * File-level, byte-exact undo/redo history.
 *
 * Every mutation captures, for each file it actually changed, the file's content
 * *before* and *after*. Undo rewrites the "before" contents; redo rewrites the
 * "after" contents. Because this is independent of the operation's semantics,
 * restoration is exact (key order, formatting, references) and cannot drift out
 * of sync with the model.
 */

/**
 * One file's content snapshot around a mutation (only files that changed).
 * `null` means the file did not exist in that state — so a structural command
 * can model file creation (before: null) and deletion (after: null).
 */
export interface FileChange {
  rel: string;
  before: string | null;
  after: string | null;
}

export interface Command {
  id: string;
  label: string;
  changes: FileChange[];
  timestamp: number;
  /** Token to re-select in the UI after undo/redo, when meaningful. */
  tokenId?: string;
  /** When set, a following command with the same key (within the coalesce
   * window) merges into this one instead of pushing a new history item. */
  coalesceKey?: string;
  /** A structural change (modes/collections): touches token files AND the config,
   * and may create/delete files — applied via a full config-aware reload rather
   * than the in-place file rewrite used for value edits. */
  structural?: boolean;
}

/** Serialisable summary for the UI (labels + which directions are available). */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the command the next undo would revert. */
  undoLabel?: string;
  /** Label of the command the next redo would re-apply. */
  redoLabel?: string;
  /** Undo stack labels, oldest → newest. */
  undo: string[];
  /** Redo stack labels, newest → oldest (next redo first). */
  redo: string[];
}

export interface RecordInput {
  label: string;
  changes: FileChange[];
  tokenId?: string;
  coalesceKey?: string;
  structural?: boolean;
}

const DEFAULT_LIMIT = 100;
/** Rapid edits to the same cell within this window merge into one history item. */
const DEFAULT_COALESCE_MS = 700;

/** Bounded in-memory undo/redo stack of byte-exact file Commands. */
export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private seq = 0;

  constructor(
    private readonly limit = DEFAULT_LIMIT,
    private readonly coalesceWindowMs = DEFAULT_COALESCE_MS,
  ) {}

  /**
   * Record a new command. Pushing any new mutation clears the redo stack (linear
   * history). If `coalesceKey` matches the top command within the time window,
   * the two merge (the original `before` is kept; `after` is updated per file).
   */
  record(input: RecordInput): void {
    const changes = input.changes.filter((c) => c.before !== c.after);
    if (changes.length === 0) return;

    this.redoStack = [];
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      input.coalesceKey &&
      top &&
      top.coalesceKey === input.coalesceKey &&
      now - top.timestamp <= this.coalesceWindowMs
    ) {
      for (const ch of changes) {
        const existing = top.changes.find((c) => c.rel === ch.rel);
        if (existing) existing.after = ch.after;
        else top.changes.push(ch);
      }
      top.timestamp = now;
      top.label = input.label;
      return;
    }

    const cmd: Command = {
      id: `cmd${++this.seq}`,
      label: input.label,
      changes,
      timestamp: now,
      ...(input.tokenId ? { tokenId: input.tokenId } : {}),
      ...(input.coalesceKey ? { coalesceKey: input.coalesceKey } : {}),
      ...(input.structural ? { structural: true } : {}),
    };
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  peekUndo(): Command | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }
  peekRedo(): Command | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  /** Pop the top undo command onto the redo stack (call after applying it). */
  commitUndo(): Command | undefined {
    const cmd = this.undoStack.pop();
    if (cmd) this.redoStack.push(cmd);
    return cmd;
  }
  /** Pop the top redo command back onto the undo stack (call after applying it). */
  commitRedo(): Command | undefined {
    const cmd = this.redoStack.pop();
    if (cmd) this.undoStack.push(cmd);
    return cmd;
  }

  state(): HistoryState {
    const undoTop = this.peekUndo();
    const redoTop = this.peekRedo();
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      ...(undoTop ? { undoLabel: undoTop.label } : {}),
      ...(redoTop ? { redoLabel: redoTop.label } : {}),
      undo: this.undoStack.map((c) => c.label),
      redo: [...this.redoStack].reverse().map((c) => c.label),
    };
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
