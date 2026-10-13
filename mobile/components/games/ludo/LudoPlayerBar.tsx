import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/Typography';
import { Badge } from '@/components/ui/Badge';
import { useTheme } from '@/constants/useTheme';
import type { LocalSeatConfig } from '../../../types/ludo-session';
import type { PlayerColor } from '../../../../packages/ludo-engine/src/index.ts';
import type { LudoControlMode, LudoPresenceStatus } from '../../../services/ludo-online/index.ts';

const PLAYER_CHIP_COLORS: Record<PlayerColor, { hex: string; bg: string }> = {
  red: { hex: '#DC2626', bg: 'rgba(220, 38, 38, 0.14)' },
  green: { hex: '#059669', bg: 'rgba(5, 150, 105, 0.14)' },
  yellow: { hex: '#D97706', bg: 'rgba(217, 119, 6, 0.16)' },
  blue: { hex: '#2563EB', bg: 'rgba(37, 99, 235, 0.14)' },
};

export interface LudoPlayerBarSeat {
  color: PlayerColor;
  status: 'human' | 'bot' | 'closed' | 'open';
  displayName: string | null;
  botDifficulty?: string | null;
  isYou?: boolean;
  isOnline?: boolean;
  controlMode?: LudoControlMode;
  presence?: LudoPresenceStatus;
  countdownText?: string | null;
  isRanked?: boolean;
}

export interface LudoPlayerBarProps {
  seats: (LocalSeatConfig | LudoPlayerBarSeat)[];
  currentTurn: PlayerColor | null;
  isGameFinished: boolean;
}

export function LudoPlayerBar({
  seats,
  currentTurn,
  isGameFinished,
}: LudoPlayerBarProps) {
  const { colors, radii, isDark } = useTheme();

  const activeSeats = seats.filter((s) => s.status !== 'closed' && s.status !== 'open');
  const isTwoPlayer = activeSeats.length === 2;

  return (
    <View style={styles.container}>
      <View style={styles.chipsRow}>
        {activeSeats.map((seat) => {
          const meta = PLAYER_CHIP_COLORS[seat.color];
          const isTurn = !isGameFinished && currentTurn === seat.color;
          const barSeat = seat as LudoPlayerBarSeat;
          const rawSeat = seat as any;

          const isTakeover =
            barSeat.controlMode === 'takeover-bot' || barSeat.presence === 'abandoned';
          const isReconnecting = barSeat.presence === 'reconnecting';
          const isBot =
            !isTakeover &&
            (seat.status === 'bot' || rawSeat.isBot || barSeat.controlMode === 'bot');

          const displayName =
            seat.displayName || rawSeat.name || seat.color.toUpperCase();

          let desc = 'Human Player';
          let accessibilityLabel = '';

          if (isTakeover) {
            desc = 'Bot takeover';
            accessibilityLabel = barSeat.isYou
              ? `Your seat, bot takeover, ${seat.color}${isTurn ? ', current turn' : ''}`
              : `${displayName}, bot takeover, ${seat.color}${isTurn ? ', current turn' : ''}`;
          } else if (isReconnecting) {
            if (barSeat.isRanked && !barSeat.countdownText) {
              desc = 'Finished';
              accessibilityLabel = `${displayName}, finished, ${seat.color}`;
            } else {
              desc = barSeat.countdownText
                ? `Reconnecting • ${barSeat.countdownText}`
                : 'Reconnecting…';
              accessibilityLabel = `${displayName}, reconnecting${
                barSeat.countdownText ? `, ${barSeat.countdownText} remaining` : ''
              }, ${seat.color}${isTurn ? ', current turn' : ''}`;
            }
          } else if (isBot) {
            const diff =
              seat.botDifficulty || rawSeat.botDifficulty
                ? (seat.botDifficulty || rawSeat.botDifficulty).charAt(0).toUpperCase() +
                  (seat.botDifficulty || rawSeat.botDifficulty).slice(1)
                : 'Normal';
            desc = `Bot • ${diff}`;
            accessibilityLabel = `${displayName}, bot, ${diff}, ${seat.color}${isTurn ? ', current turn' : ''}`;
          } else {
            if (barSeat.isOnline !== undefined) {
              desc = barSeat.isOnline ? 'Online' : 'Offline';
            } else {
              desc = 'Online';
            }
            accessibilityLabel = `${displayName}${barSeat.isYou ? ' (You)' : ''}, ${seat.color}, ${desc}${isTurn ? ', current turn' : ''}`;
          }

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
              accessibilityLabel={accessibilityLabel}
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
                    {displayName}
                  </Text>
                  {barSeat.isYou && (
                    <View style={styles.youBadge}>
                      <Text variant="xs" weight="800" style={styles.youBadgeText}>
                        YOU
                      </Text>
                    </View>
                  )}
                  {isTakeover && (
                    <View style={styles.takeoverBadge}>
                      <Text variant="xs" weight="800" style={styles.takeoverBadgeText}>
                        BOT
                      </Text>
                    </View>
                  )}
                  {isTurn && (
                    <View style={[styles.turnIndicatorDot, { backgroundColor: meta.hex }]} />
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
                  {!isBot && !isTakeover && barSeat.isOnline !== undefined && (
                    <View
                      style={[
                        styles.presenceDot,
                        {
                          backgroundColor: isReconnecting
                            ? '#F59E0B'
                            : barSeat.isOnline
                            ? '#10B981'
                            : '#6B7280',
                        },
                      ]}
                    />
                  )}
                  {isTakeover && (
                    <View
                      style={[
                        styles.presenceDot,
                        { backgroundColor: '#F97316' },
                      ]}
                    />
                  )}
                  <Text
                    variant="xs"
                    style={{
                      color: isReconnecting ? '#F59E0B' : colors.textMuted,
                      fontSize: 10,
                      fontWeight: isReconnecting ? '700' : '400',
                    }}
                    numberOfLines={1}
                  >
                    {desc}
                  </Text>
                </View>
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
  youBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
    marginLeft: 6,
  },
  youBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    lineHeight: 11,
  },
  takeoverBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: '#F97316',
    marginLeft: 6,
  },
  takeoverBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    lineHeight: 11,
  },
  presenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
});
