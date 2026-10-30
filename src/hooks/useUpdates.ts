import { useCallback, useEffect, useMemo } from 'react';

import { UPDATES } from '../constants/config';
import { downloadAndInstallApp } from '../services/appUpdateService';
import {
  checkForUpdates,
  downloadDailyVerses,
  downloadPack,
  type CheckOutcome,
} from '../services/updateService';
import {
  isTaskActive,
  selectHasUpdate,
  selectIsBusy,
  useDownloadsStore,
  type AvailableUpdates,
  type CheckStatus,
  type DownloadTask,
} from '../store/downloadsStore';
import { selectSettings, useSettingsStore } from '../store/settingsStore';
import type {
  InstalledPack,
  Manifest,
  ManifestApp,
  ManifestDailyVerses,
  ManifestPack,
  UpdateMode,
} from '../types';

/**
 * The one hook the Updates screen, the Translations screen and the quiet
 * "Update available" banner use. It joins three things:
 *
 *  - what is known (downloadsStore: installed packs, last manifest, tasks)
 *  - the person's choices (settingsStore: update mode, Wi-Fi only)
 *  - the actions (updateService and appUpdateService do the real work)
 *
 * It never throws. A failed download is reported through the task in
 * downloadsStore (task.error), which the screen turns into a translated
 * sentence. The actions here return when the work has finished or failed.
 *
 * Nothing in here starts by itself, except reading which packs are installed
 * when a screen first uses it. Checking for updates on app open is the job of
 * the root layout and the background task, and downloads always begin with a
 * tap (or, in "Auto" mode, inside updateService for small packs only).
 *
 * WHAT THIS FILE EXPECTS FROM THE SERVICES (written in batch 9; match these):
 *
 *   services/updateService.ts
 *     export type CheckOutcome =
 *       | 'updated'        // checked; available updates are in downloadsStore
 *       | 'up-to-date'     // checked; nothing new
 *       | 'skipped-recent' // not a manual check and less than 24 hours since the last
 *       | 'skipped-wifi'   // Wi-Fi only is on and the phone is not on Wi-Fi
 *       | 'off'            // update mode is Off and the check was not manual
 *       | 'error';         // no connection, bad signature, bad manifest
 *     export function checkForUpdates(options: { manual: boolean }): Promise<CheckOutcome>;
 *     export function downloadPack(pack: ManifestPack): Promise<void>;
 *     export function downloadDailyVerses(info: ManifestDailyVerses): Promise<void>;
 *
 *   services/appUpdateService.ts
 *     export function downloadAndInstallApp(app: ManifestApp): Promise<void>;
 *
 *   All of them report progress and failure through downloadsStore, update
 *   downloadsStore.available after a check, and never throw.
 */

export interface UseUpdates {
  /* What is known */
  installed: readonly InstalledPack[];
  installedBytes: number;
  manifest: Manifest | null;
  available: AvailableUpdates;
  /** True when the quiet "Update available" banner should show. */
  hasUpdate: boolean;
  checkStatus: CheckStatus;
  /** Epoch ms of the last completed check, 0 = never. */
  lastCheck: number;

  /* Downloads */
  tasks: Readonly<Record<string, DownloadTask>>;
  /** True while anything is downloading, verifying or installing. */
  isBusy: boolean;

  /* The person's choices */
  updateMode: UpdateMode;
  wifiOnly: boolean;

  /* Actions */
  /** "Check now". Resolves with what happened so the screen can say so. */
  checkNow: () => Promise<CheckOutcome>;
  /** Download and install one pack (new translation or a newer version). */
  installPack: (pack: ManifestPack) => Promise<void>;
  updateDailyVerses: () => Promise<void>;
  /** Download the new APK and open the Android installer. */
  updateApp: () => Promise<void>;
  /** Stop a download. */
  cancel: (key: string) => void;
  /** Remove a finished or failed task from the list. */
  dismiss: (key: string) => void;
  /** Re-read the installed packs, for example after deleting one. */
  refreshInstalled: () => Promise<void>;

