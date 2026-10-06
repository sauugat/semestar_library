import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SecondaryButton } from '@/components/ui/Button';
import {
  AsyncStorageLudoStorageAdapter,
  restoreLocalLudoSession,
  type LocalLudoSessionSnapshot,
  type PlayerColor,
} from '@/services/ludo';

const LUDO_COLOR_MAP: Record<string, { name: string; hex: string; bg: string }> = {
  red: { name: 'Red', hex: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
  green: { name: 'Green', hex: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
  yellow: { name: 'Yellow', hex: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' },
  blue: { name: 'Blue', hex: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)' },
};

function getColorMeta(color: string | null | undefined): { name: string; hex: string; bg: string } {
  if (color && LUDO_COLOR_MAP[color]) {
    return LUDO_COLOR_MAP[color];
  }
  return { name: 'Player', hex: '#6B7280', bg: 'rgba(107, 114, 128, 0.12)' };
}

export default function LudoLocalMatchShell() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const [snapshot, setSnapshot] = useState<LocalLudoSessionSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const storage = React.useMemo(() => new AsyncStorageLudoStorageAdapter(), []);

  useEffect(() => {
    let isMounted = true;

    async function loadMatch() {
      try {
        const res = await restoreLocalLudoSession(storage);
        if (!isMounted) return;

        if (res.success && res.session) {
          setSnapshot(res.session.getSnapshot());
        } else {
          setErrorMessage(res.error || 'Failed to restore match session.');
        }
      } catch (err: any) {
        if (isMounted) {
          setErrorMessage(err?.message || 'Error restoring match.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadMatch();

    return () => {
      isMounted = false;
    };
  }, [storage]);

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="sm" style={{ color: colors.textMuted, marginTop: 12 }}>
          Loading offline match...
        </Text>
      </View>
    );
  }

  if (errorMessage || !snapshot) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background, padding: 24 }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text variant="md" weight="700" style={{ color: colors.text, marginTop: 12 }}>
          Game couldn't be loaded
        </Text>
        <Text
          variant="sm"
          style={{ color: colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 20 }}
        >
          {errorMessage || 'The saved Ludo game is damaged or unavailable.'}
        </Text>
        <SecondaryButton
          title="Back to Ludo"
          onPress={() => router.replace('/games/ludo' as any)}
        />
      </View>
    );
  }

  const isFinished = snapshot.status === 'finished';
  const currentTurnColor = snapshot.currentTurn;
  const currentTurnPlayer = snapshot.activePlayer;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom + spacing.xl, 40),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Match Header */}
      <View style={styles.headerRow}>
        <View>
          <Heading style={{ color: colors.text }}>LUDO</Heading>
          <Subheading style={{ color: colors.textSecondary }}>Offline Match</Subheading>
        </View>
        <Badge
          label={isFinished ? 'FINISHED' : 'PLAYING'}
          variant={isFinished ? 'neutral' : 'success'}
          size="sm"
        />
      </View>

      {/* Turn or Results Card */}
      <Card
        style={[
          styles.turnCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.borderStrong,
            borderRadius: radii.card,
            marginBottom: spacing.md,
          },
        ]}
      >
        {isFinished ? (
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Ionicons name="trophy" size={32} color="#F59E0B" />
            <Text variant="lg" weight="800" style={{ color: colors.text, marginTop: 6 }}>
              Game Finished!
            </Text>
            {snapshot.winner && (
              <Text variant="sm" weight="600" style={{ color: colors.textSecondary, marginTop: 4 }}>
                Winner: {getColorMeta(snapshot.winner).name} Player
              </Text>
            )}
            {snapshot.rankings.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                {snapshot.rankings.map((c, idx) => (
                  <Badge
                    key={c}
                    label={`${idx + 1}. ${getColorMeta(c).name}`}
                    variant="neutral"
                    size="sm"
                  />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View>
            <Caption style={{ color: colors.textMuted }}>Current Turn</Caption>
            <View style={styles.turnDetailRow}>
              {currentTurnColor && (
                <View
                  style={[
                    styles.turnColorBox,
                    { backgroundColor: getColorMeta(currentTurnColor).hex },
                  ]}
                />
              )}
              <View style={{ flex: 1 }}>
                <Text variant="md" weight="700" style={{ color: colors.text }}>
                  {currentTurnPlayer
                    ? `${getColorMeta(currentTurnPlayer.color).name} — ${currentTurnPlayer.displayName}`
                    : 'Unknown'}
                </Text>
                <Text variant="xs" style={{ color: colors.textMuted }}>
                  {snapshot.isBotTurn ? 'Bot Thinking' : 'Pass and play on this device'}
                </Text>
              </View>
            </View>

            {snapshot.turnPhase === 'move' && snapshot.currentRoll !== null && (
              <View
                style={[
                  styles.phaseNoticeBox,
                  { backgroundColor: colors.surfaceRaised, borderRadius: radii.md },
                ]}
              >
                <Ionicons name="dice-outline" size={18} color={colors.primary} />
                <Text variant="xs" weight="600" style={{ color: colors.text, marginLeft: 6 }}>
                  Move Phase: Rolled {snapshot.currentRoll} • {snapshot.legalMoves.length} Legal Moves
                </Text>
              </View>
            )}
          </View>
        )}
      </Card>

      {/* Players List Card */}
      <Card
        style={[
          styles.playersCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.card,
            marginBottom: spacing.md,
          },
        ]}
      >
        <Text variant="sm" weight="700" style={{ color: colors.text, marginBottom: spacing.sm }}>
          Players
        </Text>

        <View style={{ gap: spacing.xs }}>
          {snapshot.seats.map((seat) => {
            const meta = getColorMeta(seat.color);
            const isClosed = seat.status === 'closed';
            const isCurrentTurn = !isClosed && snapshot.currentTurn === seat.color;

            return (
              <View
                key={seat.color}
                style={[
                  styles.playerRow,
                  {
                    backgroundColor: isCurrentTurn
                      ? colors.surfaceRaised
                      : colors.surfaceSubtle,
                    borderColor: isCurrentTurn ? colors.borderStrong : colors.borderSubtle,
                    borderRadius: radii.md,
                    opacity: isClosed ? 0.45 : 1,
                  },
                ]}
              >
                <View style={styles.playerInfoLeft}>
                  <View style={[styles.playerColorDot, { backgroundColor: meta.hex }]} />
                  <View>
                    <Text
                      variant="sm"
                      weight={isCurrentTurn ? '700' : '600'}
                      style={{ color: colors.text }}
                    >
                      {seat.displayName}
                    </Text>
                    <Caption style={{ color: colors.textMuted }}>
                      {meta.name} • {isClosed ? 'Closed' : seat.status === 'bot' ? `Bot (${seat.botDifficulty || 'Normal'})` : 'Human'}
                    </Caption>
                  </View>
                </View>

                {isCurrentTurn && (
                  <Badge label="TURN" variant="success" size="sm" />
                )}
              </View>
            );
          })}
        </View>
      </Card>

      {/* Neutral Match Status Banner */}
      <View
        style={[
          styles.devNoticeCard,
          {
            backgroundColor: colors.surfaceSubtle,
            borderColor: colors.borderSubtle,
            borderRadius: radii.md,
            marginBottom: spacing.lg,
          },
        ]}
      >
        <Ionicons name="checkmark-circle-outline" size={16} color={colors.textMuted} />
        <Caption style={{ color: colors.textMuted, marginLeft: 8 }}>
          Match ready
        </Caption>
      </View>

      {/* Return to Hub */}
      <SecondaryButton
        title="Leave Match"
        onPress={() => router.replace('/games/ludo' as any)}
        leftIcon={<Ionicons name="arrow-back" size={18} color={colors.text} />}
      />
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
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  turnCard: {
    padding: 16,
    borderWidth: 1.5,
  },
  turnDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  turnColorBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    marginRight: 10,
  },
  phaseNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginTop: 10,
  },
  playersCard: {
    padding: 16,
    borderWidth: 1,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  playerInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playerColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  devNoticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
  },
});
