#!/usr/bin/env node
'use strict';

/**
 * build-bible-db.js: turn a Bible text file into a Katipan Bible pack.
 * Runs on YOUR computer, never inside the app. Needs Node.js 22.5 or newer
 * (it uses Node's built-in SQLite, so there is nothing to npm install).
 *
 *   node tools/build-bible-db.js \
 *     --in  sources/web.json \
 *     --out assets/data/web.db \
 *     --id web --name "World English Bible" --language en --version 1 \
 *     --license "Public domain" --source-url "https://ebible.org/web/"
 *
 * The pack layout is exactly BIBLE_PACK_DDL in src/db/schema.ts:
 *   meta, books, verses (id = book*1000000 + chapter*1000 + verse),
 *   idx_verses_ref, and verses_fts (FTS5, unicode61 remove_diacritics 2).
 *
 * INPUT FORMATS (chosen by the file extension)
 *
 *   .tsv / .txt  One verse per line, tab separated. Either
 *                  <book> TAB <chapter> TAB <verse> TAB <text>
 *                or
 *                  <book chapter:verse> TAB <text>      ("John 3:16<TAB>For God...")
 *                Blank lines and lines starting with # are ignored.
 *
 *   .json        Any of these shapes:
 *                  [ { "book": "Gen", "chapter": 1, "verse": 1, "text": "..." }, ... ]
 *                  { "books": [ { "name": "Genesis", "chapters": [
 *                        { "chapter": 1, "verses": [ { "verse": 1, "text": "..." } ] } ] } ] }
 *                  [ { "abbrev": "gn", "chapters": [ ["verse 1 text", "verse 2 text"], ... ] } ]
 *                    (chapters as lists of plain strings; verse numbers are the positions)
 *                Chapters and verses may also be objects keyed by number.
 *
 * BOOK NAMES in the input are matched against the OSIS id, the English and
 * Filipino names, short names and abbreviations from src/constants/books.ts
 * (read directly, so there is one list to maintain), plus the numbers 1 to 66.
 * If a file has exactly 66 books and a name cannot be matched, the position
 * in the file is used (canon order).
 *
 * LICENSING RULE (master prompt, Section 7): --license and --source-url are
 * required and are written into the pack. Use only public-domain or
 * explicitly open-licensed texts. Never scrape copyrighted text.
 *
 * Run with --help for every option.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BOOKS_SOURCE = path.join(ROOT, 'src', 'constants', 'books.ts');

/** Same text as BIBLE_PACK_DDL in src/db/schema.ts. Keep the two in step. */
const PACK_DDL = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE books (
    id        INTEGER PRIMARY KEY,
    osis      TEXT    NOT NULL,
    name      TEXT    NOT NULL,
    short     TEXT    NOT NULL,
    chapters  INTEGER NOT NULL,
    testament TEXT    NOT NULL CHECK (testament IN ('OT','NT'))
  )`,
  `CREATE TABLE verses (
    id      INTEGER PRIMARY KEY,
    book    INTEGER NOT NULL,
    chapter INTEGER NOT NULL,
    verse   INTEGER NOT NULL,
    text    TEXT    NOT NULL
  )`,
  `CREATE INDEX idx_verses_ref ON verses (book, chapter, verse)`,
  `CREATE VIRTUAL TABLE verses_fts USING fts5(
    text,
    content='verses',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  )`,
];

const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The verse count of the standard Protestant 66-book canon, for the report only. */
const STANDARD_VERSE_COUNT = 31102;

const HELP = `
Usage: node tools/build-bible-db.js --in <file> --id <id> --name <name> --language <code>
         --license <text> --source-url <url> [options]

Required
  --in <file>           Source text (.tsv, .txt or .json). See the top of this file.
  --id <id>             Pack id, lowercase letters, digits, - and _ (for example web, adb1905).
  --name <text>         Display name, for example "World English Bible".
  --language <code>     en, fil, ilo, ceb, ibg, es ... (matches constants/languages.ts).
  --license <text>      For example "Public domain". Written into the pack.
  --source-url <url>    Where the text came from. Written into the pack.

Options
  --out <file>          Output file. Default: assets/data/<id>.db
  --version <number>    Pack version, a whole number, raise it for every new build. Default: 1
  --canon <text>        Default: protestant-66
  --book-names <en|fil> Language of the book names stored in the pack.
                        Default: fil when --language is fil, otherwise en.
  --allow-partial       Accept a text that lacks some books or chapters (for example a
                        New Testament only pack). Without it, all 66 books are required.
  --keep-markup         Do not remove <tags> from verse text.
  --help                Show this help.