  /**
   * True when a pack is big enough that the screen must show its size and
   * wait for an explicit tap (Section 8: larger than 10 MB).
   */
  needsConfirmation: (pack: Pick<ManifestPack, 'size'>) => boolean;
  /** The task for a pack, if one exists. */
  taskForPack: (id: string) => DownloadTask | undefined;
}

export function useUpdates(): UseUpdates {
  const installed = useDownloadsStore((state) => state.installed);
  const installedBytes = useDownloadsStore((state) => state.installedBytes);
  const manifest = useDownloadsStore((state) => state.manifest);
  const available = useDownloadsStore((state) => state.available);
  const checkStatus = useDownloadsStore((state) => state.checkStatus);
  const tasks = useDownloadsStore((state) => state.tasks);
  const hasUpdate = useDownloadsStore(selectHasUpdate);
  const isBusy = useDownloadsStore(selectIsBusy);

  const refreshInstalled = useDownloadsStore((state) => state.refreshInstalled);
  const requestCancel = useDownloadsStore((state) => state.requestCancel);
  const clearTask = useDownloadsStore((state) => state.clearTask);

  const { updateMode, wifiOnly, lastUpdateCheck } = useSettingsStore(selectSettings);

  // The first screen to use this hook fills the installed list.
  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  const checkNow = useCallback(async (): Promise<CheckOutcome> => {
    try {
      return await checkForUpdates({ manual: true });
    } catch {
      return 'error';
    }
  }, []);

  const installPack = useCallback(
    async (pack: ManifestPack): Promise<void> => {
      try {
        await downloadPack(pack);
      } catch {
        // The service has already recorded the failure on the task.
      } finally {
        await refreshInstalled();
      }
    },
    [refreshInstalled],
  );

  const updateDailyVerses = useCallback(async (): Promise<void> => {
    const info = useDownloadsStore.getState().available.dailyVerses;
    if (!info) return;
    try {
      await downloadDailyVerses(info);
    } catch {
      // Recorded on the task by the service.
    }
  }, []);

  const updateApp = useCallback(async (): Promise<void> => {
    const app: ManifestApp | null = useDownloadsStore.getState().available.app;
    if (!app) return;
    try {
      await downloadAndInstallApp(app);
    } catch {
      // Recorded on the task by the service.
    }
  }, []);

  const cancel = useCallback(
    (key: string): void => {
      requestCancel(key);
    },
    [requestCancel],
  );

  const dismiss = useCallback(
    (key: string): void => {
      // Never remove a task that is still running; cancel() is for that.
      const task = useDownloadsStore.getState().tasks[key];
      if (task && !isTaskActive(task)) clearTask(key);
    },
    [clearTask],
  );

  const needsConfirmation = useCallback(
    (pack: Pick<ManifestPack, 'size'>): boolean => pack.size > UPDATES.confirmBytes,
    [],
  );

  const taskForPack = useCallback((id: string): DownloadTask | undefined => tasks[`pack:${id}`], [tasks]);

  return useMemo(
    () => ({
      installed,
      installedBytes,
      manifest,
      available,
      hasUpdate,
      checkStatus,
      lastCheck: lastUpdateCheck,
      tasks,
      isBusy,
      updateMode,
      wifiOnly,
      checkNow,
      installPack,
      updateDailyVerses,
      updateApp,
      cancel,
      dismiss,
      refreshInstalled,
      needsConfirmation,
      taskForPack,
    }),
    [
      installed,
      installedBytes,
      manifest,
      available,
      hasUpdate,
      checkStatus,
      lastUpdateCheck,
      tasks,
      isBusy,
      updateMode,
      wifiOnly,
      checkNow,
      installPack,
      updateDailyVerses,
      updateApp,
      cancel,
      dismiss,
      refreshInstalled,
      needsConfirmation,
      taskForPack,
    ],
  );
}
