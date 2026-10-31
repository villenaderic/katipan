# Strings for app/translations.tsx

Paste into src/i18n/en.ts and src/i18n/fil.ts. Keep the existing 'translations.title' key.
This screen also reuses the 'updates.*' keys from i18n-additions-updates.md
(updates.checking, updates.checkNow, updates.tooOld, updates.confirmNote,
updates.status.*, updates.progressA11y, updates.error.*, updates.dismiss).
Please check the Filipino wording.

## en.ts

```ts
  'translations.installed': 'On this phone',
  'translations.included': 'Included with the app',
  'translations.readingNow': 'Chosen for reading',
  'translations.selectHint': 'Reads the Bible in this text',
  'translations.delete': 'Delete',
  'translations.deleteA11y': 'Delete {name}, frees {size}',
  'translations.deleteConfirm':
    'Delete {name}? You can download it again later. Your highlights, bookmarks and notes are kept.',
  'translations.deleteYes': 'Yes, delete',
  'translations.deleteYesA11y': 'Yes, delete {name}',
  'translations.deleteFailed': 'This text could not be deleted. Please try again.',
  'translations.available': 'Available to download',
  'translations.noManifest': 'Check for updates to see which other texts can be downloaded.',
  'translations.nothingMore': 'No other texts to download right now.',
  'translations.packSubtitle': '{id} · {size}',
  'translations.download': 'Download ({size})',
  'translations.downloadA11y': 'Download {name}, {size}',
  'translations.largeHidden': 'Low-storage mode is hiding {count} large text(s).',
  'translations.storageTitle': 'Storage',
  'translations.storageUsed': 'Bible texts use {size}',
  'translations.storageFree': 'Free space on this phone: {size}',
  'translations.storageLow': 'Your phone is running low on space. Deleting a text you do not read can help.',
  'translations.clearCache': 'Clear temporary files ({size})',
  'translations.cacheCleared': 'Freed {size}.',
  'translations.lowStorage': 'Low-storage mode',
  'translations.lowStorageHint': 'Hides large downloads',
```

## fil.ts

```ts
  'translations.installed': 'Nasa telepono na ito',
  'translations.included': 'Kasama sa app',
  'translations.readingNow': 'Napiling basahin',
  'translations.selectHint': 'Binabasa ang Biblia sa tekstong ito',
  'translations.delete': 'Burahin',
  'translations.deleteA11y': 'Burahin ang {name}, magbabakante ng {size}',
  'translations.deleteConfirm':
    'Buburahin ang {name}? Maaari mo itong i-download muli mamaya. Mananatili ang iyong mga highlight, bookmark at tala.',
  'translations.deleteYes': 'Oo, burahin',
  'translations.deleteYesA11y': 'Oo, burahin ang {name}',
  'translations.deleteFailed': 'Hindi nabura ang tekstong ito. Pakisubukang muli.',
  'translations.available': 'Maaaring i-download',
  'translations.noManifest': 'Suriin ang mga update para makita kung anong ibang teksto ang maaaring i-download.',
  'translations.nothingMore': 'Walang ibang tekstong maida-download sa ngayon.',
  'translations.packSubtitle': '{id} · {size}',
  'translations.download': 'I-download ({size})',
  'translations.downloadA11y': 'I-download ang {name}, {size}',
  'translations.largeHidden': 'Itinatago ng Low-storage mode ang {count} malaking teksto.',
  'translations.storageTitle': 'Imbakan',
  'translations.storageUsed': 'Gumagamit ng {size} ang mga teksto ng Biblia',
  'translations.storageFree': 'Libreng espasyo sa telepono: {size}',
  'translations.storageLow': 'Paubos na ang espasyo ng telepono mo. Makakatulong ang pagbura ng tekstong hindi mo binabasa.',
  'translations.clearCache': 'Linisin ang pansamantalang file ({size})',
  'translations.cacheCleared': 'Nabakante ang {size}.',
  'translations.lowStorage': 'Low-storage mode',
  'translations.lowStorageHint': 'Itinatago ang malalaking download',
```
