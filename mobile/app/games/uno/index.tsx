import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Text } from '@/components/ui/Typography';
import { useAuth } from '@/context/AuthContext';
import { UnoGameMode, UnoGameState, UnoCard as UnoCardType } from '@/components/games/uno/types';
import { createInitialUnoGame } from '@/components/games/uno/uno-engine';
import { UnoTable } from '@/components/games/uno/UnoTable';
import { UnoCard } from '@/components/games/uno/UnoCard';
import { TempleBell } from '@/components/games/uno/TempleBell';
import {
  playUnoSfx,
  NEPALI_TUNES,
  NepaliTuneId,
  getUnoCurrentTune,
  setUnoCurrentTune,
} from '@/components/games/uno/uno-sfx';

const SHOWCASE_CARDS: {
  card: UnoCardType;
  sfx: 'card_play' | 'skip' | 'reverse' | 'draw2' | 'wild4';
}[] = [
  {
    card: {
      id: 'demo_red',
      color: 'rato',
      type: 'number',
      value: 7,
      nepaliDigit: '७',
      nepaliLabel: 'Red 7',
      englishLabel: 'Red 7',
      scoreValue: 7,
    },
    sfx: 'card_play',
  },
  {
    card: {
      id: 'demo_blue',
      color: 'nilo',
      type: 'skip',
      nepaliLabel: 'Blue Skip',
      englishLabel: 'Blue Skip',
      scoreValue: 20,
    },
    sfx: 'skip',
  },
  {
    card: {
      id: 'demo_green',
      color: 'hariyo',
      type: 'reverse',
      nepaliLabel: 'Green Reverse',
      englishLabel: 'Green Reverse',
      scoreValue: 20,
    },
    sfx: 'reverse',
  },
  {
    card: {
      id: 'demo_yellow',
      color: 'pahelo',
      type: 'draw2',
      nepaliLabel: 'Yellow +2',
      englishLabel: 'Yellow +2',
      scoreValue: 20,
    },
    sfx: 'draw2',
  },
  {
    card: {
      id: 'demo_wild',
      color: 'wild',
      type: 'wild4',
      nepaliLabel: 'Wild +4',
      englishLabel: 'Wild +4',
      scoreValue: 50,
    },
    sfx: 'wild4',
  },
];