`;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function die(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) die(`Unexpected argument "${arg}". Run with --help.`);
    const key = arg.slice(2);
    const flag = ['help', 'allow-partial', 'keep-markup'].includes(key);
    if (flag) {
      options[key] = true;
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) die(`Option --${key} needs a value.`);
      options[key] = value;
      i += 1;
    }
  }
  return options;
}

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

function sha256OfFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
/* Reading the source                                                  */
/* ------------------------------------------------------------------ */

/**
 * Every reader returns raw rows: { bookRaw, chapter, verse, text, where }.
 * Book names are resolved afterwards, so unknown names are reported together.
 */

function readTsv(text) {
  const rows = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    const where = `line ${index + 1}`;
    const cells = line.split('\t');

    if (cells.length >= 4 && /^\d+$/.test(cells[1].trim()) && /^\d+$/.test(cells[2].trim())) {
      rows.push({
        bookRaw: cells[0].trim(),
        chapter: Number(cells[1]),
        verse: Number(cells[2]),
        text: cells.slice(3).join('\t'),
        where,
      });
      return;
    }

    if (cells.length >= 2) {
      const match = /^(.+?)\s+(\d+)[:.](\d+)$/.exec(cells[0].trim());
      if (match) {
        rows.push({
          bookRaw: match[1],
          chapter: Number(match[2]),
          verse: Number(match[3]),
          text: cells.slice(1).join('\t'),
          where,
        });
        return;
      }
    }

    die(`Cannot read ${where}: expected "book<TAB>chapter<TAB>verse<TAB>text" or "Book 1:1<TAB>text".`);
  });

  return rows;
}

const pick = (object, names) => {
  for (const name of names) {
    if (object[name] !== undefined && object[name] !== null) return object[name];
  }
  return undefined;
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Verses of one chapter: array of strings or objects, or an object keyed by verse number. */
function readVerseList(container, bookRaw, chapter, where, rows) {
  if (Array.isArray(container)) {
    container.forEach((entry, index) => {
      if (typeof entry === 'string') {
        rows.push({ bookRaw, chapter, verse: index + 1, text: entry, where });
      } else if (isPlainObject(entry)) {
        const verse = Number(pick(entry, ['verse', 'Verse', 'number', 'v']) ?? index + 1);
        const text = pick(entry, ['text', 'Text', 'content', 't']);
        rows.push({ bookRaw, chapter, verse, text: text ?? '', where });
      }
    });
  } else if (isPlainObject(container)) {
    for (const [key, value] of Object.entries(container)) {
      if (/^\d+$/.test(key) && typeof value === 'string') {
        rows.push({ bookRaw, chapter, verse: Number(key), text: value, where });
      }
    }
  }
}

function readJson(text, books) {
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    die(`The JSON file is not valid JSON: ${error.message}`);
  }

  const rows = [];

  // Flat list of verses.
  const flat = Array.isArray(data) ? data : isPlainObject(data) && Array.isArray(data.verses) ? data.verses : null;
  if (flat && flat.length > 0 && isPlainObject(flat[0]) && pick(flat[0], ['text', 'Text']) !== undefined) {
    flat.forEach((entry, index) => {
      rows.push({
        bookRaw: pick(entry, ['book', 'Book', 'book_name', 'osis', 'abbrev']),
        chapter: Number(pick(entry, ['chapter', 'Chapter', 'c'])),
        verse: Number(pick(entry, ['verse', 'Verse', 'v'])),
        text: pick(entry, ['text', 'Text']),
        where: `item ${index + 1}`,
      });
    });
    return rows;
  }

  // Books containing chapters containing verses.
  const bookList = Array.isArray(data) ? data : isPlainObject(data) ? pick(data, ['books', 'Books']) : undefined;
  if (!Array.isArray(bookList)) {
    die('The JSON file has an unknown shape. See the INPUT FORMATS list at the top of tools/build-bible-db.js.');
  }

  bookList.forEach((book, index) => {
    if (!isPlainObject(book)) return;
    const nameRaw = pick(book, ['osis', 'abbrev', 'name', 'book', 'book_name', 'Name', 'title']);
    const bookRaw = nameRaw !== undefined ? nameRaw : bookList.length === 66 ? index + 1 : undefined;
    const where = `book ${index + 1} (${nameRaw ?? 'unnamed'})`;

    // Fall back to the position when the name cannot be matched and the file has 66 books.
    const resolved = books.resolve(bookRaw);
    const useRaw = resolved === null && bookList.length === 66 ? index + 1 : bookRaw;

    const chapters = pick(book, ['chapters', 'Chapters', 'Chapter']);
    if (Array.isArray(chapters)) {
      chapters.forEach((chapterEntry, chapterIndex) => {
        if (Array.isArray(chapterEntry)) {
          readVerseList(chapterEntry, useRaw, chapterIndex + 1, where, rows);
        } else if (isPlainObject(chapterEntry)) {
          const chapter = Number(pick(chapterEntry, ['chapter', 'Chapter', 'number', 'c']) ?? chapterIndex + 1);
          readVerseList(pick(chapterEntry, ['verses', 'Verses', 'Verse']), useRaw, chapter, where, rows);
        }
      });
    } else if (isPlainObject(chapters)) {
      for (const [key, value] of Object.entries(chapters)) {
        if (/^\d+$/.test(key)) readVerseList(value, useRaw, Number(key), where, rows);
      }
    }
  });

  return rows;
}

/* ------------------------------------------------------------------ */
/* Cleaning and checking                                               */
/* ------------------------------------------------------------------ */

function cleanText(raw, keepMarkup) {
  let text = String(raw ?? '');
  if (!keepMarkup) text = text.replace(/<[^>]*>/g, ' ');
  return text
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function referenceLabel(book, chapter, verse) {
  return `${book.names.en.short} ${chapter}:${verse}`;
}

function buildVerses(rows, books, options) {
  const resolve = books.resolve;
  const byId = new Map();
  const unknownBooks = new Map();
  const duplicates = [];
  const badNumbers = [];
  const empty = [];
  let suspicious = 0;

  for (const row of rows) {
    const bookId = resolve(row.bookRaw);
    if (bookId === null) {
      unknownBooks.set(String(row.bookRaw), row.where);
      continue;
    }
    const { chapter, verse } = row;
    if (!Number.isInteger(chapter) || !Number.isInteger(verse) || chapter < 1 || verse < 1 || chapter > 999 || verse > 999) {
      badNumbers.push(`${row.where}: ${row.bookRaw} ${chapter}:${verse}`);
      continue;
    }

    const text = cleanText(row.text, options['keep-markup'] === true);
    if (text === '') {
      empty.push(referenceLabel(books.list[bookId - 1], chapter, verse));
      continue;
    }
    if (/[\\{}]/.test(text)) suspicious += 1;

    const id = bookId * 1_000_000 + chapter * 1_000 + verse;
    const existing = byId.get(id);
    if (existing !== undefined) {
      if (existing.text !== text) duplicates.push(referenceLabel(books.list[bookId - 1], chapter, verse));
      continue;
    }
    byId.set(id, { id, book: bookId, chapter, verse, text });
  }

  if (unknownBooks.size > 0) {
    const sample = [...unknownBooks.entries()].slice(0, 10).map(([name, where]) => `  "${name}" (${where})`);
    die(`These book names are not recognized:\n${sample.join('\n')}\nAdd the spelling as an alias in src/constants/books.ts, or fix the source file.`);
  }
  if (badNumbers.length > 0) {
    die(`Bad chapter or verse numbers:\n${badNumbers.slice(0, 10).map((line) => `  ${line}`).join('\n')}`);
  }
  if (duplicates.length > 0) {
    die(`The same verse appears twice with different text:\n${duplicates.slice(0, 10).map((line) => `  ${line}`).join('\n')}`);
  }

  return { verses: [...byId.values()].sort((a, b) => a.id - b.id), empty, suspicious };
}

/**
 * Structure checks. Errors stop the build; warnings are printed.
 * Verse numbering differs a little between translations, so verse gaps are
 * warnings. A wrong number of chapters, or a missing book, is an error.
 */
function checkStructure(verses, books, allowPartial) {
  const errors = [];
  const warnings = [];

  const perBook = new Map();
  for (const verse of verses) {
    let chapters = perBook.get(verse.book);
    if (!chapters) {
      chapters = new Map();
      perBook.set(verse.book, chapters);
    }
    let list = chapters.get(verse.chapter);
    if (!list) {
      list = [];
      chapters.set(verse.chapter, list);
    }
    list.push(verse.verse);
  }

  const missingBooks = books.list.filter((book) => !perBook.has(book.id));
  if (missingBooks.length > 0 && !allowPartial) {
    errors.push(`Missing ${missingBooks.length} book(s): ${missingBooks.map((b) => b.names.en.short).join(', ')}. Use --allow-partial for a partial text.`);
  }

  for (const book of books.list) {
    const chapters = perBook.get(book.id);
    if (!chapters) continue;

    const numbers = [...chapters.keys()].sort((a, b) => a - b);
    const highest = numbers[numbers.length - 1];
    const gaps = [];
    for (let c = 1; c <= highest; c += 1) if (!chapters.has(c)) gaps.push(c);

    if (!allowPartial && highest !== book.chapters) {
      errors.push(`${book.names.en.name}: the text has ${highest} chapters, the app expects ${book.chapters}.`);
    }
    if (allowPartial && highest > book.chapters) {
      errors.push(`${book.names.en.name}: chapter ${highest} is beyond the ${book.chapters} chapters of this book.`);
    }
    if (gaps.length > 0 && !allowPartial) {
      errors.push(`${book.names.en.name}: no verses for chapter(s) ${gaps.join(', ')}.`);
    }

    for (const chapter of numbers) {
      const list = chapters.get(chapter).sort((a, b) => a - b);
      const missing = [];
      for (let v = 1; v <= list[list.length - 1]; v += 1) if (!list.includes(v)) missing.push(v);
      if (missing.length > 0) {
        warnings.push(`${book.names.en.short} ${chapter}: no verse ${missing.length > 6 ? `${missing.slice(0, 6).join(', ')} ...` : missing.join(', ')}`);
      }
    }
  }

  return { errors, warnings, bookCount: perBook.size };
}

/* ------------------------------------------------------------------ */
/* Writing the database                                                */
/* ------------------------------------------------------------------ */

function openSqlite() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    die(`Node.js 22.5 or newer is needed (this is ${process.versions.node}). Install the current LTS from https://nodejs.org.`);
  }
  // Node prints a one-time "SQLite is an experimental feature" notice; it is harmless.
  return require('node:sqlite');
}

