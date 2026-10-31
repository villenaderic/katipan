import * as Network from 'expo-network';

import { APP_VERSION, UPDATES } from '../constants/config';
import {
  NO_UPDATES,
  isTaskActive,
  useDownloadsStore,
  type AvailableUpdates,
} from '../store/downloadsStore';
import { getSettings, useSettingsStore } from '../store/settingsStore';
import type { Manifest, ManifestDailyVerses, ManifestPack } from '../types';
import { isOlderThan } from '../utils/date';
import { isNewerVersion } from '../utils/format';
import { installPack } from './bibleService';
import { getDailyVersesVersion, installDailyVerses } from './dailyVerseService';
import { cleanupOldApks } from './appUpdateService';
import { DownloadError, clearTemporaryDownloads, downloadVerified } from './downloadService';
import { fetchVerifiedManifest } from './manifestService';

/**
 * The content update system (Section 8): Bible packs and the daily verse
 * list. The app itself (the APK) is appUpdateService's job.
 *
 *   checkForUpdates()      once a day at most, signature-checked manifest,
 *                          then works out what is newer than what is installed
 *   downloadPack()         one pack: download, SHA-256, install, rollback-safe
 *   downloadDailyVerses()  the same for the 366-verse list
 *
 * RULES KEPT HERE
 *  - At most one check per 24 hours for automatic checks. "Check now" is
 *    always allowed.
 *  - Automatic checks and automatic downloads only run on Wi-Fi when "Wi-Fi
 *    only" is on (the default). A check or a download the person starts by
 *    tapping always goes ahead: they chose it, and they can see its size first.
 *  - Update mode Off: no automatic check. Manual: automatic checks only
 *    announce ("Update available"). Auto: small packs (10 MB or less) and
 *    the daily verse list are installed without asking. Bigger packs and the
 *    APK always need a tap.
 *  - user.db is never touched. Nothing in this file can reach it.
 *  - A failed or corrupted download leaves the installed pack as it was
 *    (downloadService works only in tmp/, bibleService keeps the old file
 *    until the new one opens).
 *
 * Nothing here throws. Failures are reported through downloadsStore.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CheckOutcome =
  | 'updated' // checked; available updates are in downloadsStore
  | 'up-to-date' // checked; nothing new
  | 'skipped-recent' // not a manual check and less than 24 hours since the last
  | 'skipped-wifi' // Wi-Fi only is on and the phone is not on Wi-Fi
  | 'off' // update mode is Off and the check was not manual
  | 'error'; // no connection, bad signature, bad manifest

export interface CheckOptions {
  manual: boolean;
}

/* ------------------------------------------------------------------ */
/* Network                                                             */
/* ------------------------------------------------------------------ */

type Connection = 'wifi' | 'mobile' | 'offline';

async function getConnection(): Promise<Connection> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected !== true) return 'offline';
    if (
      state.type === Network.NetworkStateType.WIFI ||
      state.type === Network.NetworkStateType.ETHERNET
    ) {
      return 'wifi';
    }
    // Cellular, VPN, unknown: all treated as "not Wi-Fi", the careful choice
    // for people who pay for data.
    return 'mobile';
  } catch {
    return 'mobile';
  }
}

/* ------------------------------------------------------------------ */
/* What is newer than what is installed                                */
/* ------------------------------------------------------------------ */

/** False when the manifest says it needs a newer app than this one. */
export function appMeetsMinVersion(manifest: Manifest): boolean {
  return !isNewerVersion(manifest.minAppVersion, APP_VERSION);
}

/**
 * Compare a verified manifest with the phone. Packs that are not installed
 * are not "updates"; the Translations screen lists those from the manifest.
 * Content (packs, daily verses) is held back when this app is too old for it,
 * but the app update itself is still offered, since it is the way out.
 */
export async function computeAvailable(manifest: Manifest): Promise<AvailableUpdates> {
  const store = useDownloadsStore.getState();
  await store.refreshInstalled();
  const installed = useDownloadsStore.getState().installed;
  const contentUsable = appMeetsMinVersion(manifest);

  const packs: ManifestPack[] = contentUsable
    ? manifest.packs.filter((offered) => {
        const have = installed.find((pack) => pack.id === offered.id);
        return have !== undefined && offered.version > have.version;
      })
    : [];

  let dailyVerses: ManifestDailyVerses | null = null;
  if (contentUsable && manifest.dailyVerses) {
    try {
      const current = await getDailyVersesVersion();
      if (manifest.dailyVerses.version > current) dailyVerses = manifest.dailyVerses;
    } catch {
      // If the current list cannot be read, offering the new one is the better outcome.
      dailyVerses = manifest.dailyVerses;
    }
  }

  const app =
    manifest.app && isNewerVersion(manifest.app.latest, APP_VERSION) ? manifest.app : null;

  return { packs, dailyVerses, app };
}

async function refreshAvailable(): Promise<void> {
  const { manifest, setAvailable } = useDownloadsStore.getState();
  setAvailable(manifest ? await computeAvailable(manifest) : NO_UPDATES);
}

/* ------------------------------------------------------------------ */
/* Tidying                                                             */
/* ------------------------------------------------------------------ */

/**
 * Delete download leftovers: partial or verified-but-unused files in tmp/,
 * and, when `apks` is true, APKs from earlier app updates.
 *
 * Does nothing while any download or install is running, so it can never
 * pull a file out from under one. Never throws.
 *
 * `apks` is false right after a pack install, because an APK may be in use by
 * the Android installer at that moment. It is true only when the app starts
 * and when Low-storage mode is switched on, when no installer can be open.
 */
