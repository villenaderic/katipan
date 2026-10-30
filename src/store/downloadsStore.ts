import { create } from 'zustand';

import { listInstalledPacks } from '../services/bibleService';
import type { InstalledPack, Manifest, ManifestApp, ManifestDailyVerses, ManifestPack } from '../types';

/**
 * Everything the screens need to show about updates and downloads, in one
 * place: what is installed, what is available, what is downloading right now,
 * and how far along it is.
 *
 * This store only HOLDS state. It never touches the network or the disk
 * (except listing installed packs). The services do the work and report here:
 *   - manifestService / updateService: setCheckStatus, setManifest, setAvailable
 *   - downloadService:                 startTask, setProgress, setTaskStatus,
 *                                      failTask, finishTask, registerCancel
 *   - UI (Cancel button):              requestCancel
 *
 * Every task update is ignored if the task no longer exists, so a late
 * callback from a cancelled download can never bring it back to life.
 *
 * Progress events arrive many times per second on a fast connection. They are
 * throttled here so a 2 GB phone does not re-render the screen for every chunk.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TaskKind = 'pack' | 'dailyVerses' | 'apk';

export type TaskStatus = 'downloading' | 'verifying' | 'installing' | 'done' | 'error';

/**
 * Why a task failed. The UI maps each code to a translated sentence, so no
 * English text travels through the store.
 *   network   - no connection, or the connection dropped
 *   checksum  - the downloaded file does not match its SHA-256
 *   signature - the manifest signature is not valid for our public key
 *   storage   - not enough free space, or the disk refused the write
 *   invalid   - the file downloaded fine but is not a usable pack or list
 *   unknown   - anything else
 */
export type TaskErrorCode = 'network' | 'checksum' | 'signature' | 'storage' | 'invalid' | 'unknown';

export interface DownloadTask {
  /** "pack:web", "dailyVerses", or "apk". Unique; see taskKey(). */
  key: string;
  kind: TaskKind;
  /** Pack id for packs; the same as kind for the others. */
  id: string;
  status: TaskStatus;
  receivedBytes: number;
  /** 0 when the size is not known yet. */
  totalBytes: number;
  error: TaskErrorCode | null;
  startedAt: number;
}

export type CheckStatus = 'idle' | 'checking' | 'error';

/** What the last verified manifest offers, compared with what is installed. */
export interface AvailableUpdates {
  /** Newer versions of packs that are already installed. */
  packs: readonly ManifestPack[];
  /** Set when the daily verse list is newer than the one in use. */
  dailyVerses: ManifestDailyVerses | null;
  /** Set when the app version in the manifest is newer than the installed app. */
  app: ManifestApp | null;
}

export const NO_UPDATES: AvailableUpdates = { packs: [], dailyVerses: null, app: null };

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

export function taskKey(kind: TaskKind, id?: string): string {
  return kind === 'pack' ? `pack:${id ?? ''}` : kind;
}

export function isTaskActive(task: DownloadTask): boolean {
  return task.status === 'downloading' || task.status === 'verifying' || task.status === 'installing';
}

/** 0 to 1, or null while the total size is unknown (show an indeterminate bar). */
export function getTaskFraction(task: DownloadTask): number | null {
  if (task.totalBytes <= 0) return null;
  return Math.min(1, Math.max(0, task.receivedBytes / task.totalBytes));
}

