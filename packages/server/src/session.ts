import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
import type { BrowseResponse, ProjectState, RealtimeEvent, RecentProject } from '@tokenflow/shared';
import { ProjectManager } from './project.js';
import { loadConfig } from './config-loader.js';

const RECENTS_DIR = join(homedir(), '.token-flow-manager');
const RECENTS_FILE = join(RECENTS_DIR, 'recent.json');
const MAX_RECENTS = 12;

/** Directories never worth showing in the folder browser. */
const HIDDEN_DIRS = new Set(['node_modules', '.git', '.cache', '.DS_Store', 'dist', '.angular']);

/** Empty state shown before any project is opened (welcome screen). */
const CLOSED_STATE: ProjectState = {
  open: false,
  root: '',
  collections: [],
  diagnostics: [],
  tokenCount: 0,
};

/**
 * Holds the currently-open project and lets the UI switch projects at runtime —
 * so the app can launch with no path and present a welcome screen. Re-emits the
 * active project's realtime events under a stable emitter, and persists a list of
 * recent projects to `~/.token-flow-manager/recent.json`.
 */
export class Session extends EventEmitter {
  current: ProjectManager | null = null;
  private readonly watch: boolean;
  private forward: ((e: RealtimeEvent) => void) | null = null;

  constructor(opts: { watch?: boolean } = {}) {
    super();
    this.watch = opts.watch !== false;
  }

  /** Open `path` as the active project, replacing any current one. */
  async open(path: string): Promise<void> {
    const root = resolve(path);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(`Not a directory: ${root}`);
    }
    await this.close();
    const { config, source, organizationSource, manifestIssues } = await loadConfig(root);
    const project = new ProjectManager(root, config, {
      autoDetect: source === null,
      organizationSource,
      manifestIssues,
    });
    await project.load();
    if (this.watch) project.startWatching();

    this.forward = (e: RealtimeEvent) => this.emit('event', e);
    project.on('event', this.forward);
    this.current = project;

    this.addRecent(root);
    this.emit('event', { type: 'project-reloaded' } satisfies RealtimeEvent);
  }

  /** Dispose the active project (if any). */
  async close(): Promise<void> {
    if (!this.current) return;
    if (this.forward) this.current.off('event', this.forward);
    await this.current.dispose();
    this.current = null;
    this.forward = null;
  }

  getState(): ProjectState {
    return this.current ? this.current.getState() : CLOSED_STATE;
  }

  // ---- Recent projects ----

  getRecents(): RecentProject[] {
    return this.readRecents().map((path) => ({
      path,
      name: basename(path) || path,
      exists: existsSync(path),
    }));
  }

  private readRecents(): string[] {
    try {
      const raw = readFileSync(RECENTS_FILE, 'utf8');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private addRecent(path: string): void {
    this.writeRecents([path, ...this.readRecents().filter((p) => p !== path)].slice(0, MAX_RECENTS));
  }

  /** Remove a project from the recent list (welcome-screen "×"). */
  removeRecent(path: string): RecentProject[] {
    this.writeRecents(this.readRecents().filter((p) => p !== path));
    return this.getRecents();
  }

  private writeRecents(list: string[]): void {
    try {
      if (!existsSync(RECENTS_DIR)) mkdirSync(RECENTS_DIR, { recursive: true });
      writeFileSync(RECENTS_FILE, JSON.stringify(list, null, 2));
    } catch {
      /* best-effort */
    }
  }

  // ---- Native folder picker ----

  /**
   * Open the OS-native "choose folder" dialog on the machine running the server
   * and return the chosen absolute path, or null if cancelled / unavailable.
   * The server is local, so the dialog appears on the user's own desktop.
   */
  async pickFolder(): Promise<string | null> {
    try {
      if (process.platform === 'darwin') {
        const { stdout } = await execFileP('osascript', [
          '-e',
          'POSIX path of (choose folder with prompt "Select a token project")',
        ]);
        return stdout.trim() || null;
      }
      if (process.platform === 'win32') {
        const ps =
          'Add-Type -AssemblyName System.Windows.Forms;' +
          "$d = New-Object System.Windows.Forms.FolderBrowserDialog;" +
          "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }";
        const { stdout } = await execFileP('powershell', ['-NoProfile', '-Command', ps]);
        return stdout.trim() || null;
      }
      // Linux / other: zenity if present.
      const { stdout } = await execFileP('zenity', [
        '--file-selection',
        '--directory',
        '--title=Select a token project',
      ]);
      return stdout.trim() || null;
    } catch {
      return null; // cancelled, or no native dialog available
    }
  }

  // ---- Folder browser ----

  /** List sub-directories of `path` (defaults to the launch cwd) for the picker. */
  browse(path?: string): BrowseResponse {
    const dir = path ? resolve(path) : process.cwd();
    const parent = dirname(dir);
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !HIDDEN_DIRS.has(d.name))
      .map((d) => {
        const full = join(dir, d.name);
        return { name: d.name, path: full, isProject: looksLikeProject(full) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { path: dir, parent: parent === dir ? null : parent, entries };
  }
}

/** Heuristic: a directory is a token project if it has a config or any *.tokens.json near the top. */
function looksLikeProject(dir: string): boolean {
  try {
    if (existsSync(join(dir, 'tokenflow.config.json'))) return true;
    const top = readdirSync(dir, { withFileTypes: true });
    if (top.some((e) => e.isFile() && /\.tokens\.json$/.test(e.name))) return true;
    // One level down (e.g. a `tokens/` folder) — cheap, bounded scan.
    for (const e of top) {
      if (!e.isDirectory() || e.name.startsWith('.') || HIDDEN_DIRS.has(e.name)) continue;
      const sub = readdirSync(join(dir, e.name), { withFileTypes: true });
      if (sub.some((s) => s.isFile() && /\.tokens\.json$/.test(s.name))) return true;
    }
  } catch {
    /* unreadable → not a project */
  }
  return false;
}
