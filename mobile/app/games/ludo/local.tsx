import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button, PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import {
  AsyncStorageLudoStorageAdapter,
  restoreLocalLudoSession,
  type LocalLudoSession,
  type LocalLudoSessionSnapshot,
  type PlayerColor,
} from '@/services/ludo';
import {
  LudoBoard,
  LudoPlayerBar,
  LudoDice,
  canHumanRoll,
  isBoardInteractive,
  determineNextBotAction,
  shouldShowHandoff,
  formatActionStatusMessage,
  formatTurnStatus,
  getRankingsDisplay,
} from '@/components/games/ludo';

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

  // State
  const [snapshot, setSnapshot] = useState<LocalLudoSessionSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionPending, setIsActionPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  const [displayDiceValue, setDisplayDiceValue] = useState<number | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  // References for robust session ownership and async action guards
  const sessionRef = useRef<LocalLudoSession | null>(null);
  const mountedRef = useRef<boolean>(true);
  const actionLockRef = useRef<boolean>(false);
  const generationRef = useRef<number>(0);
  const botTimerRef = useRef<NodeJS.Timeout | null>(null);

  const storage = React.useMemo(() => new AsyncStorageLudoStorageAdapter(), []);

  // AppState listener to cancel pending presentation bot timer when backgrounded
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      setAppState(nextAppState);
      if (nextAppState !== 'active' && botTimerRef.current) {
        clearTimeout(botTimerRef.current);
        botTimerRef.current = null;
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // 1. Session restore on mount (single authoritative session for screen lifetime)
  useEffect(() => {
    mountedRef.current = true;

    async function loadMatch() {
      try {
        const res = await restoreLocalLudoSession(storage);
        if (!mountedRef.current) return;

        if (res.success && res.session) {
          sessionRef.current = res.session;
          const initialSnapshot = res.session.getSnapshot();
          setSnapshot(initialSnapshot);

          // If restored during move phase, display existing roll status and face
          if (initialSnapshot.turnPhase === 'move' && initialSnapshot.currentRoll !== null) {
            setStatusMessage(`Rolled a ${initialSnapshot.currentRoll}`);
            setDisplayDiceValue(initialSnapshot.currentRoll);
          } else {
            setDisplayDiceValue(null);
          }
        } else {
          setErrorMessage(res.error || 'Failed to restore match session.');
        }
      } catch (err: any) {
        if (mountedRef.current) {
          setErrorMessage(err?.message || 'Error restoring match.');
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    }

    void loadMatch();

    return () => {
      mountedRef.current = false;
      if (botTimerRef.current) {
        clearTimeout(botTimerRef.current);
        botTimerRef.current = null;
      }
      generationRef.current += 1;
    };
  }, [storage]);

  // 2. Action dispatchers
  const handleRollDice = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || !snapshot || actionLockRef.current || isActionPending) {
      return;
    }

    const handoffActive = shouldShowHandoff(snapshot);
    if (!canHumanRoll(snapshot, false, handoffActive)) {
      return;
    }

    actionLockRef.current = true;
    setIsActionPending(true);
    generationRef.current += 1;

    try {
      const result = await session.rollDice();
      if (!mountedRef.current) return;

      // Authoritative rolled value visually preserved on dice (including auto-pass & three-sixes)
      setDisplayDiceValue(result.rolledValue);

      const newSnapshot = session.getSnapshot();
      setSnapshot(newSnapshot);

      const msg = formatActionStatusMessage(result);
      if (msg) {
        setStatusMessage(msg);
      }

      if (result.persistenceWarning) {
        setPersistenceWarning('Game continued, but this turn couldn\'t be saved.');
      } else {
        setPersistenceWarning(null);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        Alert.alert('Action Error', err?.message || 'Could not roll dice.');
      }
    } finally {
      if (mountedRef.current) {
        setIsActionPending(false);
      }
      actionLockRef.current = false;
    }
  }, [snapshot, isActionPending]);

  const handleTokenPress = useCallback(
    async (tokenIndex: number) => {
      const session = sessionRef.current;
      if (!session || !snapshot || actionLockRef.current || isActionPending) {
        return;
      }

      const handoffActive = shouldShowHandoff(snapshot);
      if (!isBoardInteractive(snapshot, false, handoffActive)) {
        return;
      }

      actionLockRef.current = true;
      setIsActionPending(true);
      generationRef.current += 1;

      try {
        const result = await session.moveToken(tokenIndex);
        if (!mountedRef.current) return;

        const newSnapshot = session.getSnapshot();
        setSnapshot(newSnapshot);

        // If turn passes to another player in roll phase, reset dice to idle
        if (newSnapshot.turnPhase === 'roll' && newSnapshot.currentTurn !== snapshot.currentTurn) {
          setDisplayDiceValue(null);
        }

        const msg = formatActionStatusMessage(result);
        if (msg) {
          setStatusMessage(msg);
        }

        if (result.persistenceWarning) {
          setPersistenceWarning('Game continued, but this turn couldn\'t be saved.');
        } else {
          setPersistenceWarning(null);
        }
      } catch (err: any) {
        if (mountedRef.current) {
          Alert.alert('Move Error', err?.message || 'Illegal token move.');
        }
      } finally {
        if (mountedRef.current) {
          setIsActionPending(false);
        }
        actionLockRef.current = false;
      }
    },
    [snapshot, isActionPending]
  );

  const handleAcknowledgeHandoff = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;

    try {
      await session.acknowledgeHandoff();
    } catch {
      session.clearHandoff();
    }

    if (!mountedRef.current) return;
    setDisplayDiceValue(null);
    const updated = session.getSnapshot();
    setSnapshot(updated);
  }, []);

  const handleLeaveMatch = useCallback(() => {
    if (!snapshot || snapshot.status === 'finished') {
      router.replace('/games/ludo' as any);
      return;
    }

    Alert.alert(
      'Leave match?',
      'Your game is saved and can be resumed later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            router.replace('/games/ludo' as any);
          },
        },
      ]
    );
  }, [snapshot, router]);

  const handleStartNewGame = useCallback(() => {
    router.push('/games/ludo/setup?replace=1' as any);
  }, [router]);

  // 3. Bot Turn Orchestration Effect
  useEffect(() => {
    if (!snapshot || (snapshot.status !== 'finished' && !snapshot.isBotTurn)) {
      if (botTimerRef.current) {
        clearTimeout(botTimerRef.current);
        botTimerRef.current = null;
      }
      return;
    }

    if (snapshot.status !== 'playing' || appState !== 'active') {
      return;
    }

    const isHandoffActive = shouldShowHandoff(snapshot);
    const nextBotAction = determineNextBotAction(snapshot, isActionPending, isHandoffActive);

    if (!nextBotAction) {
      return;
    }

    // Clear any previous timer
    if (botTimerRef.current) {
      clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }

    const currentGen = generationRef.current;
    const delay = nextBotAction === 'BOT_ROLL' ? 650 : 750;

    botTimerRef.current = setTimeout(async () => {
      // Guard against stale async execution and background transitions
      if (
        !mountedRef.current ||
        generationRef.current !== currentGen ||
        actionLockRef.current ||
        !sessionRef.current ||
        appState !== 'active'
      ) {
        return;
      }

      actionLockRef.current = true;
      setIsActionPending(true);

      try {
        const session = sessionRef.current;
        const result =
          nextBotAction === 'BOT_ROLL'
            ? await session.performBotRoll()
            : await session.performBotMove();

        if (!mountedRef.current || generationRef.current !== currentGen) {
          return;
        }

        if (result.type === 'ROLL') {
          setDisplayDiceValue(result.rolledValue);
        }

        const updatedSnapshot = session.getSnapshot();
        setSnapshot(updatedSnapshot);

        if (
          nextBotAction === 'BOT_MOVE' &&
          updatedSnapshot.turnPhase === 'roll' &&
          updatedSnapshot.currentTurn !== snapshot.currentTurn
        ) {
          setDisplayDiceValue(null);
        }

        const msg = formatActionStatusMessage(result);
        if (msg) {
          setStatusMessage(msg);
        }

        if (result.persistenceWarning) {
          setPersistenceWarning('Game continued, but this turn couldn\'t be saved.');
        } else {
          setPersistenceWarning(null);
        }
      } catch (err: any) {
        // Safe logging of bot error without crash
      } finally {
        if (mountedRef.current) {
          setIsActionPending(false);
        }
        actionLockRef.current = false;
      }
    }, delay);

    return () => {
      if (botTimerRef.current) {
        clearTimeout(botTimerRef.current);
        botTimerRef.current = null;
      }
    };
  }, [snapshot, isActionPending, appState]);

  // Loading state
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

  // Error state
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
  const activeCount = snapshot.seats.filter((s) => s.status !== 'closed').length;
  const isHandoffActive = shouldShowHandoff(snapshot);
  const handoffData = snapshot.handoff;

  const canRoll = canHumanRoll(snapshot, isActionPending, isHandoffActive);
  const isBoardInteractiveNow = isBoardInteractive(snapshot, isActionPending, isHandoffActive);
  const turnPresentation = formatTurnStatus(snapshot, isActionPending);
  const currentTurnMeta = getColorMeta(currentTurnColor);
  const rankings = isFinished ? getRankingsDisplay(snapshot) : [];

  // Visual dice value: uses authoritative currentRoll during move phase, or preserved displayDiceValue
  const activeDiceValue =
    snapshot.turnPhase === 'move'
      ? (snapshot.currentRoll !== null ? snapshot.currentRoll : displayDiceValue)
      : displayDiceValue;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.container}
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

        {/* Persistence Warning Alert if any */}
        {persistenceWarning && (
          <View style={[styles.warningBanner, { backgroundColor: '#78350F', borderRadius: radii.sm }]}>
            <Ionicons name="warning-outline" size={16} color="#FDE68A" />
            <Text variant="xs" style={{ color: '#FDE68A', marginLeft: 6, flex: 1 }}>
              {persistenceWarning}
            </Text>
          </View>
        )}

        {/* 2. Top Turn Strip */}
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
          <View style={styles.turnDetailRow}>
            {currentTurnColor && !isFinished && (
              <View
                style={[
                  styles.turnColorBox,
                  { backgroundColor: currentTurnMeta.hex },
                ]}
              />
            )}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="sm" weight="700" style={{ color: colors.text }} numberOfLines={1}>
                  {turnPresentation.title}
                </Text>
                {statusMessage ? (
                  <Badge label={statusMessage} variant="neutral" size="sm" />
                ) : null}
              </View>
              <Text variant="xs" style={{ color: colors.textMuted, fontSize: 11, marginTop: 1 }}>
                {turnPresentation.subtitle}
              </Text>
            </View>
          </View>
        </Card>

        {/* 3. Authoritative 15x15 Ludo Board */}
        <View style={styles.boardWrapper}>
          <LudoBoard
            snapshot={snapshot}
            onTokenPress={handleTokenPress}
            disabled={!isBoardInteractiveNow}
          />
        </View>

        {/* 4. Controls & Dice Strip (when game is active) */}
        {!isFinished && (
          <Card
            style={[
              styles.controlsCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderStrong,
                borderRadius: radii.md,
                marginTop: spacing.xs,
              },
            ]}
          >
            <View style={styles.controlsRow}>
              {/* Static Dice Component */}
              <View style={styles.diceContainer}>
                <LudoDice
                  value={activeDiceValue}
                  size={50}
                  disabled={isActionPending}
                />
              </View>

              {/* Action Area */}
              <View style={styles.actionContainer}>
                {canRoll ? (
                  <TouchableOpacity
                    style={[
                      styles.rollButton,
                      {
                        backgroundColor: currentTurnMeta.hex,
                        borderRadius: radii.md,
                        opacity: isActionPending ? 0.7 : 1,
                      },
                    ]}
                    onPress={handleRollDice}
                    activeOpacity={0.8}
                    disabled={isActionPending || !canRoll}
                    accessibilityRole="button"
                    accessibilityLabel="Roll Dice"
                    accessibilityState={{ disabled: isActionPending || !canRoll }}
                  >
                    <Ionicons name="dice" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text variant="sm" weight="800" style={{ color: '#FFFFFF', letterSpacing: 0.5 }}>
                      ROLL DICE
                    </Text>
                  </TouchableOpacity>
                ) : snapshot.turnPhase === 'move' && !snapshot.isBotTurn ? (
                  <View style={styles.instructionBox}>
                    <Text variant="sm" weight="700" style={{ color: colors.text }}>
                      Select a highlighted token
                    </Text>
                    <Caption style={{ color: colors.textMuted }}>
                      Tap one of your selectable tokens to move
                    </Caption>
                  </View>
                ) : snapshot.isBotTurn ? (
                  <View style={styles.instructionBox}>
                    <Text variant="sm" weight="700" style={{ color: colors.text }}>
                      {turnPresentation.title}
                    </Text>
                    <Caption style={{ color: colors.textMuted }}>
                      {turnPresentation.subtitle}
                    </Caption>
                  </View>
                ) : (
                  <View style={styles.instructionBox}>
                    <Caption style={{ color: colors.textMuted }}>
                      Waiting for turn...
                    </Caption>
                  </View>
                )}
              </View>
            </View>
          </Card>
        )}

        {/* 5. Finished Game Results Podium */}
        {isFinished && (
          <Card
            style={[
              styles.finishedCard,
              {
                backgroundColor: colors.surface,
                borderColor: '#D97706',
                borderRadius: radii.md,
                marginTop: spacing.xs,
              },
            ]}
          >
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <Ionicons name="trophy" size={32} color="#F59E0B" />
              <Heading style={{ fontSize: 18, color: colors.text, marginTop: 4 }}>
                Match Finished!
              </Heading>
              <Text variant="xs" style={{ color: colors.textMuted }}>
                Final standings
              </Text>
            </View>

            <View style={styles.rankingsList}>
              {rankings.map((r) => {
                const meta = getColorMeta(r.color);
                return (
                  <View key={r.color} style={styles.rankingRow}>
                    <View style={styles.rankBadge}>
                      <Text variant="sm" weight="800" style={{ color: colors.text }}>
                        #{r.rank}
                      </Text>
                    </View>
                    <View style={[styles.turnColorBox, { backgroundColor: meta.hex }]} />
                    <View style={{ flex: 1 }}>
                      <Text variant="sm" weight="700" style={{ color: colors.text }}>
                        {r.displayName}
                      </Text>
                    </View>
                    <Badge
                      label={r.isBot ? 'Bot' : 'Human'}
                      variant="neutral"
                      size="sm"
                    />
                  </View>
                );
              })}
            </View>

            <View style={styles.finishedActionsRow}>
              <PrimaryButton
                title="New Game"
                onPress={handleStartNewGame}
                leftIcon={<Ionicons name="add" size={18} color={colors.primaryText} />}
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <SecondaryButton
                title="Back to Ludo"
                onPress={handleLeaveMatch}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        )}

        {/* 6. Compact Player Scoreboard */}
        <View style={{ marginTop: spacing.xs }}>
          <LudoPlayerBar
            seats={snapshot.seats}
            currentTurn={snapshot.currentTurn}
            isGameFinished={isFinished}
          />
        </View>

        {/* 7. Understated Leave Match Action */}
        <View style={styles.footerWrapper}>
          <TouchableOpacity
            style={[
              styles.leaveBtn,
              {
                borderColor: colors.borderSubtle,
                borderRadius: radii.sm,
              },
            ]}
            onPress={handleLeaveMatch}
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

      {/* 8. Pass-The-Phone Handoff Overlay (Human A -> Human B, strictly absent when game finished) */}
      {isHandoffActive && handoffData && !isFinished && (
        <View style={styles.handoffBackdrop}>
          <Card
            style={[
              styles.handoffCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderStrong,
                borderRadius: radii.lg,
              },
            ]}
          >
            <Ionicons name="phone-portrait-outline" size={44} color={getColorMeta(handoffData.toPlayer.color).hex} />
            <Heading style={{ fontSize: 20, color: colors.text, marginTop: 12, textAlign: 'center' }}>
              PASS THE PHONE
            </Heading>
            <Text variant="sm" style={{ color: colors.textSecondary, marginTop: 6, textAlign: 'center' }}>
              Hand the device to:
            </Text>
            <View style={styles.handoffPlayerBadge}>
              <View
                style={[
                  styles.turnColorBox,
                  { backgroundColor: getColorMeta(handoffData.toPlayer.color).hex },
                ]}
              />
              <Text variant="md" weight="800" style={{ color: colors.text }}>
                {handoffData.toPlayer.displayName}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.readyButton,
                {
                  backgroundColor: getColorMeta(handoffData.toPlayer.color).hex,
                  borderRadius: radii.md,
                },
              ]}
              onPress={handleAcknowledgeHandoff}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="I'm ready"
            >
              <Text variant="sm" weight="800" style={{ color: '#FFFFFF', letterSpacing: 0.5 }}>
                I'M READY
              </Text>
            </TouchableOpacity>
          </Card>
        </View>
      )}
    </View>
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
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
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
  controlsCard: {
    padding: 12,
    borderWidth: 1.5,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  diceContainer: {
    marginRight: 14,
  },
  actionContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  rollButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  instructionBox: {
    justifyContent: 'center',
  },
  finishedCard: {
    padding: 16,
    borderWidth: 1.5,
  },
  rankingsList: {
    marginBottom: 16,
    gap: 8,
  },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  rankBadge: {
    width: 28,
  },
  finishedActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  handoffBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 100,
  },
  handoffCard: {
    width: '100%',
    maxWidth: 340,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  handoffPlayerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginVertical: 18,
  },
  readyButton: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
