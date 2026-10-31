import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

import { APP_VERSION } from '../constants/config';
import { useDownloadsStore } from '../store/downloadsStore';
import type { ManifestApp } from '../types';
import { normalizeSha256, verifyFileSha256 } from '../utils/checksum';
import { isNewerVersion } from '../utils/format';
import { DownloadError, downloadVerified } from './downloadService';

/**
 * The app updates itself (Section 9). Katipan is not on Google Play, so the
 * new APK comes from our own GitHub Release, listed in the signed manifest.
 *
 *   downloadAndInstallApp(app)
 *     1. refuse anything that is not newer than the installed version
 *     2. download the APK to tmp/ and verify its SHA-256 (downloadService)
 *     3. move it to apk/ in the cache and check the SHA-256 once more
 *     4. open the Android package installer
 *
 * ANDROID RULES THIS FILE WORKS WITHIN
 *  - The installer always asks the person to tap "Install". An app cannot
 *    skip that, and this one does not try to.
 *  - The first time, Android asks the person to allow "Install unknown apps"
 *    for Katipan (the REQUEST_INSTALL_PACKAGES permission in app.json). The
 *    system shows that prompt itself when the installer is opened.
 *    openInstallPermissionSettings() opens that exact settings page for the
 *    Updates screen to offer, in case the person closed the prompt.
 *  - Android only installs an update that is signed with the SAME key as the
 *    installed app, and whose versionCode is higher. Both are release rules
 *    (Section 9), not something this file can check.
 *
 * Nothing here throws. Failures are reported through downloadsStore. The
 * task is marked finished once the installer is on screen; from there the
 * person and Android take over.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK */
const INSTALL_INTENT_FLAGS = 1 | 268435456;

const APK_MIME_TYPE = 'application/vnd.android.package-archive';

/** The task id for the APK; downloadsStore keys it as "apk". */
const APK_TASK_ID = 'apk';

/** Folder name inside the cache directory, without a trailing slash. */
const APK_FOLDER = 'apk';

/** Android package name, as in app.json. Used for the unknown-sources page. */
const APP_PACKAGE = 'ph.katipan.app';

/** Only plain version strings become file names. */
const SAFE_VERSION = /^[0-9]+(\.[0-9]+){0,3}$/;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function apkDirectory(): Directory {
  const directory = new Directory(Paths.cache, APK_FOLDER);
  try {
    if (!directory.exists) directory.create({ intermediates: true });
  } catch {
    // If the folder cannot be created, moving the file into it fails and is reported.
  }
  return directory;
}

function removeFile(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // A file that will not delete is removed by the next cleanup.
  }
}

/**
 * Delete every APK left in the cache by earlier updates. Called before a new
 * download and when the app starts, so an installed update never leaves a
 * 30 MB file behind.
 */
export function cleanupOldApks(): void {
  try {
    const directory = new Directory(Paths.cache, APK_FOLDER);
    if (directory.exists) directory.delete();
  } catch {
    // Leftovers are harmless and are replaced by the next download.
  }
}

/* ------------------------------------------------------------------ */
/* Install permission                                                  */
/* ------------------------------------------------------------------ */

/**
 * Open Android's "Install unknown apps" page for Katipan. Returns false if
 * the phone has no such page. Used by the Updates screen as a gentle
 * "Allow installing updates" button; the installer prompt works without it.
 */
export async function openInstallPermissionSettings(): Promise<boolean> {
  try {
    await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
      data: `package:${APP_PACKAGE}`,
    });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Install                                                             */
/* ------------------------------------------------------------------ */

/**
 * Download the new APK, verify it, and open the Android installer.
 * Safe to call from a button: a second tap while the first is running does
 * nothing, and a cancel is silent.
 */
export async function downloadAndInstallApp(app: ManifestApp): Promise<void> {
  const store = useDownloadsStore.getState();

  // 1. Never "update" to the same or an older version.
  if (!SAFE_VERSION.test(app.latest) || !isNewerVersion(app.latest, APP_VERSION)) {
    const key = store.startTask('apk', APK_TASK_ID, 0);
    if (key !== null) store.failTask(key, 'invalid');
    return;
  }

  const expectedSha = normalizeSha256(app.sha256);
  if (expectedSha === null) {
    const key = store.startTask('apk', APK_TASK_ID, 0);
    if (key !== null) store.failTask(key, 'checksum');
    return;
  }

  // Clear out any APK from an earlier attempt before using more space.
  cleanupOldApks();

  let key: string | null = null;
  try {
    // 2. Download to tmp/ and verify the SHA-256.
    const result = await downloadVerified({
      kind: 'apk',
      id: APK_TASK_ID,
      url: app.apkUrl,
      sha256: expectedSha,
      expectedBytes: 0,
      fileName: `katipan-${app.latest}.apk`,
    });
    key = result.key;

    useDownloadsStore.getState().setTaskStatus(key, 'installing');

    // 3. Move to apk/ in the cache, then check the file once more. The file
    // is about to be handed to Android, so it is worth one more read.
    const source = new File(result.uri);
    const target = new File(apkDirectory(), `katipan-${app.latest}.apk`);
    removeFile(target);
    source.move(target);

    const stillGood = await verifyFileSha256(target.uri, expectedSha);
    if (!stillGood) {
      removeFile(target);
      useDownloadsStore.getState().failTask(key, 'checksum');
      return;
    }

    // 4. Hand it to the Android package installer. The person taps Install.
    const contentUri = await getContentUriAsync(target.uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: INSTALL_INTENT_FLAGS,
    });

    useDownloadsStore.getState().finishTask(key);
  } catch (error) {
    if (error instanceof DownloadError) {
      // Cancelled: say nothing. Anything else: downloadService already
      // marked the task as failed.
      return;
    }
    // The file was downloaded and verified but the installer could not be
    // opened, or the file could not be moved. The installed app is untouched.
    if (key !== null) {
      useDownloadsStore.getState().failTask(key, 'unknown');
    }
  }
}