export default function UnoGameScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth >= windowHeight;

  const [activeGame, setActiveGame] = useState<UnoGameState | null>(null);
  const [selectedTune, setSelectedTune] = useState<NepaliTuneId>(getUnoCurrentTune());
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});

    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ])
    ).start();

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [floatAnim]);

  const startNewGame = (mode: UnoGameMode) => {
    playUnoSfx('win_celebration');
    const userName = user?.name ? user.name.split(' ')[0] : 'Player';
    const initial = createInitialUnoGame(mode, userName, userName);
    setActiveGame(initial);
  };

  const handleExitGame = () => {
    setActiveGame(null);
  };

  const handleSelectTune = (tuneId: NepaliTuneId) => {
    setSelectedTune(tuneId);
    setUnoCurrentTune(tuneId);
    playUnoSfx('bell_chime');
  };

  if (activeGame) {
    return (
      <View style={styles.safeArea}>
        <StatusBar hidden={isLandscape} barStyle="light-content" />
        <UnoTable
          initialState={activeGame}
          onExit={handleExitGame}
          onRestart={() => startNewGame(activeGame.mode)}
        />
      </View>
    );
  }

  const floatTranslateY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -5],
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#160B06" />

      {/* Top Newari Ankhi Jhyal Carved Wood Lattice Frieze */}
      <View style={styles.ankhiJhyalFrieze}>
        {Array.from({ length: 16 }).map((_, idx) => (
          <View
            key={`f_${idx}`}
            style={[
              styles.friezeDiamond,
              idx % 2 === 0 && styles.friezeDiamondGold,
            ]}
          />
        ))}
      </View>

      {/* Carved Newari Arch Top Header */}
      <View style={styles.hubHeader}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.bronzeCircleBtn}
          accessibilityLabel="Go back to Games"
        >
          <Ionicons name="arrow-back" size={20} color="#FCD34D" />
        </TouchableOpacity>
        <View style={styles.headerTitleCenter}>
          <Text style={styles.hubHeaderTitle}>UNO: HERITAGE EDITION</Text>
          <Text style={styles.hubHeaderSub}>Traditional Nepali Wood-Carved Court</Text>
        </View>
        <TempleBell size={22} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isLandscape && styles.scrollContentLandscape,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Bespoke Carved Rosewood & Gilded Brass Hero Card */}
        <View style={styles.heroCard}>
          {/* 4 Carved Brass Corner Studs */}
          <View style={[styles.brassCornerStud, styles.studTL]} />
          <View style={[styles.brassCornerStud, styles.studTR]} />
          <View style={[styles.brassCornerStud, styles.studBL]} />
          <View style={[styles.brassCornerStud, styles.studBR]} />

          <View style={styles.heroBadgeRow}>
            <View style={styles.carvedBadge}>
              <Ionicons name="sparkles" size={11} color="#FEF08A" />
              <Text style={styles.carvedBadgeText}>NEWARI WOOD CARVING & MANDALA</Text>
            </View>
            <View style={styles.playersPill}>
              <Ionicons name="people" size={12} color="#D4AF37" />
              <Text style={styles.playersPillText}>4 Players • Portrait & Landscape</Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>Royal Nepali Heritage UNO</Text>
          <Text style={styles.heroSubtitle}>
            Handcrafted with traditional Newari Ankhi Jhyal lattice woodwork, a rotating Ashtamangala Copper & Gold Mandala table, and warm Himalayan acoustic tones (Bansuri flute, Tungna lute & Madal).
          </Text>

          {/* Interactive Tap-to-Play Card Showcase Strip */}
          <Text style={styles.showcaseHintText}>
            TAP ANY CARVED HERITAGE CARD TO TEST ITS ACOUSTIC SOUND:
          </Text>
          <Animated.View
            style={[
              styles.cardPreviewStrip,
              { transform: [{ translateY: floatTranslateY }] },
            ]}
          >
            {SHOWCASE_CARDS.map((item, idx) => (
              <View
                key={item.card.id}
                style={[
                  styles.previewCardSlot,
                  { transform: [{ rotate: `${(idx - 2) * 4}deg` }] },
                ]}
              >
                <UnoCard
                  card={item.card}
                  isFaceUp={true}
                  isPlayable={true}
                  onPress={() => playUnoSfx(item.sfx)}
                  width={54}
                  height={80}
                />
              </View>
            ))}
          </Animated.View>

          {/* 4 Heritage Suit Colors */}
          <View style={styles.colorPillsRow}>
            <View style={[styles.miniColorDot, { backgroundColor: '#EF4444' }]} />
            <Text style={styles.miniColorLabel}>Red</Text>

            <View style={[styles.miniColorDot, { backgroundColor: '#2563EB' }]} />
            <Text style={styles.miniColorLabel}>Blue</Text>

            <View style={[styles.miniColorDot, { backgroundColor: '#10B981' }]} />
            <Text style={styles.miniColorLabel}>Green</Text>

            <View style={[styles.miniColorDot, { backgroundColor: '#F59E0B' }]} />
            <Text style={styles.miniColorLabel}>Yellow</Text>
          </View>
        </View>

        {/* Select Game Mode */}
        <Text style={styles.sectionTitle}>Select Game Mode</Text>
        <View style={isLandscape ? styles.modesGridLandscape : undefined}>
          {/* Mode 1: Play with AI Bots */}
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={() => startNewGame('bots')}
            style={[
              styles.modeCard,
              styles.modeCardPrimary,
              isLandscape && styles.modeCardHalf,
            ]}
          >
            <View style={[styles.modeIconBox, { backgroundColor: '#3B1A0B' }]}>
              <Ionicons name="sparkles" size={26} color="#D4AF37" />
            </View>
            <View style={styles.modeTextBox}>
              <View style={styles.modeTitleRow}>
                <Text style={styles.modeTitle}>Play vs Smart Bots</Text>
                <View style={styles.readyBadge}>
                  <Text style={styles.readyBadgeText}>ROYAL TABLE</Text>
                </View>
              </View>
              <Text style={styles.modeSubtitle}>
                Challenge Tanuja, Harsh, and Shubho on the carved Newari Rosewood & Ashtamangala Mandala table.
              </Text>
            </View>
          </TouchableOpacity>

          {/* Mode 2: Pass & Play */}
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={() => startNewGame('pass_and_play')}
            style={[styles.modeCard, isLandscape && styles.modeCardHalf]}
          >
            <View style={[styles.modeIconBox, { backgroundColor: '#0E231F' }]}>
              <Ionicons name="phone-portrait-outline" size={26} color="#34D399" />
            </View>
            <View style={styles.modeTextBox}>
              <View style={styles.modeTitleRow}>
                <Text style={styles.modeTitle}>Pass & Play (Local 4P)</Text>
                <View style={[styles.readyBadge, { backgroundColor: 'rgba(16, 185, 129, 0.2)', borderColor: '#10B981' }]}>
                  <Text style={[styles.readyBadgeText, { color: '#34D399' }]}>FRIENDS</Text>
                </View>
              </View>
              <Text style={styles.modeSubtitle}>
                Play with up to 4 friends on one phone. Hands switch smoothly on each player's turn.
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Select Nepali Acoustic Background Tone */}
        <Text style={styles.sectionTitle}>Select Nepali Acoustic Background Tone</Text>
        <View style={styles.tuneCardsRow}>
          {NEPALI_TUNES.map(tune => {
            const isSelected = selectedTune === tune.id;
            return (
              <TouchableOpacity
                key={tune.id}
                activeOpacity={0.85}
                onPress={() => handleSelectTune(tune.id)}
                style={[
                  styles.tuneOptionCard,
                  isSelected && styles.tuneOptionCardActive,
                ]}
              >
                <View style={styles.tuneOptionTopRow}>
                  <Ionicons
                    name={isSelected ? 'musical-notes' : 'musical-note-outline'}
                    size={16}
                    color={isSelected ? '#FCD34D' : '#D4AF37'}
                  />
                  {isSelected && <View style={styles.activeTuneDot} />}
                </View>
                <Text style={styles.tuneTitle}>{tune.titleEn}</Text>
                <Text style={styles.tuneSub} numberOfLines={2}>
                  {tune.subtitle}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Quick Tips Box */}
        <View style={styles.quickRulesCard}>
          <View style={styles.quickRulesHeader}>
            <Ionicons name="trophy" size={18} color="#D4AF37" />
            <Text style={styles.quickRulesTitle}>Designed for Effortless Play:</Text>
          </View>
          <Text style={styles.quickRulesBody}>
            • <Text style={{ color: '#FEF08A', fontWeight: '800' }}>Playable Cards Glow:</Text> Valid cards automatically elevate with a golden aura on your turn.{'\n'}
            • <Text style={{ color: '#FEF08A', fontWeight: '800' }}>Dashain Diamond Kite:</Text> Tap the <Text style={{ color: '#FCD34D', fontWeight: '800' }}>UNO!</Text> kite when down to 1 or 2 cards.{'\n'}
            • <Text style={{ color: '#FEF08A', fontWeight: '800' }}>Campus Victory Post:</Text> Win a match to share your Royal Heritage Victory Card to the Campus Feed!
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#160B06',
  },
  ankhiJhyalFrieze: {
    height: 10,
    backgroundColor: '#261107',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.35)',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  friezeDiamond: {
    width: 5,
    height: 5,
    backgroundColor: '#5C2810',
    transform: [{ rotate: '45deg' }],
  },
  friezeDiamondGold: {
    backgroundColor: '#D4AF37',
  },
  hubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#220F06',
    borderBottomWidth: 1.5,
    borderBottomColor: '#78350F',
  },
  bronzeCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#2D1409',
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleCenter: {
    alignItems: 'center',
  },
  hubHeaderTitle: {
    color: '#FCD34D',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  hubHeaderSub: {
    color: '#FDE68A',
    fontSize: 10.5,
    fontWeight: '700',
    opacity: 0.85,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
  },
  scrollContentLandscape: {
    paddingHorizontal: 28,
  },
  heroCard: {
    backgroundColor: '#261107',
    borderRadius: 20,
    padding: 18,
    borderWidth: 2,
    borderColor: '#D4AF37',
    marginBottom: 20,
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.65,
    shadowRadius: 10,
    elevation: 6,
  },
  brassCornerStud: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D4AF37',
  },
  studTL: { top: 8, left: 8 },
  studTR: { top: 8, right: 8 },
  studBL: { bottom: 8, left: 8 },
  studBR: { bottom: 8, right: 8 },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  carvedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#5B131A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  carvedBadgeText: {
    color: '#FEF08A',
    fontSize: 10,
    fontWeight: '800',
  },
  playersPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#3B1A0B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#92400E',
  },
  playersPillText: {
    color: '#FCD34D',
    fontSize: 10.5,
    fontWeight: '700',
  },
  heroTitle: {
    color: '#FFFBEB',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 6,
  },
  heroSubtitle: {
    color: '#FDE68A',
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 12,
    opacity: 0.9,
  },
  showcaseHintText: {
    color: '#D4AF37',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 10,
  },
  cardPreviewStrip: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: 10,
  },
  previewCardSlot: {
    marginHorizontal: -3,
  },
  colorPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  miniColorDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    marginRight: 5,
  },
  miniColorLabel: {
    color: '#FDE68A',
    fontSize: 11,
    fontWeight: '700',
    marginRight: 14,
  },
  sectionTitle: {
    color: '#FCD34D',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 10,
  },
  modesGridLandscape: {
    flexDirection: 'row',
    gap: 12,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#261107',
    borderRadius: 16,
    padding: 15,
    borderWidth: 1.8,
    borderColor: '#78350F',
    marginBottom: 12,
  },
  modeCardPrimary: {
    borderColor: '#D4AF37',
  },
  modeCardHalf: {
    flex: 1,
  },
  modeIconBox: {
    width: 50,
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  modeTextBox: {
    flex: 1,
  },
  modeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modeTitle: {
    color: '#FFFBEB',
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  readyBadge: {
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  readyBadgeText: {
    color: '#FCD34D',
    fontSize: 9.5,
    fontWeight: '800',
  },
  modeSubtitle: {
    color: '#FDE68A',
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.88,
  },
  tuneCardsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  tuneOptionCard: {
    flex: 1,
    backgroundColor: '#261107',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1.5,
    borderColor: '#78350F',
  },
  tuneOptionCardActive: {
    borderColor: '#D4AF37',
    backgroundColor: '#3B1A0B',
  },
  tuneOptionTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  activeTuneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  tuneTitle: {
    color: '#FFFBEB',
    fontSize: 12,
    fontWeight: '800',
  },
  tuneSub: {
    color: '#FDE68A',
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
    opacity: 0.85,
  },
  quickRulesCard: {
    backgroundColor: '#261107',
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#D4AF37',
    borderWidth: 1,
    borderColor: '#78350F',
  },
  quickRulesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  quickRulesTitle: {
    color: '#FCD34D',
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 6,
  },
  quickRulesBody: {
    color: '#FDE68A',
    fontSize: 12,
    lineHeight: 18,
  },
});
