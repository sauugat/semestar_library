import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  TouchableOpacity,
  TextInput,
  Share,
  Animated,
  Alert,
  Modal,
  ActivityIndicator,
  Image,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { searchGlobal, type SearchStudentItem } from '@/services/search';
import { sendGameInvitation, getGameInvitation } from '@/services/games-api';
import { GamesSocketClient, type GamesSocketStatus } from '@/services/games-socket';
import {
  type TicTacToeState,
  type TicTacToeSymbol,
  type GamesServerEvent,
} from '@/types/games';

/**
 * Generate a short shareable 6-character room code suitable for classmates.
 * Excludes confusing characters: 0, O, 1, I, L.
 */
function generateRoomCode(): string {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Pure vector piece component for X and O.
 * Renders identical geometric shapes across Android and iOS without relying on font glyphs.
 */
interface TicTacToePieceProps {
  symbol: TicTacToeSymbol;
  size: number;
  isWinner?: boolean;
  color?: string;
}

function TicTacToePiece({ symbol, size, isWinner, color }: TicTacToePieceProps) {
  const { colors } = useTheme();
  const effectiveColor = color || (isWinner ? colors.primary : colors.text);
  const strokeWidth = Math.max(3, Math.round(size * 0.12));

  if (symbol === 'X') {
    const lineLength = Math.round(size * 0.65);
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: lineLength,
            height: strokeWidth,
            backgroundColor: effectiveColor,
            borderRadius: strokeWidth / 2,
            transform: [{ rotate: '45deg' }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: lineLength,
            height: strokeWidth,
            backgroundColor: effectiveColor,
            borderRadius: strokeWidth / 2,
            transform: [{ rotate: '-45deg' }],
          }}
        />
      </View>
    );
  }

  if (symbol === 'O') {
    const circleSize = Math.round(size * 0.58);
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: circleSize,
            height: circleSize,
            borderRadius: circleSize / 2,
            borderWidth: strokeWidth,
            borderColor: effectiveColor,
            backgroundColor: 'transparent',
          }}
        />
      </View>
    );
  }

  return null;
}

