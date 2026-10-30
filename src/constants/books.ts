import type { BookDef, LangCode, Testament } from '../types';

/**
 * All 66 books. ids 1..66 follow the Protestant canon order, so
 * verseId = book * 1000000 + chapter * 1000 + verse lines up in every pack.
 *
 * Aliases are pre-normalized: lowercase, no spaces, no dots, digits for
 * numerals. utils/reference.ts normalizes user input the same way and also
 * matches each book's `name` and `short` automatically.
 */
function b(
  id: number,
  osis: string,
  chapters: number,
  testament: Testament,
  en: [name: string, short: string, aliases: string[]],
  fil: [name: string, short: string, aliases: string[]],
): BookDef {
  return {
    id,
    osis,
    chapters,
    testament,
    names: {
      en: { name: en[0], short: en[1], aliases: en[2] },
      fil: { name: fil[0], short: fil[1], aliases: fil[2] },
    },
  };
}

export const BOOKS: readonly BookDef[] = [
  // ---------------- Old Testament ----------------
  b(1, 'Gen', 50, 'OT', ['Genesis', 'Gen', ['ge', 'gn']], ['Genesis', 'Gen', ['ge', 'gn', 'henesis']]),
  b(2, 'Exod', 40, 'OT', ['Exodus', 'Exod', ['ex', 'exo', 'exod']], ['Exodo', 'Exo', ['ex', 'exod', 'exodus']]),
  b(3, 'Lev', 27, 'OT', ['Leviticus', 'Lev', ['le', 'lv']], ['Levitico', 'Lev', ['le', 'lv', 'leviticus']]),
  b(4, 'Num', 36, 'OT', ['Numbers', 'Num', ['nu', 'nm', 'nb']], ['Mga Bilang', 'Bil', ['bilang', 'bi', 'mgabilang', 'num', 'numeros']]),
  b(5, 'Deut', 34, 'OT', ['Deuteronomy', 'Deut', ['de', 'dt', 'deu']], ['Deuteronomio', 'Deut', ['de', 'dt', 'deu', 'deuteronomy']]),
  b(6, 'Josh', 24, 'OT', ['Joshua', 'Josh', ['jos', 'jsh']], ['Josue', 'Jos', ['josh', 'js', 'joshua']]),
  b(7, 'Judg', 21, 'OT', ['Judges', 'Judg', ['jdg', 'jg', 'jdgs']], ['Mga Hukom', 'Huk', ['hukom', 'mgahukom', 'hu', 'judg', 'jdg']]),
  b(8, 'Ruth', 4, 'OT', ['Ruth', 'Ruth', ['ru', 'rth']], ['Ruth', 'Ruth', ['ru', 'rut', 'rth']]),
  b(9, '1Sam', 31, 'OT', ['1 Samuel', '1 Sam', ['1sa', '1sm', '1s', 'isam', 'isamuel']], ['1 Samuel', '1 Sam', ['1sa', '1sm', '1s', 'isam', 'isamuel']]),
  b(10, '2Sam', 24, 'OT', ['2 Samuel', '2 Sam', ['2sa', '2sm', '2s', 'iisam', 'iisamuel']], ['2 Samuel', '2 Sam', ['2sa', '2sm', '2s', 'iisam', 'iisamuel']]),
  b(11, '1Kgs', 22, 'OT', ['1 Kings', '1 Kgs', ['1ki', '1k', '1kin', 'ikings', 'ikgs']], ['1 Mga Hari', '1 Hari', ['1hari', '1mgahari', '1ha', '1hr', 'imgahari', '1ki', '1kgs']]),
  b(12, '2Kgs', 25, 'OT', ['2 Kings', '2 Kgs', ['2ki', '2k', '2kin', 'iikings', 'iikgs']], ['2 Mga Hari', '2 Hari', ['2hari', '2mgahari', '2ha', '2hr', 'iimgahari', '2ki', '2kgs']]),
  b(13, '1Chr', 29, 'OT', ['1 Chronicles', '1 Chr', ['1ch', '1chron', 'ichronicles', 'ichr']], ['1 Mga Cronica', '1 Cron', ['1cronica', '1mgacronica', '1cr', '1cro', 'imgacronica', '1ch', '1chr']]),
  b(14, '2Chr', 36, 'OT', ['2 Chronicles', '2 Chr', ['2ch', '2chron', 'iichronicles', 'iichr']], ['2 Mga Cronica', '2 Cron', ['2cronica', '2mgacronica', '2cr', '2cro', 'iimgacronica', '2ch', '2chr']]),
  b(15, 'Ezra', 10, 'OT', ['Ezra', 'Ezra', ['ezr', 'ez']], ['Ezra', 'Ezra', ['ezr']]),
  b(16, 'Neh', 13, 'OT', ['Nehemiah', 'Neh', ['ne']], ['Nehemias', 'Neh', ['ne', 'nehemiah']]),
  b(17, 'Esth', 10, 'OT', ['Esther', 'Esth', ['es', 'est']], ['Ester', 'Est', ['es', 'esth', 'esther']]),
  b(18, 'Job', 42, 'OT', ['Job', 'Job', ['jb']], ['Job', 'Job', ['jb']]),
  b(19, 'Ps', 150, 'OT', ['Psalms', 'Ps', ['psa', 'psalm', 'pslm', 'psm', 'pss']], ['Mga Awit', 'Awit', ['aw', 'awit', 'mgaawit', 'ps', 'psa', 'salmo', 'mgasalmo']]),
  b(20, 'Prov', 31, 'OT', ['Proverbs', 'Prov', ['pr', 'prv', 'pro']], ['Mga Kawikaan', 'Kaw', ['kawikaan', 'mgakawikaan', 'ka', 'kwk', 'prov', 'pr']]),
  b(21, 'Eccl', 12, 'OT', ['Ecclesiastes', 'Eccl', ['ec', 'ecc', 'eccles', 'qoh']], ['Eclesiastes', 'Ecl', ['ec', 'ecc', 'eccl', 'eclesiates']]),
  b(22, 'Song', 8, 'OT', ['Song of Solomon', 'Song', ['sos', 'sg', 'songofsongs', 'songofsol', 'ss', 'canticles']], ['Awit ng mga Awit', 'Aw ng Aw', ['awitngmgaawit', 'awitnaawit', 'sos', 'song', 'awitnisalomon']]),
  b(23, 'Isa', 66, 'OT', ['Isaiah', 'Isa', ['is']], ['Isaias', 'Isa', ['is', 'isaiah']]),
  b(24, 'Jer', 52, 'OT', ['Jeremiah', 'Jer', ['je', 'jr']], ['Jeremias', 'Jer', ['je', 'jr', 'jeremiah']]),
  b(25, 'Lam', 5, 'OT', ['Lamentations', 'Lam', ['la']], ['Mga Panaghoy', 'Pan', ['panaghoy', 'mgapanaghoy', 'lam', 'la']]),
  b(26, 'Ezek', 48, 'OT', ['Ezekiel', 'Ezek', ['eze', 'ezk']], ['Ezekiel', 'Ezek', ['eze', 'ezk']]),
  b(27, 'Dan', 12, 'OT', ['Daniel', 'Dan', ['da', 'dn']], ['Daniel', 'Dan', ['da', 'dn']]),
  b(28, 'Hos', 14, 'OT', ['Hosea', 'Hos', ['ho']], ['Oseas', 'Os', ['os', 'ose', 'hosea', 'hos']]),
  b(29, 'Joel', 3, 'OT', ['Joel', 'Joel', ['jl']], ['Joel', 'Joel', ['jl', 'joe']]),
  b(30, 'Amos', 9, 'OT', ['Amos', 'Amos', ['am']], ['Amos', 'Amos', ['am']]),
  b(31, 'Obad', 1, 'OT', ['Obadiah', 'Obad', ['ob', 'oba']], ['Abdias', 'Abd', ['ab', 'abdi', 'obad', 'obadiah']]),
  b(32, 'Jonah', 4, 'OT', ['Jonah', 'Jonah', ['jon', 'jnh']], ['Jonas', 'Jon', ['jonah', 'jns']]),
  b(33, 'Mic', 7, 'OT', ['Micah', 'Mic', ['mc']], ['Mikas', 'Mik', ['mi', 'mika', 'micah', 'mic']]),
  b(34, 'Nah', 3, 'OT', ['Nahum', 'Nah', ['na']], ['Nahum', 'Nah', ['na']]),
  b(35, 'Hab', 3, 'OT', ['Habakkuk', 'Hab', ['hb']], ['Habacuc', 'Hab', ['hb', 'habakkuk', 'habakuk']]),
  b(36, 'Zeph', 3, 'OT', ['Zephaniah', 'Zeph', ['zep', 'zp']], ['Sofonias', 'Sof', ['sf', 'sofo', 'zeph', 'zephaniah']]),
  b(37, 'Hag', 2, 'OT', ['Haggai', 'Hag', ['hg']], ['Hagai', 'Hag', ['hg', 'haggai']]),
  b(38, 'Zech', 14, 'OT', ['Zechariah', 'Zech', ['zec', 'zc']], ['Zacarias', 'Zac', ['za', 'zec', 'zech', 'zechariah']]),
  b(39, 'Mal', 4, 'OT', ['Malachi', 'Mal', ['ml']], ['Malakias', 'Mal', ['ml', 'malachi']]),

  // ---------------- New Testament ----------------
  b(40, 'Matt', 28, 'NT', ['Matthew', 'Matt', ['mt', 'mat']], ['Mateo', 'Mat', ['mt', 'matt', 'matthew']]),
  b(41, 'Mark', 16, 'NT', ['Mark', 'Mark', ['mk', 'mr', 'mrk']], ['Marcos', 'Mar', ['mk', 'mr', 'marc', 'mark']]),
  b(42, 'Luke', 24, 'NT', ['Luke', 'Luke', ['lk', 'luk']], ['Lucas', 'Luc', ['lk', 'lu', 'luke']]),
  b(43, 'John', 21, 'NT', ['John', 'John', ['jn', 'jhn', 'joh']], ['Juan', 'Juan', ['jn', 'jua', 'john']]),
  b(44, 'Acts', 28, 'NT', ['Acts', 'Acts', ['ac', 'act']], ['Mga Gawa', 'Gawa', ['gawa', 'mgagawa', 'gaw', 'gw', 'acts', 'ac']]),
  b(45, 'Rom', 16, 'NT', ['Romans', 'Rom', ['ro', 'rm']], ['Mga Taga-Roma', 'Roma', ['roma', 'tagaroma', 'mgatagaroma', 'ro', 'rom', 'romans']]),
  b(46, '1Cor', 16, 'NT', ['1 Corinthians', '1 Cor', ['1co', 'icor', 'icorinthians']], ['1 Mga Taga-Corinto', '1 Cor', ['1corinto', '1tagacorinto', '1mgatagacorinto', '1co', '1cor', '1korinto', 'imgatagacorinto']]),
  b(47, '2Cor', 13, 'NT', ['2 Corinthians', '2 Cor', ['2co', 'iicor', 'iicorinthians']], ['2 Mga Taga-Corinto', '2 Cor', ['2corinto', '2tagacorinto', '2mgatagacorinto', '2co', '2cor', '2korinto', 'iimgatagacorinto']]),
  b(48, 'Gal', 6, 'NT', ['Galatians', 'Gal', ['ga']], ['Mga Taga-Galacia', 'Gal', ['galacia', 'tagagalacia', 'mgatagagalacia', 'ga', 'galatians']]),
  b(49, 'Eph', 6, 'NT', ['Ephesians', 'Eph', ['ep']], ['Mga Taga-Efeso', 'Efe', ['efeso', 'tagaefeso', 'mgatagaefeso', 'ef', 'eph', 'ephesians']]),
  b(50, 'Phil', 4, 'NT', ['Philippians', 'Phil', ['php', 'pp', 'ph']], ['Mga Taga-Filipos', 'Fil', ['filipos', 'tagafilipos', 'mgatagafilipos', 'fp', 'phil', 'php', 'philippians']]),
  b(51, 'Col', 4, 'NT', ['Colossians', 'Col', ['co']], ['Mga Taga-Colosas', 'Col', ['colosas', 'tagacolosas', 'mgatagacolosas', 'kolosas', 'co', 'colossians']]),
  b(52, '1Thess', 5, 'NT', ['1 Thessalonians', '1 Thess', ['1th', 'ithes', 'ithessalonians']], ['1 Mga Taga-Tesalonica', '1 Tes', ['1tesalonica', '1tagatesalonica', '1mgatagatesalonica', '1te', '1th', '1thess', 'imgatagatesalonica']]),
  b(53, '2Thess', 3, 'NT', ['2 Thessalonians', '2 Thess', ['2th', 'iithes', 'iithessalonians']], ['2 Mga Taga-Tesalonica', '2 Tes', ['2tesalonica', '2tagatesalonica', '2mgatagatesalonica', '2te', '2th', '2thess', 'iimgatagatesalonica']]),
  b(54, '1Tim', 6, 'NT', ['1 Timothy', '1 Tim', ['1ti', 'itim', 'itimothy']], ['1 Timoteo', '1 Tim', ['1ti', 'itim', '1timothy']]),
  b(55, '2Tim', 4, 'NT', ['2 Timothy', '2 Tim', ['2ti', 'iitim', 'iitimothy']], ['2 Timoteo', '2 Tim', ['2ti', 'iitim', '2timothy']]),
  b(56, 'Titus', 3, 'NT', ['Titus', 'Titus', ['tit', 'ti']], ['Tito', 'Tito', ['tit', 'ti', 'titus']]),
  b(57, 'Phlm', 1, 'NT', ['Philemon', 'Phlm', ['phm', 'philem', 'pm']], ['Filemon', 'Filem', ['flm', 'filemon', 'phlm', 'phm', 'philemon']]),
  b(58, 'Heb', 13, 'NT', ['Hebrews', 'Heb', ['he']], ['Mga Hebreo', 'Heb', ['hebreo', 'mgahebreo', 'he', 'hebrews']]),
  b(59, 'Jas', 5, 'NT', ['James', 'Jas', ['jm', 'jam']], ['Santiago', 'Sant', ['sant', 'stg', 'jas', 'james']]),
  b(60, '1Pet', 5, 'NT', ['1 Peter', '1 Pet', ['1pe', '1pt', 'ipet', 'ipeter']], ['1 Pedro', '1 Ped', ['1pe', '1pd', 'ipedro', '1pet', '1peter']]),
  b(61, '2Pet', 3, 'NT', ['2 Peter', '2 Pet', ['2pe', '2pt', 'iipet', 'iipeter']], ['2 Pedro', '2 Ped', ['2pe', '2pd', 'iipedro', '2pet', '2peter']]),
  b(62, '1John', 5, 'NT', ['1 John', '1 John', ['1jn', '1jhn', '1joh', 'ijohn']], ['1 Juan', '1 Juan', ['1jn', '1jua', 'ijuan', '1john']]),
  b(63, '2John', 1, 'NT', ['2 John', '2 John', ['2jn', '2jhn', '2joh', 'iijohn']], ['2 Juan', '2 Juan', ['2jn', '2jua', 'iijuan', '2john']]),
  b(64, '3John', 1, 'NT', ['3 John', '3 John', ['3jn', '3jhn', '3joh', 'iiijohn']], ['3 Juan', '3 Juan', ['3jn', '3jua', 'iiijuan', '3john']]),
  b(65, 'Jude', 1, 'NT', ['Jude', 'Jude', ['jud', 'jd']], ['Judas', 'Jud', ['jd', 'jude', 'judas']]),
  b(66, 'Rev', 22, 'NT', ['Revelation', 'Rev', ['re', 'rv', 'revelations', 'apocalypse']], ['Pahayag', 'Pah', ['pahayag', 'pay', 'rev', 'revelation', 'apocalipsis', 'apoc', 'pahayagnijuan']]),
];

export const BOOK_COUNT = BOOKS.length; // 66
export const OT_BOOK_COUNT = 39;
export const NT_BOOK_COUNT = 27;
export const TOTAL_CHAPTERS = 1189;

const BY_ID: ReadonlyMap<number, BookDef> = new Map(BOOKS.map((x) => [x.id, x]));
const BY_OSIS: ReadonlyMap<string, BookDef> = new Map(BOOKS.map((x) => [x.osis, x]));

export function getBook(id: number): BookDef | undefined {
  return BY_ID.get(id);
}

export function getBookByOsis(osis: string): BookDef | undefined {
  return BY_OSIS.get(osis);
}

export function bookName(id: number, lang: LangCode): string {
  return BY_ID.get(id)?.names[lang].name ?? '';
}

export function bookShort(id: number, lang: LangCode): string {
  return BY_ID.get(id)?.names[lang].short ?? '';
}

export function booksByTestament(testament: Testament): BookDef[] {
  return BOOKS.filter((x) => x.testament === testament);
}

export function chapterCount(id: number): number {
  return BY_ID.get(id)?.chapters ?? 0;
}
