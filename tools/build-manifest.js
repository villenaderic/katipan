#!/usr/bin/env node
'use strict';

/**
 * build-manifest.js: make manifest.json and sign it, for Katipan's updates.
 * Runs on YOUR computer (and in the GitHub release workflow), never inside the
 * app. Needs Node.js 22.5 or newer. There is nothing to npm install.
 *
 * THREE COMMANDS
 *
 *   node tools/build-manifest.js keygen
 *       Make the Ed25519 key pair ONCE. The private key goes to
 *       tools/keys/manifest-private.pem (git-ignored). The public key (64 hex
 *       characters) is printed: paste it into MANIFEST_PUBLIC_KEY_HEX in
 *       src/constants/config.ts BEFORE you build the first release.
 *
 *   node tools/build-manifest.js public-key
 *       Print the public key again, from the private key.
 *
 *   node tools/build-manifest.js build --base-url <https url> [options]
 *       Collect the packs, the daily verse list and (optionally) the APK,
 *       work out their SHA-256 checksums, write manifest.json, sign it, and
 *       check the result the same way the app will. Everything lands in one
 *       folder (default tools/out/), ready to upload to a GitHub Release.
 *
 * HOW THE SIGNATURE WORKS (must match src/services/manifestService.ts)
 *   manifest.json.sig holds 128 hex characters: the Ed25519 signature of the
 *   EXACT BYTES of manifest.json. Do not edit or re-save manifest.json after
 *   it is signed, not even to fix a space; build it again instead. The
 *   manifest carries the SHA-256 of every file, so one signature protects all.
 *
 * THE SIGNING KEY IS NOT THE ANDROID KEYSTORE. They are two separate secrets:
 *   - Android keystore: signs the APK. Lose it and nobody can update the app.
 *   - Manifest key (this file): signs manifest.json. Lose it and no manifest
 *     is accepted, and only a new APK carrying a new public key fixes that.
 *   Back up both in two places. Never commit either.
 *
 * WHERE THE PRIVATE KEY COMES FROM
 *   1. the environment variable KATIPAN_SIGNING_KEY (the PEM text; this is
 *      how the GitHub workflow passes it, from a repository secret), else
 *   2. the file given by --key, else
 *   3. tools/keys/manifest-private.pem
 *
 * Run with --help for every option.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_SOURCE = path.join(ROOT, 'src', 'constants', 'config.ts');
const APP_JSON = path.join(ROOT, 'app.json');
const DEFAULT_KEY_FILE = path.join(ROOT, 'tools', 'keys', 'manifest-private.pem');
const DEFAULT_PACKS = path.join(ROOT, 'assets', 'data');
const DEFAULT_DAILY_VERSES = path.join(ROOT, 'assets', 'data', 'daily-verses.json');
const DEFAULT_OUT_DIR = path.join(ROOT, 'tools', 'out');

/** Keep these in step with src/services/manifestService.ts. */
const SCHEMA = 1;
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const VERSION_PATTERN = /^\d+(\.\d+){0,2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_MANIFEST_BYTES = 256 * 1024;

/** Keep these in step with src/constants/config.ts and the master prompt. */
const DAILY_VERSE_COUNT = 366;
const CONFIRM_BYTES = 10 * 1024 * 1024;
const MAX_APK_BYTES = 40 * 1024 * 1024;
const MAX_NOTES_CHARS = 1000;

const HELP = `
Usage: node tools/build-manifest.js <command> [options]

Commands
  keygen       Make the manifest signing key pair (once). Prints the public key.
  public-key   Print the public key of the existing private key.
  build        Write and sign manifest.json (see below).

Options for keygen and public-key
  --key <file>          Private key file. Default: tools/keys/manifest-private.pem
  --force               keygen only: replace an existing key. This makes every
                        installed app refuse updates until it is replaced too.

Options for build
  --base-url <url>      Required. The https folder the uploaded files will live in.
                        For a GitHub Release:
                        https://github.com/USER/REPO/releases/download/v1.0.1
  --packs <paths>       Comma separated folders or .db files. Default: assets/data
  --daily-verses <file> Default: assets/data/daily-verses.json (skipped if missing)
  --apk <file>          The signed release APK. Adds the "app" entry.
  --app-version <x.y.z> Default: "version" in app.json
  --notes-file <file>   JSON like {"en": "What's new...", "fil": "Ano ang bago..."}
  --notes-en <text>     What's new, English (when there is no --notes-file)
  --notes-fil <text>    What's new, Filipino (falls back to English)
  --min-app-version <v> Oldest app that may use these packs. Default: 1.0.0
  --out-dir <folder>    Default: tools/out
  --key <file>          Private key file (KATIPAN_SIGNING_KEY overrides it)
  --generated <iso>     Timestamp to write. Default: now (UTC)
  --no-key-check        Do not compare with MANIFEST_PUBLIC_KEY_HEX in config.ts
  --help                Show this help.
`;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function die(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

const FLAGS = ['help', 'force', 'no-key-check'];

function parseArgs(argv) {
  const options = {};
  let command = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (command !== null) die(`Unexpected argument "${arg}". Run with --help.`);
      command = arg;
      continue;
    }
    const key = arg.slice(2);
    if (FLAGS.includes(key)) {
      options[key] = true;
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) die(`Option --${key} needs a value.`);
      options[key] = value;
      i += 1;
    }
  }
  return { command, options };
}

