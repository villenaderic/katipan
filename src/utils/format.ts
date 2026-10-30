import { READER } from '../constants/config';
import type { LangCode, VerseId } from '../types';
import { formatReference, parseVerseId } from './reference';

/**
 * Small formatting helpers shared by the UI and the services: file sizes,
 * numbers, font and line-height limits, search snippets with highlighted
 * words, "John 3:16, 18-20" labels for a selection, share text, and version
 * comparison for the app update check.
 *
 * Pure functions only. No database, no React, no Intl (Intl differs between
 * Android versions and Hermes builds, so everything is written out).
 */

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** 1234567 -> "1,234,567". Whole numbers only; decimals are dropped. */
export function formatCount(value: number): string {
  const whole = Math.trunc(Math.abs(value));
  const digits = String(whole);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return value < 0 && whole > 0 ? `-${out}` : out;
}

/** 0.456 -> "46%". Input is a fraction from 0 to 1; anything else is clamped. */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%';
  return `${Math.round(clamp(fraction, 0, 1) * 100)}%`;
}

/* ------------------------------------------------------------------ */
/* File sizes                                                          */
/* ------------------------------------------------------------------ */

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/**
 * Size for the Translation Manager and the update banner, using the same
 * 1024 base as the 10 MB confirm limit in config.
 *   512 -> "512 B", 20480 -> "20 KB", 4800000 -> "4.6 MB", 3e9 -> "2.79 GB"
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  if (bytes < GB) return `${trimZero((bytes / MB).toFixed(1))} MB`;
  return `${trimZero((bytes / GB).toFixed(2))} GB`;
}

/** "4.0" -> "4", "4.6" stays. */
function trimZero(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/* ------------------------------------------------------------------ */
/* Reader settings limits                                              */
/* ------------------------------------------------------------------ */

/** Snap to the allowed reader sizes: 14 to 30 in steps of 2. */
export function snapFontSize(value: number): number {
  if (!Number.isFinite(value)) return READER.defaultFont;
  const clamped = clamp(value, READER.minFont, READER.maxFont);
  const steps = Math.round((clamped - READER.minFont) / READER.fontStep);
  return clamp(READER.minFont + steps * READER.fontStep, READER.minFont, READER.maxFont);
}

/** Snap to one decimal between 1.3 and 1.9. */
export function snapLineHeight(value: number): number {
  if (!Number.isFinite(value)) return READER.defaultLineHeight;
  const clamped = clamp(value, READER.minLineHeight, READER.maxLineHeight);
  return clamp(Math.round(clamped * 10) / 10, READER.minLineHeight, READER.maxLineHeight);
}

/** 1.5 -> "1.5". Always one decimal, so the settings sheet does not jump. */
export function formatLineHeight(value: number): string {
  return snapLineHeight(value).toFixed(1);
}

/* ------------------------------------------------------------------ */
/* Verse text                                                          */
/* ------------------------------------------------------------------ */

/**
 * Safety net for verse text. The pack builder should already deliver clean
 * text, but a pack from outside may carry markup or odd spacing: remove any
 * <tags> and collapse every run of whitespace into one space.
 */
export function cleanVerseText(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** Cut to at most `maxLength` characters on a word boundary, adding "…". */
export function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  const room = Math.max(1, maxLength - 1);
  const cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > room * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,;:.\-]+$/, '')}…`;
}

/* ------------------------------------------------------------------ */
/* Search terms: matching and snippets                                 */
/* ------------------------------------------------------------------ */

/**
 * Lowercase and remove accents one character at a time, so the result has
 * exactly the same length as the input and match positions in the folded
 * text are valid positions in the original. "Diyós" folds to "diyos", which
 * is how the FTS5 index (remove_diacritics) matches it.
 */
function foldText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    const base = char.normalize('NFD').charAt(0);
    const lower = base.toLowerCase();
    out += lower.length === 1 ? lower : base;
  }
  return out;
}

export interface TextSegment {
  text: string;
  match: boolean;
}

interface Range {
  start: number;
  end: number;
}

/** Every place any term appears, ignoring case and accents, merged and sorted. */
function findMatchRanges(text: string, terms: readonly string[]): Range[] {
  const folded = foldText(text);
  const ranges: Range[] = [];

  for (const term of terms) {
    const needle = foldText(term.trim());
    if (needle.length === 0) continue;
    let from = 0;
    while (from <= folded.length - needle.length) {
      const at = folded.indexOf(needle, from);
      if (at === -1) break;
      ranges.push({ start: at, end: at + needle.length });
      from = at + needle.length;
    }
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

/**
 * Split text into pieces so the search screen can draw matched words in bold
 * or in the accent color. Always returns at least one segment; joining the
 * segments gives back the original text.
 */
export function splitByTerms(text: string, terms: readonly string[]): TextSegment[] {
  if (text.length === 0) return [];
  const ranges = findMatchRanges(text, terms);
  if (ranges.length === 0) return [{ text, match: false }];

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), match: false });
    segments.push({ text: text.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/**
 * A short piece of a long verse around the first search match, for the
 * "short context" line in search results. A short verse is returned whole.
 */
export function makeSnippet(text: string, terms: readonly string[], maxLength = 140): string {
  const clean = cleanVerseText(text);
  if (clean.length <= maxLength) return clean;

  const first = findMatchRanges(clean, terms)[0];
  if (!first) return truncate(clean, maxLength);

  // Start a little before the match so the word has some context.
  let start = Math.max(0, first.start - Math.floor(maxLength / 3));
  if (start > 0) {
    const space = clean.indexOf(' ', start);
    if (space !== -1 && space < first.start) start = space + 1;
  }

  let end = Math.min(clean.length, start + maxLength);
  if (end < clean.length) {
    const space = clean.lastIndexOf(' ', end);
    if (space > first.end) end = space;
  }

  const body = clean.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${body}${end < clean.length ? '…' : ''}`;
}

