import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { hairline } from '@/theme/tokens';

/**
 * The five tabs: Today, Read, Search, Library, More.
 *
 *  - Text only. No icons, so the labels are always visible and the bar stays
 *    light on a weak phone. The current tab is shown by color AND a bolder
 *    label, so it does not depend on color alone.
 *  - A hairline on top instead of a shadow (elevation 0).
 *  - Screens draw under the status bar, so each tab screen adds its own top
 *    safe-area padding. The bar adds the bottom one itself.
 *  - The bar hides while the keyboard is open (Search), so it does not ride
 *    up on top of the keyboard.
 */

/** Largest the labels may grow with the system font size, so five fit on a 360dp phone. */
const TAB_LABEL_MAX_SCALE = 1.3;

interface TabLabelProps {
  title: string;
  focused: boolean;
  color: string;
}

function TabLabel({ title, focused, color }: TabLabelProps) {
  return (
    <Text
      variant="caption"
      numberOfLines={1}
      maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}
      importantForAccessibility="no"
      style={[styles.label, { color, fontWeight: focused ? '700' : '400' }]}
    >
      {title}
    </Text>
  );
}

/** Builds the render function React Navigation wants for a tab label. */
function makeLabel(title: string) {
  return function renderTabLabel({ focused, color }: { focused: boolean; color: string }) {
    return <TabLabel title={title} focused={focused} color={color} />;
  };
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();

  const labels = useMemo(
    () => ({
      today: makeLabel(t('tabs.today')),
      read: makeLabel(t('tabs.read')),
      search: makeLabel(t('tabs.search')),
      library: makeLabel(t('tabs.library')),
      more: makeLabel(t('tabs.more')),
    }),
    [t],
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarHideOnKeyboard: true,
        // No icon: hide the slot completely, so the label sits in the middle.
        tabBarIcon: () => null,
        tabBarIconStyle: styles.noIcon,
        tabBarItemStyle: styles.item,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.divider,
          borderTopWidth: hairline,
          elevation: 0,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: t('tabs.today'),
          tabBarLabel: labels.today,
          tabBarAccessibilityLabel: t('tabs.today'),
        }}
      />
      <Tabs.Screen
        name="read"
        options={{
          title: t('tabs.read'),
          tabBarLabel: labels.read,
          tabBarAccessibilityLabel: t('tabs.read'),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t('tabs.search'),
          tabBarLabel: labels.search,
          tabBarAccessibilityLabel: t('tabs.search'),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: t('tabs.library'),
          tabBarLabel: labels.library,
          tabBarAccessibilityLabel: t('tabs.library'),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('tabs.more'),
          tabBarLabel: labels.more,
          tabBarAccessibilityLabel: t('tabs.more'),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  noIcon: {
    display: 'none',
  },
  item: {
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
