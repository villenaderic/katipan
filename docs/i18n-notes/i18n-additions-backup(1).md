# Strings for backupService.ts and app/backup.tsx

Paste each block just before the closing `};` of the file.
This file replaces the earlier `i18n-additions-backup.md`: it holds both the
words inside the exported Markdown file and the words on the Backup screen.
Please check the Filipino wording.

## en.ts

```ts
  /* ---------------- Backup: words inside the Markdown file ---------------- */
  'backup.md.title': 'My Katipan highlights, bookmarks and notes',
  'backup.md.exported': 'Exported {date}',
  'backup.md.translation': 'Verse text from: {translation}',
  'backup.md.highlights': 'Highlights ({count})',
  'backup.md.bookmarks': 'Bookmarks ({count})',
  'backup.md.notes': 'Notes ({count})',
  'backup.md.tags': 'Tags: {tags}',
  'backup.md.edited': 'Edited {date}',
  'backup.md.verseMissing': 'The text of this verse is not in the installed Bible.',
  'backup.md.footer': 'Made with Katipan. Everything here was kept on your phone.',

  /* ---------------- Backup screen ---------------- */
  'backup.title': 'Backup',
  'backup.intro':
    'Your highlights, bookmarks and notes live only on this phone. Save a copy whenever you like.',
  'backup.counts': 'On this phone now: {highlights} highlights, {bookmarks} bookmarks, {notes} notes.',
  'backup.saveTitle': 'Save a copy',
  'backup.exportJson': 'Backup file',
  'backup.exportJsonHint': 'To restore later, here or on another phone',
  'backup.exportMarkdown': 'Readable copy',
  'backup.exportMarkdownHint': 'Verses with your notes, to read, print or paste elsewhere',
  'backup.sharePrivacy':
    'The file goes only where you choose in your phone’s share menu. Katipan sends nothing anywhere.',
  'backup.shareTitleBackup': 'Katipan backup',
  'backup.shareTitleNotes': 'Katipan notes',
  'backup.restoreTitle': 'Restore',
  'backup.restoreRow': 'Add from a backup file',
  'backup.restoreHint': 'Opens your phone’s file picker',
  'backup.restoreRule':
    'Restoring only adds. Nothing already on this phone is changed or removed.',
  'backup.preparing': 'Preparing the file…',
  'backup.working': 'Reading the file…',
  'backup.adding': 'Adding…',
  'backup.confirmTitle': 'Add these to this phone?',
  'backup.confirmBody':
    'The file has {highlights} highlights, {bookmarks} bookmarks and {notes} notes. Anything you already have stays as it is.',
  'backup.confirmEmptyTitle': 'Nothing to add',
  'backup.confirmEmptyBody': 'This backup has no highlights, bookmarks or notes that can be used.',
  'backup.confirmDate': 'Backup made on {date}.',
  'backup.add': 'Add',
  'backup.resultAdded': 'Added: {highlights} highlights, {bookmarks} bookmarks, {notes} notes.',
  'backup.resultSkipped': '{count} were already on this phone and were left as they are.',
  'backup.resultInvalid': '{count} damaged entries were ignored.',
  'backup.error.empty': 'There is nothing to save yet. Highlight a verse or write a note first.',
  'backup.error.unreadable': 'That file could not be read.',
  'backup.error.notBackup': 'That file is not a Katipan backup.',
  'backup.error.tooNew':
    'That backup was made by a newer version of Katipan. Update the app first, then try again.',
  'backup.error.tooLarge': 'That file is much too big to be a backup.',
  'backup.error.writeFailed': 'Something went wrong and nothing was changed. Please try again.',
  'backup.error.shareUnavailable': 'This phone cannot share files.',
```

## fil.ts

