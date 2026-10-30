import { Directory, File, Paths } from 'expo-file-system';
// The progress-reporting, cancellable downloader lives in the legacy entry point.
import { createDownloadResumable, type DownloadResumable } from 'expo-file-system/legacy';

import {
  taskKey,
  useDownloadsStore,
  type TaskErrorCode,
  type TaskKind,
} from '../store/downloadsStore';
import { normalizeSha256, verifyFileSha256 } from '../utils/checksum';
import { getTempDirectoryUri } from './bibleService';

/**
 * Downloads one file to a temporary place and proves it is the right file.
 *
 *   downloadVerified()  ->  tmp/<name>.part  ->  SHA-256 check  ->  tmp/<name>
 *
 * This file does NOT install anything. It hands back the verified temporary
 * file, and the caller (updateService for packs and the daily verse list,
 * appUpdateService for the APK) moves it into place. If anything fails here,
 * nothing outside tmp/ has been touched, so a failed download can never harm
 * an installed pack (Section 8).
 *
 * Progress, status and failure are reported to downloadsStore, which the
 * screens read. Errors are also thrown as DownloadError so the caller knows to
 * stop. A cancel is not an error: the store removes the task first, and this
 * file then throws a DownloadError with `cancelled` set, which callers ignore.
 *
 * Interrupted downloads: a dropped connection is retried automatically,
 * continuing from the bytes already received when the server supports it and
 * starting over when it does not. After MAX_ATTEMPTS the task fails with
 * 'network' and the person can tap again; the partial file is removed.
 *
 * Only https:// addresses are accepted.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface DownloadRequest {
  kind: TaskKind;
  /** Pack id for packs. Ignored for 'dailyVerses' and 'apk'. */
  id: string;
  url: string;
  /** From the verified manifest. A download without a valid checksum is refused. */
  sha256: string;
  /** Size from the manifest, in bytes. 0 if unknown. Used for progress and the free-space check. */
  expectedBytes: number;
  /** File name inside tmp/, for example "web.db" or "katipan-1.0.1.apk". */
  fileName: string;
}

export interface DownloadResult {
  /** The key of the task in downloadsStore. The caller finishes or fails it. */
  key: string;
  /** file:// URI of the downloaded file, already checked against its SHA-256. */
  uri: string;
}

export class DownloadError extends Error {
  readonly code: TaskErrorCode;
  /** True when the person pressed Cancel. Not a failure; do not show an error. */
  readonly cancelled: boolean;

