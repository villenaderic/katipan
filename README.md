# Katipan

A minimal, offline-first Bible app for Android. No ads, no account, no tracking.

Katipan is not on Google Play. It is installed from a signed APK on a website
(GitHub Releases) and it updates itself. Donations live on the website, never
inside the app. The app only shows a quiet "Support this app" link in About.

- Old and New Testament, 66 books, in Filipino and English
- Works fully in airplane mode
- Made to run on very low-end phones (2 GB RAM, 32-bit and 64-bit)
- Everything you write stays on your phone

## What it does (version 1.0)

| Area | What you get |
| --- | --- |
| Reading | Book list, chapter picker, virtualized reader, quick jump (`John 3:16`, `Juan 3:16`), resume where you stopped, reading-focus mode |
| Translations | World English Bible and Ang Dating Biblia 1905 bundled; more packs downloadable in the Translation Manager |
| Search | Words and phrases (SQLite FTS5), plus references, in one box |
| Your notes | Highlights (5 colors), bookmarks, notes with tags, all in `user.db` |
| Daily verse | Offline, the same for everyone on a given date, optional notification once a day |
| Appearance | Light, Sepia, Dark, True Black; font size, line spacing, serif or sans, verse numbers, Lite mode |
| Sharing | Copy, share as text, share as an image |
| Reading plans | Bible in a year, New Testament in 90 days, Psalms and Proverbs. A plan is a sequence, not a calendar: the next reading is the first one not yet read, so nobody is ever "behind". The streak is only ever good news |
| Backup | Export highlights, bookmarks and notes as a JSON backup (restorable) or a readable Markdown copy. Import only adds, it never overwrites. Files leave the phone only through the share menu |
| What's new | Notes for the installed version, shown once after an update and always reachable from More |
| Storage | The Translation Manager shows how much room Katipan uses. Low-storage mode hides large downloads (over 10 MB) and clears scratch files after every download, at app start, and when it is switched on |
| Updates | Content updates (Bible texts, daily verse list) and app updates (new APK), separate systems |
| Privacy | No analytics, no ads, no account. One network call: the update check |

Later versions (parallel view, cross-references, memorization, widget, audio,
and so on) are described in the Master Prompt. See `CHANGELOG.md` for what has
shipped.

## Minimum Android version

The build sets `minSdkVersion` to **24 (Android 7.0)** in `app.json`
(through `expo-build-properties`).

> **Verify this once.** After you run `npm run fix-deps`, check the minimum
> Android version that your installed Expo SDK and React Native version support
> (see the Expo SDK release notes). If it is higher than 24, set
> `minSdkVersion` to that number in `app.json` and change this section to
> match. The real floor is whichever number is higher.

Targets: 2 GB RAM phones, `armeabi-v7a` (32-bit) and `arm64-v8a` (64-bit).
Goal: APK under 40 MB.

## Tech stack

React Native with Expo (managed workflow and development builds), TypeScript
strict mode, Hermes. Navigation with `expo-router`.

### Why each dependency is here

Every dependency has a reason. If you cannot say why it is needed, remove it.

| Package | Why |
| --- | --- |
| `expo`, `react`, `react-native` | The app framework |
| `expo-router` | File-based navigation and the five tabs |
| `expo-sqlite` | Bible texts, FTS5 search, and `user.db`. FTS is switched on in `app.json` |
| `expo-file-system` | Downloading packs and APKs, and the atomic rename into the packs folder |
| `expo-crypto` | SHA-256 checksums of downloaded files |
| `@noble/ed25519` | Checks the manifest signature (Ed25519) in the app. `expo-crypto` cannot do this |
| `expo-notifications` | Local daily-verse notifications only. There is no push server |
| `expo-background-fetch`, `expo-task-manager` | The once-a-day background update check |
| `expo-intent-launcher` | Opens the Android package installer and the "install unknown apps" settings page |
| `expo-document-picker` | Lets the person choose a backup file to import (Backup screen) |
| `expo-clipboard` | Copy a verse to the clipboard |
| `expo-network` | Tells whether the phone is on Wi-Fi, for the "Wi-Fi only" update rule |
| `expo-sharing`, `react-native-view-shot` | Sharing a verse as text and as an image |
| `expo-localization` | Picks English or Filipino on first launch |
| `expo-font` | Loads the bundled Literata font files |
| `expo-keep-awake` | Keeps the screen on in reading-focus mode |
| `expo-asset` | Copies the bundled Bible databases out of the app on first launch |
| `expo-constants` | Reads the version and the manifest URL from `app.json` |
| `expo-linking`, `expo-splash-screen`, `expo-status-bar`, `expo-system-ui` | Required by Expo Router and the app shell |
| `expo-build-properties` | Sets `minSdkVersion`, shrinking, and legacy packaging |
| `react-native-safe-area-context`, `react-native-screens` | Required by Expo Router |
| `@shopify/flash-list` | Fast virtualized lists for chapters and search results (Psalm 119 on a weak phone) |
| `zustand` | Small, fast state for settings, reader, and downloads |

