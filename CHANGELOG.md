# Changelog

All notable changes to Katipan are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

Every release also increments `android.versionCode` in `app.json`.
Every release is signed with the same permanent keystore.

## [Unreleased]

Nothing yet.

## [1.0.0] - Unreleased

First public release. Every v1.0 item in the Master Prompt is built. Not yet tagged: finish the checklist under
"Before tagging 1.0.0" below, then replace "Unreleased" with the release date.

### Added

**Reading**
- Book list (Old and New Testament), chapter picker, and a virtualized chapter reader.
- Quick jump by typing a reference such as `John 3:16` or `Juan 3:16`,
  with English and Filipino book names and abbreviations.
- Resume at the last-read position on launch.
- Reading-focus mode that hides the interface after 2 seconds without touch.
- Two translations: World English Bible (English) and Ang Dating Biblia 1905 (Filipino).

**Search**
- Full-text search for words and phrases using SQLite FTS5.
- One search box that understands both words and references.
- Results grouped by translation.

**Your notes**
- Highlights in 5 colors, bookmarks, and notes with tags.
- Library screen with Highlights, Bookmarks, and Notes tabs.
- Everything is stored in `user.db` on the device. It stores verse ids and
  translation ids, never verse text, so changing translation or updating a pack
  never breaks your notes.

**Reading plans**
- Three plans: the Bible in a year, the New Testament in 90 days, and Psalms and Proverbs.
- A plan is a sequence, not a calendar. The next reading is the first one not yet read,
  so there is no "behind", no deadline, and nothing in red.
- "I have read everything up to here" marks earlier days as read in one tap.
- The streak is only shown as good news and is never mentioned when it ends.
- Stopping a plan keeps its progress. "Start over" is the only thing that clears it.
- Today shows the next reading of the active plan, and nothing when there is none.

**Backup**
- Export highlights, bookmarks, and notes as JSON (a backup you can restore) or as Markdown (a readable copy with the verse text).
- Import only adds: it never overwrites or deletes what is already on the phone, and runs as one all-or-nothing step.
- Files leave the phone only through the system share menu. There is no network use.

**What's new**
- Notes for the installed version, shown once after an update and always available from More.
- A fresh install shows nothing.

**Daily verse**
- One verse per day, the same for everyone on a given date, with no internet needed.
- Optional daily notification at a time you choose (local notifications only).

**Appearance**
- Light, Sepia, Dark, and True Black themes.
- Font size, line spacing, serif or sans-serif, and verse numbers on or off.
- Lite mode that turns off animations.
- Interface in English and Filipino.

**Sharing**
- Copy a verse, share it as text, or share it as an image.

**Updates (two separate systems)**
- Content updates for Bible texts and the daily verse list: a signed manifest,
  SHA-256 checks, and a rollback if a new pack fails to open.
- App updates from GitHub Releases: the APK is downloaded, checked with SHA-256,
  and handed to the Android installer. You tap Install.
- Translation Manager to download extra packs and delete packs to free space.
- Updates screen with a quiet banner, "Check now", Auto / Manual / Off, and Wi-Fi only (on by default).
- Background check at most once every 24 hours.

**Storage**
- The Translation Manager shows the space used by Bible packs, the cache, and the free space left.
- Low-storage mode hides large downloads (over 10 MB) and clears download leftovers after every download, when the app starts, and when the mode is switched on.
- "Clear cache" button. Old APKs from earlier updates are removed at app start.
- Low-data mode: updates only on Wi-Fi, on by default.

**Privacy**
- No ads, no account, no analytics, no crash-reporting SDKs.
- The only network requests are to the update manifest and the files it points to.
- Plain privacy text in About.

**Tooling (runs on your computer, not shipped in the app)**
- `tools/build-bible-db.js`: source text to a SQLite pack with FTS5.
- `tools/generate-daily-verses.js`: builds the 366-reference daily verse list.
- `tools/build-manifest.js`: checksums, Ed25519 signature, and `manifest.json`.
- `.github/workflows/release.yml`: builds the APKs, creates a GitHub Release,
  and publishes the manifest when a version tag is pushed.

### Before tagging 1.0.0

- Have a Filipino speaker read every line in `src/i18n/fil.ts`, especially the reading plans, backup, and updates screens.
- Add the three Literata font files to `assets/fonts/`.
- Add `icon.png`, `adaptive-icon.png`, `splash.png`, and `notification-icon.png` to `assets/images/`.
- Build `web.db` and `adb1905.db` into `assets/data/` with `npm run build:db`.
- Generate the Ed25519 key pair, embed the public key in `src/constants/config.ts`,
  and store the private key outside the repository.
- Create the release keystore, back it up in two places, and never commit it.
- Replace `YOUR-USER` in `manifestUrl` in `app.json`.
- Test on an Android 7 (API 24) emulator with 2 GB RAM: cold start, Psalm 119 scrolling, and a chapter opening time.
- Test the update flow: a good update applies, a corrupted pack is rejected, an interrupted download retries, and rollback works.
- Confirm with a network proxy that the only requests go to the update URLs.

[Unreleased]: https://github.com/YOUR-USER/katipan/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/YOUR-USER/katipan/releases/tag/v1.0.0
