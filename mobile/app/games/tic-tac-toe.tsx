import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export default function TicTacToeScreen() {
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Responsive board dimensions with bounds for both small and large displays
  const maxBoardWidth = Math.min(width - spacing.md * 2, 360);
  const cellGap = 10;
  const cellSize = Math.floor((maxBoardWidth - cellGap * 2) / 3);
  const actualBoardSize = cellSize * 3 + cellGap * 2;

  // 9 empty cells for initial UI shell
  const cells = Array(9).fill(null);

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
      {/* Title & subtitle */}
      <View style={[styles.headerSection, { marginBottom: spacing.md }]}>
        <Heading style={[styles.mainTitle, { color: colors.text }]}>
          Tic Tac Toe
        </Heading>
        <Subheading style={{ color: colors.textSecondary, marginTop: 2 }}>
          2 Player Multiplayer
        </Subheading>
      </View>

      {/* Match status card / players header */}
      <Card
        style={[
          styles.statusCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.card,
            marginBottom: spacing.lg,
          },
        ]}
      >
        <View style={styles.playersRow}>
          {/* Player X Badge */}
          <View style={styles.playerColumn}>
            <View
              style={[
                styles.playerSymbolBox,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.borderStrong,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Text variant="lg" weight="800" style={{ color: colors.text }}>
                X
              </Text>
            </View>
            <Text variant="xs" style={{ color: colors.textMuted, marginTop: 4 }}>
              Player 1
            </Text>
          </View>

          {/* Match status indicator */}
          <View style={styles.centerStatus}>
            <Badge label="Preparation Mode" variant="outline" size="sm" />
            <Text
              variant="xs"
              style={{ color: colors.textSecondary, marginTop: 6, textAlign: 'center' }}
            >
              Waiting for match
            </Text>
          </View>

          {/* Player O Badge */}
          <View style={styles.playerColumn}>
            <View
              style={[
                styles.playerSymbolBox,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.borderStrong,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Text variant="lg" weight="800" style={{ color: colors.text }}>
                O
              </Text>
            </View>
            <Text variant="xs" style={{ color: colors.textMuted, marginTop: 4 }}>
              Player 2
            </Text>
          </View>
        </View>
      </Card>

      {/* 3 x 3 Tic Tac Toe Board */}
      <View style={styles.boardWrapper}>
        <View
          style={[
            styles.boardContainer,
            {
              width: actualBoardSize,
              height: actualBoardSize,
              gap: cellGap,
            },
          ]}
        >
          {cells.map((_, index) => (
            <View
              key={index}
              style={[
                styles.cell,
                {
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                },
              ]}
              accessible={true}
              accessibilityRole="none"
              accessibilityLabel={`Cell ${index + 1}, empty`}
              accessibilityState={{ disabled: true }}
            />
          ))}
        </View>
      </View>

      {/* Development / Next step informational note */}
      <Card
        style={[
          styles.infoCard,
          {
            backgroundColor: colors.surfaceSubtle,
            borderColor: colors.borderSubtle,
            borderRadius: radii.card,
            marginTop: spacing.xl,
          },
        ]}
      >
        <View style={styles.infoContent}>
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={colors.textSecondary}
            style={{ marginRight: 10, marginTop: 2 }}
          />
          <View style={{ flex: 1 }}>
            <Text variant="sm" weight="600" style={{ color: colors.text }}>
              Multiplayer Connection
            </Text>
            <Text variant="xs" style={{ color: colors.textMuted, marginTop: 3 }}>
              Multiplayer connection will be enabled next.
            </Text>
          </View>
        </View>
      </Card>
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
  statusCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  playersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playerColumn: {
    alignItems: 'center',
    width: 64,
  },
  playerSymbolBox: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerStatus: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  boardWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  boardContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cell: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    padding: 14,
    borderWidth: 1,
  },
  infoContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});