Not used, on purpose: a UI kit, Redux, Moment, Lodash, an animation library.

## Getting started

You need Node.js 22.5 or newer, JDK 17, and the Android SDK
(Android Studio is the easiest way to get it).

```bash
npm install
npm run fix-deps      # lines every Expo package up with your Expo SDK version
npm run typecheck
```

Native code is needed (SQLite with FTS5, background tasks), so Expo Go will not
work. Use a development build:

```bash
npm run prebuild      # generates the android/ folder
npm run android       # builds and runs on an emulator or a connected phone
npm run start         # starts Metro for the development build
```

`android/` is generated and git-ignored. Do not edit it by hand.

### Test on a weak phone

Before you call a build good, run it on an Android 7 (API 24) emulator with
2 GB RAM and write down:

- cold start time (goal: under 3 seconds)
- time to open a chapter (goal: under 300 ms)
- how smoothly Psalm 119 scrolls

## Before the first build: things only you can add

These are not in the repository.

1. **Fonts.** Put `Literata-Regular.ttf`, `Literata-Italic.ttf` and
   `Literata-Bold.ttf` in `assets/fonts/` (Literata, SIL Open Font License).
2. **Images.** Put `icon.png`, `adaptive-icon.png`, `splash.png` and
   `notification-icon.png` in `assets/images/`.
3. **Bible databases.** Build `web.db` and `adb1905.db` into `assets/data/`
   (see "Making a Bible pack" below).
4. **Manifest key pair.** Run `node tools/build-manifest.js keygen`, paste the
   printed public key into `MANIFEST_PUBLIC_KEY_HEX` in
   `src/constants/config.ts`. Until you do, every update is refused.
5. **Manifest URL.** In `app.json`, replace `YOUR-USER` in
   `extra.manifestUrl` with your GitHub user name. Also set `WEBSITE_URL` in
   `src/constants/config.ts`.
6. **Android keystore.** Create it once (below).

## Making a Bible pack

Packs are built on your computer, not in the app.

```bash
node tools/build-bible-db.js \
  --in sources/web.json \
  --out assets/data/web.db \
  --id web --name "World English Bible" --language en --version 1 \
  --license "Public domain" --source-url "https://ebible.org/web/"
```

Run `node tools/build-bible-db.js --help` for the accepted input formats.
Each pack records its license and source in its `meta` table.

**Licensing rule:** ship only public-domain or explicitly open-licensed texts.
Confirm the license in writing before you add any modern translation. Never
copy copyrighted text.

The daily verse list is 366 references (no text), so it works for every
translation:

```bash
node tools/generate-daily-verses.js export   # writes tools/daily-verses.txt
# edit the list, then:
node tools/generate-daily-verses.js build    # writes assets/data/daily-verses.json
```

## How the daily verse works

The verse of the day is `list[dayOfYear % 366]`, and the text is read from the
translation the person chose. The same date gives the same verse for everyone,
with no internet. The app schedules the next 14 days of notifications each time
it opens or the update task runs.

## How data is stored

- **Bible packs:** one SQLite file per translation. Verse ids are
  `book * 1000000 + chapter * 1000 + verse`, so the same reference lines up
  across translations.
- **`user.db`:** highlights, bookmarks, notes, tags, reading progress, settings.
  It stores a verse id and a translation id, never verse text, so changing or
  updating a translation never breaks your notes. Updates never touch `user.db`.

## Updates

Both systems read one static file, `manifest.json`, from GitHub Releases. There
is no server code.

### Content updates (Bible texts, daily verses)

- Checked at most once every 24 hours, on Wi-Fi by default, in the background
  and on "Check now".
- The manifest signature (Ed25519) is checked with the public key built into the
  app. Then the pack is downloaded to a temporary file and its SHA-256 is
  checked. Anything that fails is refused.
- A verified pack is moved into the packs folder with an atomic rename. The old
  pack is kept until the new one opens successfully, then rollback is possible.
- The setting is Auto, Manual or Off, with "Wi-Fi only" on by default.
- A quiet banner says "Update available". It is never a blocking dialog.
- Packs over 10 MB show their size and need an explicit tap.

### App updates (new APK)

- The manifest's `app.latest` is compared with the installed version.
- If it is newer, the app shows "What's new" and an Update button.
- The APK is downloaded to the cache and its SHA-256 is checked.
- The Android installer opens. **You must tap Install.** Android requires this
  and it cannot be skipped.
