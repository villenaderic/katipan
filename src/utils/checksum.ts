import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

/**
 * SHA-256 helpers for the update system (Section 8 and 9): a downloaded pack
 * or APK is only accepted when its SHA-256 equals the value in the verified
 * manifest. This file only computes and compares hashes. Checking the
 * manifest's Ed25519 signature is manifestService's job.
 *
 * expo-crypto hashes in one call, so a file is read into memory first. That
 * is fine for packs (about 5 MB) and for an APK under the 40 MB limit; a 2 GB
 * phone has room for it. Callers should hash one file at a time.
 */

/* ------------------------------------------------------------------ */
/* Hex                                                                 */
/* ------------------------------------------------------------------ */

const HEX_DIGITS = '0123456789abcdef';
const SHA256_HEX_LENGTH = 64;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Lowercase hex string for a byte array. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    out += HEX_DIGITS.charAt(byte >> 4) + HEX_DIGITS.charAt(byte & 0x0f);
  }
  return out;
}

/** Bytes for a hex string (either case). Returns null if it is not valid, even-length hex. */
export function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/* ------------------------------------------------------------------ */
/* Checksums as written in manifest.json                               */
/* ------------------------------------------------------------------ */

/**
 * Clean a checksum from the manifest: trim, lowercase, drop an optional
 * "sha256:" prefix. Returns null unless the result is exactly 64 hex characters.
 */
export function normalizeSha256(value: string): string | null {
  let clean = value.trim().toLowerCase();
  if (clean.startsWith('sha256:')) clean = clean.slice('sha256:'.length);
  return SHA256_HEX_PATTERN.test(clean) ? clean : null;
}

export function isValidSha256(value: string): boolean {
  return normalizeSha256(value) !== null;
}

/**
 * Compare two checksums. Both are normalized first, and an invalid value on
 * either side never matches (so a missing or garbled manifest entry refuses
 * the download instead of accepting it). Compares every character, so the
 * time taken does not reveal where the first difference is.
 */
export function checksumsMatch(a: string, b: string): boolean {
  const left = normalizeSha256(a);
  const right = normalizeSha256(b);
  if (left === null || right === null) return false;

  let difference = 0;
  for (let i = 0; i < SHA256_HEX_LENGTH; i += 1) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

/** SHA-256 of raw bytes, as 64 lowercase hex characters. */
export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  // expo-crypto types its input as BufferSource, which newer TypeScript versions
  // narrow to ArrayBuffer-backed views. Our bytes are a plain Uint8Array and are
  // accepted at runtime, so the cast only silences that typing difference.
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes as unknown as BufferSource,
  );
  return bytesToHex(new Uint8Array(digest));
}

/** SHA-256 of a string (UTF-8), as 64 lowercase hex characters. */
export async function sha256OfString(text: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  return hex.toLowerCase();
}

/**
 * SHA-256 of a file on the phone. `uri` is a file:// URI such as the ones
 * downloadService produces. Throws if the file does not exist or cannot be read.
 */
export async function sha256OfFile(uri: string): Promise<string> {
  const file = new File(uri);
  if (!file.exists) {
    throw new Error(`File not found: ${uri}`);
  }
  const bytes = await file.bytes();
  return sha256OfBytes(bytes);
}

/**
 * The check used before installing anything: true only when the file's
 * SHA-256 equals `expected`. Never throws; an unreadable file, a missing file
 * and an invalid `expected` value all return false.
 */
export async function verifyFileSha256(uri: string, expected: string): Promise<boolean> {
  if (!isValidSha256(expected)) return false;
  try {
    const actual = await sha256OfFile(uri);
    return checksumsMatch(actual, expected);
  } catch {
    return false;
  }
}
