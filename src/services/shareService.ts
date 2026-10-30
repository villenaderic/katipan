import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

/**
 * Copy and share for verses (MVP: text and image).
 *
 *  - Text goes through the system share sheet. React Native's own Share is
 *    used for text because expo-sharing only shares files.
 *  - Images are drawn from an on-screen View with react-native-view-shot into
 *    a temporary PNG, then handed to the share sheet. Nothing is uploaded and
 *    no network call is made: the share sheet is the phone's, not ours.
 *  - Every function throws on failure. Callers show their own error message
 *    (they already have the interface language), so this file has no strings.
 *  - Closing the share sheet without choosing an app is NOT an error.
 */

/** Longest edge, in pixels, of a shared image. Keeps memory low on 2 GB phones. */
const IMAGE_MAX_EDGE = 1080;

/** PNG quality is ignored by view-shot for PNG, but the type requires a value. */
const IMAGE_QUALITY = 1;

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** Put text on the clipboard. Throws if the clipboard is unavailable. */
export async function copyText(text: string): Promise<void> {
  const ok = await Clipboard.setStringAsync(text);
  if (!ok) {
    throw new Error('Clipboard refused the text.');
  }
}

/**
 * Open the system share sheet with plain text. Resolves when the sheet is
 * closed, whether or not the person picked an app.
 */
export async function shareText(text: string): Promise<void> {
  if (text.trim().length === 0) return;
  await Share.share({ message: text });
}

/* ------------------------------------------------------------------ */
/* Image                                                               */
/* ------------------------------------------------------------------ */

/** True when this phone can share a file through the share sheet. */
export function canShareImage(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

/**
 * Turn a View (for example the verse card on the share screen) into a PNG and
 * open the share sheet with it. Returns the file URI of the PNG so the caller
 * can reuse it. Throws if the View cannot be captured or sharing is not
 * available.
 *
 * `title` is only the label some share sheets show above the file.
 */
export async function shareImage(
  viewRef: RefObject<View | null>,
  title: string,
): Promise<string> {
  const target = viewRef.current;
  if (target === null) {
    throw new Error('Nothing to capture: the view is not on screen.');
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing files is not available on this phone.');
  }

  const uri = await captureRef(target, {
    format: 'png',
    quality: IMAGE_QUALITY,
    result: 'tmpfile',
    width: IMAGE_MAX_EDGE,
  });

  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    dialogTitle: title,
    UTI: 'public.png',
  });

  return uri;
}