export function tidyDownloads(options: { apks: boolean }): void {
  try {
    const busy = Object.values(useDownloadsStore.getState().tasks).some(isTaskActive);
    if (busy) return;
    clearTemporaryDownloads();
    if (options.apks) cleanupOldApks();
  } catch {
    // Leftovers cost some space and are replaced by the next download.
  }
}

/* ------------------------------------------------------------------ */
/* Installing                                                          */
/* ------------------------------------------------------------------ */

/**
 * Shared by packs and the daily verse list: refuse if the app is too old,
 * download and verify, install, tidy up. Reports everything to the store.
 */
async function runInstall(
  kind: 'pack' | 'dailyVerses',
  id: string,
  request: { url: string; sha256: string; expectedBytes: number; fileName: string },
  install: (uri: string) => Promise<void>,
): Promise<void> {
  const store = useDownloadsStore.getState();

  const manifest = store.manifest;
  if (manifest && !appMeetsMinVersion(manifest)) {
    // This app is too old for the content. Show the reason instead of doing nothing.
    const key = store.startTask(kind, id, request.expectedBytes);
    if (key !== null) store.failTask(key, 'invalid');
    return;
  }

  let key: string | null = null;
  try {
    const result = await downloadVerified({ kind, id, ...request });
    key = result.key;

    useDownloadsStore.getState().setTaskStatus(key, 'installing');
    await install(result.uri);

    useDownloadsStore.getState().finishTask(key);
    await useDownloadsStore.getState().refreshInstalled();
    await refreshAvailable();
  } catch (error) {
    if (error instanceof DownloadError) {
      // Cancelled: say nothing. Anything else: downloadService already
      // marked the task as failed.
      return;
    }
    // The file was downloaded and verified but could not be installed
    // (not a usable pack, disk problem). The old version is still in place.
    if (key !== null) useDownloadsStore.getState().failTask(key, 'invalid');
  } finally {
    // Low-storage mode: do not keep scratch files once a download is over,
    // whether it worked, failed or was cancelled.
    if (getSettings().lowStorageMode) tidyDownloads({ apks: false });
  }
}

/** Download and install one pack: a new translation or a newer version. */
export function downloadPack(pack: ManifestPack): Promise<void> {
  return runInstall(
    'pack',
    pack.id,
    {
      url: pack.url,
      sha256: pack.sha256,
      expectedBytes: pack.size,
      fileName: `${pack.id}.db`,
    },
    async (uri) => {
      await installPack(pack.id, uri);
    },
  );
}

/** Download and install the newer daily verse list. */
export function downloadDailyVerses(info: ManifestDailyVerses): Promise<void> {
  return runInstall(
    'dailyVerses',
    'dailyVerses',
    {
      url: info.url,
      sha256: info.sha256,
      expectedBytes: 0,
      fileName: 'daily-verses.json',
    },
    async (uri) => {
      await installDailyVerses(uri);
    },
  );
}

/**
 * Update mode "Auto": install what is small and safe without asking. The
 * list always goes first (a few KB). Packs over 10 MB and the APK are left
 * for the person to start.
 */
async function autoInstall(available: AvailableUpdates): Promise<void> {
  if (available.dailyVerses) await downloadDailyVerses(available.dailyVerses);

  for (const pack of available.packs) {
    if (pack.size > UPDATES.confirmBytes) continue;
    await downloadPack(pack);
  }
}

/* ------------------------------------------------------------------ */
/* Checking                                                            */
/* ------------------------------------------------------------------ */

let checkInFlight: Promise<CheckOutcome> | null = null;

async function runCheck(options: CheckOptions): Promise<CheckOutcome> {
  const settings = getSettings();

  if (!options.manual) {
    if (settings.updateMode === 'off') return 'off';
    if (!isOlderThan(settings.lastUpdateCheck, UPDATES.minIntervalMs)) return 'skipped-recent';
  }

  const connection = await getConnection();
  if (connection === 'offline') return 'error';
  if (!options.manual && settings.wifiOnly && connection !== 'wifi') return 'skipped-wifi';

  const store = useDownloadsStore.getState();
  store.setCheckStatus('checking');

  try {
    const manifest = await fetchVerifiedManifest();
    store.setManifest(manifest);

    const available = await computeAvailable(manifest);
    store.setAvailable(available);
    store.setCheckStatus('idle');
    useSettingsStore.getState().setSetting('lastUpdateCheck', Date.now());

    // Automatic installs only for automatic checks, only in Auto mode.
    if (!options.manual && settings.updateMode === 'auto') {
      await autoInstall(available);
    }

    const left = useDownloadsStore.getState().available;
    const anything = left.packs.length > 0 || left.dailyVerses !== null || left.app !== null;
    return anything ? 'updated' : 'up-to-date';
  } catch {
    store.setCheckStatus('error');
    return 'error';
  }
}

/**
 * Look for updates. Safe to call from the background task, the root layout
 * and the "Check now" button: if a check is already running, every caller
 * gets the same result instead of starting a second one.
 */
export function checkForUpdates(options: CheckOptions): Promise<CheckOutcome> {
  if (checkInFlight === null) {
    checkInFlight = runCheck(options)
      .catch((): CheckOutcome => 'error')
      .finally(() => {
        checkInFlight = null;
      });
  }
  return checkInFlight;
}
