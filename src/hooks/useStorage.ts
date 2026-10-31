import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FOLDERS } from '../constants/config';
import { deletePack } from '../services/bibleService';
import { tidyDownloads } from '../services/updateService';
import { useDownloadsStore } from '../store/downloadsStore';
import { selectSettings, useSettingsStore } from '../store/settingsStore';
import type { InstalledPack } from '../types';

/**
 * How much room Katipan uses on the phone, and how much is left. Used by the
 * Translation Manager footer, the Updates screen and the Low-storage switch.
 *
 *  - packBytes:   Bible packs on disk (installed list in downloadsStore)
 *  - cacheBytes:  scratch downloads and leftovers in the temp folder
 *  - freeBytes:   free space left on the phone
 *  - isLow:       true when free space is under LOW_FREE_BYTES, so a screen
 *                 can quietly suggest freeing space (never a pop-up)
 *
 * Low-storage mode (Section 4) is a setting, not something this hook decides.
 * This hook reads it and gives screens `removePack` and `clearCache`. Turning
 * it on also tidies right away (download leftovers and old APKs), and while it
 * is on updateService tidies after every download. Large packs are hidden in
 * the Translation Manager.
 * Screens use `canDelete(pack)` to hide the delete button for bundled packs.
 *
 * It never throws. If the phone will not report a number, that number is 0,
 * and `ready` still becomes true so a screen never waits forever.
 *
 * Nothing here touches user.db, notes, highlights or settings files.
 */

/** Below this much free space the app suggests clearing the cache or a pack. */
export const LOW_FREE_BYTES = 200 * 1024 * 1024;

export interface UseStorage {
  /** False until the first measurement has finished. */
  ready: boolean;
  packBytes: number;
  cacheBytes: number;
  /** Packs plus cache. */
  usedBytes: number;
  /** Free space on the phone. 0 when unknown. */
  freeBytes: number;
  /** Total space of the phone. 0 when unknown. */
  totalBytes: number;
  isLow: boolean;
  /** The person's Low-storage mode setting. */
  lowStorageMode: boolean;
  setLowStorageMode: (on: boolean) => void;

  /** Measure again, for example after a download or a delete. */
  refresh: () => Promise<void>;
  /** True for packs that may be deleted (not the two bundled ones). */
  canDelete: (pack: Pick<InstalledPack, 'bundled'>) => boolean;
  /** Delete one downloaded pack. Resolves false if it could not be deleted. */
  removePack: (id: string) => Promise<boolean>;
  /** Empty the scratch folder. Returns the bytes freed. */
  clearCache: () => Promise<number>;
}

interface DiskNumbers {
  cacheBytes: number;
  freeBytes: number;
  totalBytes: number;
}

function tempDirectory(): Directory {
  const name = FOLDERS.temp.endsWith('/') ? FOLDERS.temp.slice(0, -1) : FOLDERS.temp;
  return new Directory(Paths.cache, name);
}

function safeNumber(read: () => unknown): number {
  try {
    const value = read();
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function folderBytes(directory: Directory): number {
  return safeNumber(() => (directory.exists ? directory.size : 0));
}

/** Reads the disk. Quick: a few file-system calls, no database. */
function measureDisk(): DiskNumbers {
  return {
    cacheBytes: folderBytes(tempDirectory()),
    freeBytes: safeNumber(() => Paths.availableDiskSpace),
    totalBytes: safeNumber(() => Paths.totalDiskSpace),
  };
}

/** Delete everything inside the temp folder, one item at a time so one stuck file does not stop the rest. */
function emptyTempDirectory(): number {
  const directory = tempDirectory();
  const before = folderBytes(directory);
  try {
    if (!directory.exists) return 0;
    for (const item of directory.list()) {
      try {
        if (item instanceof File || item instanceof Directory) item.delete();
      } catch {
        // A file still in use stays; the rest are removed.
      }
    }
  } catch {
    // Folder unreadable: nothing more can be done here.
  }
  return Math.max(0, before - folderBytes(directory));
}

export function useStorage(): UseStorage {
  const installed = useDownloadsStore((state) => state.installed);
  const packBytes = useDownloadsStore((state) => state.installedBytes);
  const refreshInstalled = useDownloadsStore((state) => state.refreshInstalled);

  const { lowStorageMode } = useSettingsStore(selectSettings);
  const setSetting = useSettingsStore((state) => state.setSetting);

  const [disk, setDisk] = useState<DiskNumbers>({ cacheBytes: 0, freeBytes: 0, totalBytes: 0 });
  const [ready, setReady] = useState(false);

  // Stops a late measurement from updating a screen that has closed.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    await refreshInstalled();
    const numbers = measureDisk();
    if (!mounted.current) return;
    setDisk(numbers);
    setReady(true);
  }, [refreshInstalled]);

  // Measure once when the first screen uses the hook.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setLowStorageMode = useCallback(
    (on: boolean): void => {
      setSetting('lowStorageMode', on);
      if (on) {
        // No installer can be open while this screen is on top, so APKs go too.
        tidyDownloads({ apks: true });
        void refresh();
      }
    },
    [setSetting, refresh],
  );

  const canDelete = useCallback((pack: Pick<InstalledPack, 'bundled'>): boolean => !pack.bundled, []);

  const removePack = useCallback(
    async (id: string): Promise<boolean> => {
      const pack = installed.find((item) => item.id === id);
      if (pack?.bundled) return false;

      // If the deleted pack is the one being read, the reader falls back to
      // the default translation by itself (bibleService.resolveTranslation).
      let deleted = true;
      try {
        await deletePack(id);
      } catch {
        deleted = false;
      }
      await refresh();
      return deleted;
    },
    [installed, refresh],
  );

  const clearCache = useCallback(async (): Promise<number> => {
    const freed = emptyTempDirectory();
    await refresh();
    return freed;
  }, [refresh]);

  const usedBytes = packBytes + disk.cacheBytes;
  const isLow = ready && disk.freeBytes > 0 && disk.freeBytes < LOW_FREE_BYTES;

  return useMemo(
    () => ({
      ready,
      packBytes,
      cacheBytes: disk.cacheBytes,
      usedBytes,
      freeBytes: disk.freeBytes,
      totalBytes: disk.totalBytes,
      isLow,
      lowStorageMode,
      setLowStorageMode,
      refresh,
      canDelete,
      removePack,
      clearCache,
    }),
    [
      ready,
      packBytes,
      disk.cacheBytes,
      disk.freeBytes,
      disk.totalBytes,
      usedBytes,
      isLow,
      lowStorageMode,
      setLowStorageMode,
      refresh,
      canDelete,
      removePack,
      clearCache,
    ],
  );
}
