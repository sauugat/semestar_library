import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
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
import { LudoBoard, LudoPlayerBar } from '@/components/games/ludo';

const LUDO_COLOR_MAP: Record<string, { name: string; hex: string; bg: string }> = {
  red: { name: 'Red', hex: '#DC2626', bg: 'rgba(220, 38, 38, 0.14)' },
  green: { name: 'Green', hex: '#059669', bg: 'rgba(5, 150, 105, 0.14)' },
  yellow: { name: 'Yellow', hex: '#D97706', bg: 'rgba(217, 119, 6, 0.16)' },
  blue: { name: 'Blue', hex: '#2563EB', bg: 'rgba(37, 99, 235, 0.14)' },
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
  const activeCount = snapshot.seats.filter((s) => s.status !== 'closed').length;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingHorizontal: spacing.sm,
          paddingTop: spacing.xs,
          paddingBottom: Math.max(insets.bottom + spacing.md, 24),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. Compact Match Header */}
      <View style={styles.headerRow}>
        <View>
          <Text variant="sm" weight="800" style={{ color: colors.text, letterSpacing: 0.5 }}>
            OFFLINE MATCH
          </Text>
          <Text variant="xs" style={{ color: colors.textMuted }}>
            {activeCount} Players • Pass & Play
          </Text>
        </View>
        <Badge
          label={isFinished ? 'FINISHED' : 'PLAYING'}
          variant={isFinished ? 'neutral' : 'success'}
          size="sm"
        />
      </View>

      {/* 2. Compact Status / Turn Strip */}
      <Card
        style={[
          styles.turnCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.borderStrong,
            borderRadius: radii.md,
            marginBottom: spacing.xs,
          },
        ]}
      >
        {isFinished ? (
          <View style={{ alignItems: 'center', paddingVertical: 4 }}>
            <Ionicons name="trophy" size={26} color="#F59E0B" />
            <Text variant="sm" weight="800" style={{ color: colors.text, marginTop: 2 }}>
              Game Finished!
            </Text>
            {snapshot.winner && (
              <Text variant="xs" weight="600" style={{ color: colors.textSecondary }}>
                Winner: {getColorMeta(snapshot.winner).name} Player
              </Text>
            )}
            {snapshot.rankings.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="sm" weight="700" style={{ color: colors.text }} numberOfLines={1}>
                  {currentTurnPlayer?.displayName || 'Player'}
                </Text>
                {snapshot.turnPhase === 'move' && snapshot.currentRoll !== null && (
                  <Badge
                    label={`Rolled ${snapshot.currentRoll}`}
                    variant="neutral"
                    size="sm"
                  />
                )}
              </View>
              <Text variant="xs" style={{ color: colors.textMuted, fontSize: 11, marginTop: 1 }}>
                {snapshot.isBotTurn ? 'Bot Thinking...' : 'Your turn to roll'}
              </Text>
            </View>
          </View>
        )}
      </Card>

      {/* 3. Authoritative 15x15 Ludo Board */}
      <View style={styles.boardWrapper}>
        <LudoBoard snapshot={snapshot} />
      </View>

      {/* 4. Compact Player Scoreboard */}
      <LudoPlayerBar
        seats={snapshot.seats}
        currentTurn={snapshot.currentTurn}
        isGameFinished={isFinished}
      />

      {/* 5. Understated Leave Match Action */}
      <View style={styles.footerWrapper}>
        <TouchableOpacity
          style={[
            styles.leaveBtn,
            {
              borderColor: colors.borderSubtle,
              borderRadius: radii.sm,
            },
          ]}
          onPress={() => router.replace('/games/ludo' as any)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Leave Match"
        >
          <Ionicons name="arrow-back" size={13} color={colors.textMuted} style={{ marginRight: 5 }} />
          <Text variant="xs" weight="600" style={{ color: colors.textMuted }}>
            Leave Match
          </Text>
        </TouchableOpacity>
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
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  turnCard: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1.5,
  },
  turnDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  turnColorBox: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 10,
  },
  boardWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  footerWrapper: {
    marginTop: 8,
    alignItems: 'center',
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
});