/* ------------------------------------------------------------------ */
/* Selections and sharing                                              */
/* ------------------------------------------------------------------ */

interface VerseRun {
  book: number;
  chapter: number;
  start: number;
  end: number;
}

/** Group sorted verse ids into runs of consecutive verses in one chapter. */
function toRuns(ids: readonly VerseId[]): VerseRun[] {
  const sorted = Array.from(new Set(ids)).sort((a, b) => a - b);
  const runs: VerseRun[] = [];

  for (const id of sorted) {
    const ref = parseVerseId(id);
    const last = runs[runs.length - 1];
    if (last && last.book === ref.book && last.chapter === ref.chapter && ref.verse === last.end + 1) {
      last.end = ref.verse;
    } else {
      runs.push({ book: ref.book, chapter: ref.chapter, start: ref.verse, end: ref.verse });
    }
  }
  return runs;
}

/**
 * One label for a selection of verses, the way a person would write it:
 *   [43003016]                      -> "John 3:16"
 *   [43003016, 43003018, 43003019]  -> "John 3:16, 18-19"
 *   [43003016, 43004001]            -> "John 3:16; 4:1"
 *   [43003016, 45008028]            -> "John 3:16; Romans 8:28"
 * Returns "" for an empty selection.
 */
export function formatVerseSelection(ids: readonly VerseId[], lang: LangCode, short = false): string {
  const runs = toRuns(ids);
  let out = '';

  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    if (!run) continue;
    const prev = i > 0 ? runs[i - 1] : undefined;
    const span = run.end > run.start ? `${run.start}-${run.end}` : String(run.start);

    if (!prev) {
      out = formatReference(
        { book: run.book, chapter: run.chapter, verse: run.start, verseEnd: run.end },
        lang,
        short,
      );
    } else if (prev.book === run.book && prev.chapter === run.chapter) {
      out += `, ${span}`;
    } else if (prev.book === run.book) {
      out += `; ${run.chapter}:${span}`;
    } else {
      out += `; ${formatReference(
        { book: run.book, chapter: run.chapter, verse: run.start, verseEnd: run.end },
        lang,
        short,
      )}`;
    }
  }
  return out;
}

export interface ShareVerse {
  id: VerseId;
  text: string;
}

/**
 * Plain text for Copy and Share:
 *
 *   “For God so loved the world…”
 *   John 3:16 (WEB)
 *
 * With more than one verse, each line starts with its verse number. Verses
 * are sorted by id first, so the order of selection does not matter.
 */
export function buildShareText(
  verses: readonly ShareVerse[],
  translationLabel: string,
  lang: LangCode,
): string {
  if (verses.length === 0) return '';

  const sorted = [...verses].sort((a, b) => a.id - b.id);
  const body =
    sorted.length === 1
      ? cleanVerseText(sorted[0]?.text ?? '')
      : sorted.map((v) => `${parseVerseId(v.id).verse} ${cleanVerseText(v.text)}`).join('\n');

  const label = formatVerseSelection(
    sorted.map((v) => v.id),
    lang,
  );
  const source = translationLabel.length > 0 ? ` (${translationLabel})` : '';
  return `“${body}”\n${label}${source}`;
}

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

function versionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    ?.split('.')
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }) ?? [0];
}

/**
 * Compare app versions like "1.0.1" and "1.10.0" number by number.
 * Returns -1 if a is older, 1 if a is newer, 0 if equal. A leading "v" and a
 * "-beta" tail are ignored; missing parts count as 0 ("1.0" equals "1.0.0").
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** True when `latest` is a newer version than `installed`. */
export function isNewerVersion(latest: string, installed: string): boolean {
  return compareVersions(latest, installed) === 1;
}