  constructor(code: TaskErrorCode, message: string, cancelled = false) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
    this.cancelled = cancelled;
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** One first try plus two retries. */
const MAX_ATTEMPTS = 3;

/** Wait before retry n (1-based): 1.5 s, then 3 s. */
const RETRY_DELAY_MS = 1500;

/** Free space to keep after the download, so the phone does not run dry. */
const FREE_SPACE_MARGIN_BYTES = 8 * 1024 * 1024;

/** File names must stay inside tmp/. */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function joinUri(directoryUri: string, name: string): string {
  return directoryUri.endsWith('/') ? `${directoryUri}${name}` : `${directoryUri}/${name}`;
}

function removeFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A file that will not delete is left for the next cleanup.
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHttps(url: string): boolean {
  return /^https:\/\/[^\s/]+/i.test(url);
}

/** Free bytes on the phone, or null when it cannot be read. */
function freeBytes(): number | null {
  try {
    const free = Paths.availableDiskSpace;
    return typeof free === 'number' && Number.isFinite(free) ? free : null;
  } catch {
    return null;
  }
}

function hasRoomFor(bytes: number): boolean {
  if (bytes <= 0) return true;
  const free = freeBytes();
  // If the phone will not say, try anyway; a full disk is reported as a write error.
  return free === null || free >= bytes + FREE_SPACE_MARGIN_BYTES;
}

/** True once the store no longer has this task (the Cancel button was pressed). */
function wasCancelled(key: string): boolean {
  return useDownloadsStore.getState().tasks[key] === undefined;
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

/** Remove everything in tmp/ that a crashed or interrupted download left behind. */
export function clearTemporaryDownloads(): void {
  try {
    const folder = new Directory(getTempDirectoryUri());
    if (folder.exists) folder.delete();
    // getTempDirectoryUri() creates the folder again when it is missing.
    getTempDirectoryUri();
  } catch {
    // Leftovers cost a few megabytes at most and are replaced by the next download.
  }
}

/**
 * Download `request.url`, verify its SHA-256, and return the temporary file.
 * Throws DownloadError. Never touches installed packs, the APK folder or user.db.
 */
export async function downloadVerified(request: DownloadRequest): Promise<DownloadResult> {
  const store = useDownloadsStore.getState();
  const expectedSha = normalizeSha256(request.sha256);

  // Refuse before a task exists: these are mistakes in the manifest, not network trouble.
  if (!isHttps(request.url)) {
    throw new DownloadError('invalid', 'Download address is not https.');
  }
  if (expectedSha === null) {
    throw new DownloadError('checksum', 'Manifest entry has no valid SHA-256.');
  }
  if (!SAFE_FILE_NAME.test(request.fileName)) {
    throw new DownloadError('invalid', 'Unsafe temporary file name.');
  }

  const key = store.startTask(request.kind, request.id, request.expectedBytes);
  if (key === null) {
    // The same download is already running. Not a failure of this call.
    throw new DownloadError('unknown', 'Already downloading.', true);
  }

  const partUri = joinUri(getTempDirectoryUri(), `${request.fileName}.part`);
  const finalUri = joinUri(getTempDirectoryUri(), request.fileName);
  removeFile(partUri);
  removeFile(finalUri);

  let active: DownloadResumable | null = null;
  store.registerCancel(key, () => {
    const current = active;
    active = null;
    if (current) void current.cancelAsync().catch(() => undefined);
    removeFile(partUri);
  });

  /** Report a failure to the store, clean up, and stop. */
  const fail = (code: TaskErrorCode, message: string): never => {
    removeFile(partUri);
    removeFile(finalUri);
    useDownloadsStore.getState().failTask(key, code);
    throw new DownloadError(code, message);
  };

  const stopIfCancelled = (): void => {
    if (wasCancelled(key)) {
      removeFile(partUri);
      removeFile(finalUri);
      throw new DownloadError('unknown', 'Cancelled.', true);
    }
  };

  if (!hasRoomFor(request.expectedBytes)) {
    return fail('storage', 'Not enough free space.');
  }

  /* ---- 1. Download, retrying a dropped connection ---- */

  const onProgress = (data: { totalBytesWritten: number; totalBytesExpectedToWrite: number }): void => {
    useDownloadsStore
      .getState()
      .setProgress(
        key,
        data.totalBytesWritten,
        data.totalBytesExpectedToWrite > 0 ? data.totalBytesExpectedToWrite : undefined,
      );
  };

  let resumeData: string | undefined;
  let finished = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !finished; attempt += 1) {
    stopIfCancelled();

    try {
      const resumable = createDownloadResumable(request.url, partUri, {}, onProgress, resumeData);
      active = resumable;

      const result = await (resumeData === undefined
        ? resumable.downloadAsync()
        : resumable.resumeAsync());

      // Cancelled while downloading: the store already removed the task.
      stopIfCancelled();
      active = null;

      if (!result) {
        throw new Error('Download returned no result.');
      }
      if (result.status < 200 || result.status >= 300) {
        // A wrong address or a missing file will not fix itself; do not retry.
        removeFile(partUri);
        return fail(
          result.status === 404 || result.status === 403 ? 'invalid' : 'network',
          `Server answered ${result.status}.`,
        );
      }
      finished = true;
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      stopIfCancelled();

      const message = error instanceof Error ? error.message : String(error);

      // Out of space is not a network problem and retrying cannot help.
      if (/ENOSPC|no space/i.test(message)) {
        return fail('storage', message);
      }

      // Keep what was received so far, if the library can describe it.
      let saved: string | undefined;
      try {
        saved = active?.savable().resumeData;
      } catch {
        saved = undefined;
      }
      active = null;
      resumeData = saved;

      if (attempt === MAX_ATTEMPTS) {
        return fail('network', message);
      }
      await wait(RETRY_DELAY_MS * attempt);
    }
  }

  stopIfCancelled();

  /* ---- 2. Verify the SHA-256 of what arrived ---- */

  useDownloadsStore.getState().setTaskStatus(key, 'verifying');

  const matches = await verifyFileSha256(partUri, expectedSha);
  stopIfCancelled();
  if (!matches) {
    // A corrupted or tampered file is deleted and never offered for install.
    return fail('checksum', 'SHA-256 does not match the manifest.');
  }

  /* ---- 3. Give the verified file its real name ---- */

  try {
    new File(partUri).move(new File(finalUri));
  } catch (error) {
    return fail('storage', error instanceof Error ? error.message : 'Could not save the file.');
  }

  return { key, uri: finalUri };
}

/** The store key for a request, for callers that want it before starting. */
export function keyFor(kind: TaskKind, id: string): string {
  return taskKey(kind, id);
}
