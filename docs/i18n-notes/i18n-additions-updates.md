# Strings for app/updates.tsx and UpdateBanner.tsx

Paste into src/i18n/en.ts and src/i18n/fil.ts, replacing the lines
'translations.title' / 'updates.title' block header if you like (keep both of those keys).
Please check the Filipino wording.

## en.ts

```ts
  'updates.bannerView': 'View',
  'updates.bannerViewA11y': 'View available updates',
  'updates.bannerDismiss': 'Not now',
  'updates.bannerDismissHint': 'Hides this message until you open the app again',

  'updates.version': 'Installed version {version}',
  'updates.lastChecked': 'Last checked {time}',
  'updates.neverChecked': 'Not checked yet',
  'updates.checkNow': 'Check now',
  'updates.checking': 'Checking…',
  'updates.checkNowHint': 'Looks for new Bible texts and app versions',
  'updates.result.updated': 'Updates are available.',
  'updates.result.upToDate': 'Everything is up to date.',
  'updates.result.error': 'Could not check for updates. Check your connection and try again.',
  'updates.notConfigured': 'Updates are not set up in this build yet.',
  'updates.tooOld': 'The newest Bible texts need a newer version of Katipan. Update the app first.',

  'updates.appTitle': 'App update',
  'updates.appAvailable': 'Version {version} is available',
  'updates.appHow':
    'Katipan downloads the update, then Android asks you to tap Install. Your notes and highlights stay on your phone.',
  'updates.appButton': 'Download and install',
  'updates.allowInstall': 'Allow installing updates',
  'updates.allowInstallHint': 'Opens your phone’s settings for installing apps from Katipan',
  'updates.allowInstallFailed': 'Your phone could not open that page. Android will ask when you install.',
  'updates.installerOpened': 'The installer is open. Tap Install to finish.',

  'updates.contentTitle': 'Bible texts',
  'updates.nothingToUpdate': 'No updates for your Bible texts.',
  'updates.dailyVerses': 'Daily verse list',
  'updates.dailyVersesNew': 'A newer list of daily verses',
  'updates.packNew': 'New version {version}, {size}',
  'updates.confirmNote': 'Large download. Wi-Fi is recommended.',
  'updates.updateButton': 'Update',
  'updates.updateButtonSize': 'Update ({size})',
  'updates.updateA11y': 'Update {name}, {size}',

  'updates.status.downloading': 'Downloading, {percent}',
  'updates.status.downloadingUnknown': 'Downloading…',
  'updates.status.verifying': 'Checking the file…',
  'updates.status.installing': 'Installing…',
  'updates.progressA11y': 'Downloading {what}',
  'updates.dismiss': 'Dismiss',
  'updates.error.network': 'The download was interrupted. Check your connection and try again. Nothing was changed.',
  'updates.error.checksum': 'The file did not match what was expected, so it was thrown away. Nothing was changed.',
  'updates.error.signature': 'The update could not be verified, so it was not used. Nothing was changed.',
  'updates.error.storage': 'There is not enough free space on your phone. Nothing was changed.',
  'updates.error.invalid': 'This file cannot be used. Nothing was changed.',
  'updates.error.unknown': 'Something went wrong. Nothing was changed.',

  'updates.modeTitle': 'Automatic updates',
  'updates.mode.auto': 'Auto',
  'updates.mode.manual': 'Manual',
  'updates.mode.off': 'Off',
  'updates.modeHint.auto': 'Small updates install by themselves. Large ones always ask first.',
  'updates.modeHint.manual': 'Katipan tells you when an update is ready, and you choose.',
  'updates.modeHint.off': 'Katipan never checks by itself. You can still check here.',
  'updates.wifiOnly': 'Wi-Fi only',
  'updates.wifiOnlyHint': 'Automatic checks and downloads wait for Wi-Fi',
```

## fil.ts

