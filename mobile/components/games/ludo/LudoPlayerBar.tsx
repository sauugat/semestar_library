import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/Typography';
import { Badge } from '@/components/ui/Badge';
import { useTheme } from '@/constants/useTheme';
import type { LocalSeatConfig } from '../../../types/ludo-session';
import type { PlayerColor } from '../../../../packages/ludo-engine/src/index.ts';

const PLAYER_CHIP_COLORS: Record<PlayerColor, { hex: string; bg: string }> = {
  red: { hex: '#DC2626', bg: 'rgba(220, 38, 38, 0.14)' },
  green: { hex: '#059669', bg: 'rgba(5, 150, 105, 0.14)' },
  yellow: { hex: '#D97706', bg: 'rgba(217, 119, 6, 0.16)' },
  blue: { hex: '#2563EB', bg: 'rgba(37, 99, 235, 0.14)' },
};

export interface LudoPlayerBarProps {
  seats: LocalSeatConfig[];
  currentTurn: PlayerColor | null;
  isGameFinished: boolean;
}

export function LudoPlayerBar({
  seats,
  currentTurn,
  isGameFinished,
}: LudoPlayerBarProps) {
  const { colors, radii, isDark } = useTheme();

  const activeSeats = seats.filter((s) => s.status !== 'closed');
  const isTwoPlayer = activeSeats.length === 2;

  return (
    <View style={styles.container}>
      <View style={styles.chipsRow}>
        {activeSeats.map((seat) => {
          const meta = PLAYER_CHIP_COLORS[seat.color];
          const isTurn = !isGameFinished && currentTurn === seat.color;
          const isBot = seat.status === 'bot';

          const desc = isBot
            ? `Bot • ${seat.botDifficulty ? seat.botDifficulty.charAt(0).toUpperCase() + seat.botDifficulty.slice(1) : 'Normal'}`
            : 'Human Player';

          return (
            <View
              key={seat.color}
              style={[
                styles.playerChip,
                isTwoPlayer ? styles.playerChipTwoUp : styles.playerChipFourUp,
                {
                  backgroundColor: isTurn
                    ? isDark
                      ? '#1E293B'
                      : '#FFFFFF'
                    : isDark
                    ? '#111827'
                    : '#F8FAFC',
                  borderColor: isTurn ? meta.hex : isDark ? '#1F2937' : '#E2E8F0',
                  borderWidth: isTurn ? 1.5 : 1,
                  borderRadius: radii.md,
                },
              ]}
              accessibilityRole="text"
              accessibilityLabel={`${seat.displayName}, ${seat.color}, ${desc}${isTurn ? ', current turn' : ''}`}
            >
              {/* Vertical Color Accent Pill */}
              <View style={[styles.colorPill, { backgroundColor: meta.hex }]} />
              <View style={styles.textStack}>
                <View style={styles.nameRow}>
                  <Text
                    variant="xs"
                    weight={isTurn ? '800' : '600'}
                    style={{ color: colors.text, flex: 1 }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {seat.displayName}
                  </Text>
                  {isTurn && (
                    <View style={[styles.turnIndicatorDot, { backgroundColor: meta.hex }]} />
                  )}
                </View>
                <Text variant="xs" style={{ color: colors.textMuted, fontSize: 10, marginTop: 1 }} numberOfLines={1}>
                  {desc}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 6,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  playerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 10,
    flexShrink: 1,
  },
  playerChipTwoUp: {
    flex: 1,
    minWidth: 130,
  },
  playerChipFourUp: {
    width: '48%',
    minWidth: 120,
  },
  colorPill: {
    width: 4,
    height: 22,
    borderRadius: 2,
    marginRight: 8,
  },
  textStack: {
    flex: 1,
    overflow: 'hidden',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  turnIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
  },
});
