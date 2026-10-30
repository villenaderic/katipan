import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Text } from '@/components/ui/Text';
import { APP_VERSION, MANIFEST_URL, READER, WEBSITE_URL } from '@/constants/config';
import { useI18n } from '@/i18n';
import { getPackInfo, listInstalledPacks, type PackInfo } from '@/services/bibleService';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/**
 * About and Privacy: route /about, opened from the More tab. The navigator
 * draws the header (see app/_layout.tsx).
 *
 * One quiet scroll of plain text:
 *  - The app name, version and a one-line promise.
 *  - Privacy, said honestly: "Data we collect: none", what stays on the phone,
 *    and the one network call (the update check) with the real address it uses.
 *  - Permissions, and why each one is there.
 *  - The Bible texts installed on this phone, with the license and source each
 *    pack records in its own meta table, so the credit is never out of date.
 *  - The reading font and its license.
 *  - One quiet "Support this app" text link (it opens the website, where the
 *    GCash details live). No banner, no filled button, no pop-up. Giving is optional and the app stays
 *    free with no ads either way.
 *
 * Nothing here talks to the network. The link opens the phone's browser
 * only when the person taps them. Every string comes from i18n.
 */

/** Ignore a second tap on the same link inside this time. */
const DOUBLE_TAP_MS = 800;

/** The host part of an address ("github.com"), or an empty string if there is none. */
function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return match && match[1] ? match[1] : '';
}

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();

  const [packs, setPacks] = useState<readonly PackInfo[] | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);

  /* ---------------- Installed texts and their licenses ---------------- */

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const installed = await listInstalledPacks();
        const infos: PackInfo[] = [];
        for (const pack of installed) {
          const info = await getPackInfo(pack.id);
          if (info) infos.push(info);
        }
        if (!cancelled) setPacks(infos);
      } catch {
        // The list is a courtesy. If it cannot be read, show the "none found" line.
        if (!cancelled) setPacks([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- Links ---------------- */

  const lastTap = useRef(0);

  const openLink = useCallback(
    (url: string): void => {
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) return;
      lastTap.current = now;

      setLinkFailed(false);
      Linking.openURL(url).catch(() => {
        // No browser on the phone, or it refused. Say so plainly.
        setLinkFailed(true);
      });
    },
    [],
  );

  const updateHost = hostOf(MANIFEST_URL);

  /* ---------------- Screen ---------------- */

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
      >
        {/* ---------------- Name and version ---------------- */}
        <View style={styles.intro}>
          <Text variant="display">{t('app.name')}</Text>
          <Text variant="label" tone="muted" style={styles.version}>
            {t('about.version', { version: APP_VERSION })}
          </Text>
          <Text variant="body" style={styles.paragraph}>
            {t('about.tagline')}
          </Text>
        </View>

        {/* ---------------- Privacy ---------------- */}
        <SectionTitle label={t('about.privacyTitle')} />
        <Divider />
        <View style={styles.block}>
          <Text variant="title" tone="accent" accessibilityRole="header">
            {t('about.dataCollected')}
          </Text>
          <Text variant="body" style={styles.paragraph}>
            {t('about.privacyIntro')}
          </Text>
        </View>
        <Divider />

        <View style={styles.block}>
          <Text variant="label" accessibilityRole="header" style={styles.bold}>
            {t('about.onDeviceTitle')}
          </Text>
          <Text variant="body" tone="muted" style={styles.paragraph}>
            {t('about.onDeviceBody')}
          </Text>
        </View>
        <Divider />

        <View style={styles.block}>
          <Text variant="label" accessibilityRole="header" style={styles.bold}>
            {t('about.networkTitle')}
          </Text>
          <Text variant="body" tone="muted" style={styles.paragraph}>
            {updateHost
              ? t('about.networkBody', { host: updateHost })
              : t('about.networkBodyNoHost')}
          </Text>
        </View>
        <Divider />

        <View style={styles.block}>
          <Text variant="label" accessibilityRole="header" style={styles.bold}>
            {t('about.permissionsTitle')}
          </Text>
          <Text variant="body" tone="muted" style={styles.paragraph}>
            {t('about.permissionsBody')}
          </Text>
        </View>

        {/* ---------------- Bible texts ---------------- */}
        <SectionTitle label={t('about.textsTitle')} />
        <Divider />
        {packs === null ? null : packs.length === 0 ? (
          <View style={styles.block}>
            <Text variant="body" tone="muted">
              {t('about.textsEmpty')}
            </Text>
          </View>
        ) : (
          packs.map((pack) => (
            <Row
              key={pack.id}
              title={pack.name}
              subtitle={t('about.textLicense', {
                license: pack.license,
                source: pack.source_url,
              })}
              accessibilityLabel={t('about.textA11y', {
                name: pack.name,
                license: pack.license,
                source: pack.source_url,
              })}
            />
          ))
        )}

        {/* ---------------- Font ---------------- */}
        <SectionTitle label={t('about.fontTitle')} />
        <Divider />
        <View style={styles.block}>
          <Text variant="body" tone="muted">
            {t('about.fontBody')}
          </Text>
        </View>

        {/* ---------------- Support and website ---------------- */}
        <SectionTitle label={t('about.supportTitle')} />
        <Divider />
        <View style={styles.block}>
          <Text variant="body" tone="muted">
            {t('about.supportBody')}
          </Text>
          <View style={styles.links}>
            <Button
              label={t('about.support')}
              onPress={() => openLink(WEBSITE_URL)}
              accessibilityHint={t('about.linkHint')}
              style={styles.linkButton}
            />
          </View>
          {linkFailed ? (
            <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
              {t('about.linkFailed', { url: WEBSITE_URL })}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces used only here                                               */
/* ------------------------------------------------------------------ */

function SectionTitle({ label }: { label: string }) {
  return (
    <Text variant="label" tone="muted" accessibilityRole="header" style={styles.section}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
  },
  intro: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.md,
  },
  version: {
    marginTop: space.xs,
  },
  section: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  block: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  paragraph: {
    marginTop: space.sm,
  },
  bold: {
    fontWeight: '600',
  },
  links: {
    marginTop: space.sm,
    marginLeft: -space.lg,
  },
  linkButton: {
    alignSelf: 'flex-start',
  },
});