function sha256OfFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readJsonFile(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    die(`Cannot read ${label}: ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    die(`${label} is not valid JSON: ${error.message}`);
  }
  return null;
}

function isWholeNumber(value, min) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

function openSqlite() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    die(`Node.js 22.5 or newer is needed (this is ${process.versions.node}). Install the current LTS from https://nodejs.org.`);
  }
  return require('node:sqlite');
}

/* ------------------------------------------------------------------ */
/* Project settings, read straight from the source (one place to edit) */
/* ------------------------------------------------------------------ */

function loadConfig() {
  let source;
  try {
    source = fs.readFileSync(CONFIG_SOURCE, 'utf8');
  } catch {
    die(`Cannot read ${CONFIG_SOURCE}. Run this tool from the project, with src/constants/config.ts in place.`);
  }

  const bundledMatch = source.match(/BUNDLED_PACK_IDS\s*=\s*\[([^\]]*)\]/);
  const bundled = bundledMatch
    ? [...bundledMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    : [];
  const keyMatch = source.match(/MANIFEST_PUBLIC_KEY_HEX\s*=\s*'([^']*)'/);

  return {
    bundled,
    publicKey: keyMatch ? keyMatch[1].trim().toLowerCase() : '',
  };
}

function loadAppJson() {
  const json = readJsonFile(APP_JSON, 'app.json');
  const expo = json && json.expo ? json.expo : {};
  return {
    version: typeof expo.version === 'string' ? expo.version : '',
    slug: typeof expo.slug === 'string' && expo.slug ? expo.slug : 'katipan',
    versionCode: expo.android && expo.android.versionCode,
    manifestUrl: expo.extra && typeof expo.extra.manifestUrl === 'string' ? expo.extra.manifestUrl : '',
  };
}

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

function loadPrivateKey(options) {
  const fromEnv = process.env.KATIPAN_SIGNING_KEY;
  let pem;
  let origin;

  if (fromEnv && fromEnv.trim().length > 0) {
    // Some secret stores keep the line breaks as the two characters \n.
    pem = fromEnv.includes('\\n') && !fromEnv.includes('\n') ? fromEnv.replace(/\\n/g, '\n') : fromEnv;
    origin = 'KATIPAN_SIGNING_KEY';
  } else {
    const file = path.resolve(options.key ?? DEFAULT_KEY_FILE);
    try {
      pem = fs.readFileSync(file, 'utf8');
    } catch {
      die(`No signing key. Run "node tools/build-manifest.js keygen" first, or set KATIPAN_SIGNING_KEY.\n(looked for ${file})`);
    }
    origin = file;
  }

  let key;
  try {
    key = crypto.createPrivateKey(pem);
  } catch {
    die(`The signing key from ${origin} is not a readable private key (PEM).`);
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    die(`The signing key from ${origin} is ${key.asymmetricKeyType}, but Ed25519 is required.`);
  }
  return key;
}

