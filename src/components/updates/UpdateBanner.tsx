import { useRouter } from 'expo-router';
import { memo, useCallback, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useI18n } from '../../i18n';
import {
  hasAnyUpdate,
  useDownloadsStore,
  type AvailableUpdates,
} from '../../store/downloadsStore';
import { space } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Divider } from '../ui/Divider';
import { Text } from '../ui/Text';

export interface UpdateBannerProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * The quiet "Update available" line (Section 8): one row of text and two
 * text buttons, a hairline under it. Never a dialog, never blocking, no badge.
 *
 *   View     opens the Updates screen, where sizes and notes are shown.
 *   Not now  hides the banner until the app is closed. It comes back for a
 *            NEWER update (a different version), so one tap never hides
 *            something the person has not seen yet.
 *
 * Renders nothing when there is nothing to offer, so a screen can include it
 * without checking first. It never starts a download by itself.
 */

/** Remembers, until the app process ends, which set of updates was waved away. */
let dismissedSignature: string | null = null;

/** A short text that changes whenever the set of offered updates changes. */
function signatureOf(available: AvailableUpdates): string {
  const packs = available.packs.map((pack) => `${pack.id}@${pack.version}`).join(',');
  const verses = available.dailyVerses ? `v${available.dailyVerses.version}` : '';
  const app = available.app ? `a${available.app.latest}` : '';
  return `${packs}|${verses}|${app}`;
}

function UpdateBannerBase({ style }: UpdateBannerProps) {
  const { t } = useI18n();
  const router = useRouter();
  const available = useDownloadsStore((state) => state.available);

  // The state exists only to redraw after "Not now"; the memory is the variable above.
  const [, setRedraw] = useState(0);

  const open = useCallback((): void => {
    router.push('/updates');
  }, [router]);

  const dismiss = useCallback((): void => {
    dismissedSignature = signatureOf(useDownloadsStore.getState().available);
    setRedraw((value) => value + 1);
  }, []);

  if (!hasAnyUpdate(available)) return null;
  if (dismissedSignature === signatureOf(available)) return null;

  return (
    <View style={style} accessibilityRole="summary">
      <View style={styles.row}>
        <Text variant="body" style={styles.message} numberOfLines={2}>
          {t('more.updateAvailable')}
        </Text>
        <Button
          label={t('updates.bannerDismiss')}
          accessibilityHint={t('updates.bannerDismissHint')}
          onPress={dismiss}
        />
        <Button
          label={t('updates.bannerView')}
          accessibilityLabel={t('updates.bannerViewA11y')}
          accessibilityHint={t('more.openHint')}
          onPress={open}
        />
      </View>
      <Divider />
    </View>
  );
}

export const UpdateBanner = memo(UpdateBannerBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
    paddingRight: space.xs,
  },
  message: {
    flex: 1,
    paddingVertical: space.sm,
    paddingRight: space.sm,
  },
});
