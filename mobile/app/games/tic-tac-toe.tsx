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
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
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

  // Animation values for end-game overlay
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.88)).current;
  const lastHapticRevision = useRef<number | null>(null);

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
        setErrorMessage(event.message || 'Game error occurred.');
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

  // Result animation & haptics on game finish
  useEffect(() => {
    if (gameState?.status === 'finished') {
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

      // Trigger haptic ONCE per finished revision
      if (gameState.revision !== lastHapticRevision.current) {
        lastHapticRevision.current = gameState.revision;
        if (gameState.winner === 'draw') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else if (localSymbol && gameState.winner === localSymbol) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else if (localSymbol && gameState.winner) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.88);
    }
  }, [gameState?.status, gameState?.revision, gameState?.winner, localSymbol, fadeAnim, scaleAnim]);

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
  }, []);

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
          badge: turn ? 'Your Turn' : "Opponent's Turn",
          badgeVariant: turn ? ('official' as const) : ('neutral' as const),
          title: turn ? 'Your turn' : "Opponent's turn",
          showReconnect: false,
        };
      }
      return {
        badge: 'Playing',
        badgeVariant: 'neutral' as const,
        title: `Player ${gameState.currentTurn}'s turn`,
        showReconnect: false,
      };
    }

    if (gameState.status === 'finished') {
      if (gameState.winner === 'draw') {
        return {
          badge: 'Finished',
          badgeVariant: 'neutral' as const,
          title: 'Draw',
          showReconnect: false,
        };
      }
      if (localSymbol && gameState.winner === localSymbol) {
        return {
          badge: 'Finished',
          badgeVariant: 'success' as const,
          title: 'You won',
          showReconnect: false,
        };
      }
      if (localSymbol && gameState.winner) {
        return {
          badge: 'Finished',
          badgeVariant: 'neutral' as const,
          title: 'Opponent won',
          showReconnect: false,
        };
      }
      return {
        badge: 'Finished',
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
                onPress={() => {
                  Alert.alert(
                    'Direct Invites',
                    'In-app classmate invitations are coming in Phase 2. Use "Share Room Code" below to invite your peer now!'
                  );
                }}
                leftIcon={
                  <Ionicons
                    name="person-add-outline"
                    size={16}
                    color={colors.primaryText}
                    style={{ marginRight: 6 }}
                  />
                }
                accessibilityLabel="Invite classmate (coming soon)"
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

              <View style={{ width: '100%', marginTop: 16, gap: 8 }}>
                <Button
                  title="Play Again"
                  variant="primary"
                  size="md"
                  onPress={() => {
                    Alert.alert(
                      'Rematch Support',
                      'Server-authoritative rematch is arriving in Phase 2. To play another match now, tap Leave Room and start a new game!'
                    );
                  }}
                  accessibilityLabel="Play again (coming soon)"
                />
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
});
