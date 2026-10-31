#!/usr/bin/env node
'use strict';

/**
 * generate-daily-verses.js: turn a plain text list of 366 verses into
 * assets/data/daily-verses.json, the calendar behind "verse of the day".
 * Runs on YOUR computer, never inside the app. Needs Node.js 22.5 or newer.
 *
 * WHY A TEXT LIST
 *   The curated list is a text file a person can read and edit: one verse per
 *   line, in calendar order, in either English or Filipino book names.
 *
 *       John 3:16
 *       Salmo 23:1
 *       1 Cor 13:4        # a note after # is ignored
 *
 *   Line 1 is day 1 of the 366-day calendar (the app's dailyVerseIndex), and
 *   line 366 is the last. Leap-year day 366 is real, so the list is always 366.
 *   Only single verses are allowed (the app shows one verse), no ranges.
 *   The list holds references, never text, so it works for every translation.
 *
 * COMMANDS
 *
 *   node tools/generate-daily-verses.js export
 *       Write the current assets/data/daily-verses.json as a text list
 *       (tools/daily-verses.txt) so you can edit it. Start here.
 *
 *   node tools/generate-daily-verses.js build
 *       Read tools/daily-verses.txt, check it, write assets/data/daily-verses.json.
 *       The version number goes up by one by itself when the list changed, and
 *       stays the same when it did not. Raise it yourself with --version.
 *
 * WHAT IS CHECKED
 *   - exactly 366 lines; every book name known; chapter inside the book
 *   - no verse used twice (a repeat in a year is almost always a typo)
 *   - every verse exists in every pack in assets/data/*.db (the app falls back
 *     to another translation when one lacks a verse, but the person should
 *     see the verse they were promised, in the translation they chose)
 *
 * IMPORTANT: moving a line changes which verse everyone sees on that date.
 * Editing is fine; reshuffling the whole list is a visible change. After you
 * change the list, ship it as a content update: tools/build-manifest.js picks
 * up the new version, and the app downloads it. Bump nothing else.
 *
 * Run with --help for every option.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BOOKS_SOURCE = path.join(ROOT, 'src', 'constants', 'books.ts');
const DEFAULT_LIST = path.join(ROOT, 'tools', 'daily-verses.txt');
const DEFAULT_JSON = path.join(ROOT, 'assets', 'data', 'daily-verses.json');
const DEFAULT_PACKS = path.join(ROOT, 'assets', 'data');

/** Same as DAILY_VERSE_COUNT in src/constants/config.ts. */
const DAILY_VERSE_COUNT = 366;

/** Psalm 119:176 is the highest verse number in the Bible. */
const MAX_VERSE_NUMBER = 176;

const HELP = `
Usage: node tools/generate-daily-verses.js <command> [options]

Commands
  export    Write the current daily-verses.json as an editable text list.
  build     Check the text list and write daily-verses.json.

Options
  --list <file>      The text list. Default: tools/daily-verses.txt
  --json <file>      The JSON file. Default: assets/data/daily-verses.json
  --names <en|fil>   export only: book names to write. Default: en
  --version <n>      build only: set the version yourself (whole number, 1 or more).
                     Default: the current version, plus 1 if the list changed.
  --packs <paths>    build only: comma separated folders or .db files to check the
                     verses against. Default: assets/data
  --no-pack-check    build only: skip the check against the packs.
  --force            export only: overwrite an existing list file.
  --help             Show this help.
`;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function die(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

const FLAGS = ['help', 'force', 'no-pack-check'];

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

function openSqlite() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    die(`Node.js 22.5 or newer is needed (this is ${process.versions.node}). Install the current LTS from https://nodejs.org.`);
  }
  return require('node:sqlite');
}

/* ------------------------------------------------------------------ */
/* Book names (the same code as build-bible-db.js: one list to maintain) */
/* ------------------------------------------------------------------ */