/** The raw 32-byte public key as 64 hex characters (what config.ts expects). */
function publicKeyHex(privateKey) {
  const der = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('hex');
}

function keygen(options) {
  const file = path.resolve(options.key ?? DEFAULT_KEY_FILE);
  if (fs.existsSync(file) && options.force !== true) {
    die(`${file} already exists.\nA new key would make every installed app refuse updates. Use "public-key" to see the current one, or --force if you really mean it.`);
  }

  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

  console.log(`\nPrivate key written to ${file}`);
  console.log('');
  console.log('Public key (paste into MANIFEST_PUBLIC_KEY_HEX in src/constants/config.ts):');
  console.log(`\n  ${publicKeyHex(privateKey)}\n`);
  console.log('Now:');
  console.log('  1. Back the private key up in TWO places (for example a password manager and an');
  console.log('     encrypted USB stick). It is git-ignored; never commit it.');
  console.log('  2. In GitHub: Settings > Secrets and variables > Actions > New repository secret,');
  console.log('     name KATIPAN_SIGNING_KEY, value = the whole text of the .pem file.');
  console.log('  3. Put the public key in config.ts, then build and release the app.');
}

function printPublicKey(options) {
  console.log(publicKeyHex(loadPrivateKey(options)));
}

/* ------------------------------------------------------------------ */
/* Packs                                                               */
/* ------------------------------------------------------------------ */

function collectPackFiles(spec) {
  const files = [];
  for (const entry of spec.split(',').map((part) => part.trim()).filter(Boolean)) {
    const full = path.resolve(entry);
    if (!fs.existsSync(full)) die(`--packs: ${full} does not exist.`);
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        if (name.toLowerCase().endsWith('.db')) files.push(path.join(full, name));
      }
    } else {
      files.push(full);
    }
  }
  return files;
}

/**
 * Open a COPY of the pack (the original is never touched) and check it the way
 * the app will rely on it. Returns { meta, verses } or pushes into `errors`.
 */
function inspectPack(copy, label, DatabaseSync, errors) {
  let db;
  try {
    db = new DatabaseSync(copy);
  } catch (error) {
    errors.push(`${label}: not a SQLite file (${error.message}).`);
    return null;
  }

  try {
    const meta = {};
    for (const row of db.prepare('SELECT key, value FROM meta').all()) meta[row.key] = row.value;

    const quick = db.prepare('PRAGMA quick_check').get();
    if (Object.values(quick)[0] !== 'ok') errors.push(`${label}: SQLite integrity check failed.`);

    const verses = db.prepare('SELECT COUNT(*) AS n FROM verses').get().n;
    if (verses === 0) errors.push(`${label}: the pack has no verses.`);

    // Prove the search index is really there and filled in: look up a word
    // taken from the first verse.
    const first = db.prepare('SELECT text FROM verses ORDER BY id LIMIT 1').get();
    const word = first ? (first.text.match(/[\p{L}]{3,}/u) || [])[0] : undefined;
    if (word !== undefined) {
      const hit = db.prepare('SELECT rowid FROM verses_fts WHERE verses_fts MATCH ? LIMIT 1').get(`"${word}"`);
      if (hit === undefined) errors.push(`${label}: the full-text search index (verses_fts) is empty or broken.`);
    }

    return { meta, verses };
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  } finally {
    db.close();
  }
}