function writePack({ out, meta, books, bookNames, verses }) {
  const { DatabaseSync } = openSqlite();

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const temp = `${out}.building`;
  for (const file of [temp, `${temp}-journal`, `${temp}-wal`, `${temp}-shm`]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  const db = new DatabaseSync(temp);
  try {
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA page_size = 4096');
    for (const statement of PACK_DDL) db.exec(statement);

    db.exec('BEGIN');

    const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(meta)) insertMeta.run(key, String(value));

    const insertBook = db.prepare('INSERT INTO books (id, osis, name, short, chapters, testament) VALUES (?, ?, ?, ?, ?, ?)');
    for (const book of books) {
      insertBook.run(book.id, book.osis, book.names[bookNames].name, book.names[bookNames].short, book.chapters, book.testament);
    }

    const insertVerse = db.prepare('INSERT INTO verses (id, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)');
    for (const verse of verses) insertVerse.run(verse.id, verse.book, verse.chapter, verse.verse, verse.text);

    db.exec('INSERT INTO verses_fts (rowid, text) SELECT id, text FROM verses');
    db.exec("INSERT INTO verses_fts (verses_fts) VALUES ('optimize')");
    db.exec('COMMIT');

    // Smaller file, no free pages.
    db.exec('VACUUM');

    // ---- Check what was written ----
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (!integrity || Object.values(integrity)[0] !== 'ok') {
      throw new Error('SQLite integrity_check failed.');
    }
    db.exec("INSERT INTO verses_fts (verses_fts) VALUES ('integrity-check')");

    const count = db.prepare('SELECT COUNT(*) AS n FROM verses').get().n;
    if (count !== verses.length) throw new Error(`Wrote ${count} verses, expected ${verses.length}.`);

    const sample = verses[0].text.split(/\s+/).find((word) => /^\p{L}{4,}$/u.test(word));
    if (sample) {
      const hits = db.prepare('SELECT COUNT(*) AS n FROM verses_fts WHERE verses_fts MATCH ?').get(`"${sample.replace(/"/g, '')}"`).n;
      if (hits < 1) throw new Error('Full-text search found nothing for a word that is in the text.');
    }
  } catch (error) {
    try {
      db.close();
    } catch {
      // Already closed.
    }
    if (fs.existsSync(temp)) fs.rmSync(temp);
    die(`Could not build the database: ${error.message}`);
  }
  db.close();

  if (fs.existsSync(out)) fs.rmSync(out);
  fs.renameSync(temp, out);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  const required = ['in', 'id', 'name', 'language', 'license', 'source-url'];
  const missing = required.filter((key) => !options[key] || String(options[key]).trim() === '');
  if (missing.length > 0) die(`Missing: ${missing.map((key) => `--${key}`).join(', ')}. Run with --help.`);

  const id = options.id;
  if (!PACK_ID_PATTERN.test(id)) die('--id must be lowercase letters, digits, - or _, up to 32 characters, starting with a letter or digit.');

  const version = options.version === undefined ? 1 : Number(options.version);
  if (!Number.isInteger(version) || version < 1) die('--version must be a whole number, 1 or higher.');

  const language = options.language;
  const bookNames = options['book-names'] ?? (language === 'fil' ? 'fil' : 'en');
  if (!['en', 'fil'].includes(bookNames)) die('--book-names must be en or fil.');

  const input = path.resolve(options.in);
  if (!fs.existsSync(input)) die(`Source file not found: ${input}`);
  const out = path.resolve(options.out ?? path.join(ROOT, 'assets', 'data', `${id}.db`));

  const list = loadBooks();
  const books = { list, resolve: makeResolver(list) };

  // ---- Read ----
  console.log(`Reading ${input}`);
  const text = fs.readFileSync(input, 'utf8');
  const extension = path.extname(input).toLowerCase();
  const rows = extension === '.json' ? readJson(text, books) : readTsv(text);
  if (rows.length === 0) die('No verses were found in the source file.');

  // ---- Check ----
  const { verses, empty, suspicious } = buildVerses(rows, books, options);
  const allowPartial = options['allow-partial'] === true;
  const { errors, warnings, bookCount } = checkStructure(verses, books, allowPartial);

  if (errors.length > 0) {
    die(`The text does not fit the 66-book layout:\n${errors.slice(0, 20).map((line) => `  ${line}`).join('\n')}${errors.length > 20 ? `\n  ... and ${errors.length - 20} more` : ''}`);
  }

  const presentBooks = list.filter((book) => verses.some((verse) => verse.book === book.id));
  const meta = {
    id,
    name: options.name,
    language,
    version,
    canon: options.canon ?? 'protestant-66',
    license: options.license,
    source_url: options['source-url'],
  };

  // ---- Write ----
  writePack({ out, meta, books: allowPartial ? presentBooks : list, bookNames, verses });

  // ---- Report ----
  const bytes = fs.statSync(out).size;
  console.log('');
  console.log(`Built ${out}`);
  console.log(`  id ${id}, version ${version}, language ${language}, book names ${bookNames}`);
  console.log(`  ${verses.length.toLocaleString()} verses in ${bookCount} books (the standard canon has ${STANDARD_VERSE_COUNT.toLocaleString()} verses; translations differ slightly)`);
  console.log(`  ${formatBytes(bytes)}   sha256 ${sha256OfFile(out)}`);

  if (empty.length > 0) {
    console.log(`\nSkipped ${empty.length} verse(s) with no text (normal for verses a translation leaves out): ${empty.slice(0, 8).join(', ')}${empty.length > 8 ? ' ...' : ''}`);
  }
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} verse-number gap(s) (translations number some verses differently; check a few against the printed Bible):`);
    for (const line of warnings.slice(0, 15)) console.log(`  ${line}`);
    if (warnings.length > 15) console.log(`  ... and ${warnings.length - 15} more`);
  }
  if (suspicious > 0) {
    console.log(`\n${suspicious} verse(s) contain { } or \\ characters. If the source has markup, clean it first or check those verses.`);
  }
  if (bytes > 12 * 1024 * 1024) {
    console.log('\nNote: this pack is over 12 MB. The bundled packs must keep the APK under 40 MB.');
  }
  console.log('\nNext: put the file in assets/data/ (bundled packs) or upload it to the release and list it with tools/build-manifest.js.');
}

main();