/** True when there is anything at all to offer: used by the quiet "Update available" banner. */
export function hasAnyUpdate(available: AvailableUpdates): boolean {
  return available.packs.length > 0 || available.dailyVerses !== null || available.app !== null;
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

/** At most one progress render per task every 200 ms. */
const PROGRESS_INTERVAL_MS = 200;

const lastProgressAt = new Map<string, number>();
const cancelHandlers = new Map<string, () => void>();

function forget(key: string): void {
  lastProgressAt.delete(key);
  cancelHandlers.delete(key);
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

interface DownloadsState {
  installed: readonly InstalledPack[];
  installedBytes: number;
  /** The last manifest that passed its signature check, or null if none yet. */
  manifest: Manifest | null;
  available: AvailableUpdates;
  checkStatus: CheckStatus;
  tasks: Readonly<Record<string, DownloadTask>>;

  /** Re-read the installed packs from disk. Call after an install, a delete, or an update. */
  refreshInstalled: () => Promise<void>;

  setCheckStatus: (status: CheckStatus) => void;
  setManifest: (manifest: Manifest | null) => void;
  setAvailable: (available: AvailableUpdates) => void;

  /**
   * Register a new download. Returns its key, or null if the same thing is
   * already downloading (so a double tap can never start two downloads).
   * A finished or failed task with the same key is replaced.
   */
  startTask: (kind: TaskKind, id: string, totalBytes: number) => string | null;
  setProgress: (key: string, receivedBytes: number, totalBytes?: number) => void;
  setTaskStatus: (key: string, status: 'downloading' | 'verifying' | 'installing') => void;
  failTask: (key: string, error: TaskErrorCode) => void;
  finishTask: (key: string) => void;
  /** Remove a task from the list (dismiss an error, hide a finished download). */
  clearTask: (key: string) => void;

  /** The service gives the store a way to abort its download. */
  registerCancel: (key: string, cancel: () => void) => void;
  /** Cancel button: aborts the download and removes the task. A cancel is not an error. */
  requestCancel: (key: string) => void;
}

export const useDownloadsStore = create<DownloadsState>()((set, get) => {
  /** Apply `change` to one task; do nothing if the task is gone. */
  function updateTask(key: string, change: (task: DownloadTask) => DownloadTask): void {
    const task = get().tasks[key];
    if (!task) return;
    set({ tasks: { ...get().tasks, [key]: change(task) } });
  }

  function removeTask(key: string): void {
    forget(key);
    const { [key]: removed, ...rest } = get().tasks;
    if (removed) set({ tasks: rest });
  }

  return {
    installed: [],
    installedBytes: 0,
    manifest: null,
    available: NO_UPDATES,
    checkStatus: 'idle',
    tasks: {},

    refreshInstalled: async () => {
      try {
        const installed = await listInstalledPacks();
        const installedBytes = installed.reduce((sum, pack) => sum + pack.bytes, 0);
        set({ installed, installedBytes });
      } catch {
        // Keep showing the last known list rather than an empty one.
      }
    },

    setCheckStatus: (checkStatus) => set({ checkStatus }),
    setManifest: (manifest) => set({ manifest }),
    setAvailable: (available) => set({ available }),

    startTask: (kind, id, totalBytes) => {
      const key = taskKey(kind, id);
      const existing = get().tasks[key];
      if (existing && isTaskActive(existing)) return null;

      forget(key);
      const task: DownloadTask = {
        key,
        kind,
        id: kind === 'pack' ? id : kind,
        status: 'downloading',
        receivedBytes: 0,
        totalBytes: Math.max(0, totalBytes),
        error: null,
        startedAt: Date.now(),
      };
      set({ tasks: { ...get().tasks, [key]: task } });
      return key;
    },

    setProgress: (key, receivedBytes, totalBytes) => {
      const now = Date.now();
      const last = lastProgressAt.get(key) ?? 0;
      const task = get().tasks[key];
      if (!task) return;

      const total = totalBytes !== undefined && totalBytes > 0 ? totalBytes : task.totalBytes;
      const finished = total > 0 && receivedBytes >= total;
      if (!finished && now - last < PROGRESS_INTERVAL_MS) return;

      lastProgressAt.set(key, now);
      updateTask(key, (current) => ({ ...current, receivedBytes, totalBytes: total }));
    },

    setTaskStatus: (key, status) => {
      updateTask(key, (task) => ({ ...task, status, error: null }));
    },

    failTask: (key, error) => {
      cancelHandlers.delete(key);
      updateTask(key, (task) => ({ ...task, status: 'error', error }));
    },

    finishTask: (key) => {
      cancelHandlers.delete(key);
      updateTask(key, (task) => ({
        ...task,
        status: 'done',
        error: null,
        receivedBytes: task.totalBytes > 0 ? task.totalBytes : task.receivedBytes,
      }));
    },

    clearTask: (key) => removeTask(key),

    registerCancel: (key, cancel) => {
      if (get().tasks[key]) cancelHandlers.set(key, cancel);
    },

    requestCancel: (key) => {
      const cancel = cancelHandlers.get(key);
      // Remove the task first, so the service's own abort handling finds it gone
      // and does not report the abort as a failure.
      removeTask(key);
      if (cancel) {
        try {
          cancel();
        } catch {
          // The download was already finishing; nothing left to abort.
        }
      }
    },
  };
});

/* ------------------------------------------------------------------ */
/* Selectors (return primitives, so they never cause extra re-renders)  */
/* ------------------------------------------------------------------ */

/** True when the "Update available" banner should show. */
export const selectHasUpdate = (state: DownloadsState): boolean => hasAnyUpdate(state.available);

/** True while anything is downloading, verifying or installing. */
export const selectIsBusy = (state: DownloadsState): boolean =>
  Object.values(state.tasks).some(isTaskActive);
