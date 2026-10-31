import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { READER } from '@/constants/config';
import {
  PLAN_IDS,
  formatChapter,
  formatReadings,
  getPlanDays,
  type PlanChapter,
  type PlanDay,
  type PlanId,
} from '@/constants/plans';
import { useI18n } from '@/i18n';
import {
  getActivePlanId,
  getAllPlanStates,
  getPlanState,
  markDaysThrough,
  restartPlan,
  setDayDone,
  startPlan,
  stopPlan,
  type PlanState,
} from '@/services/planService';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/**
 * Reading plans: route /plans, opened from the More tab (and from the plan
 * line on Today). The navigator draws the header (see app/_layout.tsx).
 *
 * Two views:
 *  - No plan is active: the three plans to choose from, each with a short
 *    description. A plan that was started before shows how far it got.
 *  - A plan is active: how far you are, the next reading with a button to
 *    mark it as read, then every day of the plan. Tap a day to open its
 *    chapters, mark it read or not read, or say "I have read everything up
 *    to here".
 *
 * Kindness is built in, not added on (see planService.ts): the next reading
 * is simply the first one not yet read, so nobody is ever "behind"; the
 * streak line shows only when there is a run of 2 or more days and is never
 * mentioned when it ends; there are no reminders and no red.
 *
 * Every string comes from i18n.
 */

/** Ignore a second tap on the same control inside this time. */
const DOUBLE_TAP_MS = 600;

interface Loaded {
  activeId: PlanId | null;
  /** State of the active plan. */
  state: PlanState | null;
  /** State of every plan, used when none is active. */
  all: readonly PlanState[];
}