```ts
  /* ---------------- Backup: words inside the Markdown file ---------------- */
  'backup.md.title': 'Aking mga highlight, bookmark at note sa Katipan',
  'backup.md.exported': 'Na-export noong {date}',
  'backup.md.translation': 'Teksto ng talata mula sa: {translation}',
  'backup.md.highlights': 'Mga Highlight ({count})',
  'backup.md.bookmarks': 'Mga Bookmark ({count})',
  'backup.md.notes': 'Mga Note ({count})',
  'backup.md.tags': 'Mga tag: {tags}',
  'backup.md.edited': 'Na-edit noong {date}',
  'backup.md.verseMissing': 'Wala sa naka-install na Biblia ang teksto ng talatang ito.',
  'backup.md.footer': 'Gawa sa Katipan. Nanatili sa iyong telepono ang lahat ng narito.',

  /* ---------------- Backup screen ---------------- */
  'backup.title': 'Backup',
  'backup.intro':
    'Nasa telepono mo lamang ang iyong mga highlight, bookmark at note. Mag-save ng kopya kahit kailan.',
  'backup.counts': 'Nasa telepono ngayon: {highlights} highlight, {bookmarks} bookmark, {notes} note.',
  'backup.saveTitle': 'Mag-save ng kopya',
  'backup.exportJson': 'Backup file',
  'backup.exportJsonHint': 'Para maibalik mamaya, dito o sa ibang telepono',
  'backup.exportMarkdown': 'Kopyang madaling basahin',
  'backup.exportMarkdownHint': 'Mga talata kasama ang iyong mga note, para basahin, i-print o i-paste sa iba',
  'backup.sharePrivacy':
    'Sa pipiliin mo lamang sa share menu ng telepono mapupunta ang file. Walang ipinapadala ang Katipan kahit saan.',
  'backup.shareTitleBackup': 'Backup ng Katipan',
  'backup.shareTitleNotes': 'Mga note sa Katipan',
  'backup.restoreTitle': 'Ibalik',
  'backup.restoreRow': 'Magdagdag mula sa backup file',
  'backup.restoreHint': 'Bubuksan ang file picker ng telepono',
  'backup.restoreRule':
    'Nagdaragdag lamang ang pagbabalik. Walang babaguhin o buburahin sa nasa telepono na.',
  'backup.preparing': 'Inihahanda ang file…',
  'backup.working': 'Binabasa ang file…',
  'backup.adding': 'Nagdaragdag…',
  'backup.confirmTitle': 'Idagdag ang mga ito sa telepono?',
  'backup.confirmBody':
    'May {highlights} highlight, {bookmarks} bookmark at {notes} note ang file. Mananatili ang anumang mayroon ka na.',
  'backup.confirmEmptyTitle': 'Walang maidaragdag',
  'backup.confirmEmptyBody': 'Walang magagamit na highlight, bookmark o note sa backup na ito.',
  'backup.confirmDate': 'Ginawa ang backup noong {date}.',
  'backup.add': 'Idagdag',
  'backup.resultAdded': 'Naidagdag: {highlights} highlight, {bookmarks} bookmark, {notes} note.',
  'backup.resultSkipped': '{count} ang nasa telepono na at hindi ginalaw.',
  'backup.resultInvalid': '{count} nasirang entry ang hindi pinansin.',
  'backup.error.empty': 'Wala pang maisa-save. Mag-highlight muna ng talata o magsulat ng note.',
  'backup.error.unreadable': 'Hindi mabasa ang file na iyon.',
  'backup.error.notBackup': 'Hindi backup ng Katipan ang file na iyon.',
  'backup.error.tooNew':
    'Mas bagong bersyon ng Katipan ang gumawa ng backup na iyon. I-update muna ang app, saka subukan ulit.',
  'backup.error.tooLarge': 'Napakalaki ng file na iyon para maging backup.',
  'backup.error.writeFailed': 'May nangyaring mali at walang nabago. Pakisubukan ulit.',
  'backup.error.shareUnavailable': 'Hindi makapag-share ng file ang teleponong ito.',
```
