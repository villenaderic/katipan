# Katipan

A minimal, offline-first Bible app for Android with no ads, no account, no tracking, daily verses, and a safe auto-update system.

## Features

- **Offline-First**: Reading, search, daily verses, highlights, and notes work completely offline.
- **Privacy First**: No ads, no analytics, no third-party network calls, and no user accounts.
- **Dual Translations**: Shipped with World English Bible (WEB) and Ang Dating Biblia 1905 (Filipino).
- **Fast Full-Text Search**: Powered by SQLite FTS5 with support for both phrase searching and quick-jump reference queries (e.g. *John 3:16* or *Juan 3:16*).
- **Reader Settings**: Custom themes (Light, Sepia, Dark, True Black), adjustable font sizes, line heights, serif/sans toggle, and verse number display.
- **Personal Annotations**: Color-coded highlights (5 accessible colors), notes with tags, and bookmarks stored locally in SQLite (`user.db`).

## Tech Stack

- **Framework**: React Native with Expo (Managed workflow & development builds)
- **Navigation**: `expo-router`
- **Database & Search**: `expo-sqlite` (SQLite + FTS5)
- **Local State**: `zustand`
- **List Virtualization**: `@shopify/flash-list`

## Project Structure

```
├── app/                  # Expo Router screens and navigation
│   ├── (tabs)/           # Bottom tab screens (Today, Read, Search, Library, More)
│   ├── reader/           # Reading view ([book]/[chapter].tsx)
│   └── ...               # Standalone modals and screens
├── assets/               # Fonts, images, and static data
├── src/
│   ├── components/       # UI and feature components
│   ├── constants/        # Book definitions, app configuration, languages
│   ├── db/               # SQLite schema, client, migrations, queries
│   ├── hooks/            # Custom application hooks
│   ├── i18n/             # Translations (English and Filipino)
│   ├── services/         # Core business logic and background services
│   ├── store/            # Zustand stores
│   ├── theme/            # Design system, tokens, typography, and themes
│   ├── types/            # TypeScript interfaces and definitions
│   └── utils/            # Reference parsing, formatting, checksum, and dates
```

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run start
   ```

3. Run on Android:
   ```bash
   npm run android
   ```