export default function TicTacToeScreen() {
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ invite?: string; room?: string; autoJoin?: string }>();

  // Socket client reference (persists across renders)
  const clientRef = useRef<GamesSocketClient | null>(null);

  // Screen & Game State
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [socketStatus, setSocketStatus] = useState<GamesSocketStatus>('idle');
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<TicTacToeState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMovePending, setIsMovePending] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Phase 3: In-App Invitations & Auto-Join State
  const autoJoinedInviteRef = useRef<string | null>(null);
  const [isValidatingInvite, setIsValidatingInvite] = useState(false);
  const [invitationError, setInvitationError] = useState<{
    type: 'expired' | 'full' | 'error';
    title: string;
    message: string;
  } | null>(null);

  // Phase 3: Invite Classmate Modal State
  const [isInviteModalVisible, setIsInviteModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchStudentItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [inviteStatusMap, setInviteStatusMap] = useState<Record<string, 'idle' | 'sending' | 'sent'>>({});

  // Animation values for end-game overlay
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.88)).current;
  const lastHapticRevision = useRef<number | null>(null);
  const lastAnimatedStatusRef = useRef<string | null>(null);
  const lastRematchPromptRevision = useRef<number | null>(null);
  const lastRoundHapticRef = useRef<number>(1);

  // Responsive board dimensions
  const maxBoardWidth = Math.min(width - spacing.md * 2, 350);
  const cellGap = 8;
  const cellSize = Math.floor((maxBoardWidth - cellGap * 2) / 3);
  const actualBoardSize = cellSize * 3 + cellGap * 2;

  // Single GamesSocketClient instance across screen lifecycle
  useEffect(() => {
    const client = new GamesSocketClient();
    clientRef.current = client;

    const unsubEvent = client.onEvent((event: GamesServerEvent) => {
      if (event.type === 'CONNECTED') {
        setAuthUserId(event.userId);
        setErrorMessage(null);
      } else if (event.type === 'GAME_STATE') {
        setGameState(event.state);
        setIsMovePending(false);
        setErrorMessage(null);
      } else if (event.type === 'ERROR') {
        setIsMovePending(false);
        const rawMsg = event.message || 'Game error occurred.';
        if (
          rawMsg.toLowerCase().includes('full') ||
          rawMsg.toLowerCase().includes('already in progress') ||
          rawMsg.toLowerCase().includes('two players')
        ) {
          setInvitationError({
            type: 'full',
            title: 'Room Full',
            message: 'This room is already full.',
          });
          setActiveRoomId(null);
        } else {
          setErrorMessage(rawMsg);
        }
      }
    });

    const unsubStatus = client.onStatusChange((status: GamesSocketStatus) => {
      setSocketStatus(status);
      if (status === 'error' || status === 'closed') {
        setIsMovePending(false);
      }
    });

    return () => {
      unsubEvent();
      unsubStatus();
      client.disconnect();
      clientRef.current = null;
    };
  }, []);

  // Determine local player symbol ('X', 'O', or null for spectator/unassigned)
  const localSymbol = useMemo<TicTacToeSymbol | null>(() => {
    if (!authUserId || !gameState) return null;
    if (gameState.players.X === authUserId) return 'X';
    if (gameState.players.O === authUserId) return 'O';
    return null;
  }, [authUserId, gameState]);

  // Turn check
  const isMyTurn = useMemo(() => {
    if (socketStatus !== 'connected' || !gameState || gameState.status !== 'playing') {
      return false;
    }
    if (!localSymbol) return false;
    return gameState.currentTurn === localSymbol;
  }, [socketStatus, gameState, localSymbol]);

  // Result animation on game finish (entrance animation runs once upon entering finished status)
  useEffect(() => {
    if (gameState?.status === 'finished') {
      if (lastAnimatedStatusRef.current !== 'finished') {
        lastAnimatedStatusRef.current = 'finished';
        fadeAnim.setValue(0);
        scaleAnim.setValue(0.88);
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 6,
            tension: 80,
            useNativeDriver: true,
          }),
        ]).start();

        // Trigger finish haptic ONCE
        if (gameState.winner === 'draw') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else if (localSymbol && gameState.winner === localSymbol) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else if (localSymbol && gameState.winner) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }
    } else {
      lastAnimatedStatusRef.current = gameState?.status ?? null;
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.88);
    }
  }, [gameState?.status, gameState?.winner, localSymbol, fadeAnim, scaleAnim]);

  // Rematch request & new round haptics
  useEffect(() => {
    if (!gameState) return;

    // Subtle notification haptic ONCE when opponent requests a rematch
    if (
      gameState.status === 'finished' &&
      gameState.rematchRequestedBy !== null &&
      gameState.rematchRequestedBy !== authUserId &&
      lastRematchPromptRevision.current !== gameState.revision
    ) {
      lastRematchPromptRevision.current = gameState.revision;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }

    // Light impact ONCE when a new round starts
    if (
      gameState.status === 'playing' &&
      gameState.round > 1 &&
      lastRoundHapticRef.current < gameState.round
    ) {
      lastRoundHapticRef.current = gameState.round;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [gameState?.status, gameState?.revision, gameState?.round, gameState?.rematchRequestedBy, authUserId]);

  // Connect to room workflow
  const connectToRoom = useCallback(
    async (roomIdToConnect: string) => {
      const normalized = roomIdToConnect.trim().toUpperCase();
      if (!normalized) {
        setErrorMessage('Please enter a valid room code.');
        return;
      }

      if (isConnecting) return;

      setIsConnecting(true);
      setErrorMessage(null);
      setGameState(null);
      setAuthUserId(null);
      setActiveRoomId(normalized);

      try {
        const client = clientRef.current;
        if (!client) {
          throw new Error('Realtime game client is not initialized.');
        }

        await client.connect(normalized);

        client.send({ type: 'JOIN_GAME' });
        client.send({ type: 'REQUEST_STATE' });
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'Failed to connect to game room.';
        const safe =
          raw.toLowerCase().includes('ticket') || raw.toLowerCase().includes('bearer')
            ? 'Authentication failed. Please check your login session and try again.'
            : raw;
        setErrorMessage(safe);
      } finally {
        setIsConnecting(false);
      }
    },
    [isConnecting]
  );

  // Phase 3: Secure Auto-Join via Invitation
  useEffect(() => {
    if (params.autoJoin === '1' && params.invite) {
      const inviteId = params.invite.trim();
      if (!inviteId || autoJoinedInviteRef.current === inviteId) return;
      autoJoinedInviteRef.current = inviteId;

      let isCancelled = false;
      const executeAutoJoin = async () => {
        setIsValidatingInvite(true);
        setInvitationError(null);
        setErrorMessage(null);

        try {
          const res = await getGameInvitation(inviteId);
          if (isCancelled) return;

          if (res.error) {
            if (res.expired || res.status === 410) {
              setInvitationError({
                type: 'expired',
                title: 'Invitation Expired',
                message: 'This game invitation is no longer active.',
              });
            } else {
              setInvitationError({
                type: 'error',
                title: 'Invitation Unavailable',
                message: res.error,
              });
            }
            return;
          }

          if (!res.invitation?.roomId) {
            setInvitationError({
              type: 'error',
              title: 'Invitation Unavailable',
              message: 'Invalid invitation received.',
            });
            return;
          }

          // Authoritative room ID from server
          const authoritativeRoomId = res.invitation.roomId.toUpperCase();
          await connectToRoom(authoritativeRoomId);
        } catch (err: unknown) {
          if (isCancelled) return;
          const msg = err instanceof Error ? err.message : 'Could not validate invitation.';
          setInvitationError({
            type: 'error',
            title: 'Connection Error',
            message: msg,
          });
        } finally {
          if (!isCancelled) {
            setIsValidatingInvite(false);
          }
        }
      };

      void executeAutoJoin();
      return () => {
        isCancelled = true;
      };
    }
  }, [params.autoJoin, params.invite, connectToRoom]);

  // Phase 3: Debounced Student Search for Invitations
  useEffect(() => {
    if (!isInviteModalVisible) {
      setSearchQuery('');
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchGlobal(trimmed);
        const filtered = (res.students || []).filter((s) => {
          if (user?.studentId && s.studentId === user.studentId) return false;
          if (s.role && s.role.toLowerCase() === 'banned') return false;
          return true;
        });
        setSearchResults(filtered);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, isInviteModalVisible, user?.studentId]);

  // Phase 3: Send Game Invitation to Selected Classmate
  const handleSendInvite = useCallback(
    async (student: SearchStudentItem) => {
      if (!activeRoomId) return;
      const sid = student.studentId;
      if (inviteStatusMap[sid] === 'sending' || inviteStatusMap[sid] === 'sent') return;

      setInviteStatusMap((prev) => ({ ...prev, [sid]: 'sending' }));
      try {
        const res = await sendGameInvitation({
          roomId: activeRoomId,
          recipientStudentId: sid,
          gameType: 'tic-tac-toe',
        });

        if (res.error) {
          setInviteStatusMap((prev) => ({ ...prev, [sid]: 'idle' }));
          if (res.status === 429 || res.error.toLowerCase().includes('too quickly')) {
            Alert.alert(
              'Sending Too Quickly',
              "You're sending invitations too quickly. Try again shortly."
            );
          } else {
            Alert.alert('Invitation Failed', res.error);
          }
          return;
        }

        setInviteStatusMap((prev) => ({ ...prev, [sid]: 'sent' }));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        setInviteStatusMap((prev) => ({ ...prev, [sid]: 'idle' }));
        Alert.alert('Invitation Failed', 'Could not send invitation. Please try again.');
      }
    },
    [activeRoomId, inviteStatusMap]
  );

  const handleCreateRoom = useCallback(() => {
    const code = generateRoomCode();
    void connectToRoom(code);
  }, [connectToRoom]);

  const handleJoinRoom = useCallback(() => {
    const normalized = inputRoomCode.trim().toUpperCase();
    if (!normalized) {
      setErrorMessage('Please enter a room code.');
      return;
    }
    void connectToRoom(normalized);
  }, [inputRoomCode, connectToRoom]);

  const handleLeaveRoom = useCallback(() => {
    clientRef.current?.disconnect();
    setActiveRoomId(null);
    setAuthUserId(null);
    setGameState(null);
    setErrorMessage(null);
    setInputRoomCode('');
    setIsMovePending(false);
    setCodeCopied(false);
    lastRoundHapticRef.current = 1;
    lastRematchPromptRevision.current = null;
    lastAnimatedStatusRef.current = null;
  }, []);

  const handleRematch = useCallback(() => {
    if (!activeRoomId || !clientRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clientRef.current.send({ type: 'REMATCH' });
  }, [activeRoomId]);

  const handleReconnect = useCallback(() => {
    if (!activeRoomId || isConnecting) return;
    void connectToRoom(activeRoomId);
  }, [activeRoomId, isConnecting, connectToRoom]);

  const handleShare = useCallback(async () => {
    if (!activeRoomId) return;
    try {
      await Share.share({
        message: `Join my Tic Tac Toe game in Semester Library! Room Code: ${activeRoomId}`,
      });
    } catch {}
  }, [activeRoomId]);

  const handleCopyCode = useCallback(async () => {
    if (!activeRoomId) return;
    try {
      await Clipboard.setStringAsync(activeRoomId);
      setCodeCopied(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeout(() => setCodeCopied(false), 2500);
    } catch {}
  }, [activeRoomId]);

  const handleCellPress = useCallback(
    (cellIndex: number) => {
      if (!isMyTurn || !gameState || gameState.board[cellIndex] !== null || isMovePending) {
        return;
      }

      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setIsMovePending(true);
        setErrorMessage(null);
        clientRef.current?.send({
          type: 'MAKE_MOVE',
          cellIndex,
        });
      } catch (err) {
        setIsMovePending(false);
        const safeMsg = err instanceof Error ? err.message : 'Failed to send move.';
        setErrorMessage(safeMsg);
      }
    },
    [isMyTurn, gameState, isMovePending]
  );

  // Winning cell detector
  const isWinningCell = (index: number): boolean => {
    if (gameState?.status !== 'finished') return false;
    return gameState.winningLine?.includes(index) ?? false;
  };

  // Match status UI calculation
  const matchStatus = useMemo(() => {
    if (!activeRoomId) {
      return {
        badge: 'Lobby',
        badgeVariant: 'outline' as const,
        title: 'Create or join a room',
        showReconnect: false,
      };
    }

    if (socketStatus === 'connecting' || isConnecting) {
      return {
        badge: 'Connecting…',
        badgeVariant: 'outline' as const,
        title: 'Connecting…',
        showReconnect: false,
      };
    }

    if (socketStatus === 'error' || socketStatus === 'closed') {
      return {
        badge: 'Offline',
        badgeVariant: 'error' as const,
        title: 'Connection lost',
        showReconnect: true,
      };
    }

    if (!gameState) {
      return {
        badge: 'Connecting…',
        badgeVariant: 'outline' as const,
        title: 'Connecting…',
        showReconnect: false,
      };
    }

    if (gameState.status === 'waiting') {
      return {
        badge: 'Waiting',
        badgeVariant: 'warning' as const,
        title: 'Waiting for opponent',
        showReconnect: false,
      };
    }

    if (gameState.status === 'playing') {
      if (localSymbol === 'X' || localSymbol === 'O') {
        const turn = gameState.currentTurn === localSymbol;
        return {
          badge: `Round ${gameState.round}`,
          badgeVariant: turn ? ('official' as const) : ('neutral' as const),
          title: turn ? 'Your turn to move' : "Opponent's turn",
          showReconnect: false,
        };
      }
      return {
        badge: `Round ${gameState.round}`,
        badgeVariant: 'neutral' as const,
        title: `Player ${gameState.currentTurn}'s turn`,
        showReconnect: false,
      };
    }

    if (gameState.status === 'finished') {
      const roundLabel = `Round ${gameState.round}`;
      if (gameState.winner === 'draw') {
        return {
          badge: `${roundLabel} • Draw`,
          badgeVariant: 'neutral' as const,
          title: 'Draw',
          showReconnect: false,
        };
      }
      if (localSymbol && gameState.winner === localSymbol) {
        return {
          badge: `${roundLabel} • Won`,
          badgeVariant: 'success' as const,
          title: 'You won',
          showReconnect: false,
        };
      }
      if (localSymbol && gameState.winner) {
        return {
          badge: `${roundLabel} • Lost`,
          badgeVariant: 'neutral' as const,
          title: 'Opponent won',
          showReconnect: false,
        };
      }
      return {
        badge: roundLabel,
        badgeVariant: 'neutral' as const,
        title: `Player ${gameState.winner} won`,
        showReconnect: false,
      };
    }

    return {
      badge: 'Ready',
      badgeVariant: 'outline' as const,
      title: 'Create or join a room',
      showReconnect: false,
    };
  }, [activeRoomId, socketStatus, isConnecting, gameState, localSymbol]);

  // Player labels
  const playerXLabel = useMemo(() => {
    if (!activeRoomId) return 'Player 1';
    if (!gameState?.players.X) return 'Waiting';
    if (localSymbol === 'X') return 'You';
    if (localSymbol === 'O') return 'Opponent';
    return 'Player 1';
  }, [activeRoomId, gameState?.players.X, localSymbol]);

  const playerOLabel = useMemo(() => {
    if (!activeRoomId) return 'Player 2';
    if (!gameState?.players.O) return 'Waiting';
    if (localSymbol === 'O') return 'You';
    if (localSymbol === 'X') return 'Opponent';
    return 'Player 2';
  }, [activeRoomId, gameState?.players.O, localSymbol]);

  const isXActive = gameState?.status === 'playing' && gameState.currentTurn === 'X';
  const isOActive = gameState?.status === 'playing' && gameState.currentTurn === 'O';

  // Result card content
  const resultTitle = useMemo(() => {
    if (gameState?.status !== 'finished') return '';
    if (gameState.winner === 'draw') return 'DRAW';
    if (localSymbol && gameState.winner === localSymbol) return 'YOU WON';
    if (localSymbol && gameState.winner) return 'YOU LOST';
    return `PLAYER ${gameState.winner} WON`;
  }, [gameState, localSymbol]);

  const isWin = localSymbol && gameState?.winner === localSymbol;
  const isLoss = localSymbol && gameState?.winner && gameState.winner !== localSymbol && gameState.winner !== 'draw';

  return (
    <>
      <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingHorizontal: spacing.md,
          paddingTop: spacing.xs,
          paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Active Room Code Compact Bar (only when playing or finished) */}
      {activeRoomId && gameState?.status !== 'waiting' && (
        <View
          style={[
            styles.roomHeaderBar,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              paddingHorizontal: spacing.md,
              paddingVertical: 10,
              marginBottom: spacing.sm,
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleCopyCode}
            style={styles.roomCodeInfo}
            accessibilityLabel={`Room code: ${activeRoomId}. Tap to copy.`}
          >
            <Text
              variant="xs"
              weight="700"
              style={{ color: colors.textMuted, letterSpacing: 0.5, marginRight: 6 }}
            >
              ROOM
            </Text>
            <Text
              variant="md"
              weight="800"
              style={{
                color: colors.text,
                letterSpacing: 2,
              }}
            >
              {activeRoomId}
            </Text>
            <Ionicons
              name={codeCopied ? 'checkmark-circle' : 'copy-outline'}
              size={14}
              color={codeCopied ? colors.success : colors.textMuted}
              style={{ marginLeft: 6 }}
            />
          </TouchableOpacity>

          <View style={styles.roomHeaderActions}>
            <Button
              title="Share"
              variant="secondary"
              size="sm"
              onPress={handleShare}
              leftIcon={
                <Ionicons
                  name="share-outline"
                  size={13}
                  color={colors.text}
                  style={{ marginRight: 3 }}
                />
              }
              accessibilityLabel="Share room code"
              style={{ marginRight: 6 }}
            />
            <Button
              title="Leave"
              variant="outline"
              size="sm"
              onPress={handleLeaveRoom}
              accessibilityLabel="Leave room"
            />
          </View>
        </View>
      )}

      {/* Match Player / Turn Strip (only when playing or finished) */}
      {activeRoomId && gameState?.status !== 'waiting' && (
      <Card
        style={[
          styles.statusCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.card,
            marginBottom: spacing.md,
          },
        ]}
      >
        <View style={styles.playersRow}>
          {/* Player X Panel */}
          <View
            style={[
              styles.playerColumn,
              isXActive && {
                backgroundColor: colors.surfaceRaised,
                borderRadius: radii.md,
                paddingVertical: 4,
              },
            ]}
          >
            <View
              style={[
                styles.playerSymbolBox,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: isXActive ? colors.primary : colors.border,
                  borderRadius: radii.md,
                  borderWidth: isXActive ? 2 : 1,
                },
              ]}
            >
              <TicTacToePiece
                symbol="X"
                size={24}
                isWinner={gameState?.status === 'finished' && gameState?.winner === 'X'}
              />
            </View>
            <Text
              variant="xs"
              weight={playerXLabel === 'You' ? '700' : '500'}
              style={{
                color: playerXLabel === 'You' ? colors.text : colors.textMuted,
                marginTop: 4,
              }}
              numberOfLines={1}
            >
              {playerXLabel}
            </Text>
          </View>

          {/* Center Status */}
          <View style={styles.centerStatus}>
            <Badge
              label={matchStatus.badge}
              variant={matchStatus.badgeVariant}
              size="sm"
            />
            <Text
              variant="xs"
              weight="600"
              style={{
                color: colors.textSecondary,
                marginTop: 4,
                textAlign: 'center',
              }}
            >
              {matchStatus.title}
            </Text>

            {matchStatus.showReconnect && (
              <Button
                title="Reconnect"
                variant="outline"
                size="sm"
                onPress={handleReconnect}
                disabled={isConnecting}
                loading={isConnecting}
                accessibilityLabel="Reconnect to game room"
                style={{ marginTop: 6 }}
              />
            )}
          </View>

          {/* Player O Panel */}
          <View
            style={[
              styles.playerColumn,
              isOActive && {
                backgroundColor: colors.surfaceRaised,
                borderRadius: radii.md,
                paddingVertical: 4,
              },
            ]}
          >
            <View
              style={[
                styles.playerSymbolBox,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: isOActive ? colors.primary : colors.border,
                  borderRadius: radii.md,
                  borderWidth: isOActive ? 2 : 1,
                },
              ]}
            >
              <TicTacToePiece
                symbol="O"
                size={24}
                isWinner={gameState?.status === 'finished' && gameState?.winner === 'O'}
              />
            </View>
            <Text
              variant="xs"
              weight={playerOLabel === 'You' ? '700' : '500'}
              style={{
                color: playerOLabel === 'You' ? colors.text : colors.textMuted,
                marginTop: 4,
              }}
              numberOfLines={1}
            >
              {playerOLabel}
            </Text>
          </View>
        </View>
      </Card>
      )}

      {/* Transient Error Banner */}
      {errorMessage && (
        <View
          style={[
            styles.errorBanner,
            {
              backgroundColor: colors.errorBg,
              borderColor: colors.error,
              borderRadius: radii.md,
              padding: spacing.sm,
              marginBottom: spacing.md,
            },
          ]}
          accessible={true}
          accessibilityRole="alert"
        >
          <Ionicons
            name="alert-circle-outline"
            size={18}
            color={colors.error}
            style={{ marginRight: 8 }}
          />
          <Text
            variant="xs"
            weight="500"
            style={{ color: colors.error, flex: 1 }}
          >
            {errorMessage}
          </Text>
        </View>
      )}

      {/* Lobby: Create Room & Join Room Form (when not in a room) */}
      {!activeRoomId && (
        <Card
          style={[
            styles.lobbyCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              padding: spacing.md,
              marginBottom: spacing.lg,
            },
          ]}
        >
          {/* Create Room Section */}
          <View style={styles.lobbySection}>
            <Text
              variant="md"
              weight="700"
              style={{ color: colors.text, marginBottom: 4 }}
            >
              Create Room
            </Text>
            <Text
              variant="xs"
              style={{ color: colors.textSecondary, marginBottom: spacing.md }}
            >
              Start a new multiplayer game session.
            </Text>
            <Button
              title="Create Room"
              variant="primary"
              size="md"
              onPress={handleCreateRoom}
              disabled={isConnecting}
              loading={isConnecting && !inputRoomCode}
              accessibilityLabel="Create a new game room"
              leftIcon={
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={colors.primaryText}
                  style={{ marginRight: 6 }}
                />
              }
            />
          </View>

          {/* Divider */}
          <View
            style={[
              styles.lobbyDivider,
              { marginVertical: spacing.md },
            ]}
          >
            <View
              style={[
                styles.dividerLine,
                { backgroundColor: colors.borderSubtle },
              ]}
            />
            <Text
              variant="xs"
              weight="600"
              style={{ color: colors.textMuted, marginHorizontal: spacing.sm }}
            >
              OR
            </Text>
            <View
              style={[
                styles.dividerLine,
                { backgroundColor: colors.borderSubtle },
              ]}
            />
          </View>

          {/* Join Room Section */}
          <View style={styles.lobbySection}>
            <Text
              variant="md"
              weight="700"
              style={{ color: colors.text, marginBottom: 4 }}
            >
              Join Room
            </Text>
            <Text
              variant="xs"
              style={{ color: colors.textSecondary, marginBottom: spacing.sm }}
            >
              Enter the 6-character room code from your classmate.
            </Text>
            <View style={styles.joinInputRow}>
              <TextInput
                style={[
                  styles.roomInput,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.border,
                    borderRadius: radii.md,
                    color: colors.text,
                  },
                ]}
                value={inputRoomCode}
                onChangeText={(text) =>
                  setInputRoomCode(text.toUpperCase().trim())
                }
                placeholder="e.g. AB7K4Q"
                placeholderTextColor={colors.textMuted}
                maxLength={12}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!isConnecting}
                returnKeyType="join"
                onSubmitEditing={handleJoinRoom}
                accessibilityLabel="Room code input"
              />
              <Button
                title="Join"
                variant="secondary"
                size="md"
                onPress={handleJoinRoom}
                disabled={!inputRoomCode.trim() || isConnecting}
                loading={isConnecting && !!inputRoomCode}
                accessibilityLabel="Join game room"
                style={{ minWidth: 80 }}
              />
            </View>
          </View>
        </Card>
      )}

      {/* Waiting Room Redesign (when in room but waiting for opponent) */}
      {activeRoomId && gameState?.status === 'waiting' && (
        <Card
          style={[
            styles.waitingCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              padding: spacing.lg,
              marginBottom: spacing.md,
            },
          ]}
        >
          <View style={{ alignItems: 'center' }}>
            <View
              style={[
                styles.waitingPulseBadge,
                { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
              ]}
            >
              <Ionicons name="hourglass-outline" size={20} color={colors.primary} />
            </View>

            <Text variant="md" weight="700" style={{ color: colors.text, marginTop: 10 }}>
              Waiting for opponent...
            </Text>
            <Text
              variant="xs"
              style={{ color: colors.textSecondary, marginTop: 4, textAlign: 'center' }}
            >
              Share this room code with a classmate to start playing.
            </Text>

            {/* Room Code Display Box */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleCopyCode}
              style={[
                styles.bigCodeBox,
                {
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                  marginTop: 14,
                },
              ]}
              accessibilityLabel={`Room code: ${activeRoomId}. Tap to copy.`}
            >
              <Text
                variant="xl"
                weight="800"
                style={{
                  color: colors.text,
                  letterSpacing: 4,
                  fontSize: 22,
                }}
              >
                {activeRoomId}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <Ionicons
                  name={codeCopied ? 'checkmark-circle' : 'copy-outline'}
                  size={12}
                  color={codeCopied ? colors.success : colors.textMuted}
                  style={{ marginRight: 4 }}
                />
                <Text
                  variant="xs"
                  weight="600"
                  style={{ color: codeCopied ? colors.success : colors.textMuted }}
                >
                  {codeCopied ? 'Copied to clipboard' : 'Tap to copy'}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Primary & Secondary Actions */}
            <View style={{ width: '100%', marginTop: 16, gap: 8 }}>
              <Button
                title="Invite Classmate"
                variant="primary"
                size="md"
                onPress={() => setIsInviteModalVisible(true)}
                leftIcon={
                  <Ionicons
                    name="person-add-outline"
                    size={16}
                    color={colors.primaryText}
                    style={{ marginRight: 6 }}
                  />
                }
                accessibilityLabel="Invite classmate to game room"
              />
              <Button
                title="Share Room Code"
                variant="secondary"
                size="md"
                onPress={handleShare}
                leftIcon={
                  <Ionicons
                    name="share-outline"
                    size={16}
                    color={colors.text}
                    style={{ marginRight: 6 }}
                  />
                }
                accessibilityLabel="Share room code via phone"
              />
              <TouchableOpacity
                onPress={handleLeaveRoom}
                style={{ alignSelf: 'center', marginTop: 6, paddingVertical: 6 }}
                accessibilityLabel="Leave room"
              >
                <Text variant="xs" weight="600" style={{ color: colors.textMuted }}>
                  Leave Room
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Card>
      )}

      {/* 3 x 3 Tic Tac Toe Board */}
      <View style={styles.boardWrapper}>
        <View
          style={[
            styles.boardContainer,
            {
              width: actualBoardSize,
              height: actualBoardSize,
              gap: cellGap,
              opacity: activeRoomId && gameState?.status === 'waiting' ? 0.35 : 1,
            },
          ]}
          pointerEvents={activeRoomId && gameState?.status === 'waiting' ? 'none' : 'auto'}
        >
          {Array.from({ length: 9 }).map((_, index) => {
            const cellValue = gameState?.board[index] ?? null;
            const isWinner = isWinningCell(index);
            const canPress =
              socketStatus === 'connected' &&
              gameState?.status === 'playing' &&
              (localSymbol === 'X' || localSymbol === 'O') &&
              gameState.currentTurn === localSymbol &&
              cellValue === null &&
              !isMovePending;

            const cellLabel = `Cell ${index + 1}, ${
              cellValue === null ? 'empty' : cellValue
            }`;

            return (
              <TouchableOpacity
                key={index}
                activeOpacity={canPress ? 0.7 : 1}
                onPress={() => handleCellPress(index)}
                disabled={!canPress}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    backgroundColor: isWinner
                      ? colors.surfaceRaised
                      : colors.surface,
                    borderColor: isWinner
                      ? colors.primary
                      : canPress
                      ? colors.borderStrong
                      : colors.border,
                    borderWidth: isWinner ? 2 : 1,
                    borderRadius: radii.md,
                  },
                ]}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={cellLabel}
                accessibilityState={{ disabled: !canPress }}
              >
                {cellValue && (
                  <TicTacToePiece
                    symbol={cellValue}
                    size={cellSize}
                    isWinner={isWinner}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* End-Game Animated Overlay (over the board) */}
        {activeRoomId && gameState?.status === 'finished' && (
          <Animated.View
            style={[
              styles.resultOverlay,
              {
                opacity: fadeAnim,
              },
            ]}
            pointerEvents="box-none"
          >
            <Animated.View
              style={[
                styles.resultCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: isWin ? colors.primary : colors.borderStrong,
                  borderRadius: radii.card,
                  transform: [{ scale: scaleAnim }],
                },
              ]}
              accessible={true}
              accessibilityRole="alert"
              accessibilityLabel={`Game finished. ${resultTitle}.`}
            >
              <View
                style={[
                  styles.resultIconCircle,
                  {
                    backgroundColor: colors.surfaceRaised,
                    borderColor: isWin ? colors.primary : colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={
                    isWin
                      ? 'trophy-outline'
                      : isLoss
                      ? 'close-circle-outline'
                      : 'remove-outline'
                  }
                  size={24}
                  color={isWin ? colors.primary : colors.text}
                />
              </View>

              <Text
                variant="lg"
                weight="800"
                style={{
                  color: isWin ? colors.primary : colors.text,
                  marginTop: 10,
                  letterSpacing: 1,
                }}
              >
                {resultTitle}
              </Text>

              <Text
                variant="xs"
                style={{
                  color: colors.textSecondary,
                  marginTop: 4,
                  textAlign: 'center',
                }}
              >
                {gameState.winner === 'draw'
                  ? 'All cells filled without a winner.'
                  : isWin
                  ? 'Three in a row! Great match.'
                  : 'Better luck next round!'}
              </Text>

              {/* Opponent Rematch Banner */}
              {gameState.rematchRequestedBy !== null && gameState.rematchRequestedBy !== authUserId && (
                <View
                  style={[
                    styles.rematchBanner,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.primary,
                      borderRadius: radii.md,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      marginTop: 10,
                      borderWidth: 1,
                      width: '100%',
                      alignItems: 'center',
                    },
                  ]}
                  accessible={true}
                  accessibilityRole="text"
                >
                  <Text variant="xs" weight="700" style={{ color: colors.primary }}>
                    Opponent wants a rematch!
                  </Text>
                </View>
              )}

              <View style={{ width: '100%', marginTop: 14, gap: 8 }}>
                {gameState.rematchRequestedBy !== null && gameState.rematchRequestedBy !== authUserId ? (
                  <Button
                    title="Accept Rematch"
                    variant="primary"
                    size="md"
                    onPress={handleRematch}
                    accessibilityLabel="Accept opponent rematch request"
                  />
                ) : gameState.rematchRequestedBy === authUserId ? (
                  <Button
                    title="Waiting for opponent..."
                    variant="secondary"
                    size="md"
                    disabled={true}
                    accessibilityLabel="Waiting for opponent to accept rematch"
                  />
                ) : (
                  <Button
                    title="Play Again"
                    variant="primary"
                    size="md"
                    disabled={localSymbol === null}
                    onPress={handleRematch}
                    accessibilityLabel="Request rematch"
                  />
                )}
                <Button
                  title="Leave Room"
                  variant="outline"
                  size="md"
                  onPress={handleLeaveRoom}
                  accessibilityLabel="Leave room"
                />
              </View>
            </Animated.View>
          </Animated.View>
        )}
      </View>

      {/* Spectator notice */}
      {activeRoomId && localSymbol === null && gameState?.status === 'playing' && (
        <Card
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.surfaceSubtle,
              borderColor: colors.borderSubtle,
              borderRadius: radii.card,
              marginTop: spacing.md,
            },
          ]}
        >
          <View style={styles.infoContent}>
            <Ionicons
              name="eye-outline"
              size={18}
              color={colors.textSecondary}
              style={{ marginRight: 8, marginTop: 2 }}
            />
            <View style={{ flex: 1 }}>
              <Text variant="sm" weight="600" style={{ color: colors.text }}>
                Spectating Match
              </Text>
              <Text
                variant="xs"
                style={{ color: colors.textMuted, marginTop: 2 }}
              >
                This room is full. You are spectating the current game.
              </Text>
            </View>
          </View>
        </Card>
      )}
      {/* Auto-Join Validating Spinner State */}
      {isValidatingInvite && (
        <Card
          style={[
            styles.statusCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              padding: spacing.xl,
              alignItems: 'center',
              marginBottom: spacing.lg,
            },
          ]}
        >
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="md" weight="600" style={{ marginTop: 16, color: colors.text }}>
            Connecting to invited game...
          </Text>
          <Text variant="xs" color="muted" style={{ marginTop: 6, textAlign: 'center' }}>
            Validating invitation and acquiring ticket
          </Text>
        </Card>
      )}

      {/* Auto-Join / Room Error State (Expired, Full, Not Found) */}
      {invitationError && (
        <Card
          style={[
            styles.statusCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              padding: spacing.xl,
              alignItems: 'center',
              marginBottom: spacing.lg,
            },
          ]}
        >
          <Ionicons
            name={invitationError.type === 'expired' ? 'time-outline' : 'alert-circle-outline'}
            size={48}
            color={invitationError.type === 'expired' ? colors.warning : colors.error}
            style={{ marginBottom: 12 }}
          />
          <Text variant="lg" weight="700" style={{ color: colors.text, marginBottom: 8, textAlign: 'center' }}>
            {invitationError.title}
          </Text>
          <Text variant="sm" color="muted" style={{ textAlign: 'center', marginBottom: 20 }}>
            {invitationError.message}
          </Text>
          <View style={{ width: '100%', gap: 10 }}>
            {invitationError.type === 'expired' && (
              <Button
                title="Enter Room Code"
                variant="primary"
                size="md"
                onPress={() => {
                  setInvitationError(null);
                  setActiveRoomId(null);
                }}
              />
            )}
            <Button
              title="Back to Games"
              variant={invitationError.type === 'expired' ? 'secondary' : 'primary'}
              size="md"
              onPress={() => router.replace('/games')}
            />
          </View>
        </Card>
      )}
    </ScrollView>

      {/* Phase 3: Invite Classmate Modal */}
      <Modal
        visible={isInviteModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsInviteModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              },
            ]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text variant="md" weight="700" style={{ color: colors.text }}>
                  Invite a Classmate
                </Text>
                <Text variant="xs" color="muted" style={{ marginTop: 2 }}>
                  Search for peers to join Room {activeRoomId}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsInviteModalVisible(false)}
                style={{ padding: 4 }}
                accessibilityLabel="Close invite modal"
              >
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Search Input Box */}
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.textMuted}
                style={{ marginRight: 8 }}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search classmates by name..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Results / Empty / Loading State */}
            {isSearching ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text variant="xs" color="muted" style={{ marginTop: 8 }}>
                  Searching classmates...
                </Text>
              </View>
            ) : searchQuery.trim().length === 0 ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <Ionicons name="people-outline" size={36} color={colors.textMuted} style={{ marginBottom: 8 }} />
                <Text variant="xs" color="muted" style={{ textAlign: 'center' }}>
                  Type a student's name above to send an instant game invitation.
                </Text>
              </View>
            ) : searchResults.length === 0 ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <Ionicons name="search-outline" size={36} color={colors.textMuted} style={{ marginBottom: 8 }} />
                <Text variant="xs" color="muted" style={{ textAlign: 'center' }}>
                  No classmates found matching "{searchQuery}".
                </Text>
              </View>
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.studentId}
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 320 }}
                renderItem={({ item }) => {
                  const status = inviteStatusMap[item.studentId] || 'idle';
                  const initials = item.name ? item.name.charAt(0).toUpperCase() : '?';
                  const subtitle = [item.semester, item.department].filter(Boolean).join(' • ') || 'Student';

                  return (
                    <View
                      style={[
                        styles.studentItem,
                        { borderBottomColor: colors.border },
                      ]}
                    >
                      <View style={styles.studentInfo}>
                        {item.avatarUrl ? (
                          <Image source={{ uri: item.avatarUrl }} style={styles.avatarImg} />
                        ) : (
                          <View style={[styles.avatarCircle, { backgroundColor: colors.surfaceSubtle }]}>
                            <Text variant="sm" weight="700" style={{ color: colors.text }}>
                              {initials}
                            </Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text variant="sm" weight="600" style={{ color: colors.text }} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text variant="xs" color="muted" numberOfLines={1}>
                            {subtitle}
                          </Text>
                        </View>
                      </View>

                      <Button
                        title={
                          status === 'sending'
                            ? 'Sending...'
                            : status === 'sent'
                            ? 'Invited ✓'
                            : 'Invite'
                        }
                        variant={status === 'sent' ? 'secondary' : 'primary'}
                        size="sm"
                        disabled={status === 'sending' || status === 'sent'}
                        onPress={() => void handleSendInvite(item)}
                        leftIcon={
                          status === 'sent' ? (
                            <Ionicons name="checkmark-circle" size={14} color={colors.success} style={{ marginRight: 4 }} />
                          ) : undefined
                        }
                      />
                    </View>
                  );
                }}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
  roomHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  roomCodeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  roomHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusCard: {
    paddingVertical: 10,
    paddingHorizontal: 12,
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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerStatus: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  lobbyCard: {
    borderWidth: 1,
  },
  lobbySection: {
    width: '100%',
  },
  lobbyDivider: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  joinInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roomInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  waitingCard: {
    borderWidth: 1,
  },
  waitingPulseBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  bigCodeBox: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  boardWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    position: 'relative',
  },
  boardContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    zIndex: 10,
    borderRadius: 16,
    padding: 16,
  },
  resultCard: {
    width: '100%',
    maxWidth: 290,
    paddingVertical: 20,
    paddingHorizontal: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  resultIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  infoCard: {
    padding: 12,
    borderWidth: 1,
  },
  infoContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  rematchBanner: {
    borderWidth: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '85%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  studentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  studentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarImg: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: 10,
  },
});
