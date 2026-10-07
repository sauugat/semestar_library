/**
 * Semester Library Games Platform - Online Ludo Game View
 *
 * Full authoritative online gameplay view using the canonical visual board,
 * dice, animated overlays, token hops, captures, haptics, and results UI.
 *
 * Authority rule: 100% server-authoritative. Mobile only sends:
 * - LUDO_ROLL_DICE
 * - LUDO_MOVE_TOKEN (tokenId)
 *
 * Replays ordered server actions via presentation projection and
 * settles on authoritative server snapshots.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  AccessibilityInfo,
  AppState,
  type AppStateStatus,
  BackHandler,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';

import {
  type PlayerColor,
  type LudoState,
  PLAYER_COLORS,
} from '../../../../packages/ludo-engine/src/index.ts';

import {
  LudoBoard,
  LudoDice,
  LudoPlayerBar,
  buildLudoBoardViewModelFromState,
  type GenericSeatPresentation,
  type LudoPlayerBarSeat,
  type TokenTravelPlan,
  type CaptureReturnPlan,
  buildTokenTravelPlan,
  buildCaptureReturnPlan,
  LudoHaptics,
} from './index.ts';

import {
  OnlineLudoClient,
  type LudoOnlineState,
  type LudoSeat,
  type LudoDiceRolledEvent,
  type LudoMoveResultEvent,
  type OnlinePresentationState,
  CANONICAL_COLORS,
  deriveMyColor,
  createPresentationStateFromEngine,
  projectDiceRolled,
  projectMoveResult,
  reconcileWithAuthoritativeState,
  canOnlineHumanRoll,
  getOnlineSelectableTokens,
  formatOnlineRollStatus,
  formatOnlineTurnStatus,
  resolveOnlineMoveHaptic,
} from '../../../services/ludo-online/index.ts';

export interface OnlineLudoGameViewProps {
  client: OnlineLudoClient;
  clientState: LudoOnlineState;
  onLeaveRoom: () => void;
}

const COLOR_ACCENTS: Record<PlayerColor, string> = {
  red: '#DC2626',
  green: '#059669',
  yellow: '#D97706',
  blue: '#2563EB',
};

export function OnlineLudoGameView({
  client,
  clientState,
  onLeaveRoom,
}: OnlineLudoGameViewProps) {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const { width } = useWindowDimensions();

  // Responsive board geometry: 15 cells across
  const maxBoardSize = 430;
  const horizontalPadding = 20;
  const targetWidth = Math.min(width - horizontalPadding, maxBoardSize);
  const boardSize = Math.floor(targetWidth);
  const cellSize = boardSize / 15;

  const myUserId = clientState.myUserId;
  const authoritativeSeats = clientState.playingState?.seats || ({} as Record<PlayerColor, LudoSeat>);
  const myColor = useMemo(
    () => deriveMyColor(authoritativeSeats, myUserId),
    [authoritativeSeats, myUserId]
  );
  const mySeat = myColor ? authoritativeSeats[myColor] : null;

  // Presentation State (visual truth while actions animate)
  const initialEngineState = clientState.playingState?.state as LudoState;
  const initialRevision = clientState.playingState?.revision || 0;
  const [presentationState, setPresentationState] = useState<OnlinePresentationState>(() =>
    createPresentationStateFromEngine(initialEngineState, initialRevision)
  );

  // Command submission lock
  const [pendingCommand, setPendingCommand] = useState<'roll' | 'move' | null>(null);
  const pendingCommandRef = useRef<'roll' | 'move' | null>(null);

  // Animation & Overlay state
  const [displayDiceValue, setDisplayDiceValue] = useState<number | null>(
    initialEngineState?.turnPhase === 'move' ? initialEngineState.currentRoll : null
  );
  const [isDiceRolling, setIsDiceRolling] = useState<boolean>(false);
  const [isMovementAnimating, setIsMovementAnimating] = useState<boolean>(false);
  const [travelPlan, setTravelPlan] = useState<TokenTravelPlan | null>(null);
  const [capturePlans, setCapturePlans] = useState<CaptureReturnPlan[]>([]);
  const [hiddenTokenKeys, setHiddenTokenKeys] = useState<string[]>([]);
  const [celebrationRank, setCelebrationRank] = useState<{
    color: PlayerColor;
    rank: number;
    displayName: string;
  } | null>(null);
  const [showWinnerCelebration, setShowWinnerCelebration] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isReducedMotion, setIsReducedMotion] = useState<boolean>(false);

  const isProcessingQueueRef = useRef<boolean>(false);
  const activeActionRef = useRef<any>(null);
  const pacingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clientStateRef = useRef<LudoOnlineState>(clientState);
  clientStateRef.current = clientState;

  // Intercept Android hardware back button during active game
  useEffect(() => {
    const onBackPress = () => {
      onLeaveRoom();
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => {
      sub.remove();
    };
  }, [onLeaveRoom]);

  // Reduced motion preference
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => setIsReducedMotion(Boolean(enabled)))
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setIsReducedMotion(Boolean(enabled));
    });

    return () => {
      sub?.remove?.();
    };
  }, []);

  // AppState background cancellation + foreground authoritative resync
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState !== 'active') {
        if (pacingTimerRef.current) {
          clearTimeout(pacingTimerRef.current);
          pacingTimerRef.current = null;
        }
        setTravelPlan(null);
        setCapturePlans([]);
        setHiddenTokenKeys([]);
        setIsMovementAnimating(false);
        setIsDiceRolling(false);
        setCelebrationRank(null);
        setShowWinnerCelebration(false);
        isProcessingQueueRef.current = false;
        activeActionRef.current = null;
        pendingCommandRef.current = null;
        setPendingCommand(null);

        // Snap to latest authoritative snapshot on background
        if (clientStateRef.current.playingState) {
          const authState = clientStateRef.current.playingState.state as LudoState;
          setPresentationState(
            reconcileWithAuthoritativeState(authState, clientStateRef.current.playingState.revision)
          );
          if (authState.turnPhase === 'move' && authState.currentRoll !== null) {
            setDisplayDiceValue(authState.currentRoll);
          } else {
            setDisplayDiceValue(null);
          }
        }
      } else {
        // Foreground transition:
        // If connected, request authoritative state so that controls remain blocked
        // (via isResyncing) until fresh authoritative truth is received from server.
        // If disconnected/reconnecting, the reconnect lifecycle will deliver fresh state.
        if (clientStateRef.current.connectionStatus === 'connected') {
          client.requestState();
        }
      }
    });

    return () => {
      sub.remove();
    };
  }, [client]);

  // Clean pending command on server errors
  useEffect(() => {
    if (clientState.lastError) {
      pendingCommandRef.current = null;
      setPendingCommand(null);
      if (
        clientState.lastError.code === 'NOT_YOUR_TURN' ||
        clientState.lastError.code === 'INVALID_PHASE' ||
        clientState.lastError.code === 'ILLEGAL_MOVE'
      ) {
        client.requestState();
      }
    }
  }, [clientState.lastError, client]);

  // Reconnect / Desync safety
  useEffect(() => {
    if (
      clientState.connectionStatus === 'reconnecting' ||
      clientState.isResyncing ||
      clientState.presentationGapDetected
    ) {
      if (pacingTimerRef.current) {
        clearTimeout(pacingTimerRef.current);
        pacingTimerRef.current = null;
      }
      setTravelPlan(null);
      setCapturePlans([]);
      setHiddenTokenKeys([]);
      setIsMovementAnimating(false);
      setIsDiceRolling(false);
      isProcessingQueueRef.current = false;
      activeActionRef.current = null;
      pendingCommandRef.current = null;
      setPendingCommand(null);
    }
  }, [
    clientState.connectionStatus,
    clientState.isResyncing,
    clientState.presentationGapDetected,
  ]);

  const isBoardBusy =
    isDiceRolling ||
    isMovementAnimating ||
    travelPlan !== null ||
    isProcessingQueueRef.current;

  // Action Queue Processing Loop
  const processNextQueuedAction = useCallback(() => {
    if (
      isProcessingQueueRef.current ||
      isDiceRolling ||
      isMovementAnimating ||
      travelPlan !== null
    ) {
      return;
    }

    if (
      clientState.connectionStatus !== 'connected' ||
      clientState.isResyncing ||
      clientState.presentationGapDetected
    ) {
      return;
    }

    const nextAction = client.peekNextAction();

    if (!nextAction) {
      // Queue empty: reconcile presentation with latest authoritative snapshot
      if (clientState.playingState) {
        const authEngine = clientState.playingState.state as LudoState;
        const authRev = clientState.playingState.revision;
        setPresentationState((prev: OnlinePresentationState) => {
          if (prev.revision <= authRev) {
            return reconcileWithAuthoritativeState(authEngine, authRev);
          }
          return prev;
        });

        if (authEngine.turnPhase === 'move' && authEngine.currentRoll !== null) {
          setDisplayDiceValue(authEngine.currentRoll);
        } else if (authEngine.turnPhase === 'roll') {
          setDisplayDiceValue(null);
        }
      }
      return;
    }

    isProcessingQueueRef.current = true;
    activeActionRef.current = nextAction;

    try {
      if (nextAction.type === 'LUDO_DICE_ROLLED') {
        const isMyAction =
          nextAction.color === myColor && pendingCommandRef.current === 'roll';
        pendingCommandRef.current = null;
        setPendingCommand(null);

        const seatName =
          authoritativeSeats[nextAction.color]?.displayName ||
          nextAction.color.toUpperCase();
        setStatusMessage(formatOnlineRollStatus(nextAction, nextAction.color === myColor, seatName));
        setDisplayDiceValue(nextAction.roll);
        setIsDiceRolling(true);

        if (isMyAction) {
          void LudoHaptics.rollStart();
        }
      } else if (nextAction.type === 'LUDO_MOVE_RESULT') {
        const isMyAction =
          nextAction.player === myColor && pendingCommandRef.current === 'move';
        pendingCommandRef.current = null;
        setPendingCommand(null);

        const plan = buildTokenTravelPlan(nextAction, cellSize, { isReducedMotion });
        const capPlans = buildCaptureReturnPlan(nextAction, cellSize, { isReducedMotion });

        if (plan) {
          const movingKey = `${nextAction.player}:${nextAction.tokenId}`;
          const capKeys = capPlans.map((c) => `${c.color}:${c.tokenIndex}`);
          setHiddenTokenKeys([movingKey, ...capKeys]);
          setTravelPlan(plan);
          setCapturePlans(capPlans);
          setIsMovementAnimating(true);
        } else {
          // No path (e.g. malformed or static) -> project directly
          setPresentationState((prev: OnlinePresentationState) => projectMoveResult(prev, nextAction));
          client.ackAction(nextAction);
          isProcessingQueueRef.current = false;
          activeActionRef.current = null;
          processNextQueuedAction();
        }
      } else {
        // Unrecognized action in queue -> acknowledge and continue
        client.ackAction(nextAction);
        isProcessingQueueRef.current = false;
        activeActionRef.current = null;
        processNextQueuedAction();
      }
    } catch (_err) {
      // Presentation failure safe: acknowledge failing action so queue is never blocked,
      // clear processing locks, and request authoritative snapshot.
      client.ackAction(nextAction);
      isProcessingQueueRef.current = false;
      activeActionRef.current = null;
      client.requestState();
    }
  }, [
    client,
    clientState.connectionStatus,
    clientState.isResyncing,
    clientState.presentationGapDetected,
    clientState.playingState,
    isDiceRolling,
    isMovementAnimating,
    travelPlan,
    myColor,
    authoritativeSeats,
    cellSize,
    isReducedMotion,
  ]);

  // Trigger queue check whenever actionQueue or snapshot changes
  useEffect(() => {
    processNextQueuedAction();
  }, [clientState.actionQueue.length, clientState.playingState?.revision, processNextQueuedAction]);

  // Dice Roll Completion Handler
  const handleDiceRollComplete = useCallback(
    (outcome: 'completed' | 'cancelled') => {
      setIsDiceRolling(false);
      const action = activeActionRef.current as LudoDiceRolledEvent;

      if (action && action.type === 'LUDO_DICE_ROLLED') {
        const isMyAction = action.color === myColor;
        if (outcome === 'completed' && isMyAction) {
          void LudoHaptics.rollSettle();
        }

        setPresentationState((prev: OnlinePresentationState) => projectDiceRolled(prev, action));
        client.ackAction(action);
      }

      isProcessingQueueRef.current = false;
      activeActionRef.current = null;

      // Pacing gap before next action (serially plays bot bursts)
      const pauseMs = action?.autoPassed || action?.threeSixesForfeit ? 500 : 250;
      pacingTimerRef.current = setTimeout(() => {
        processNextQueuedAction();
      }, pauseMs);
    },
    [client, myColor, processNextQueuedAction]
  );

  // Token Travel Completion Handler
  const handleTravelComplete = useCallback(
    (outcome: 'completed' | 'cancelled') => {
      const action = activeActionRef.current as LudoMoveResultEvent;

      if (!capturePlans || capturePlans.length === 0) {
        // No capture returns: complete move immediately
        finalizeMove(action, outcome);
      }
      // If captures exist, LudoBoard's overlay will now animate capture returns
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capturePlans]
  );

  // Capture Return Completion Handler
  const handleCaptureComplete = useCallback(
    (outcome: 'completed' | 'cancelled') => {
      const action = activeActionRef.current as LudoMoveResultEvent;
      finalizeMove(action, outcome);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const finalizeMove = (
    action: LudoMoveResultEvent,
    _outcome: 'completed' | 'cancelled'
  ) => {
    if (action && action.type === 'LUDO_MOVE_RESULT') {
      const isMyAction = action.player === myColor;

      // Centralized online haptic policy
      const hapticEvent = resolveOnlineMoveHaptic(action, isMyAction);
      if (hapticEvent === 'gameWin') {
        void LudoHaptics.gameWon();
      } else if (hapticEvent === 'rank') {
        void LudoHaptics.playerRanked();
      } else if (hapticEvent === 'finish') {
        void LudoHaptics.finishToken();
      } else if (hapticEvent === 'capture') {
        void LudoHaptics.capture();
      } else if (hapticEvent === 'step') {
        void LudoHaptics.rollSettle();
      }

      // Celebrations
      if (action.playerRanked) {
        const playerName =
          authoritativeSeats[action.player]?.displayName ||
          action.player.toUpperCase();
        setCelebrationRank({
          color: action.player,
          rank: action.rank || 1,
          displayName: playerName,
        });
      }

      if (action.gameFinished) {
        setShowWinnerCelebration(true);
      }

      setPresentationState((prev: OnlinePresentationState) => projectMoveResult(prev, action));
      client.ackAction(action);
    }

    setTravelPlan(null);
    setCapturePlans([]);
    setHiddenTokenKeys([]);
    setIsMovementAnimating(false);
    isProcessingQueueRef.current = false;
    activeActionRef.current = null;

    // Pacing gap before next queued action
    pacingTimerRef.current = setTimeout(() => {
      processNextQueuedAction();
    }, 280);
  };

  const handleCelebrationComplete = () => {
    setCelebrationRank(null);
  };

  const handleWinnerCelebrationComplete = () => {
    setShowWinnerCelebration(false);
  };

  // Human Roll Button Tap
  const canRoll = canOnlineHumanRoll({
    connectionStatus: clientState.connectionStatus,
    isResyncing: clientState.isResyncing,
    isPresentationBusy: isBoardBusy,
    actionQueueLength: clientState.actionQueue.length,
    gameStatus: presentationState.status,
    currentTurn: presentationState.currentTurn,
    turnPhase: presentationState.turnPhase,
    myColor,
    mySeatStatus: mySeat?.status || null,
    pendingCommand,
  });

  const handleRollPress = () => {
    if (!canRoll) return;
    pendingCommandRef.current = 'roll';
    setPendingCommand('roll');
    void LudoHaptics.rollStart();
    const sent = client.rollDice();
    if (!sent) {
      pendingCommandRef.current = null;
      setPendingCommand(null);
    }
  };

  // Human Token Tap on Board
  const selectableTokenIds = getOnlineSelectableTokens({
    connectionStatus: clientState.connectionStatus,
    isResyncing: clientState.isResyncing,
    isPresentationBusy: isBoardBusy,
    gameStatus: presentationState.status,
    currentTurn: presentationState.currentTurn,
    turnPhase: presentationState.turnPhase,
    myColor,
    legalMoves: presentationState.legalMoves,
    pendingCommand,
  });

  const handleTokenPress = (tokenIndex: number) => {
    if (!selectableTokenIds.includes(tokenIndex)) return;
    if (pendingCommand !== null || isBoardBusy) return;

    pendingCommandRef.current = 'move';
    setPendingCommand('move');
    void LudoHaptics.tokenSelected();
    const sent = client.moveToken(tokenIndex);
    if (!sent) {
      pendingCommandRef.current = null;
      setPendingCommand(null);
    }
  };

  // Build Board View Model
  const boardViewModel = useMemo(() => {
    const seatsPresentation: Record<PlayerColor, GenericSeatPresentation> = {
      red: { color: 'red', status: 'closed', displayName: null },
      green: { color: 'green', status: 'closed', displayName: null },
      yellow: { color: 'yellow', status: 'closed', displayName: null },
      blue: { color: 'blue', status: 'closed', displayName: null },
    };

    for (const color of CANONICAL_COLORS) {
      const seat = authoritativeSeats[color as PlayerColor];
      if (seat) {
        seatsPresentation[color as PlayerColor] = {
          color: seat.color,
          status: seat.status,
          displayName: seat.displayName,
          botDifficulty: seat.botDifficulty,
          isYou: seat.status === 'human' && seat.userId === myUserId,
          isOnline: seat.userId ? Boolean(clientState.presence[seat.userId]) : true,
        };
      }
    }

    const engineStateLike: LudoState = {
      gameType: 'ludo',
      status: presentationState.status,
      activeColors: Object.values(seatsPresentation)
        .filter((s) => s.status !== 'closed')
        .map((s) => s.color),
      players: {} as any,
      tokens: presentationState.tokens,
      currentTurn: presentationState.currentTurn,
      turnPhase: presentationState.turnPhase,
      currentRoll: presentationState.currentRoll,
      consecutiveSixes: 0,
      legalMoves: selectableTokenIds.map((idx: number) => ({ tokenIndex: idx } as any)),
      rankings: presentationState.rankings,
      lastAction: null,
      round: 1,
      revision: presentationState.revision,
    };

    return buildLudoBoardViewModelFromState({
      engineState: engineStateLike,
      seats: seatsPresentation,
      selectableTokenIds,
      currentTurn: presentationState.currentTurn,
      winner: presentationState.winner,
      rankings: presentationState.rankings,
    });
  }, [
    authoritativeSeats,
    myUserId,
    clientState.presence,
    presentationState,
    selectableTokenIds,
  ]);

  // Player Bar Seats
  const playerBarSeats: LudoPlayerBarSeat[] = useMemo(() => {
    return CANONICAL_COLORS.map((color: PlayerColor) => {
      const s = authoritativeSeats[color];
      if (!s || s.status === 'closed') {
        return {
          color,
          status: 'closed' as const,
          displayName: null,
          isYou: false,
        };
      }
      return {
        color: s.color,
        status: s.status as 'human' | 'bot' | 'closed',
        displayName: s.displayName,
        botDifficulty: s.botDifficulty,
        isYou: s.status === 'human' && s.userId === myUserId,
        isOnline: s.userId ? Boolean(clientState.presence[s.userId]) : true,
      };
    });
  }, [authoritativeSeats, myUserId, clientState.presence]);

  // Turn status presentation
  const isMyTurn = presentationState.currentTurn === myColor;
  const currentSeat = presentationState.currentTurn
    ? authoritativeSeats[presentationState.currentTurn]
    : null;
  const currentTurnPlayerName =
    currentSeat?.displayName ||
    (presentationState.currentTurn ? presentationState.currentTurn.toUpperCase() : 'Waiting');
  const isCurrentTurnBot = currentSeat?.status === 'bot';

  const turnStatus = formatOnlineTurnStatus(
    presentationState.currentTurn,
    presentationState.turnPhase,
    isMyTurn,
    currentTurnPlayerName,
    isCurrentTurnBot,
    clientState.connectionStatus,
    clientState.isResyncing,
    presentationState.status === 'finished'
  );

  const turnAccent = presentationState.currentTurn
    ? COLOR_ACCENTS[presentationState.currentTurn]
    : colors.borderStrong;

  // Render Finished Standings Screen (Rule 38)
  if (presentationState.status === 'finished') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
          ]}
        >
          <Card
            style={[
              styles.finishedCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.primary,
                borderRadius: radii.card,
              },
            ]}
          >
            <View
              style={[
                styles.trophyBox,
                { backgroundColor: colors.surfaceRaised, borderRadius: radii.pill },
              ]}
            >
              <Ionicons name="trophy" size={48} color="#F59E0B" />
            </View>

            <Heading style={[styles.finishedTitle, { color: colors.text }]}>
              GAME FINISHED
            </Heading>
            <Text variant="sm" style={{ color: colors.textMuted, marginTop: 4 }}>
              Match completed • Room {clientState.roomId}
            </Text>

            <View style={[styles.rankingsList, { marginTop: spacing.lg }]}>
              {presentationState.rankings.map((color: PlayerColor, idx: number) => {
                const seat = authoritativeSeats[color];
                const isYou = seat?.status === 'human' && seat?.userId === myUserId;
                const place = idx === 0 ? '1st' : idx === 1 ? '2nd' : idx === 2 ? '3rd' : '4th';
                return (
                  <View
                    key={color}
                    style={[
                      styles.rankingRow,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: isYou ? colors.primary : colors.borderStrong,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <View style={styles.rankBadgeBox}>
                      <Text variant="sm" weight="800" style={{ color: COLOR_ACCENTS[color] }}>
                        {place}
                      </Text>
                    </View>
                    <View style={[styles.colorPill, { backgroundColor: COLOR_ACCENTS[color] }]} />
                    <View style={{ flex: 1 }}>
                      <Text variant="sm" weight="700" style={{ color: colors.text }}>
                        {seat?.displayName || color.toUpperCase()}
                      </Text>
                      {seat?.status === 'bot' && (
                        <Caption style={{ color: colors.textMuted }}>Bot ({seat.botDifficulty})</Caption>
                      )}
                    </View>
                    {isYou && (
                      <Badge label="YOU" variant="official" size="sm" />
                    )}
                  </View>
                );
              })}
            </View>

            <View style={{ marginTop: spacing.xl, width: '100%', gap: spacing.sm }}>
              <PrimaryButton
                title="Back to Online Ludo"
                onPress={() => {
                  client.leaveRoom();
                  router.replace('/games/ludo/online' as any);
                }}
              />
              <SecondaryButton
                title="Back to Games"
                onPress={() => {
                  client.leaveRoom();
                  router.replace('/games/ludo' as any);
                }}
              />
            </View>
          </Card>
        </ScrollView>
      </View>
    );
  }

  // Active Live Game Screen
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View
        style={[
          styles.headerBar,
          {
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm,
            paddingBottom: spacing.xs,
            borderBottomColor: colors.borderStrong,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onLeaveRoom}
          style={styles.leaveButton}
          accessibilityLabel="Leave Match"
          accessibilityRole="button"
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.roomHeaderCenter}>
          <Text variant="xs" weight="800" style={{ color: colors.textSecondary }}>
            ROOM {clientState.roomId}
          </Text>
          <View style={styles.liveIndicator}>
            <View
              style={[
                styles.liveDot,
                {
                  backgroundColor:
                    clientState.connectionStatus === 'connected' ? '#10B981' : '#F59E0B',
                },
              ]}
            />
            <Text variant="xs" style={{ color: colors.textMuted, fontSize: 10 }}>
              {clientState.connectionStatus === 'connected' ? 'LIVE' : 'SYNCING'}
            </Text>
          </View>
        </View>

        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Player Bar */}
        <View style={{ paddingHorizontal: spacing.md, marginVertical: spacing.xs }}>
          <LudoPlayerBar
            seats={playerBarSeats}
            currentTurn={presentationState.currentTurn}
            isGameFinished={false}
          />
        </View>

        {/* Turn Status Banner */}
        <View style={{ paddingHorizontal: spacing.md, marginBottom: spacing.xs }}>
          <Card
            style={[
              styles.turnCard,
              {
                backgroundColor: colors.surface,
                borderLeftColor: turnAccent,
                borderLeftWidth: 4,
                borderColor: colors.borderStrong,
                borderRadius: radii.md,
              },
            ]}
          >
            <View style={styles.turnCardRow}>
              <View style={{ flex: 1 }}>
                <Text variant="sm" weight="800" style={{ color: colors.text }}>
                  {turnStatus.title}
                </Text>
                <Caption style={{ color: colors.textMuted }}>{turnStatus.subtitle}</Caption>
              </View>
              {statusMessage && (
                <View
                  style={[
                    styles.statusPill,
                    { backgroundColor: colors.surfaceRaised, borderRadius: radii.pill },
                  ]}
                >
                  <Text variant="xs" weight="700" style={{ color: turnAccent }}>
                    {statusMessage}
                  </Text>
                </View>
              )}
            </View>
          </Card>
        </View>

        {/* Interactive Canonical Ludo Board */}
        <View style={styles.boardWrapper}>
          <LudoBoard
            viewModel={boardViewModel}
            maxBoardSize={maxBoardSize}
            onTokenPress={handleTokenPress}
            disabled={!isMyTurn || presentationState.turnPhase !== 'move' || isBoardBusy}
            hiddenTokenKeys={hiddenTokenKeys}
            travelPlan={travelPlan}
            capturePlans={capturePlans}
            celebrationRank={celebrationRank}
            showWinnerCelebration={showWinnerCelebration}
            isReducedMotion={isReducedMotion}
            onTravelComplete={handleTravelComplete}
            onCaptureComplete={handleCaptureComplete}
            onCelebrationComplete={handleCelebrationComplete}
            onWinnerCelebrationComplete={handleWinnerCelebrationComplete}
          />
        </View>

        {/* Dice & Controls Row */}
        <View
          style={[
            styles.controlsContainer,
            { paddingHorizontal: spacing.md, marginTop: spacing.md },
          ]}
        >
          <View style={styles.diceRow}>
            <LudoDice
              value={displayDiceValue}
              size={54}
              disabled={!canRoll}
              isRolling={isDiceRolling}
              isBotTurn={!isMyTurn}
              isReducedMotion={isReducedMotion}
              onRollComplete={handleDiceRollComplete}
            />

            <View style={{ flex: 1, marginLeft: spacing.md }}>
              {isMyTurn && presentationState.turnPhase === 'move' ? (
                <View
                  style={[
                    styles.instructionBox,
                    { backgroundColor: colors.surfaceRaised, borderRadius: radii.md },
                  ]}
                >
                  <Ionicons name="hand-right-outline" size={18} color={turnAccent} />
                  <Text
                    variant="xs"
                    weight="700"
                    style={{ color: colors.text, marginLeft: 6, flex: 1 }}
                  >
                    Tap a pulsing token to move
                  </Text>
                </View>
              ) : (
                <PrimaryButton
                  title={pendingCommand === 'roll' ? 'ROLLING…' : 'ROLL DICE'}
                  onPress={handleRollPress}
                  disabled={!canRoll}
                  style={{ width: '100%' }}
                />
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leaveButton: {
    padding: 6,
    borderRadius: 8,
  },
  roomHeaderCenter: {
    alignItems: 'center',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  turnCard: {
    width: '100%',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  turnCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  boardWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  controlsContainer: {
    width: '100%',
    maxWidth: 430,
  },
  diceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  instructionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  finishedCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    padding: 24,
  },
  trophyBox: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  finishedTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  rankingsList: {
    width: '100%',
    gap: 10,
  },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  rankBadgeBox: {
    width: 34,
  },
  colorPill: {
    width: 4,
    height: 24,
    borderRadius: 2,
    marginRight: 10,
  },
});