```ts
  'updates.bannerView': 'Tingnan',
  'updates.bannerViewA11y': 'Tingnan ang mga available na update',
  'updates.bannerDismiss': 'Mamaya na',
  'updates.bannerDismissHint': 'Itatago ito hanggang buksan mong muli ang app',

  'updates.version': 'Naka-install na bersyon {version}',
  'updates.lastChecked': 'Huling sinuri {time}',
  'updates.neverChecked': 'Hindi pa nasusuri',
  'updates.checkNow': 'Suriin ngayon',
  'updates.checking': 'Sinusuri…',
  'updates.checkNowHint': 'Naghahanap ng bagong teksto ng Biblia at bersyon ng app',
  'updates.result.updated': 'May mga update na available.',
  'updates.result.upToDate': 'Napapanahon na ang lahat.',
  'updates.result.error': 'Hindi nasuri ang mga update. Tingnan ang koneksyon mo at subukang muli.',
  'updates.notConfigured': 'Hindi pa naka-set up ang mga update sa bersyong ito.',
  'updates.tooOld': 'Kailangan ng mas bagong bersyon ng Katipan para sa pinakabagong teksto ng Biblia. I-update muna ang app.',

  'updates.appTitle': 'Update ng app',
  'updates.appAvailable': 'Available na ang bersyon {version}',
  'updates.appHow':
    'Idi-download ng Katipan ang update, at pagkatapos ay hihingin ng Android na pindutin mo ang Install. Mananatili sa telepono mo ang iyong mga tala at highlight.',
  'updates.appButton': 'I-download at i-install',
  'updates.allowInstall': 'Payagan ang pag-install ng update',
  'updates.allowInstallHint': 'Binubuksan ang settings ng telepono para sa pag-install ng app mula sa Katipan',
  'updates.allowInstallFailed': 'Hindi mabuksan ng telepono mo ang pahinang iyon. Magtatanong ang Android sa pag-install.',
  'updates.installerOpened': 'Bukas na ang installer. Pindutin ang Install para matapos.',

  'updates.contentTitle': 'Mga teksto ng Biblia',
  'updates.nothingToUpdate': 'Walang update para sa mga teksto mo ng Biblia.',
  'updates.dailyVerses': 'Listahan ng talata sa araw-araw',
  'updates.dailyVersesNew': 'May mas bagong listahan ng mga talata sa araw-araw',
  'updates.packNew': 'Bagong bersyon {version}, {size}',
  'updates.confirmNote': 'Malaking download. Mas mabuti ang Wi-Fi.',
  'updates.updateButton': 'I-update',
  'updates.updateButtonSize': 'I-update ({size})',
  'updates.updateA11y': 'I-update ang {name}, {size}',

  'updates.status.downloading': 'Nagda-download, {percent}',
  'updates.status.downloadingUnknown': 'Nagda-download…',
  'updates.status.verifying': 'Sinusuri ang file…',
  'updates.status.installing': 'Ini-install…',
  'updates.progressA11y': 'Nagda-download ng {what}',
  'updates.dismiss': 'Isara',
  'updates.error.network': 'Naputol ang download. Tingnan ang koneksyon mo at subukang muli. Walang nabago.',
  'updates.error.checksum': 'Hindi tugma ang file sa inaasahan, kaya itinapon ito. Walang nabago.',
  'updates.error.signature': 'Hindi napatunayan ang update, kaya hindi ito ginamit. Walang nabago.',
  'updates.error.storage': 'Kulang ang libreng espasyo sa telepono mo. Walang nabago.',
  'updates.error.invalid': 'Hindi magagamit ang file na ito. Walang nabago.',
  'updates.error.unknown': 'May nangyaring mali. Walang nabago.',

  'updates.modeTitle': 'Awtomatikong update',
  'updates.mode.auto': 'Auto',
  'updates.mode.manual': 'Manual',
  'updates.mode.off': 'Naka-off',
  'updates.modeHint.auto': 'Kusang mai-install ang maliliit na update. Palaging magtatanong muna para sa malalaki.',
  'updates.modeHint.manual': 'Sasabihin ng Katipan kapag may update, at ikaw ang pipili.',
  'updates.modeHint.off': 'Hindi kailanman kusang susuriin ng Katipan. Maaari ka pa ring magsuri dito.',
  'updates.wifiOnly': 'Wi-Fi lang',
  'updates.wifiOnlyHint': 'Hihintayin ng awtomatikong pagsuri at pag-download ang Wi-Fi',
```