function buildPacks(spec, baseUrl, outDir, bundledIds, errors, warnings) {
  const files = collectPackFiles(spec);
  if (files.length === 0) {
    warnings.push('No .db packs were found, so the manifest lists none.');
    return [];
  }

  const { DatabaseSync } = openSqlite();
  const entries = [];
  const seen = new Map();

  for (const file of files) {
    const label = path.basename(file);

    // Work on a copy that already carries its final name.
    const staging = path.join(outDir, `.inspect-${process.pid}-${label}`);
    fs.copyFileSync(file, staging);
    const result = inspectPack(staging, label, DatabaseSync, errors);
    fs.rmSync(staging, { force: true });
    if (result === null) continue;

    const { meta } = result;
    const id = meta.id;
    const version = Number(meta.version);

    if (typeof id !== 'string' || !PACK_ID_PATTERN.test(id)) {
      errors.push(`${label}: meta "id" is missing or not a valid pack id (${String(id)}).`);
      continue;
    }
    if (!isWholeNumber(version, 1)) {
      errors.push(`${label}: meta "version" must be a whole number of 1 or more (is ${String(meta.version)}).`);
      continue;
    }
    if (typeof meta.language !== 'string' || meta.language.trim() === '') {
      errors.push(`${label}: meta "language" is missing.`);
      continue;
    }
    // Licensing rule, master prompt Section 7.
    if (!meta.license || !meta.license.trim() || !meta.source_url || !meta.source_url.trim()) {
      errors.push(`${label}: meta "license" and "source_url" must both be filled in. Only public-domain or openly licensed texts may ship.`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${label}: pack id "${id}" is already used by ${seen.get(id)}.`);
      continue;
    }
    seen.set(id, label);

    // A new file name for every version, so older releases keep working.
    const fileName = `${id}-v${version}.db`;
    fs.copyFileSync(file, path.join(outDir, fileName));
    const size = fs.statSync(path.join(outDir, fileName)).size;

    if (size > CONFIRM_BYTES) {
      warnings.push(`${fileName} is ${formatBytes(size)}. Packs over 10 MB make the app ask for an explicit tap.`);
    }

    entries.push({
      id,
      lang: meta.language.trim(),
      version,
      size,
      url: `${baseUrl}/${fileName}`,
      sha256: sha256OfFile(path.join(outDir, fileName)),
      bundled: bundledIds.includes(id),
      _file: fileName,
      _name: meta.name,
      _verses: result.verses,
    });
  }

  for (const bundledId of bundledIds) {
    if (!seen.has(bundledId)) {
      warnings.push(`Bundled pack "${bundledId}" (BUNDLED_PACK_IDS in config.ts) was not found among the packs.`);
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* Daily verses                                                        */
/* ------------------------------------------------------------------ */

function buildDailyVerses(file, baseUrl, outDir, errors, warnings) {
  if (!fs.existsSync(file)) {
    warnings.push(`No daily verse list at ${file}, so the manifest has no "dailyVerses" entry.`);
    return null;
  }

  const json = readJsonFile(file, 'daily-verses.json');
  const label = 'daily-verses.json';

  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    errors.push(`${label}: expected { "version": n, "verses": [...] }.`);
    return null;
  }
  if (!isWholeNumber(json.version, 1)) {
    errors.push(`${label}: "version" must be a whole number of 1 or more.`);
    return null;
  }
  if (!Array.isArray(json.verses) || json.verses.length !== DAILY_VERSE_COUNT) {
    errors.push(`${label}: "verses" must hold exactly ${DAILY_VERSE_COUNT} references (has ${Array.isArray(json.verses) ? json.verses.length : 'none'}).`);
    return null;
  }

  const bad = [];
  json.verses.forEach((value, index) => {
    const valid =
      isWholeNumber(value, 1000001) &&
      Math.floor(value / 1000000) >= 1 &&
      Math.floor(value / 1000000) <= 66 &&
      Math.floor(value / 1000) % 1000 >= 1 &&
      value % 1000 >= 1;
    if (!valid) bad.push(`#${index + 1} (${String(value)})`);
  });
  if (bad.length > 0) {
    errors.push(`${label}: ${bad.length} reference(s) are not book*1000000 + chapter*1000 + verse: ${bad.slice(0, 6).join(', ')}${bad.length > 6 ? ' ...' : ''}`);
    return null;
  }
  if (new Set(json.verses).size !== json.verses.length) {
    warnings.push(`${label}: some references appear more than once.`);
  }

  const fileName = `daily-verses-v${json.version}.json`;
  fs.copyFileSync(file, path.join(outDir, fileName));

  return {
    version: json.version,
    url: `${baseUrl}/${fileName}`,
    sha256: sha256OfFile(path.join(outDir, fileName)),
    _file: fileName,
  };
}

/* ------------------------------------------------------------------ */
/* App (APK)                                                           */
/* ------------------------------------------------------------------ */

function loadNotes(options, errors) {
  let en = '';
  let fil = '';
  if (options['notes-file'] !== undefined) {
    const json = readJsonFile(path.resolve(options['notes-file']), '--notes-file');
    en = json && typeof json.en === 'string' ? json.en.trim() : '';
    fil = json && typeof json.fil === 'string' ? json.fil.trim() : '';
  }
  if (options['notes-en'] !== undefined) en = options['notes-en'].trim();
  if (options['notes-fil'] !== undefined) fil = options['notes-fil'].trim();

  if (en === '') {
    errors.push('An APK needs "What\'s new" text: use --notes-file, or --notes-en (and --notes-fil).');
  }
  return { en, fil: fil === '' ? en : fil };
}

function buildApp(options, appJson, baseUrl, outDir, errors, warnings) {
  if (options.apk === undefined) return null;

  const apk = path.resolve(options.apk);
  if (!fs.existsSync(apk)) {
    errors.push(`--apk: ${apk} does not exist.`);
    return null;
  }

  const latest = options['app-version'] ?? appJson.version;
  if (!VERSION_PATTERN.test(latest)) {
    errors.push(`App version "${latest}" is not like 1.0.1. Set "version" in app.json or use --app-version.`);
    return null;
  }

  const notes = loadNotes(options, errors);
  for (const [lang, text] of Object.entries(notes)) {
    if (text.length > MAX_NOTES_CHARS) warnings.push(`The "${lang}" notes are ${text.length} characters; keep them short.`);
  }

  const fileName = `${appJson.slug}-${latest}.apk`;
  fs.copyFileSync(apk, path.join(outDir, fileName));
  const size = fs.statSync(path.join(outDir, fileName)).size;
  if (size > MAX_APK_BYTES) {
    warnings.push(`${fileName} is ${formatBytes(size)}, over the 40 MB target in the master prompt.`);
  }

  return {
    latest,
    apkUrl: `${baseUrl}/${fileName}`,
    sha256: sha256OfFile(path.join(outDir, fileName)),
    notes,
    _file: fileName,
    _size: size,
  };
}

/* ------------------------------------------------------------------ */
/* Check the result the way the app will                               */
/* ------------------------------------------------------------------ */

function isHttps(value) {
  return typeof value === 'string' && /^https:\/\/[^\s/]+/i.test(value);
}

/** Mirrors parseManifest() in manifestService.ts: anything it would drop is a problem here. */
function checkLikeTheApp(manifest, outDir, errors) {
  if (manifest.schema !== SCHEMA) errors.push('check: unsupported schema.');
  if (!VERSION_PATTERN.test(manifest.minAppVersion)) errors.push('check: minAppVersion is not like 1.0.0.');

  const ids = new Set();
  for (const pack of manifest.packs) {
    if (!PACK_ID_PATTERN.test(pack.id) || ids.has(pack.id)) errors.push(`check: pack "${pack.id}" has a bad or repeated id.`);
    ids.add(pack.id);
    if (!isHttps(pack.url) || !SHA256_PATTERN.test(pack.sha256)) errors.push(`check: pack "${pack.id}" has a bad url or checksum.`);
  }
  if (manifest.dailyVerses && (!isHttps(manifest.dailyVerses.url) || !SHA256_PATTERN.test(manifest.dailyVerses.sha256))) {
    errors.push('check: dailyVerses has a bad url or checksum.');
  }
  if (manifest.app && (!isHttps(manifest.app.apkUrl) || !SHA256_PATTERN.test(manifest.app.sha256) || !VERSION_PATTERN.test(manifest.app.latest))) {
    errors.push('check: app has a bad url, checksum or version.');
  }

  // Every checksum in the manifest must match the file that will be uploaded.
  const listed = [
    ...manifest.packs.map((p) => [p.url, p.sha256]),
    ...(manifest.dailyVerses ? [[manifest.dailyVerses.url, manifest.dailyVerses.sha256]] : []),
    ...(manifest.app ? [[manifest.app.apkUrl, manifest.app.sha256]] : []),
  ];
  for (const [url, sha] of listed) {
    const name = url.slice(url.lastIndexOf('/') + 1);
    const file = path.join(outDir, name);
    if (!fs.existsSync(file) || sha256OfFile(file) !== sha) errors.push(`check: ${name} does not match its checksum.`);
  }
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

function build(options) {
  if (options['base-url'] === undefined) die('--base-url is required (the https folder the files will be uploaded to). Run with --help.');

  const baseUrl = options['base-url'].replace(/\/+$/, '');
  if (!isHttps(baseUrl)) die(`--base-url must start with https:// (got "${options['base-url']}").`);
  if (/YOUR-USER|YOUR_USER/i.test(baseUrl)) die('--base-url still contains the placeholder YOUR-USER. Use your real GitHub user and repository.');

  const minAppVersion = options['min-app-version'] ?? '1.0.0';
  if (!VERSION_PATTERN.test(minAppVersion)) die(`--min-app-version "${minAppVersion}" is not like 1.0.0.`);

  const generated = options.generated ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (Number.isNaN(Date.parse(generated))) die(`--generated "${generated}" is not a date.`);

  const config = loadConfig();
  const appJson = loadAppJson();
  const privateKey = loadPrivateKey(options);
  const publicKey = publicKeyHex(privateKey);

  const errors = [];
  const warnings = [];

  // The app silently refuses every update if its built-in key is not this key.
  if (options['no-key-check'] !== true) {
    if (!/^[0-9a-f]{64}$/.test(config.publicKey)) {
      errors.push('MANIFEST_PUBLIC_KEY_HEX in src/constants/config.ts is empty. An app built like that refuses every update. Paste the key from "keygen" (or "public-key") there first.');
    } else if (config.publicKey !== publicKey) {
      errors.push(`MANIFEST_PUBLIC_KEY_HEX in config.ts (${config.publicKey.slice(0, 12)}...) is not the public key of this private key (${publicKey.slice(0, 12)}...). Apps built that way refuse this manifest.`);
    }
  }

  const outDir = path.resolve(options['out-dir'] ?? DEFAULT_OUT_DIR);
  fs.mkdirSync(outDir, { recursive: true });

  const packs = buildPacks(options.packs ?? DEFAULT_PACKS, baseUrl, outDir, config.bundled, errors, warnings);
  const dailyVerses = buildDailyVerses(path.resolve(options['daily-verses'] ?? DEFAULT_DAILY_VERSES), baseUrl, outDir, errors, warnings);
  const app = buildApp(options, appJson, baseUrl, outDir, errors, warnings);

  if (options.apk === undefined) {
    warnings.push('No --apk given: this manifest updates content only and has no "app" entry.');
  }
  if (errors.length > 0) failWith(errors);

  // Strip the helper fields (those starting with an underscore) before writing.
  const clean = (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith('_')));

  const manifest = {
    schema: SCHEMA,
    generated,
    minAppVersion,
    packs: packs.map(clean),
    ...(dailyVerses !== null ? { dailyVerses: clean(dailyVerses) } : {}),
    ...(app !== null ? { app: clean(app) } : {}),
  };

  // ---- Write, then sign the bytes that are really on disk ----
  const manifestFile = path.join(outDir, 'manifest.json');
  const signatureFile = `${manifestFile}.sig`;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  const manifestBytes = fs.readFileSync(manifestFile);
  if (manifestBytes.length > MAX_MANIFEST_BYTES) {
    fs.rmSync(manifestFile, { force: true });
    die(`manifest.json is ${manifestBytes.length} bytes; the app refuses anything over ${MAX_MANIFEST_BYTES}.`);
  }
  const signature = crypto.sign(null, manifestBytes, privateKey);
  fs.writeFileSync(signatureFile, `${signature.toString('hex')}\n`);

  // ---- Check it the way the app will ----
  const checkErrors = [];
  const reread = fs.readFileSync(manifestFile);
  const signatureHex = fs.readFileSync(signatureFile, 'utf8').trim();
  if (!/^[0-9a-f]{128}$/.test(signatureHex)) checkErrors.push('check: the signature file is not 128 hex characters.');
  const verified = crypto.verify(
    null,
    reread,
    crypto.createPublicKey(privateKey),
    Buffer.from(signatureHex, 'hex'),
  );
  if (!verified) checkErrors.push('check: the signature does not verify.');
  checkLikeTheApp(JSON.parse(reread.toString('utf8')), outDir, checkErrors);
  if (checkErrors.length > 0) failWith(checkErrors);

  report({ outDir, manifest, packs, dailyVerses, app, appJson, publicKey, warnings, baseUrl });
}

function failWith(errors) {
  die(`Nothing was released. Fix this and run again:\n${errors.map((line) => `  - ${line}`).join('\n')}`);
}

function report({ outDir, manifest, packs, dailyVerses, app, appJson, publicKey, warnings, baseUrl }) {
  console.log(`\nSigned ${path.join(outDir, 'manifest.json')}`);
  console.log(`  generated ${manifest.generated}, minAppVersion ${manifest.minAppVersion}`);
  console.log(`  public key ${publicKey.slice(0, 16)}...  (matches the one in config.ts)`);

  console.log('\nListed in the manifest');
  for (const pack of packs) {
    const kind = pack.bundled ? 'bundled' : 'download';
    console.log(`  pack   ${pack.id.padEnd(10)} v${pack.version}  ${formatBytes(pack.size).padStart(9)}  ${kind}  ${pack._name ?? ''}`);
  }
  if (dailyVerses) console.log(`  daily verses v${dailyVerses.version}`);
  if (app) {
    console.log(`  app    ${app.latest}  ${formatBytes(app._size)}   (versionCode in app.json is ${String(appJson.versionCode)}; it must be higher than the last release)`);
  }

  console.log('\nUpload ALL of these to the release (files are named by version, so old releases keep working):');
  const names = [
    ...packs.map((p) => p._file),
    ...(dailyVerses ? [dailyVerses._file] : []),
    ...(app ? [app._file] : []),
    'manifest.json',
    'manifest.json.sig',
  ];
  for (const name of names) console.log(`  ${path.join(outDir, name)}`);

  console.log(`\nThey will be served from ${baseUrl}/`);
  console.log(`The app looks for the manifest at: ${appJson.manifestUrl || '(extra.manifestUrl is empty in app.json)'}`);
  console.log('Upload manifest.json and manifest.json.sig LAST, so nobody sees a manifest before its files exist.');

  if (warnings.length > 0) {
    console.log('\nNotes');
    for (const line of warnings) console.log(`  - ${line}`);
  }
  console.log('');
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (options.help === true || command === null) {
    console.log(HELP);
    process.exit(command === null && options.help !== true ? 1 : 0);
  }

  switch (command) {
    case 'keygen':
      keygen(options);
      break;
    case 'public-key':
      printPublicKey(options);
      break;
    case 'build':
      build(options);
      break;
    default:
      die(`Unknown command "${command}". Use keygen, public-key or build. Run with --help.`);
  }
}

main();