/** Lowercase, no accents, letters and digits only. "1 Corinthians" -> "1corinthians". */
function normalizeKey(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** "I Kings" and "II Samuel" -> "1 Kings", "2 Samuel". Only when a space follows the numeral. */
function romanPrefixToDigits(value) {
  return String(value).replace(/^\s*(iii|ii|i)\.?\s+(?=[A-Za-z])/i, (_, roman) => {
    return `${roman.length} `;
  });
}

/* ------------------------------------------------------------------ */
/* Books: read src/constants/books.ts                                  */
/* ------------------------------------------------------------------ */

function unquote(text) {
  return text.replace(/\\(.)/g, '$1');
}

function loadBooks() {
  let source;
  try {
    source = fs.readFileSync(BOOKS_SOURCE, 'utf8');
  } catch {
    die(`Cannot read ${BOOKS_SOURCE}. Run this tool from the project, with src/constants/books.ts in place.`);
  }

  const q = `'((?:[^'\\\\]|\\\\.)*)'`;
  const group = `\\[\\s*${q}\\s*,\\s*${q}\\s*,\\s*\\[([^\\]]*)\\]\\s*\\]`;
  const pattern = new RegExp(
    `\\bb\\(\\s*(\\d+)\\s*,\\s*'([^']+)'\\s*,\\s*(\\d+)\\s*,\\s*'(OT|NT)'\\s*,\\s*${group}\\s*,\\s*${group}\\s*,?\\s*\\)`,
    'g',
  );

  const aliasList = (text) => [...text.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => unquote(m[1]));

  const books = [];
  for (const m of source.matchAll(pattern)) {
    books.push({
      id: Number(m[1]),
      osis: m[2],
      chapters: Number(m[3]),
      testament: m[4],
      names: {
        en: { name: unquote(m[5]), short: unquote(m[6]), aliases: aliasList(m[7]) },
        fil: { name: unquote(m[8]), short: unquote(m[9]), aliases: aliasList(m[10]) },
      },
    });
  }

  books.sort((a, b) => a.id - b.id);
  const ok = books.length === 66 && books.every((book, index) => book.id === index + 1);
  if (!ok) {
    die(`Found ${books.length} books in src/constants/books.ts, expected 66 in order. The b(...) lines may have changed shape; update loadBooks() in this tool.`);
  }
  return books;
}

/** A function that turns a book name from the source into a book id (1..66), or null. */
function makeResolver(books) {
  const strong = new Map();
  const weak = new Map();
  const ambiguous = new Set();

  const addStrong = (key, id) => {
    const k = normalizeKey(key);
    if (k && !strong.has(k)) strong.set(k, id);
  };
  const addWeak = (key, id) => {
    const k = normalizeKey(key);
    if (!k) return;
    const existing = weak.get(k);
    if (existing !== undefined && existing !== id) ambiguous.add(k);
    else weak.set(k, id);
  };

  for (const book of books) {
    addStrong(book.osis, book.id);
    for (const lang of ['en', 'fil']) {
      addStrong(book.names[lang].name, book.id);
      addStrong(book.names[lang].short, book.id);
    }
  }
  for (const book of books) {
    for (const lang of ['en', 'fil']) {
      for (const alias of book.names[lang].aliases) addWeak(alias, book.id);
    }
  }

  const extras = {
    revelations: 66,
    revelationofjohn: 66,
    revelationofstjohn: 66,
    actsoftheapostles: 44,
    songofsongs: 22,
    canticles: 22,
    psalm: 19,
    psalms: 19,
    qoheleth: 21,
  };
  for (const [key, id] of Object.entries(extras)) addWeak(key, id);

  return (raw) => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'number') return raw >= 1 && raw <= 66 ? raw : null;

    const text = romanPrefixToDigits(String(raw)).trim();
    if (/^\d+$/.test(text)) {
      const n = Number(text);
      return n >= 1 && n <= 66 ? n : null;
    }
    const key = normalizeKey(text);
    if (strong.has(key)) return strong.get(key);
    if (ambiguous.has(key)) return null;
    return weak.has(key) ? weak.get(key) : null;
  };
}

/* ------------------------------------------------------------------ */
/* Verse ids                                                           */
/* ------------------------------------------------------------------ */

const toId = (book, chapter, verse) => book * 1000000 + chapter * 1000 + verse;

function describeId(id) {
  return { book: Math.floor(id / 1000000), chapter: Math.floor(id / 1000) % 1000, verse: id % 1000 };
}

