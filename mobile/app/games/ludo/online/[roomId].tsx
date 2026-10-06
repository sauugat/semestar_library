import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PrimaryButton, SecondaryButton, Button } from '@/components/ui/Button';
import {
  OnlineLudoClient,
  type PlayerColor,
  type BotDifficulty,
  type LudoSeat,
  type LudoOnlineState,
  type OnlineEntryIntent,
  CANONICAL_COLORS,
  isUserHost,
  getUserSeat,
  canStartGame,
  normalizeRoomCode,
  isValidRoomCode,
} from '@/services/ludo-online';

const COLOR_THEMES: Record<PlayerColor, { name: string; hex: string; bg: string }> = {
  red: { name: 'Red', hex: '#DC2626', bg: 'rgba(220, 38, 38, 0.12)' },
  green: { name: 'Green', hex: '#059669', bg: 'rgba(5, 150, 105, 0.12)' },
  yellow: { name: 'Yellow', hex: '#D97706', bg: 'rgba(217, 119, 6, 0.12)' },
  blue: { name: 'Blue', hex: '#2563EB', bg: 'rgba(37, 99, 235, 0.12)' },
};

export default function OnlineLudoLobbyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ roomId: string; intent?: string }>();
  const rawRoomId = params.roomId || '';
  const roomId = useMemo(() => normalizeRoomCode(rawRoomId), [rawRoomId]);
  const intent: OnlineEntryIntent = params.intent === 'create' ? 'create' : 'join';
  const isValidCode = useMemo(() => isValidRoomCode(roomId), [roomId]);

  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const clientRef = useRef<OnlineLudoClient | null>(null);
  const [clientState, setClientState] = useState<LudoOnlineState | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [isStartingGame, setIsStartingGame] = useState<boolean>(false);

  const activeRoomCode = clientState?.roomId || roomId;

  // Initialize and connect client on mount
  useEffect(() => {
    if (!roomId || !isValidCode) return;

    const client = new OnlineLudoClient();
    clientRef.current = client;

    const unsubscribe = client.subscribe((next) => {
      setClientState(next);
      if (next.playingState) {
        setIsStartingGame(false);
      }
    });

    client.connect(roomId, undefined, intent).catch((err) => {
      if (__DEV__) {
        console.warn('[OnlineLudoLobby] Connect error:', err);
      }
    });

    return () => {
      unsubscribe();
      client.destroy();
      clientRef.current = null;
    };
  }, [roomId, isValidCode, intent]);

  const handleCopyCode = async () => {
    if (!activeRoomCode) return;
    await Clipboard.setStringAsync(activeRoomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleLeaveRoom = () => {
    Alert.alert('Leave Room?', 'Are you sure you want to leave this online lobby?', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          clientRef.current?.leaveRoom();
          router.replace('/games/ludo/online' as any);
        },
      },
    ]);
  };

  const handleSetPlayerCount = (count: 2 | 3 | 4) => {
    clientRef.current?.setPlayerCount(count);
  };

  const handleToggleReady = () => {
    if (!clientState?.lobby || !clientState?.myUserId) return;
    const mySeat = getUserSeat(clientState.lobby, clientState.myUserId);
    if (!mySeat) return;
    clientRef.current?.setReady(!mySeat.ready);
  };

  const handleAddBot = (color: PlayerColor) => {
    clientRef.current?.addBot(color, 'normal');
  };

  const handleRemoveBot = (color: PlayerColor) => {
    clientRef.current?.removeBot(color);
  };

  const handleCycleBotDifficulty = (color: PlayerColor, current: BotDifficulty | null) => {
    const next: BotDifficulty =
      current === 'easy' ? 'normal' : current === 'normal' ? 'hard' : 'easy';
    clientRef.current?.setBotDifficulty(color, next);
  };

  const handleStartGame = () => {
    if (isStartingGame) return;
    setIsStartingGame(true);
    clientRef.current?.startGame();
    setTimeout(() => {
      setIsStartingGame(false);
    }, 2000);
  };

  const isHost = isUserHost(clientState?.lobby || null, clientState?.myUserId || null);
  const mySeat = getUserSeat(clientState?.lobby || null, clientState?.myUserId || null);
  const startEvaluation = canStartGame(clientState?.lobby || null);

  // Invalid Room Code error screen
  if (!isValidCode) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            paddingHorizontal: spacing.md,
            paddingTop: spacing.xl,
            paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl),
            justifyContent: 'center',
          },
        ]}
      >
        <Card
          style={[
            styles.matchReadyCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderStrong,
              borderRadius: radii.card,
            },
          ]}
        >
          <View
            style={[
              styles.matchReadyIconBox,
              {
                backgroundColor: colors.surfaceRaised,
                borderRadius: radii.pill,
              },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          </View>

          <Heading style={[styles.matchReadyTitle, { color: colors.text }]}>Room Unavailable</Heading>
          <Text variant="sm" style={{ color: colors.textMuted, textAlign: 'center', marginTop: 8 }}>
            The room code &quot;{rawRoomId}&quot; is invalid. Room codes must be 6 characters using letters and digits.
          </Text>

          <View style={{ marginTop: spacing.xl, width: '100%' }}>
            <Button
              title="Return to Online Ludo"
              variant="primary"
              onPress={() => router.replace('/games/ludo/online' as any)}
              leftIcon={<Ionicons name="arrow-back-outline" size={18} color={colors.primaryText} />}
            />
          </View>
        </Card>
      </View>
    );
  }

  // Phase 4B1 Temporary Match Ready View when status === 'playing'
  if (clientState?.playingState) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            paddingHorizontal: spacing.md,
            paddingTop: spacing.xl,
            paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl),
          },
        ]}
      >
        <Card
          style={[
            styles.matchReadyCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.primary,
              borderRadius: radii.card,
            },
          ]}
        >
          <View
            style={[
              styles.matchReadyIconBox,
              {
                backgroundColor: colors.surfaceRaised,
                borderRadius: radii.pill,
              },
            ]}
          >
            <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
          </View>

          <Heading style={[styles.matchReadyTitle, { color: colors.text }]}>MATCH READY</Heading>
          <Text variant="sm" weight="600" style={{ color: colors.primary, marginTop: 4 }}>
            Room {activeRoomCode} connected successfully
          </Text>

          <Text variant="xs" style={{ color: colors.textMuted, textAlign: 'center', marginTop: 12 }}>
            Authoritative online match engine state received from Cloudflare Workers.
          </Text>

          <View
            style={[
              styles.phaseNoteBox,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.borderStrong,
                borderRadius: radii.md,
                marginTop: 20,
              },
            ]}
          >
            <Text variant="xs" weight="700" style={{ color: colors.textSecondary }}>
              PHASE 4B1 GATE COMPLETE
            </Text>
            <Text variant="xs" style={{ color: colors.textMuted, marginTop: 4, textAlign: 'center' }}>
              Phase 4B2 will connect this live state to the interactive Ludo board, animations, dice,
              and moves.
            </Text>
          </View>

          <View style={{ marginTop: spacing.xl, width: '100%' }}>
            <Button
              title="Leave Match"
              variant="secondary"
              onPress={handleLeaveRoom}
              leftIcon={<Ionicons name="exit-outline" size={18} color={colors.text} />}
            />
          </View>
        </Card>
      </View>
    );
  }

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
      {/* Reconnecting Banner */}
      {clientState?.connectionStatus === 'reconnecting' && (
        <View style={[styles.reconnectingBanner, { backgroundColor: colors.warning }]}>
          <ActivityIndicator size="small" color="#000" />
          <Text variant="xs" weight="700" style={{ color: '#000', marginLeft: 8 }}>
            Connection lost. Reconnecting to room…
          </Text>
        </View>
      )}

      {/* Error Banner */}
      {clientState?.lastError && (
        <View style={[styles.errorBanner, { backgroundColor: colors.error }]}>
          <Ionicons name="alert-circle" size={16} color="#FFF" />
          <Text variant="xs" weight="600" style={{ color: '#FFF', marginLeft: 8, flex: 1 }}>
            {clientState.lastError.friendlyMessage}
          </Text>
        </View>
      )}

      {/* Room Header Card */}
      <Card
        style={[
          styles.roomHeaderCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.borderStrong,
            borderRadius: radii.card,
            marginBottom: spacing.md,
          },
        ]}
      >
        <View style={styles.roomCodeRow}>
          <View>
            <Caption style={{ color: colors.textMuted }}>ROOM CODE</Caption>
            <Text variant="xl" weight="800" style={[styles.roomCodeText, { color: colors.text }]}>
              {activeRoomCode}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.copyButton,
              {
                backgroundColor: copiedCode ? colors.primary : colors.surfaceRaised,
                borderColor: colors.border,
                borderRadius: radii.pill,
              },
            ]}
            onPress={handleCopyCode}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Copy room code ${activeRoomCode}`}
          >
            <Ionicons
              name={copiedCode ? 'checkmark' : 'copy-outline'}
              size={14}
              color={copiedCode ? colors.primaryText : colors.text}
            />
            <Text
              variant="xs"
              weight="700"
              style={{
                color: copiedCode ? colors.primaryText : colors.text,
                marginLeft: 4,
              }}
            >
              {copiedCode ? 'Copied' : 'Copy'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Host Controls: Player Count */}
        {isHost && clientState?.lobby && (
          <View style={[styles.playerCountSection, { borderTopColor: colors.border }]}>
            <Text variant="xs" weight="700" style={{ color: colors.textMuted, marginBottom: 8 }}>
              PLAYER COUNT (HOST)
            </Text>
            <View style={styles.playerCountRow}>
              {([2, 3, 4] as (2 | 3 | 4)[]).map((count) => {
                const isSelected = clientState.lobby?.activeSeatCount === count;
                return (
                  <TouchableOpacity
                    key={count}
                    style={[
                      styles.playerCountButton,
                      {
                        backgroundColor: isSelected ? colors.primary : colors.surfaceRaised,
                        borderColor: isSelected ? colors.primary : colors.border,
                        borderRadius: radii.md,
                      },
                    ]}
                    onPress={() => handleSetPlayerCount(count)}
                    activeOpacity={0.8}
                  >
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: isSelected ? colors.primaryText : colors.text }}
                    >
                      {count} Players
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </Card>

      {/* Seats Container */}
      <View style={{ marginBottom: spacing.lg }}>
        <Text variant="xs" weight="700" style={{ color: colors.textMuted, marginBottom: 8 }}>
          SEATS ({clientState?.lobby?.activeSeatCount || 4} ACTIVE)
        </Text>

        {!clientState?.lobby ? (
          <Card
            style={[
              styles.loadingCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.card,
              },
            ]}
          >
            <ActivityIndicator size="small" color={colors.primary} />
            <Text variant="sm" style={{ color: colors.textMuted, marginLeft: 10 }}>
              Connecting to room lobby…
            </Text>
          </Card>
        ) : (
          CANONICAL_COLORS.map((color) => {
            const seat = clientState.lobby?.seats[color];
            const theme = COLOR_THEMES[color];
            const isMe = seat?.status === 'human' && seat?.userId === clientState.myUserId;
            const isSeatHost = seat?.status === 'human' && seat?.userId === clientState.lobby?.hostUserId;
            const isOnline = seat?.userId ? Boolean(clientState.presence[seat.userId]) : false;

            return (
              <Card
                key={color}
                style={[
                  styles.seatCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isMe ? theme.hex : colors.border,
                    borderRadius: radii.card,
                    marginBottom: 10,
                  },
                ]}
              >
                <View style={styles.seatHeaderRow}>
                  <View style={styles.seatColorBadgeRow}>
                    <View style={[styles.seatColorDot, { backgroundColor: theme.hex }]} />
                    <Text variant="sm" weight="700" style={{ color: colors.text }}>
                      {theme.name}
                    </Text>
                    {isMe && (
                      <Badge
                        label="YOU"
                        variant="official"
                        size="sm"
                        style={{ marginLeft: 6 }}
                      />
                    )}
                    {isSeatHost && (
                      <Badge
                        label="HOST"
                        variant="neutral"
                        size="sm"
                        style={{ marginLeft: 6 }}
                      />
                    )}
                  </View>

                  {/* Presence indicator for humans */}
                  {seat?.status === 'human' && (
                    <View style={styles.presenceRow}>
                      <View
                        style={[
                          styles.presenceDot,
                          { backgroundColor: isOnline ? colors.success : colors.textMuted },
                        ]}
                      />
                      <Caption style={{ color: isOnline ? colors.success : colors.textMuted, marginLeft: 4 }}>
                        {isOnline ? 'Online' : 'Offline'}
                      </Caption>
                    </View>
                  )}
                </View>

                {/* Seat Body */}
                <View style={styles.seatBodyRow}>
                  {seat?.status === 'human' && (
                    <View style={styles.seatDetailCol}>
                      <Text variant="md" weight="700" style={{ color: colors.text }} numberOfLines={1}>
                        {seat.displayName || 'Human Player'}
                      </Text>
                      <View style={{ marginTop: 4 }}>
                        <Badge
                          label={seat.ready ? 'READY ✓' : 'NOT READY'}
                          variant={seat.ready ? 'success' : 'neutral'}
                          size="sm"
                        />
                      </View>
                    </View>
                  )}

                  {seat?.status === 'bot' && (
                    <View style={styles.seatDetailCol}>
                      <Text variant="md" weight="700" style={{ color: colors.text }}>
                        Bot ({seat.botDifficulty ? seat.botDifficulty.toUpperCase() : 'NORMAL'})
                      </Text>
                      {isHost && (
                        <View style={styles.botActionsRow}>
                          <TouchableOpacity
                            style={[
                              styles.smallPillButton,
                              { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                            ]}
                            onPress={() => handleCycleBotDifficulty(color, seat.botDifficulty)}
                          >
                            <Caption style={{ color: colors.text }}>Change Difficulty</Caption>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.smallPillButton,
                              { backgroundColor: colors.surfaceRaised, borderColor: colors.error, marginLeft: 8 },
                            ]}
                            onPress={() => handleRemoveBot(color)}
                          >
                            <Caption style={{ color: colors.error }}>Remove</Caption>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )}

                  {seat?.status === 'open' && (
                    <View style={styles.seatDetailCol}>
                      <Text variant="sm" weight="600" style={{ color: colors.textMuted }}>
                        Open Seat
                      </Text>
                      {isHost && (
                        <TouchableOpacity
                          style={[
                            styles.smallPillButton,
                            { backgroundColor: colors.surfaceRaised, borderColor: colors.border, marginTop: 4 },
                          ]}
                          onPress={() => handleAddBot(color)}
                        >
                          <Caption style={{ color: colors.primary }}>+ Add Bot</Caption>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {seat?.status === 'closed' && (
                    <View style={styles.seatDetailCol}>
                      <Text variant="sm" style={{ color: colors.textMuted }}>
                        Closed
                      </Text>
                    </View>
                  )}
                </View>
              </Card>
            );
          })
        )}
      </View>

      {/* Action Controls Section */}
      <View style={{ marginTop: spacing.sm, gap: 10 }}>
        {/* Non-host Ready Toggle */}
        {!isHost && mySeat && (
          <Button
            title={mySeat.ready ? 'Unready' : 'Ready to Play'}
            variant={mySeat.ready ? 'secondary' : 'primary'}
            onPress={handleToggleReady}
            leftIcon={
              <Ionicons
                name={mySeat.ready ? 'close-circle-outline' : 'checkmark-circle-outline'}
                size={18}
                color={mySeat.ready ? colors.text : colors.primaryText}
              />
            }
          />
        )}

        {/* Host Start Game Button */}
        {isHost && (
          <PrimaryButton
            title="Start Match"
            loading={isStartingGame}
            disabled={!startEvaluation.canStart || isStartingGame}
            onPress={handleStartGame}
            leftIcon={<Ionicons name="play" size={18} color={colors.primaryText} />}
          />
        )}

        {/* Leave Room Button */}
        <SecondaryButton
          title="Leave Room"
          onPress={handleLeaveRoom}
          leftIcon={<Ionicons name="exit-outline" size={18} color={colors.text} />}
        />
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
  reconnectingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  roomHeaderCard: {
    padding: 16,
    borderWidth: 1.5,
  },
  roomCodeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roomCodeText: {
    fontSize: 24,
    letterSpacing: 2,
    marginTop: 2,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  playerCountSection: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  playerCountRow: {
    flexDirection: 'row',
    gap: 8,
  },
  playerCountButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  loadingCard: {
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  seatCard: {
    padding: 14,
    borderWidth: 1.5,
  },
  seatHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  seatColorBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  seatColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  presenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  seatBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seatDetailCol: {
    flex: 1,
  },
  botActionsRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  smallPillButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  matchReadyCard: {
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  matchReadyIconBox: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  matchReadyTitle: {
    fontSize: 22,
    letterSpacing: -0.5,
  },
  phaseNoteBox: {
    padding: 14,
    borderWidth: 1,
    width: '100%',
    alignItems: 'center',
  },
});
