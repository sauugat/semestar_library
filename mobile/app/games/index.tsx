import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface GameItem {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  isPlayable: boolean;
  route?: string;
  badgeLabel: string;
}

const GAMES_LIST: GameItem[] = [
  {
    id: 'tic-tac-toe',
    title: 'Tic Tac Toe',
    description: 'Classic 2-player strategy',
    icon: 'grid-outline',
    isPlayable: true,
    route: '/games/tic-tac-toe',
    badgeLabel: 'PLAYABLE',
  },
  {
    id: 'ludo',
    title: 'Ludo',
    description: 'Classic 4-player board match',
    icon: 'dice-outline',
    isPlayable: false,
    badgeLabel: 'Coming Soon',
  },
  {
    id: 'color-cards',
    title: 'Color Cards',
    description: 'Fast-paced match & discard',
    icon: 'albums-outline',
    isPlayable: false,
    badgeLabel: 'Coming Soon',
  },
  {
    id: 'imposter',
    title: 'Imposter',
    description: 'Social deduction with friends',
    icon: 'people-outline',
    isPlayable: false,
    badgeLabel: 'Coming Soon',
  },
  {
    id: 'chess',
    title: 'Chess',
    description: 'Turn-based tactical mastery',
    icon: 'trophy-outline',
    isPlayable: false,
    badgeLabel: 'Coming Soon',
  },
  {
    id: 'more-games',
    title: 'More Games',
    description: 'New multiplayer games incoming',
    icon: 'sparkles-outline',
    isPlayable: false,
    badgeLabel: 'Coming Soon',
  },
];

export default function GamesHubScreen() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const handleGamePress = (game: GameItem) => {
    if (game.isPlayable && game.route) {
      router.push(game.route as any);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header section */}
      <View style={[styles.headerSection, { marginBottom: spacing.lg }]}>
        <Heading style={[styles.mainTitle, { color: colors.text }]}>Games</Heading>
        <Subheading style={[styles.subTitle, { color: colors.textSecondary }]}>
          Play with your classmates
        </Subheading>
        <Text variant="xs" style={{ color: colors.textMuted, marginTop: 4 }}>
          Multiplayer games powered by Semester Library
        </Text>
      </View>

      {/* Games list */}
      <View style={{ gap: spacing.sm }}>
        {GAMES_LIST.map((game) => {
          const isEnabled = game.isPlayable;

          return (
            <TouchableOpacity
              key={game.id}
              activeOpacity={isEnabled ? 0.7 : 1}
              onPress={() => handleGamePress(game)}
              disabled={!isEnabled}
              accessibilityRole="button"
              accessibilityLabel={`${game.title}, ${game.description}. ${game.badgeLabel}`}
              accessibilityState={{ disabled: !isEnabled }}
            >
              <Card
                style={[
                  styles.gameCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isEnabled ? colors.borderStrong : colors.border,
                    opacity: isEnabled ? 1 : 0.65,
                    borderRadius: radii.card,
                  },
                ]}
              >
                <View style={styles.cardContent}>
                  {/* Game icon container */}
                  <View
                    style={[
                      styles.iconContainer,
                      {
                        backgroundColor: isEnabled ? colors.surfaceRaised : colors.surfaceSubtle,
                        borderColor: isEnabled ? colors.borderStrong : colors.borderSubtle,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <Ionicons
                      name={game.icon}
                      size={24}
                      color={isEnabled ? colors.text : colors.textMuted}
                    />
                  </View>

                  {/* Title and description */}
                  <View style={styles.textContainer}>
                    <View style={styles.titleRow}>
                      <Text
                        variant="md"
                        weight="700"
                        style={{ color: isEnabled ? colors.text : colors.textSecondary }}
                        numberOfLines={1}
                      >
                        {game.title}
                      </Text>
                    </View>
                    <Text
                      variant="xs"
                      style={{ color: colors.textMuted, marginTop: 2 }}
                      numberOfLines={1}
                    >
                      {game.description}
                    </Text>
                  </View>

                  {/* Badge & action indicator */}
                  <View style={styles.actionContainer}>
                    <Badge
                      label={game.badgeLabel}
                      variant={isEnabled ? 'success' : 'neutral'}
                      size="sm"
                    />
                    {isEnabled && (
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textSecondary}
                        style={{ marginLeft: 6 }}
                      />
                    )}
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
  headerSection: {
    paddingTop: 4,
  },
  mainTitle: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  subTitle: {
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  gameCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
});