function isValidId(value) {
  if (!Number.isInteger(value) || value < 1000001) return false;
  const { book, chapter, verse } = describeId(value);
  return book >= 1 && book <= 66 && chapter >= 1 && verse >= 1;
}

/* ------------------------------------------------------------------ */
/* Reading and writing the files                                       */
/* ------------------------------------------------------------------ */

function readCurrentJson(file) {
  if (!fs.existsSync(file)) return null;
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    die(`${file} is not valid JSON: ${error.message}`);
  }
  const ok =
    json !== null &&
    typeof json === 'object' &&
    Number.isInteger(json.version) &&
    json.version >= 1 &&
    Array.isArray(json.verses);
  if (!ok) die(`${file} is not shaped like { "version": 1, "verses": [ ... ] }.`);
  return json;
}

const LIST_HEADER = [
  '# Katipan daily verses: one verse per line, in calendar order (366 lines).',
  '# Line 1 is day 1 of the 366-day calendar; line 366 is the last.',
  '# English or Filipino book names both work. Single verses only, no ranges.',
  '# Text after # on a line is ignored. Build with: node tools/generate-daily-verses.js build',
  '',
];

function exportList(options) {
  const jsonFile = path.resolve(options.json ?? DEFAULT_JSON);
  const listFile = path.resolve(options.list ?? DEFAULT_LIST);
  const lang = options.names ?? 'en';
  if (lang !== 'en' && lang !== 'fil') die('--names must be en or fil.');

  const current = readCurrentJson(jsonFile);
  if (current === null) die(`Nothing to export: ${jsonFile} does not exist.`);
  if (fs.existsSync(listFile) && options.force !== true) {
    die(`${listFile} already exists. Use --force to overwrite it (your edits there would be lost).`);
  }

  const books = loadBooks();
  const lines = [];
  current.verses.forEach((id, index) => {
    if (!isValidId(id)) die(`${jsonFile}: entry #${index + 1} (${String(id)}) is not a valid verse id.`);
    const { book, chapter, verse } = describeId(id);
    lines.push(`${books[book - 1].names[lang].name} ${chapter}:${verse}`);
  });

  fs.mkdirSync(path.dirname(listFile), { recursive: true });
  fs.writeFileSync(listFile, `${[...LIST_HEADER, ...lines].join('\n')}\n`);
  console.log(`\nWrote ${lines.length} verses to ${listFile}`);
  console.log('Edit it, then run: node tools/generate-daily-verses.js build\n');
}

/** Returns { ids, problems } for the list text. Never exits; the caller decides. */
function parseList(text, resolve, books) {
  const ids = [];
  const problems = [];
  const firstSeen = new Map();

  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '').trim();
    if (line === '') return;
    const where = `line ${index + 1}`;

    const match = /^(.+?)\s+(\d+)\s*[:.]\s*(\d+)$/.exec(line);
    if (!match) {
      problems.push(
        /\d\s*[-–,]\s*\d/.test(line)
          ? `${where}: "${line}" looks like a range or a list. Use a single verse.`
          : `${where}: "${line}" is not like "John 3:16".`,
      );
      return;
    }

    const book = resolve(match[1]);
    const chapter = Number(match[2]);
    const verse = Number(match[3]);
    if (book === null) {
      problems.push(`${where}: unknown book "${match[1]}".`);
      return;
    }
    const def = books[book - 1];
    if (chapter < 1 || chapter > def.chapters) {
      problems.push(`${where}: ${def.names.en.name} has ${def.chapters} chapters, not ${chapter}.`);
      return;
    }
    if (verse < 1 || verse > MAX_VERSE_NUMBER) {
      problems.push(`${where}: verse number ${verse} is out of range.`);
      return;
    }

    const id = toId(book, chapter, verse);
    if (firstSeen.has(id)) {
      problems.push(`${where}: ${def.names.en.name} ${chapter}:${verse} is already on ${firstSeen.get(id)}.`);
      return;
    }
    firstSeen.set(id, where);
    ids.push(id);
  });

  return { ids, problems };
}

/* ------------------------------------------------------------------ */
/* Checking against the packs                                          */
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

