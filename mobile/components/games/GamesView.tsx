import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Typography';
import { useAuth } from '@/context/AuthContext';
import { isOnlineGamesAvailable } from '@/services/games-api';

export interface GameDirectoryItem {
  id: string;
  title: string;
  category: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  status: 'playable' | 'coming_soon';
  modes?: {
    id: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    action:
      | 'modal_ttt'
      | 'route_ttt'
      | 'route_ludo'
      | 'route_ludo_setup'
      | 'route_ludo_online'
      | 'online_disabled';
    disabled?: boolean;
    badge?: string;
  }[];
}

export function GamesView() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [activeGameModal, setActiveGameModal] = useState<string | null>(null);
  const isOnlineAvailable = isOnlineGamesAvailable();

  const gamesDirectory = useMemo<GameDirectoryItem[]>(() => [
    {
      id: 'tic-tac-toe',
      title: 'Tic Tac Toe',
      category: 'Turn-Based Strategy',
      description: 'Play a quick pass-and-play practice round or challenge classmates online.',
      icon: 'grid-outline',
      status: 'playable',
      modes: [
        {
          id: 'ttt-quick',
          label: 'Quick Play',
          icon: 'play',
          action: 'modal_ttt',
        },
        {
          id: 'ttt-online',
          label: 'Online Multiplayer',
          icon: 'globe-outline',
          action: isOnlineAvailable ? 'route_ttt' : 'online_disabled',
          badge: isOnlineAvailable ? undefined : 'Setup Required',
        },
      ],
    },
    {
      id: 'ludo',
      title: 'Ludo',
      category: 'Classic Board Game',
      description: '2 to 4 player strategy match with bot intelligence, safe zones, and local auto-save.',
      icon: 'dice-outline',
      status: 'playable',
      modes: [
        {
          id: 'ludo-offline',
          label: 'Offline Match',
          icon: 'phone-portrait-outline',
          action: 'route_ludo',
        },
        {
          id: 'ludo-bots',
          label: 'Play with Bots',
          icon: 'hardware-chip-outline',
          action: 'route_ludo_setup',
        },
        {
          id: 'ludo-online',
          label: 'Online Multiplayer',
          icon: 'globe-outline',
          action: isOnlineAvailable ? 'route_ludo_online' : 'online_disabled',
          badge: isOnlineAvailable ? undefined : 'Setup Required',
        },
      ],
    },
    {
      id: 'color-cards',
      title: 'UNO / Color Cards',
      category: 'Card Matching',
      description: 'Fast-paced color matching and tactical discard challenges with friends.',
      icon: 'albums-outline',
      status: 'coming_soon',
    },
    {
      id: 'imposter',
      title: 'Imposter',
      category: 'Social Deduction',
      description: 'Uncover the infiltrator among your classmates before time runs out.',
      icon: 'people-outline',
      status: 'coming_soon',
    },
    {
      id: 'chess',
      title: 'Chess',
      category: 'Grandmaster Tactics',
      description: 'Deep strategic matches with asynchronous move clocks and rankings.',
      icon: 'trophy-outline',
      status: 'coming_soon',
    },
    {
      id: 'quiz-arena',
      title: 'Quiz Arena',
      category: 'Cohort Trivia',
      description: 'Timed subject quizzes and semester challenges against your peers.',
      icon: 'help-circle-outline',
      status: 'coming_soon',
    },
  ], [isOnlineAvailable]);

  // Local Tic Tac Toe board state (preserved)
  const [board, setBoard] = useState<(string | null)[]>(Array(9).fill(null));
  const [turn, setTurn] = useState<'X' | 'O'>('X');
  const [winner, setWinner] = useState<string | null>(null);

  const checkWinner = (squares: (string | null)[]) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];
    for (const [a, b, c] of lines) {
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return squares[a];
      }
    }
    if (squares.every(Boolean)) return 'Tie';
    return null;
  };

  const handleSquarePress = (idx: number) => {
    if (board[idx] || winner) return;
    const nextBoard = [...board];
    nextBoard[idx] = turn;
    setBoard(nextBoard);

    const result = checkWinner(nextBoard);
    if (result) {
      setWinner(result);
    } else {
      setTurn(turn === 'X' ? 'O' : 'X');
    }
  };

  const resetGame = () => {
    setBoard(Array(9).fill(null));
    setTurn('X');
    setWinner(null);
  };

  const handleLaunchMode = (action: string) => {
    if (action === 'modal_ttt') {
      resetGame();
      setActiveGameModal('tic-tac-toe');
    } else if (action === 'route_ttt') {
      router.push('/games/tic-tac-toe' as any);
    } else if (action === 'route_ludo') {
      router.push('/games/ludo' as any);
    } else if (action === 'route_ludo_setup') {
      router.push('/games/ludo/setup' as any);
    } else if (action === 'route_ludo_online') {
      router.push('/games/ludo/online' as any);
    } else if (action === 'online_disabled') {
      Alert.alert(
        'Online Multiplayer Unavailable',
        'Online multiplayer requires an explicitly configured game backend (e.g., local dev worker at ws://127.0.0.1:8789). Local pass-and-play and bot matches remain fully functional.'
      );
    }
  };

  const handleComingSoonPress = (title: string) => {
    Alert.alert(
      title,
      'This game is currently in development and will be released in an upcoming update.'
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>Games</Text>
          <View style={styles.headerBadge}>
            <Ionicons name="game-controller-outline" size={16} color="#FFFFFF" />
          </View>
        </View>
        <Text style={styles.headerSubtitle}>Multiplayer & Cohort Challenges</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick Challenge Banner */}
        <View style={styles.bannerCard}>
          <View style={styles.bannerTextContainer}>
            <Text style={styles.bannerTitle}>Offline Ludo & Quick Play</Text>
            <Text style={styles.bannerSubtitle}>
              Play casual matches between classes. Supports local pass-and-play and AI bots without network access.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.bannerActionBtn}
            onPress={() => router.push('/games/ludo' as any)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Launch Offline Ludo"
          >
            <Text style={styles.bannerActionText}>Play Ludo</Text>
            <Ionicons name="arrow-forward" size={12} color="#111111" />
          </TouchableOpacity>
        </View>

        {/* Section Heading */}
        <Text style={styles.sectionHeader}>Game Directory</Text>

        {/* Game Cards */}
        {gamesDirectory.map((game) => {
          const isPlayable = game.status === 'playable';

          return (
            <View key={game.id} style={styles.gameCard}>
              <View style={styles.gameCardHeader}>
                <View style={styles.gameIconBox}>
                  <Ionicons
                    name={game.icon}
                    size={22}
                    color={isPlayable ? '#FFFFFF' : '#737373'}
                  />
                </View>

                <View style={styles.gameTitleContainer}>
                  <View style={styles.gameHeaderRow}>
                    <Text style={styles.gameTitle}>{game.title}</Text>
                    <View
                      style={[
                        styles.statusPill,
                        isPlayable ? styles.statusPillActive : styles.statusPillPending,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          isPlayable ? styles.statusPillTextActive : styles.statusPillTextPending,
                        ]}
                      >
                        {isPlayable ? 'Playable' : 'Coming Soon'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.gameCategory}>{game.category}</Text>
                </View>
              </View>

              <Text style={styles.gameDescription}>{game.description}</Text>

              {/* Mode Action Buttons for Playable Games */}
              {isPlayable && game.modes && (
                <View style={styles.modesRow}>
                  {game.modes.map((mode) => (
                    <TouchableOpacity
                      key={mode.id}
                      style={[
                        styles.modeButton,
                        mode.action === 'online_disabled'
                          ? styles.modeButtonDisabled
                          : styles.modeButtonPrimary,
                      ]}
                      onPress={() => handleLaunchMode(mode.action)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${game.title} ${mode.label}`}
                    >
                      <Ionicons
                        name={mode.icon}
                        size={13}
                        color={mode.action === 'online_disabled' ? '#737373' : '#FFFFFF'}
                      />
                      <Text
                        style={[
                          styles.modeButtonText,
                          mode.action === 'online_disabled'
                            ? styles.modeButtonTextDisabled
                            : styles.modeButtonTextPrimary,
                        ]}
                      >
                        {mode.label}
                      </Text>
                      {mode.badge && (
                        <View style={styles.modeBadge}>
                          <Text style={styles.modeBadgeText}>{mode.badge}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Tap handler for non-playable cards */}
              {!isPlayable && (
                <TouchableOpacity
                  style={styles.comingSoonTouchArea}
                  onPress={() => handleComingSoonPress(game.title)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${game.title} Coming Soon`}
                >
                  <Text style={styles.comingSoonHint}>In development for your semester cohort</Text>
                  <Ionicons name="information-circle-outline" size={14} color="#737373" />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Game Modal (Local Tic Tac Toe - Preserved) */}
      <Modal
        visible={activeGameModal === 'tic-tac-toe'}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setActiveGameModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Tic Tac Toe</Text>
                <Text style={styles.modalSubtitle}>
                  {winner
                    ? winner === 'Tie'
                      ? 'Game ended in a Tie!'
                      : `Winner: ${winner}!`
                    : `Current Turn: ${turn}`}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setActiveGameModal(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Close Tic Tac Toe"
              >
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* 3x3 Board */}
            <View style={styles.boardGrid}>
              {board.map((cell, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.boardCell}
                  onPress={() => handleSquarePress(idx)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Cell ${idx + 1}: ${cell || 'Empty'}`}
                >
                  <Text style={styles.boardCellText}>{cell || ''}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Reset Button */}
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={resetGame}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Start New Round"
            >
              <Text style={styles.resetBtnText}>New Round</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080808',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#282828',
    backgroundColor: '#101010',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#303030',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#A1A1A1',
    marginTop: 2,
  },
  scrollContent: {
    padding: 16,
  },
  bannerCard: {
    backgroundColor: '#171717',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#303030',
    padding: 16,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerTextContainer: {
    flex: 1,
    paddingRight: 12,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  bannerSubtitle: {
    fontSize: 12,
    color: '#A1A1A1',
    lineHeight: 16,
  },
  bannerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
  },
  bannerActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111111',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#737373',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
    marginLeft: 4,
  },
  gameCard: {
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#282828',
    padding: 14,
    marginBottom: 12,
  },
  gameCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  gameIconBox: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: '#282828',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  gameTitleContainer: {
    flex: 1,
  },
  gameHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  gameTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusPillActive: {
    backgroundColor: '#242424',
    borderWidth: 1,
    borderColor: '#383838',
  },
  statusPillPending: {
    backgroundColor: '#181818',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusPillTextActive: {
    color: '#FFFFFF',
  },
  statusPillTextPending: {
    color: '#737373',
  },
  gameCategory: {
    fontSize: 11.5,
    color: '#737373',
  },
  gameDescription: {
    fontSize: 12.5,
    color: '#A1A1A1',
    lineHeight: 17,
    marginBottom: 10,
  },
  modesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#242424',
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    gap: 5,
  },
  modeButtonPrimary: {
    backgroundColor: '#222222',
    borderWidth: 1,
    borderColor: '#383838',
  },
  modeButtonDisabled: {
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#262626',
    borderStyle: 'dashed',
  },
  modeButtonText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  modeButtonTextPrimary: {
    color: '#FFFFFF',
  },
  modeButtonTextDisabled: {
    color: '#737373',
  },
  modeBadge: {
    backgroundColor: '#2B2B2B',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    marginLeft: 2,
  },
  modeBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#9E9E9E',
  },
  comingSoonTouchArea: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#202020',
  },
  comingSoonHint: {
    fontSize: 11,
    color: '#555555',
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: '#282828',
    padding: 20,
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#A1A1A1',
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#242424',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardGrid: {
    width: 270,
    height: 270,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 20,
  },
  boardCell: {
    width: 82,
    height: 82,
    backgroundColor: '#1C1C1C',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#282828',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardCellText: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  resetBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
  },
  resetBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111111',
  },
});
