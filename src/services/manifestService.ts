import * as ed from '@noble/ed25519';
import * as Crypto from 'expo-crypto';

import {
  IS_SIGNING_KEY_CONFIGURED,
  MANIFEST_PUBLIC_KEY_HEX,
  MANIFEST_URL,
} from '../constants/config';
import type { Manifest, ManifestApp, ManifestDailyVerses, ManifestPack } from '../types';
import { hexToBytes, normalizeSha256 } from '../utils/checksum';

/**
 * Fetches manifest.json and refuses it unless its Ed25519 signature is valid.
 *
 * HOW THE SIGNATURE WORKS
 *   Two static files sit side by side on GitHub:
 *     manifest.json       the manifest, exactly as tools/build-manifest.js wrote it
 *     manifest.json.sig   128 hex characters: the Ed25519 signature of the
 *                         EXACT BYTES of manifest.json
 *   The app downloads both, checks the signature with the public key built
 *   into the app (MANIFEST_PUBLIC_KEY_HEX), and only then reads the JSON.
 *   Signing the raw bytes means nobody has to agree on how JSON is
 *   re-written, so there is nothing to get subtly wrong. Because the manifest
 *   carries the SHA-256 of every pack, the daily verse list and the APK, one
 *   signature protects them all; a per-pack signature would add nothing.
 *
 * This is the ONLY place the app contacts the network for the manifest, and
 * only at MANIFEST_URL (and the same address plus ".sig").
 *
 * Nothing here writes to disk. The caller (updateService) keeps the result.
 */

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 *   not-configured  no manifest address or no public key in the app yet
 *   network         no connection, a timeout, or the server said no
 *   signature       the signature file is missing or does not match
 *   invalid         the signature is fine but the content is not a usable manifest
 */
export type ManifestErrorCode = 'not-configured' | 'network' | 'signature' | 'invalid';

export class ManifestError extends Error {
  readonly code: ManifestErrorCode;

  constructor(code: ManifestErrorCode, message: string) {
    super(message);
    this.name = 'ManifestError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

const FETCH_TIMEOUT_MS = 20_000;

/** A manifest this large is not ours. Refuse before reading it all into memory. */
const MAX_MANIFEST_BYTES = 256 * 1024;

const SIGNATURE_HEX_LENGTH = 128;
const SUPPORTED_SCHEMA = 1;
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/* ------------------------------------------------------------------ */
/* Ed25519 needs SHA-512, which the library leaves to us               */
/* ------------------------------------------------------------------ */

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha512(...parts: Uint8Array[]): Promise<Uint8Array> {
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA512,
    // Same typing difference as in utils/checksum.ts; a plain Uint8Array works at runtime.
    concatBytes(parts) as unknown as BufferSource,
  );
  return new Uint8Array(digest);
}

/**
 * @noble/ed25519 version 2 keeps its hash hook at `etc.sha512Async` and
 * version 3 at `hashes.sha512Async`. This sets whichever exists, so the app
 * works with either. The cast is needed because each version types only its
 * own hook.
 */
interface HashHooks {
  etc?: { sha512Async?: (...messages: Uint8Array[]) => Promise<Uint8Array> };
  hashes?: { sha512Async?: (message: Uint8Array) => Promise<Uint8Array> };
}

let hashConfigured = false;

function configureEd25519(): void {
  if (hashConfigured) return;
  const lib = ed as unknown as HashHooks;
  if (lib.etc) lib.etc.sha512Async = sha512;
  if (lib.hashes) lib.hashes.sha512Async = (message) => sha512(message);
  hashConfigured = true;
}

/* ------------------------------------------------------------------ */
/* Signature check                                                     */
/* ------------------------------------------------------------------ */

/**
 * True only when `signatureHex` is a valid Ed25519 signature of `message`
 * for the public key. Never throws: any problem means "not valid".
 */
export async function verifySignature(
  message: Uint8Array,
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const signature = hexToBytes(signatureHex);
    const publicKey = hexToBytes(publicKeyHex);
    if (signature === null || signature.length !== SIGNATURE_HEX_LENGTH / 2) return false;
    if (publicKey === null || publicKey.length !== 32) return false;

    configureEd25519();
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Reading the JSON                                                    */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function asHttpsUrl(value: unknown): string | null {
  const text = asString(value);
  return text !== null && /^https:\/\/[^\s/]+/i.test(text) ? text : null;
}

function parsePack(value: unknown): ManifestPack | null {
  if (!isObject(value)) return null;
  const id = asString(value.id);
  const lang = asString(value.lang);
  const version = asCount(value.version);
  const size = asCount(value.size);
  const url = asHttpsUrl(value.url);
  const sha256 = typeof value.sha256 === 'string' ? normalizeSha256(value.sha256) : null;

  if (id === null || !PACK_ID_PATTERN.test(id)) return null;
  if (lang === null || version === null || version < 1 || size === null) return null;
  if (url === null || sha256 === null) return null;

  return {
    id,
    lang,
    version,
    size,
    url,
    sha256,
    bundled: value.bundled === true,
  };
}

function parseDailyVerses(value: unknown): ManifestDailyVerses | null {
  if (!isObject(value)) return null;
  const version = asCount(value.version);
  const url = asHttpsUrl(value.url);
  const sha256 = typeof value.sha256 === 'string' ? normalizeSha256(value.sha256) : null;
  if (version === null || version < 1 || url === null || sha256 === null) return null;
  return { version, url, sha256 };
}

function parseApp(value: unknown): ManifestApp | null {
  if (!isObject(value)) return null;
  const latest = asString(value.latest);
  const apkUrl = asHttpsUrl(value.apkUrl);
  const sha256 = typeof value.sha256 === 'string' ? normalizeSha256(value.sha256) : null;
  if (latest === null || !/^\d+(\.\d+){0,2}$/.test(latest)) return null;
  if (apkUrl === null || sha256 === null) return null;

  const rawNotes = isObject(value.notes) ? value.notes : {};
  const en = asString(rawNotes.en) ?? '';
  const fil = asString(rawNotes.fil) ?? en;

  return { latest, apkUrl, sha256, notes: { en, fil } };
}

/**
 * Turn already-verified manifest text into a Manifest. Entries that are
 * damaged are left out rather than failing the whole manifest, so one bad
 * pack cannot block every other update. Throws ManifestError('invalid') when
 * the file as a whole is not a manifest this app understands.
 */
export function parseManifest(text: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ManifestError('invalid', 'Manifest is not valid JSON.');
  }
  if (!isObject(raw)) throw new ManifestError('invalid', 'Manifest is not an object.');

  if (raw.schema !== SUPPORTED_SCHEMA) {
    throw new ManifestError('invalid', `Unsupported manifest schema: ${String(raw.schema)}.`);
  }

  const generated = asString(raw.generated);
  const minAppVersion = asString(raw.minAppVersion) ?? '0.0.0';
  if (generated === null) throw new ManifestError('invalid', 'Manifest has no date.');

  const packs: ManifestPack[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.packs)) {
    for (const entry of raw.packs) {
      const pack = parsePack(entry);
      if (pack !== null && !seen.has(pack.id)) {
        seen.add(pack.id);
        packs.push(pack);
      }
    }
  }