/** Returns lines like "web: John 3:16 is missing". Opens each pack read-only by copying it first. */
function checkAgainstPacks(ids, files, books) {
  const { DatabaseSync } = openSqlite();
  const os = require('node:os');
  const missing = [];

  for (const file of files) {
    const label = path.basename(file);
    const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'katipan-dv-')), label);
    fs.copyFileSync(file, copy);

    let db;
    try {
      db = new DatabaseSync(copy);
      const find = db.prepare('SELECT 1 AS found FROM verses WHERE id = ?');
      for (const id of ids) {
        if (find.get(id) === undefined) {
          const { book, chapter, verse } = describeId(id);
          missing.push(`${label}: ${books[book - 1].names.en.name} ${chapter}:${verse} is not in this pack.`);
        }
      }
    } catch (error) {
      missing.push(`${label}: cannot be read (${error.message}).`);
    } finally {
      if (db) db.close();
      fs.rmSync(path.dirname(copy), { recursive: true, force: true });
    }
  }
  return missing;
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

function build(options) {
  const listFile = path.resolve(options.list ?? DEFAULT_LIST);
  const jsonFile = path.resolve(options.json ?? DEFAULT_JSON);

  if (!fs.existsSync(listFile)) {
    die(`${listFile} does not exist. Run "node tools/generate-daily-verses.js export" to make it from the current list.`);
  }

  const books = loadBooks();
  const resolve = makeResolver(books);
  const { ids, problems } = parseList(fs.readFileSync(listFile, 'utf8'), resolve, books);

  if (problems.length === 0 && ids.length !== DAILY_VERSE_COUNT) {
    problems.push(`The list has ${ids.length} verses; it must have exactly ${DAILY_VERSE_COUNT}.`);
  }

  if (problems.length === 0 && options['no-pack-check'] !== true) {
    const packs = collectPackFiles(options.packs ?? DEFAULT_PACKS);
    if (packs.length === 0) {
      console.log('\nNote: no .db packs found, so the verses were not checked against any translation.');
    } else {
      problems.push(...checkAgainstPacks(ids, packs, books));
    }
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, 25).map((line) => `  - ${line}`).join('\n');
    const more = problems.length > 25 ? `\n  ... and ${problems.length - 25} more` : '';
    die(`Nothing was written. Fix this and run again:\n${shown}${more}`);
  }

  // ---- Version ----
  const current = readCurrentJson(jsonFile);
  const sameList =
    current !== null &&
    current.verses.length === ids.length &&
    current.verses.every((id, index) => id === ids[index]);

  let version;
  if (options.version !== undefined) {
    version = Number(options.version);
    if (!Number.isInteger(version) || version < 1) die('--version must be a whole number of 1 or more.');
    if (current !== null && version < current.version) {
      die(`--version ${version} is lower than the current ${current.version}. Apps only accept a newer list.`);
    }
  } else if (current === null) {
    version = 1;
  } else {
    version = sameList ? current.version : current.version + 1;
  }

  // ---- Write ----
  if (sameList && version === current.version) {
    console.log(`\nNo change: ${jsonFile} already matches the list (version ${version}).\n`);
    return;
  }

  // Same layout as the file already in the project: 6 numbers per line.
  const rows = [];
  for (let i = 0; i < ids.length; i += 6) rows.push(`    ${ids.slice(i, i + 6).join(', ')}`);
  const text = `{\n  "version": ${version},\n  "verses": [\n${rows.join(',\n')}\n  ]\n}\n`;

  // Parse it back before it replaces anything.
  const back = JSON.parse(text);
  if (back.verses.length !== DAILY_VERSE_COUNT || back.verses.some((id, i) => id !== ids[i])) {
    die('Internal check failed: the JSON does not match the list. Nothing was written.');
  }

  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  const temp = `${jsonFile}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, jsonFile);

  const old = current === null ? 'new file' : `was version ${current.version}`;
  console.log(`\nWrote ${jsonFile}`);
  console.log(`  version ${version} (${old}), ${ids.length} verses, all different`);
  console.log('\nNext: build the release with tools/build-manifest.js. The new list reaches users as a content update.\n');
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
    case 'export':
      exportList(options);
      break;
    case 'build':
      build(options);
      break;
    default:
      die(`Unknown command "${command}". Use export or build. Run with --help.`);
  }
}

main();