export default function PlansScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, lang } = useI18n();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [openDay, setOpenDay] = useState<PlanDay | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

  const lastTap = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const acceptTap = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) return false;
    lastTap.current = now;
    return true;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const activeId = await getActivePlanId();
      const next: Loaded =
        activeId === null
          ? { activeId, state: null, all: await getAllPlanStates() }
          : { activeId, state: await getPlanState(activeId), all: [] };
      if (mounted.current) {
        setLoaded(next);
        setFailed(false);
      }
    } catch {
      if (mounted.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run a change to the plan data, then show the new state. */
  const change = useCallback(
    (action: () => Promise<void>, announcement?: string): void => {
      void (async () => {
        try {
          await action();
          await load();
          if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
        } catch {
          if (mounted.current) setFailed(true);
        }
      })();
    },
    [load],
  );

  const openChapter = useCallback(
    (chapter: PlanChapter): void => {
      if (!acceptTap()) return;
      setOpenDay(null);
      router.push({
        pathname: '/reader/[book]/[chapter]',
        params: { book: String(chapter.book), chapter: String(chapter.chapter) },
      });
    },
    [acceptTap, router],
  );

  /* ---------------- Wording helpers ---------------- */

  const planName = useCallback((id: PlanId): string => t(`plans.${id}.name`), [t]);

  const progressText = useCallback(
    (state: PlanState): string =>
      t('plans.progress', { done: state.doneCount, total: state.totalDays }),
    [t],
  );

  /* ---------------- Failure ---------------- */

  if (failed) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: colors.background }]}>
        <Text variant="body" tone="muted" style={styles.centerText}>
          {t('plans.loadError')}
        </Text>
        <Button
          label={t('common.retry')}
          onPress={() => {
            setFailed(false);
            void load();
          }}
        />
      </View>
    );
  }

  if (loaded === null) {
    return <View style={[styles.screen, { backgroundColor: colors.background }]} />;
  }

  /* ---------------- No plan yet: choose one ---------------- */

  if (loaded.activeId === null || loaded.state === null) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
        >
          <Text variant="body" tone="muted" style={styles.intro}>
            {t('plans.intro')}
          </Text>
          <Divider />
          {PLAN_IDS.map((id) => {
            const state = loaded.all.find((item) => item.planId === id);
            const started = state !== undefined && state.doneCount > 0;
            const about = t(`plans.${id}.about`);
            return (
              <Row
                key={id}
                title={planName(id)}
                subtitle={started && state ? `${about} ${progressText(state)}` : about}
                value={t('plans.days', { count: state?.totalDays ?? 0 })}
                chevron
                accessibilityHint={t('plans.startHint')}
                onPress={() => {
                  if (!acceptTap()) return;
                  change(() => startPlan(id), t('plans.started', { plan: planName(id) }));
                }}
              />
            );
          })}
        </ScrollView>
      </View>
    );
  }

  /* ---------------- A plan is active ---------------- */

  const { activeId, state } = loaded;
  const days = getPlanDays(activeId);
  const nextDay = state.nextDay === null ? null : (days[state.nextDay - 1] ?? null);
  const finished = state.nextDay === null;

  const renderDay = ({ item }: { item: PlanDay }) => {
    const done = state.doneDays.has(item.day);
    const readings = formatReadings(item.chapters, lang);
    return (
      <Row
        title={t('plans.dayTitle', { day: item.day })}
        subtitle={readings}
        selected={done}
        accessibilityLabel={t('plans.dayA11y', {
          day: item.day,
          readings,
          state: done ? t('plans.stateRead') : t('plans.stateNotRead'),
        })}
        accessibilityHint={t('plans.dayHint')}
        onPress={() => setOpenDay(item)}
      />
    );
  };

  const header = (
    <View>
      <View style={styles.summary}>
        <Text variant="title">{planName(activeId)}</Text>
        <Text variant="label" tone="muted" style={styles.summaryLine}>
          {progressText(state)}
        </Text>
        {state.streak >= 2 ? (
          <Text variant="label" tone="muted" style={styles.summaryLine}>
            {t('plans.streak', { count: state.streak })}
          </Text>
        ) : null}
      </View>

      <Divider />
      {nextDay ? (
        <View style={styles.next}>
          <Text variant="caption" tone="muted" style={styles.inset}>
            {t('plans.nextEyebrow', { day: nextDay.day })}
          </Text>
          <Text variant="body" style={[styles.inset, styles.nextReadings]}>
            {formatReadings(nextDay.chapters, lang)}
          </Text>
          {nextDay.chapters.map((chapter) => (
            <Row
              key={`${chapter.book}-${chapter.chapter}`}
              title={formatChapter(chapter, lang)}
              chevron
              accessibilityHint={t('plans.openChapterHint')}
              onPress={() => openChapter(chapter)}
            />
          ))}
          <View style={styles.actions}>
            <Button
              label={t('plans.markRead')}
              variant="filled"
              onPress={() => {
                if (!acceptTap()) return;
                change(
                  () => setDayDone(activeId, nextDay.day, true),
                  t('plans.markedRead', { day: nextDay.day }),
                );
              }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.next}>
          <Text variant="body" style={styles.inset}>
            {t('plans.finished', { plan: planName(activeId) })}
          </Text>
        </View>
      )}

      <Text variant="label" tone="muted" accessibilityRole="header" style={styles.section}>
        {finished ? t('plans.allDaysDone') : t('plans.allDays')}
      </Text>
      <Divider />
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      <Button
        label={t('plans.changePlan')}
        accessibilityHint={t('plans.changePlanHint')}
        onPress={() => {
          if (!acceptTap()) return;
          change(() => stopPlan());
        }}
      />
      <Button label={t('plans.startOver')} onPress={() => setConfirmRestart(true)} />
    </View>
  );

  const dayDone = openDay ? state.doneDays.has(openDay.day) : false;
  const earlierUnread =
    openDay !== null && Array.from({ length: openDay.day - 1 }, (_, i) => i + 1).some((d) => !state.doneDays.has(d));

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlatList
        data={days}
        renderItem={renderDay}
        keyExtractor={(item) => String(item.day)}
        extraData={state}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
      />

      {/* One day: its chapters, and what to do with it. */}
      <Sheet
        visible={openDay !== null}
        onClose={() => setOpenDay(null)}
        title={openDay ? t('plans.dayTitle', { day: openDay.day }) : undefined}
        closeLabel={t('common.close')}
      >
        {openDay ? (
          <ScrollView showsVerticalScrollIndicator={false}>
            {openDay.chapters.map((chapter) => (
              <Row
                key={`${chapter.book}-${chapter.chapter}`}
                title={formatChapter(chapter, lang)}
                chevron
                accessibilityHint={t('plans.openChapterHint')}
                onPress={() => openChapter(chapter)}
              />
            ))}
            <View style={styles.sheetActions}>
              <Button
                label={dayDone ? t('plans.markNotRead') : t('plans.markRead')}
                variant="filled"
                onPress={() => {
                  const day = openDay.day;
                  setOpenDay(null);
                  change(
                    () => setDayDone(activeId, day, !dayDone),
                    dayDone ? t('plans.markedNotRead', { day }) : t('plans.markedRead', { day }),
                  );
                }}
              />
              {earlierUnread ? (
                <Button
                  label={t('plans.readThroughHere')}
                  variant="outline"
                  accessibilityHint={t('plans.readThroughHereHint')}
                  onPress={() => {
                    const day = openDay.day;
                    setOpenDay(null);
                    change(
                      () => markDaysThrough(activeId, day),
                      t('plans.markedThrough', { day }),
                    );
                  }}
                />
              ) : null}
            </View>
          </ScrollView>
        ) : null}
      </Sheet>

      {/* Start over asks first, because it clears the progress of this plan. */}
      <Sheet
        visible={confirmRestart}
        onClose={() => setConfirmRestart(false)}
        title={t('plans.startOverTitle')}
        closeLabel={t('common.close')}
      >
        <View style={styles.confirm}>
          <Text variant="body">{t('plans.startOverBody', { plan: planName(activeId) })}</Text>
          <View style={styles.sheetActions}>
            <Button
              label={t('plans.startOverConfirm')}
              variant="filled"
              onPress={() => {
                setConfirmRestart(false);
                change(async () => {
                  await restartPlan(activeId);
                }, t('plans.startedOver', { plan: planName(activeId) }));
              }}
            />
            <Button
              label={t('common.cancel')}
              variant="outline"
              onPress={() => setConfirmRestart(false)}
            />
          </View>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  centerText: {
    textAlign: 'center',
    marginBottom: space.lg,
  },
  content: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
  },
  intro: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
  },
  summary: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.lg,
  },
  summaryLine: {
    marginTop: space.xs,
  },
  next: {
    paddingTop: space.lg,
  },
  inset: {
    paddingHorizontal: space.xl,
  },
  nextReadings: {
    marginTop: space.xs,
    marginBottom: space.sm,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  section: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.xl,
  },
  sheetActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  confirm: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
});