- The app declares `REQUEST_INSTALL_PACKAGES`. The first time, the person has to
  allow "Install unknown apps" for Katipan.

## Releasing

### Two secrets, kept apart

| Secret | What it protects | If you lose it |
| --- | --- | --- |
| **Android keystore** | Signs every APK | Existing users can never update. They must uninstall and lose their data |
| **Manifest private key** (`tools/keys/manifest-private.pem`) | Signs `manifest.json` | No manifest is accepted until you ship a new APK with a new public key |

Back up both in **two separate places**. Never commit either. `.gitignore`
already excludes `*.keystore`, `*.jks`, `*.pem`, and `tools/keys/`.

### Create the keystore (once)

```bash
keytool -genkeypair -v -keystore release.keystore -alias katipan \
  -keyalg RSA -keysize 4096 -validity 10000
keytool -list -v -keystore release.keystore     # note the SHA-256 fingerprint
base64 -w0 release.keystore                      # for the GitHub secret
```

### GitHub secrets and variables

Set these in the repository under Settings, Secrets and variables, Actions.
The full list, with explanations, is at the top of
`.github/workflows/release.yml`.

- Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `KATIPAN_SIGNING_KEY`
- Variable: `ANDROID_CERT_SHA256` (the build stops if the keystore does not match)

### Every release

1. Raise `version` **and** `android.versionCode` in `app.json`. The
   `versionCode` must go up every time.
2. Write `tools/release-notes.json`:
   `{ "version": "1.0.1", "en": "What's new...", "fil": "Ano ang bago..." }`
   The version must equal `app.json`.
3. Update `CHANGELOG.md`, commit, and push.
4. Tag and push: `git tag v1.0.1 && git push origin v1.0.1`

The workflow builds a universal APK plus one for each ABI, builds and signs the
manifest, publishes the GitHub Release, and then downloads what it published and
checks it the way the app will. Running the workflow by hand from the Actions
tab is a dry run: it publishes nothing.

Keep old releases available so people can go back.

### Building locally instead

```bash
npm run prebuild
npm run apk:local     # runs ./gradlew assembleRelease in android/
```

You must configure the same keystore for a local release build. Never sign a
release with a different one.

## Website

The download page needs: a button for the latest APK, install steps for
"unknown apps", a plain privacy statement, and the GCash donation QR with a
short note that the app stays free with no ads either way.

## Privacy

Data we collect: **none**.

The only network request Katipan makes is the update check, to the manifest URL
set in `app.json`, and then to the pack and APK files that the signed manifest
lists. It sends no personal information. Reading, search, and the daily verse
all work in airplane mode.

## Definition of done for a release

- Installs and opens on Android 7 and on the latest Android
- Every core feature works in airplane mode
- Cold start under 3 seconds and a chapter opens in under 300 ms on a 2 GB phone
- Update flow tested: a good update applies, a corrupted pack is rejected, an
  interrupted download resumes or retries cleanly, rollback works
- A network proxy shows no requests except to the manifest and update URLs
- APK signed with the permanent keystore, `versionCode` raised, `CHANGELOG.md` updated

## Project structure

```
katipan/
├─ app/                 expo-router screens
│  ├─ (tabs)/           Today, Read, Search, Library, More
│  ├─ reader/[book]/[chapter].tsx
│  └─ books, translations, updates, plans, backup, whats-new,
│     note-editor, appearance, about
├─ src/
│  ├─ components/       ui, reader, today, library, updates
│  ├─ constants/        books, config, languages, plans
│  ├─ db/               schema, client, migrations, queries
│  ├─ hooks/
│  ├─ i18n/             en.ts, fil.ts
│  ├─ services/         bible, daily verse, notification, download,
│  │                    manifest, update, app update, share, plan,
│  │                    backup, what's new
│  ├─ store/            settings, reader, downloads
│  ├─ tasks/            backgroundTasks.ts
│  ├─ theme/            tokens, themes, typography, ThemeProvider
│  ├─ types/
│  └─ utils/            reference, format, checksum, date
├─ assets/              fonts, images, data
├─ tools/               run on your computer, not shipped in the app
└─ .github/workflows/release.yml
```

Keep this tree and the file count in the Master Prompt in step with the code
whenever you add or remove files.

## Design rules

Typography first, chrome last. No gradients, no drop shadows, no cards inside
cards. One accent color. Animations are simple fades under 150 ms and are off
in Lite mode or when the phone's "reduce motion" is on. Every interactive
element has an accessibility label and a touch target of at least 48 dp. Every
visible string goes through `src/i18n` in both English and Filipino.

## License

Add your own license for the code here. Bible texts and fonts keep their own
licenses, recorded in each pack's `meta` table and in the font files.
