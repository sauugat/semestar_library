import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Typography';
import { Monochrome } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/services/api';

interface GameItem {
  id: string;
  title: string;
  category: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  status: 'available' | 'coming_soon';
}

const FEATURED_GAMES: GameItem[] = [
  {
    id: 'tic-tac-toe',
    title: 'Tic Tac Toe',
    category: 'Turn-Based Multiplayer',
    description: 'Challenge your cohort peers or play a quick local practice round.',
    icon: 'grid-outline',
    status: 'available',
  },
  {
    id: 'quiz-arena',
    title: 'Quiz Arena',
    category: 'Semester Trivia',
    description: 'Timed subject challenges against students from your semester cohort.',
    icon: 'help-circle-outline',
    status: 'coming_soon',
  },
  {
    id: 'chess',
    title: 'Chess',
    category: 'Classic Strategy',
    description: 'Deep strategic matches with asynchronous move notifications.',
    icon: 'shield-outline',
    status: 'coming_soon',
  },
];

export function GamesView() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [activeGameModal, setActiveGameModal] = useState<string | null>(null);

  // Local Tic Tac Toe board state
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

  const handleLaunchGame = async (game: GameItem) => {
    if (game.status === 'coming_soon') {
      Alert.alert(game.title, 'This game is currently in development for your semester.');
      return;
    }
    resetGame();
    setActiveGameModal(game.id);
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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick Challenge Banner */}
        <View style={styles.bannerCard}>
          <View style={styles.bannerTextContainer}>
            <Text style={styles.bannerTitle}>Instant Multiplayer</Text>
            <Text style={styles.bannerSubtitle}>
              Play casual matches between study sessions with your classmates.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.bannerActionBtn}
            onPress={() => handleLaunchGame(FEATURED_GAMES[0])}
            activeOpacity={0.75}
          >
            <Text style={styles.bannerActionText}>Quick Play</Text>
            <Ionicons name="play" size={12} color="#111111" />
          </TouchableOpacity>
        </View>

        {/* Section Heading */}
        <Text style={styles.sectionHeader}>Featured Games</Text>

        {/* Game Cards */}
        {FEATURED_GAMES.map((game) => {
          const isAvailable = game.status === 'available';

          return (
            <TouchableOpacity
              key={game.id}
              style={styles.gameCard}
              onPress={() => handleLaunchGame(game)}
              activeOpacity={0.7}
            >
              <View style={styles.gameIconBox}>
                <Ionicons name={game.icon} size={24} color="#FFFFFF" />
              </View>

              <View style={styles.gameDetails}>
                <View style={styles.gameHeaderRow}>
                  <Text style={styles.gameTitle}>{game.title}</Text>
                  <View
                    style={[
                      styles.statusPill,
                      isAvailable ? styles.statusPillActive : styles.statusPillPending,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        isAvailable ? styles.statusPillTextActive : styles.statusPillTextPending,
                      ]}
                    >
                      {isAvailable ? 'Play' : 'Coming Soon'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.gameCategory}>{game.category}</Text>
                <Text style={styles.gameDescription}>{game.description}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Game Modal (Tic Tac Toe) */}
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
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    flexDirection: 'row',
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#282828',
    padding: 14,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  gameIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: '#282828',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  gameDetails: {
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
    marginBottom: 4,
  },
  gameDescription: {
    fontSize: 12.5,
    color: '#A1A1A1',
    lineHeight: 17,
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