  const dailyVerses = parseDailyVerses(raw.dailyVerses);
  const app = parseApp(raw.app);

  return {
    schema: SUPPORTED_SCHEMA,
    generated,
    minAppVersion,
    packs,
    ...(dailyVerses !== null ? { dailyVerses } : {}),
    ...(app !== null ? { app } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Network                                                             */
/* ------------------------------------------------------------------ */

/** Download a small file as raw bytes. Throws ManifestError('network'). */
async function fetchBytes(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      // A stale cached manifest would hide a new release.
      headers: { 'Cache-Control': 'no-cache' },
    });

    if (!response.ok) {
      throw new ManifestError('network', `Server answered ${response.status}.`);
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_MANIFEST_BYTES) {
      throw new ManifestError('invalid', 'Manifest is too large.');
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_MANIFEST_BYTES) {
      throw new ManifestError('invalid', 'Manifest is too large.');
    }
    return new Uint8Array(buffer);
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    throw new ManifestError(
      'network',
      error instanceof Error ? error.message : 'Could not reach the update server.',
    );
  } finally {
    clearTimeout(timer);
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

/**
 * Check manifest bytes against a signature and read them. Pure apart from
 * the hashing, so it can be tested without a network.
 */
export async function verifyAndParseManifest(
  manifestBytes: Uint8Array,
  signatureText: string,
  publicKeyHex: string = MANIFEST_PUBLIC_KEY_HEX,
): Promise<Manifest> {
  const valid = await verifySignature(manifestBytes, signatureText.trim(), publicKeyHex);
  if (!valid) {
    throw new ManifestError('signature', 'Manifest signature is not valid.');
  }
  return parseManifest(decodeUtf8(manifestBytes));
}

/**
 * Download manifest.json and its signature, verify, and return the manifest.
 * Throws ManifestError. Anything that fails the signature is refused, with no
 * exception for "just this once".
 */
export async function fetchVerifiedManifest(): Promise<Manifest> {
  if (MANIFEST_URL.length === 0 || !/^https:\/\//i.test(MANIFEST_URL)) {
    throw new ManifestError('not-configured', 'No manifest address is set in app.json.');
  }
  if (!IS_SIGNING_KEY_CONFIGURED) {
    throw new ManifestError('not-configured', 'No public key is set in config.ts.');
  }

  // One after the other: if the phone is offline, the manifest request fails
  // first and is reported as a network problem, not as a signature problem.
  const manifestBytes = await fetchBytes(MANIFEST_URL);

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = await fetchBytes(`${MANIFEST_URL}.sig`);
  } catch {
    // The manifest arrived but its signature did not: refuse it.
    throw new ManifestError('signature', 'The signature file could not be downloaded.');
  }

  return verifyAndParseManifest(manifestBytes, decodeUtf8(signatureBytes));
}
