import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  TouchableOpacity,
  TextInput,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading } from '@/components/ui/Typography';
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

  // Responsive board dimensions
  const maxBoardWidth = Math.min(width - spacing.md * 2, 360);
  const cellGap = 10;
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
        // Display safe error message without internal traces
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

        // Resolves ONLY after trusted backend CONNECTED handshake event
        await client.connect(normalized);

        // Send JOIN_GAME and initial REQUEST_STATE
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

  const handleCellPress = useCallback(
    (cellIndex: number) => {
      if (!isMyTurn || !gameState || gameState.board[cellIndex] !== null || isMovePending) {
        return;
      }

      try {
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
        title: 'Waiting for another player',
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
      {/* Title & Subtitle */}
      <View style={[styles.headerSection, { marginBottom: spacing.md }]}>
        <Heading style={[styles.mainTitle, { color: colors.text }]}>
          Tic Tac Toe
        </Heading>
        <Subheading style={{ color: colors.textSecondary, marginTop: 2 }}>
          2 Player Multiplayer
        </Subheading>
      </View>

      {/* Active Room Code Bar (when in a room) */}
      {activeRoomId && (
        <View
          style={[
            styles.roomHeaderBar,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radii.card,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              marginBottom: spacing.md,
            },
          ]}
        >
          <View style={styles.roomCodeInfo}>
            <Text
              variant="xs"
              weight="600"
              style={{ color: colors.textMuted, letterSpacing: 0.5 }}
            >
              ROOM CODE
            </Text>
            <Text
              variant="lg"
              weight="800"
              style={{
                color: colors.text,
                letterSpacing: 2,
                marginTop: 2,
              }}
              accessibilityLabel={`Room code: ${activeRoomId}`}
            >
              {activeRoomId}
            </Text>
          </View>

          <View style={styles.roomHeaderActions}>
            <Button
              title="Share"
              variant="secondary"
              size="sm"
              onPress={handleShare}
              leftIcon={
                <Ionicons
                  name="share-outline"
                  size={14}
                  color={colors.text}
                  style={{ marginRight: 4 }}
                />
              }
              accessibilityLabel="Share room code"
              style={{ marginRight: spacing.xs }}
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

      {/* Match status card / players header */}
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
          <View style={styles.playerColumn}>
            <View
              style={[
                styles.playerSymbolBox,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: isXActive ? colors.primary : colors.borderStrong,
                  borderRadius: radii.md,
                  borderWidth: isXActive ? 2 : 1,
                },
              ]}
            >
              <Text variant="lg" weight="800" style={{ color: colors.text }}>
                X
              </Text>
            </View>
            <Text
              variant="xs"
              weight={playerXLabel === 'You' ? '700' : '500'}
              style={{
                color: playerXLabel === 'You' ? colors.text : colors.textMuted,
                marginTop: 4,
              }}
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
                marginTop: 6,
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
                style={{ marginTop: 8 }}
              />
            )}
          </View>

          {/* Player O Panel */}
          <View style={styles.playerColumn}>
            <View
              style={[
                styles.playerSymbolBox,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: isOActive ? colors.primary : colors.borderStrong,
                  borderRadius: radii.md,
                  borderWidth: isOActive ? 2 : 1,
                },
              ]}
            >
              <Text variant="lg" weight="800" style={{ color: colors.text }}>
                O
              </Text>
            </View>
            <Text
              variant="xs"
              weight={playerOLabel === 'You' ? '700' : '500'}
              style={{
                color: playerOLabel === 'You' ? colors.text : colors.textMuted,
                marginTop: 4,
              }}
            >
              {playerOLabel}
            </Text>
          </View>
        </View>
      </Card>

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
              Start a new game session and invite a classmate to play.
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
                  <Text
                    style={[
                      styles.cellSymbol,
                      {
                        color: colors.text,
                        fontSize: Math.floor(cellSize * 0.45),
                      },
                    ]}
                    weight="800"
                  >
                    {cellValue}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Helper Guidance Card */}
      {activeRoomId && gameState?.status === 'waiting' && (
        <Card
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.surfaceSubtle,
              borderColor: colors.borderSubtle,
              borderRadius: radii.card,
              marginTop: spacing.lg,
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
                Waiting for Classmate
              </Text>
              <Text
                variant="xs"
                style={{ color: colors.textMuted, marginTop: 3 }}
              >
                Share code {activeRoomId} with a classmate to begin the match.
              </Text>
            </View>
          </View>
        </Card>
      )}

      {activeRoomId && localSymbol === null && gameState?.status === 'playing' && (
        <Card
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.surfaceSubtle,
              borderColor: colors.borderSubtle,
              borderRadius: radii.card,
              marginTop: spacing.lg,
            },
          ]}
        >
          <View style={styles.infoContent}>
            <Ionicons
              name="eye-outline"
              size={20}
              color={colors.textSecondary}
              style={{ marginRight: 10, marginTop: 2 }}
            />
            <View style={{ flex: 1 }}>
              <Text variant="sm" weight="600" style={{ color: colors.text }}>
                Spectating Match
              </Text>
              <Text
                variant="xs"
                style={{ color: colors.textMuted, marginTop: 3 }}
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
  headerSection: {
    paddingTop: 4,
  },
  mainTitle: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  roomHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  roomCodeInfo: {
    flex: 1,
  },
  roomHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontWeight: '600',
    letterSpacing: 1.5,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSymbol: {
    textAlign: 'center',
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
