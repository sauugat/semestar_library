import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  Animated,
  Easing,
  Image,
  useWindowDimensions,
  TextInput,
  Share,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Text } from '@/components/ui/Typography';
import { createPost } from '@/services/posts';
import {
  UnoCard as UnoCardType,
  UnoColor,
  UnoGameState,
  UnoPlayer,
  COLOR_METAS,
} from './types';
import {
  canPlayCard,
  playCard,
  drawCard,
  passTurn,
  callUno,
  challengeUno,
  computeBotMove,
} from './uno-engine';
import { UnoCard } from './UnoCard';
import { UnoKiteButton } from './UnoKiteButton';
import { TempleBell } from './TempleBell';
import { UnoAudioBridge, UnoAudioBridgeRef } from './UnoAudioBridge';
import {
  isUnoSfxMuted,
  setUnoSfxMuted,
  NEPALI_TUNES,
  NepaliTuneId,
  getUnoCurrentTune,
  setUnoCurrentTune,
} from './uno-sfx';

const AVATAR_TANUJA = require('@/assets/games/uno/tanuja.jpg');
const AVATAR_HARSH = require('@/assets/games/uno/harsh.jpg');
const AVATAR_GUST = require('@/assets/games/uno/gust.jpg');
const AVATAR_SHUBHO = require('@/assets/games/uno/shubho.jpg');

interface UnoTableProps {
  initialState: UnoGameState;
  onExit: () => void;
  onRestart: () => void;
}

interface FlyingCardData {
  card: UnoCardType;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isFaceUp: boolean;
}

interface ActionBannerData {
  title: string;
  subtitle: string;
  colorHex: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const QUICK_REACTIONS = [
  'Namaste! 🙏',
  'UNO! ⚡',
  'My Turn! 🎯',
  'Well Played! 👏',
  'Skipped! ⊘',
  'Reversed! ⇄',
  'Draw +2! 🔥',
  'Wild +4! 💥',
  'Royal Victory! 🏆',
];

function getAvatarSource(playerId: string) {
  if (playerId === 'p_1') return AVATAR_TANUJA;
  if (playerId === 'p_2') return AVATAR_HARSH;
  if (playerId === 'p_3') return AVATAR_SHUBHO;
  return AVATAR_GUST;
}

export function UnoTable({ initialState, onExit, onRestart }: UnoTableProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = windowWidth >= windowHeight;

  const [gameState, setGameState] = useState<UnoGameState>(initialState);
  const [soundMuted, setSoundMuted] = useState<boolean>(isUnoSfxMuted());
  const [activeTune, setActiveTune] = useState<NepaliTuneId>(getUnoCurrentTune());
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [showMenuModal, setShowMenuModal] = useState<boolean>(false);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [showReactionPicker, setShowReactionPicker] = useState<boolean>(false);
  const [pendingWildCard, setPendingWildCard] = useState<UnoCardType | null>(null);
  const [turnCounter, setTurnCounter] = useState<number>(1);

  // Win Post / Campus Feed Sharing State
  const [winPostCaption, setWinPostCaption] = useState<string>('');
  const [isPostingWin, setIsPostingWin] = useState<boolean>(false);
  const [winPostPublished, setWinPostPublished] = useState<boolean>(false);
  const [showWinPostComposer, setShowWinPostComposer] = useState<boolean>(false);

  // Character Reaction Bubbles
  const [reactions, setReactions] = useState<{ [playerId: string]: string }>({});

  // Action Popup Banner (Skip, Reverse, +2, Wild, +4, UNO, Catch)
  const [actionBanner, setActionBanner] = useState<ActionBannerData | null>(null);
  const bannerScale = useRef(new Animated.Value(0)).current;
  const bannerOpacity = useRef(new Animated.Value(0)).current;

  // Table Camera Shake for +2, +4, and Penalty
  const tableShakeAnim = useRef(new Animated.Value(0)).current;

  // Center Mandala Landing Shockwave Ripple
  const discardRippleScale = useRef(new Animated.Value(0.8)).current;
  const discardRippleOpacity = useRef(new Animated.Value(0)).current;

  // Flickering Brass Diyo Oil Lamp Flame
  const diyoFlickerAnim = useRef(new Animated.Value(1)).current;

  // Victory Trophy & Petal Shower Animations
  const victoryTrophyScale = useRef(new Animated.Value(0.92)).current;
  const petalAnim = useRef(new Animated.Value(0)).current;

  // Audio Bridge Ref
  const audioBridgeRef = useRef<UnoAudioBridgeRef>(null);

  // 60fps Card Flight Animation
  const [flyingCard, setFlyingCard] = useState<FlyingCardData | null>(null);
  const flyPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const flyScale = useRef(new Animated.Value(1)).current;
  const flyRotate = useRef(new Animated.Value(0)).current;

  // Active Turn Pulse & Diyo Flicker
  const turnGlowAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(turnGlowAnim, { toValue: 1.07, duration: 680, useNativeDriver: true }),
        Animated.timing(turnGlowAnim, { toValue: 0.96, duration: 680, useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(diyoFlickerAnim, { toValue: 1.15, duration: 360, useNativeDriver: true }),
        Animated.timing(diyoFlickerAnim, { toValue: 0.88, duration: 290, useNativeDriver: true }),
        Animated.timing(diyoFlickerAnim, { toValue: 1.06, duration: 320, useNativeDriver: true }),
      ])
    ).start();
  }, [turnGlowAnim, diyoFlickerAnim]);

  // Carved Copper & Gold Mandala Spin
  const rotateAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    rotateAnim.setValue(0);
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 16000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [gameState.direction, rotateAnim]);

  const rotationInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange:
      gameState.direction === 'clockwise' ? ['0deg', '360deg'] : ['360deg', '0deg'],
  });

  // Match Summary & Standings for Victory Modal
  const matchSummary = useMemo(() => {
    const sortedPlayers = [...gameState.players].sort((a, b) => {
      const scoreA = a.cards.reduce((sum, c) => sum + c.scoreValue, 0);
      const scoreB = b.cards.reduce((sum, c) => sum + c.scoreValue, 0);
      if (a.cards.length !== b.cards.length) return a.cards.length - b.cards.length;
      return scoreA - scoreB;
    });

    const winner = gameState.winner || sortedPlayers[0];
    const opponentsPoints = gameState.players
      .filter(p => p.id !== winner?.id)
      .reduce((acc, p) => acc + p.cards.reduce((s, c) => s + c.scoreValue, 0), 0);

    const totalVictoryPoints = Math.max(50, opponentsPoints);

    let rankTitle = 'Himalayan Victor';
    if (totalVictoryPoints >= 150) {
      rankTitle = 'Royal Durbar Grandmaster';
    } else if (totalVictoryPoints >= 90) {
      rankTitle = 'Master of the Mandala';
    }

    return {
      winner,
      standings: sortedPlayers,
      totalVictoryPoints,
      rankTitle,
    };
  }, [gameState.players, gameState.winner]);

  // Populate default Win Post caption when game ends
  useEffect(() => {
    if (gameState.status === 'game_over' && matchSummary.winner) {
      const w = matchSummary.winner;
      const isHumanWin = w.id === 'p_0' || gameState.mode === 'pass_and_play';
      const defaultCaption = isHumanWin
        ? `🏆 Royal Victory in UNO: Heritage Edition! Won the match as ${w.name} with +${matchSummary.totalVictoryPoints} points (${matchSummary.rankTitle}) in ${turnCounter} turns! 🪁🌺🥁 #UNOHeritage #SemesterLibrary`
        : `🃏 Great match of UNO: Heritage Edition! ${w.name} claimed victory with +${matchSummary.totalVictoryPoints} points (${matchSummary.rankTitle})! 🪁🥁 #UNOHeritage`;
      setWinPostCaption(defaultCaption);
      setWinPostPublished(false);

      petalAnim.setValue(0);
      Animated.loop(
        Animated.timing(petalAnim, {
          toValue: 1,
          duration: 3800,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(victoryTrophyScale, {
            toValue: 1.08,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(victoryTrophyScale, {
            toValue: 0.94,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [
    gameState.status,
    gameState.mode,
    matchSummary.winner,
    matchSummary.totalVictoryPoints,
    matchSummary.rankTitle,
    turnCounter,
    victoryTrophyScale,
    petalAnim,
  ]);

  const triggerAudioSfx = (type: string) => {
    if (audioBridgeRef.current) {
      audioBridgeRef.current.playSfx(type);
    }
  };

  const toggleSound = () => {
    const next = !soundMuted;
    setSoundMuted(next);
    setUnoSfxMuted(next);
    if (audioBridgeRef.current) {
      audioBridgeRef.current.setMuted(next);
    }
  };

  const cycleMusicStyle = () => {
    const idx = NEPALI_TUNES.findIndex(t => t.id === activeTune);
    const nextTune = NEPALI_TUNES[(idx + 1) % NEPALI_TUNES.length].id;
    setActiveTune(nextTune);
    setUnoCurrentTune(nextTune);
    if (audioBridgeRef.current) {
      audioBridgeRef.current.setTune(nextTune);
    }
    triggerAudioSfx('bell_chime');
  };

  const toggleScreenOrientation = async () => {
    if (isLandscape) {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    } else {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    }
  };

  // -------------------------------------------------------------------------
  // Visual Effects: Table Shake, Mandala Shockwave & Action Stamp
  // -------------------------------------------------------------------------
  const triggerTableShake = () => {
    tableShakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(tableShakeAnim, { toValue: -8, duration: 40, useNativeDriver: true }),
      Animated.timing(tableShakeAnim, { toValue: 8, duration: 40, useNativeDriver: true }),
      Animated.timing(tableShakeAnim, { toValue: -5, duration: 40, useNativeDriver: true }),
      Animated.timing(tableShakeAnim, { toValue: 5, duration: 40, useNativeDriver: true }),
      Animated.timing(tableShakeAnim, { toValue: 0, duration: 40, useNativeDriver: true }),
    ]).start();
  };

  const triggerDiscardRipple = () => {
    discardRippleScale.setValue(0.75);
    discardRippleOpacity.setValue(0.92);
    Animated.parallel([
      Animated.timing(discardRippleScale, {
        toValue: 1.8,
        duration: 500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(discardRippleOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const triggerActionStamp = (data: ActionBannerData) => {
    setActionBanner(data);
    bannerScale.setValue(0.5);
    bannerOpacity.setValue(1);

    Animated.sequence([
      Animated.spring(bannerScale, {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.delay(850),
      Animated.timing(bannerOpacity, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setActionBanner(null);
    });
  };

  const announcePlayedCardEffects = (card: UnoCardType, chosenColor?: UnoColor) => {
    triggerDiscardRipple();
    if (card.type === 'skip') {
      triggerAudioSfx('skip');
      triggerActionStamp({
        title: 'SKIP TURN!',
        subtitle: 'Next player is skipped',
        colorHex: '#E11D48',
        icon: 'ban',
      });
    } else if (card.type === 'reverse') {
      triggerAudioSfx('reverse');
      triggerActionStamp({
        title: 'REVERSED!',
        subtitle: 'Play direction flipped',
        colorHex: '#0284C7',
        icon: 'sync',
      });
    } else if (card.type === 'draw2') {
      triggerAudioSfx('draw2');
      triggerTableShake();
      triggerActionStamp({
        title: '+2 DRAW!',
        subtitle: 'Next player draws 2 cards',
        colorHex: '#D97706',
        icon: 'flash',
      });
    } else if (card.type === 'wild4') {
      triggerAudioSfx('wild4');
      triggerTableShake();
      const cMeta = COLOR_METAS[chosenColor || 'rato'];
      triggerActionStamp({
        title: 'WILD +4!',
        subtitle: `Suit set to ${cMeta.nameEn}`,
        colorHex: '#7C3AED',
        icon: 'thunderstorm',
      });
    } else if (card.type === 'wild') {
      triggerAudioSfx('wild');
      const cMeta = COLOR_METAS[chosenColor || 'rato'];
      triggerActionStamp({
        title: `${cMeta.nameEn.toUpperCase()} SUIT!`,
        subtitle: 'Active suit changed',
        colorHex: cMeta.bgHex,
        icon: 'color-palette',
      });
    } else {
      triggerAudioSfx('card_play');
    }
  };

  // -------------------------------------------------------------------------
  // Card Flight Animation Helper
  // -------------------------------------------------------------------------
  const runCardFlightAnimation = (
    card: UnoCardType,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    isFaceUp: boolean,
    onComplete: () => void
  ) => {
    setFlyingCard({ card, fromX, fromY, toX, toY, isFaceUp });
    flyPos.setValue({ x: fromX, y: fromY });
    flyScale.setValue(0.72);
    flyRotate.setValue(0);

    Animated.parallel([
      Animated.timing(flyPos, {
        toValue: { x: toX, y: toY },
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(flyScale, {
          toValue: 1.18,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(flyScale, {
          toValue: 1.0,
          duration: 140,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(flyRotate, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setFlyingCard(null);
      onComplete();
    });
  };

  const triggerReaction = (playerId: string, text: string) => {
    setReactions(prev => ({ ...prev, [playerId]: text }));
    setTimeout(() => {
      setReactions(prev => {
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
    }, 2800);
  };

  // -------------------------------------------------------------------------
  // Dynamic Flight Coordinates for Both Portrait and Landscape
  // -------------------------------------------------------------------------
  const centerDiscardX = windowWidth / 2 - 34;
  const centerDiscardY = windowHeight * (isLandscape ? 0.36 : 0.42);
  const deckSourceX = isLandscape ? windowWidth * 0.28 : windowWidth * 0.14;
  const deckSourceY = centerDiscardY;
  const handSourceX = windowWidth / 2 - 34;
  const handSourceY = windowHeight - 115;

  const getBotCoordinates = (playerIndex: number) => {
    if (isLandscape) {
      if (playerIndex === 1) return { x: 40, y: windowHeight * 0.36 };
      if (playerIndex === 2) return { x: windowWidth / 2 - 30, y: 50 };
      return { x: windowWidth - 100, y: windowHeight * 0.36 };
    } else {
      if (playerIndex === 1) return { x: windowWidth * 0.14, y: 90 };
      if (playerIndex === 2) return { x: windowWidth * 0.46, y: 90 };
      return { x: windowWidth * 0.78, y: 90 };
    }
  };

  // -------------------------------------------------------------------------
  // Bot Turn Automation Loop
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (gameState.status !== 'playing') return;

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer.isBot) return;

    const botCoords = getBotCoordinates(gameState.currentPlayerIndex);

    const timer = setTimeout(() => {
      // 1. Check if an opponent forgot to call UNO
      const vulnerableOpponent = gameState.players.find(
        p => p.id !== currentPlayer.id && p.cards.length === 1 && !p.hasCalledUno
      );
      if (vulnerableOpponent && Math.random() < 0.65) {
        triggerAudioSfx('uno_penalty');
        triggerTableShake();
        triggerReaction(currentPlayer.id, 'Caught you! +2 ⚠️');
        triggerActionStamp({
          title: 'CAUGHT NO UNO!',
          subtitle: `${vulnerableOpponent.name} draws +2 penalty cards`,
          colorHex: '#DC2626',
          icon: 'warning',
        });
        setGameState(prev => challengeUno(prev, currentPlayer.id, vulnerableOpponent.id));
        return;
      }

      // 2. Bot calls UNO if about to have 1 card
      if (currentPlayer.cards.length === 2 && Math.random() < 0.85) {
        triggerAudioSfx('uno_call');
        triggerReaction(currentPlayer.id, 'UNO! ⚡');
        setGameState(prev => callUno(prev, currentPlayer.id));
      }

      // 3. Compute best bot move
      const botMove = computeBotMove(gameState, currentPlayer.id);

      if (botMove.action === 'play' && botMove.cardId) {
        const cardToPlay = currentPlayer.cards.find(c => c.id === botMove.cardId);
        if (cardToPlay) {
          if (cardToPlay.type === 'draw2' || cardToPlay.type === 'wild4') {
            triggerReaction(currentPlayer.id, 'Draw cards! 🔥');
          } else if (cardToPlay.type === 'skip') {
            triggerReaction(currentPlayer.id, 'Skipped! ⊘');
          } else if (cardToPlay.type === 'reverse') {
            triggerReaction(currentPlayer.id, 'Reverse! ⇄');
          }

          runCardFlightAnimation(
            cardToPlay,
            botCoords.x,
            botCoords.y,
            centerDiscardX,
            centerDiscardY,
            true,
            () => {
              announcePlayedCardEffects(cardToPlay, botMove.chosenColor);
              const { nextState, event } = playCard(
                gameState,
                currentPlayer.id,
                botMove.cardId!,
                botMove.chosenColor
              );
              setTurnCounter(c => c + 1);
              if (event === 'win') {
                triggerAudioSfx('win_celebration');
              }
              setGameState(nextState);
            }
          );
        }
      } else {
        triggerAudioSfx('card_draw');
        runCardFlightAnimation(
          {
            id: 'bot_drawn',
            color: 'rato',
            type: 'number',
            nepaliLabel: '',
            englishLabel: '',
            scoreValue: 0,
          },
          deckSourceX,
          deckSourceY,
          botCoords.x,
          botCoords.y,
          false,
          () => {
            const afterDraw = drawCard(gameState, currentPlayer.id);
            setTurnCounter(c => c + 1);
            setGameState(afterDraw);
          }
        );
      }
    }, 950);

    return () => clearTimeout(timer);
  }, [
    gameState.currentPlayerIndex,
    gameState.status,
    gameState.updatedAt,
    isLandscape,
    windowWidth,
    windowHeight,
  ]);

  // -------------------------------------------------------------------------
  // Player & Hand State
  // -------------------------------------------------------------------------
  const isPassAndPlay = gameState.mode === 'pass_and_play';
  const activeHandPlayer = isPassAndPlay
    ? gameState.players[gameState.currentPlayerIndex]
    : gameState.players[0];
  const isHumanTurn = isPassAndPlay ? true : gameState.currentPlayerIndex === 0;

  const topDiscard = gameState.discardPile[gameState.discardPile.length - 1];
  const previousDiscards = gameState.discardPile.slice(-3, -1);
  const activeMeta = COLOR_METAS[gameState.activeColor] || COLOR_METAS.rato;
  const currentTuneMeta = NEPALI_TUNES.find(t => t.id === activeTune) || NEPALI_TUNES[0];

  const hasAnyPlayableCard = useMemo(() => {
    if (!isHumanTurn || !topDiscard) return false;
    return activeHandPlayer.cards.some(c =>
      canPlayCard(c, topDiscard, gameState.activeColor)
    );
  }, [isHumanTurn, activeHandPlayer.cards, topDiscard, gameState.activeColor]);

  const handlePlayCard = (card: UnoCardType) => {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (currentPlayer.isBot) return;

    if (!canPlayCard(card, topDiscard, gameState.activeColor)) {
      triggerAudioSfx('uno_penalty');
      triggerTableShake();
      return;
    }

    if (card.color === 'wild') {
      setPendingWildCard(card);
      setShowColorPicker(true);
      return;
    }

    runCardFlightAnimation(
      card,
      handSourceX,
      handSourceY,
      centerDiscardX,
      centerDiscardY,
      true,
      () => {
        announcePlayedCardEffects(card);
        const { nextState, event } = playCard(gameState, currentPlayer.id, card.id);
        setTurnCounter(c => c + 1);
        if (event === 'win') {
          triggerAudioSfx('win_celebration');
        }
        setGameState(nextState);
      }
    );
  };

  const handleSelectColor = (color: UnoColor) => {
    if (!pendingWildCard) return;
    setShowColorPicker(false);

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const cardToPlay = pendingWildCard;
    setPendingWildCard(null);

    runCardFlightAnimation(
      cardToPlay,
      handSourceX,
      handSourceY,
      centerDiscardX,
      centerDiscardY,
      true,
      () => {
        announcePlayedCardEffects(cardToPlay, color);
        const { nextState, event } = playCard(
          gameState,
          currentPlayer.id,
          cardToPlay.id,
          color
        );
        setTurnCounter(c => c + 1);
        if (event === 'win') {
          triggerAudioSfx('win_celebration');
        }
        setGameState(nextState);
      }
    );
  };

  const handleDrawPilePress = () => {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (currentPlayer.isBot) return;

    triggerAudioSfx('card_draw');

    runCardFlightAnimation(
      {
        id: 'draw_anim',
        color: 'rato',
        type: 'number',
        nepaliLabel: '',
        englishLabel: '',
        scoreValue: 0,
      },
      deckSourceX,
      deckSourceY,
      handSourceX,
      handSourceY,
      false,
      () => {
        const next = drawCard(gameState, currentPlayer.id);
        setTurnCounter(c => c + 1);
        setGameState(next);
      }
    );
  };

  const handlePassPress = () => {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (currentPlayer.isBot) return;

    triggerAudioSfx('card_play');
    const next = passTurn(gameState, currentPlayer.id);
    setTurnCounter(c => c + 1);
    setGameState(next);
  };

  const handleCallUnoPress = () => {
    if (activeHandPlayer.cards.length <= 2) {
      triggerAudioSfx('uno_call');
      triggerReaction(activeHandPlayer.id, 'UNO! ⚡');
      triggerActionStamp({
        title: 'UNO CALLED!',
        subtitle: `${activeHandPlayer.name} is down to 1 card!`,
        colorHex: '#D97706',
        icon: 'notifications',
      });
      setGameState(prev => callUno(prev, activeHandPlayer.id));
    }
  };

  const handleCatchOpponent = (opponentId: string) => {
    const target = gameState.players.find(p => p.id === opponentId);
    triggerAudioSfx('uno_penalty');
    triggerTableShake();
    triggerReaction(activeHandPlayer.id, 'Caught! +2 ⚠️');
    triggerActionStamp({
      title: 'CAUGHT!',
      subtitle: `${target?.name || 'Opponent'} forgot UNO (+2 cards)`,
      colorHex: '#DC2626',
      icon: 'alert-circle',
    });
    setGameState(prev => challengeUno(prev, activeHandPlayer.id, opponentId));
  };

  // -------------------------------------------------------------------------
  // Win Post Publishing (Campus Feed + Native Share)
  // -------------------------------------------------------------------------
  const handlePublishWinPostToFeed = async () => {
    if (isPostingWin || winPostPublished) return;
    setIsPostingWin(true);
    triggerAudioSfx('tika_blessing');

    try {
      const w = matchSummary.winner;
      const postTitle = `🏆 UNO Heritage Victory: ${w?.name || 'Champion'} (+${matchSummary.totalVictoryPoints} pts)`;
      const standingsText = matchSummary.standings
        .map(
          (p, idx) =>
            `${idx === 0 ? '🥇 1st' : idx === 1 ? '🥈 2nd' : idx === 2 ? '🥉 3rd' : '4th'} — ${p.name}: ${
              p.cards.length === 0 ? 'Cleared Hand! 🏆' : `${p.cards.length} cards left`
            }`
        )
        .join('\n');

      const fullContent = `${winPostCaption.trim()}\n\n📊 Match Standings:\n${standingsText}`;

      await createPost({
        title: postTitle,
        content: fullContent,
        type: 'status',
        category: 'general',
        allSemesters: true,
        visibility: 'everyone',
      });

      setWinPostPublished(true);
      setShowWinPostComposer(false);
      triggerAudioSfx('win_celebration');
      Alert.alert(
        'Victory Posted! 🎉',
        'Your UNO Heritage Victory Post has been shared to the Campus Feed!'
      );
    } catch (err: any) {
      Alert.alert(
        'Could Not Post to Feed',
        err?.message || 'Unable to publish right now. You can use the Share button below!'
      );
    } finally {
      setIsPostingWin(false);
    }
  };

  const handleNativeShareWin = async () => {
    triggerAudioSfx('tika_blessing');
    try {
      await Share.share({
        message: winPostCaption,
        title: 'UNO: Heritage Edition Victory!',
      });
    } catch {
      // User dismissed share sheet
    }
  };

  // -------------------------------------------------------------------------
  // Traditional Newari Carved Wood & Gilded Brass Opponent Medallion
  // -------------------------------------------------------------------------
  const renderOpponentSeat = (player: UnoPlayer, seatIndex: number, compact = false) => {
    const isActiveTurn = gameState.currentPlayerIndex === seatIndex;
    const canCatch = player.cards.length === 1 && !player.hasCalledUno;

    return (
      <View
        key={player.id}
        style={[
          styles.opponentCarvedCard,
          compact && styles.opponentCarvedCardCompact,
          isActiveTurn && styles.opponentCarvedCardActive,
        ]}
      >
        {/* Carved Brass Corner Studs */}
        <View style={[styles.panelBrassStud, styles.studTL]} />
        <View style={[styles.panelBrassStud, styles.studTR]} />

        {/* Reaction Bubble */}
        {reactions[player.id] && (
          <View style={styles.reactionBubble}>
            <Text style={styles.reactionBubbleText} numberOfLines={1}>
              {reactions[player.id]}
            </Text>
          </View>
        )}

        <View style={styles.opponentHeaderRow}>
          <Animated.View
            style={[
              styles.avatarBrassFrame,
              compact && styles.avatarBrassFrameSmall,
              isActiveTurn && {
                borderColor: '#FDE047',
                transform: [{ scale: turnGlowAnim }],
              },
            ]}
          >
            <Image source={getAvatarSource(player.id)} style={styles.avatarImg} />
          </Animated.View>

          <View style={styles.opponentMetaCol}>
            <Text style={styles.opponentNameText} numberOfLines={1}>
              {player.name}
            </Text>
            <View style={styles.opponentCountBadge}>
              <Ionicons name="albums" size={11} color="#D4AF37" />
              <Text style={styles.opponentCountText}>
                {player.cards.length} {player.cards.length === 1 ? 'card' : 'cards'}
              </Text>
            </View>
          </View>
        </View>

        {/* Active Turn or UNO / Catch Badge */}
        {canCatch ? (
          <TouchableOpacity
            onPress={() => handleCatchOpponent(player.id)}
            style={styles.catchNowBtn}
          >
            <Text style={styles.catchNowBtnText}>CATCH +2!</Text>
          </TouchableOpacity>
        ) : player.cards.length === 1 && player.hasCalledUno ? (
          <View style={styles.unoSafeBadge}>
            <Text style={styles.unoSafeBadgeText}>UNO!</Text>
          </View>
        ) : isActiveTurn ? (
          <View style={styles.turnTagPill}>
            <Text style={styles.turnTagText}>PLAYING</Text>
          </View>
        ) : null}
      </View>
    );
  };

  // -------------------------------------------------------------------------
  // Brand-New "Bhaktapur Royal Carved Wood & Gilded Mandala" Table
  // -------------------------------------------------------------------------
  const tableCardWidth = isLandscape ? 60 : 66;
  const tableCardHeight = isLandscape ? 90 : 98;

  const renderCenterTableSanctum = () => (
    <View
      style={[
        styles.carvedTimberOuterFrame,
        isLandscape ? styles.tableFeltLandscape : styles.tableFeltPortrait,
      ]}
    >
      {/* Inner Gilded Copper & Deep Royal Sanctum */}
      <View
        style={[
          styles.royalTableSanctum,
          { borderColor: activeMeta.bgHex },
        ]}
      >
        {/* Subtle Newari Carved Corner Brackets & Flickering Brass Diyos */}
        <Animated.View
          pointerEvents="none"
          style={[styles.cornerDiyoLamp, styles.diyoTL, { transform: [{ scale: diyoFlickerAnim }] }]}
        >
          <Ionicons name="flame" size={12} color="#FCD34D" />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[styles.cornerDiyoLamp, styles.diyoTR, { transform: [{ scale: diyoFlickerAnim }] }]}
        >
          <Ionicons name="flame" size={12} color="#FCD34D" />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[styles.cornerDiyoLamp, styles.diyoBL, { transform: [{ scale: diyoFlickerAnim }] }]}
        >
          <Ionicons name="flame" size={12} color="#FCD34D" />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[styles.cornerDiyoLamp, styles.diyoBR, { transform: [{ scale: diyoFlickerAnim }] }]}
        >
          <Ionicons name="flame" size={12} color="#FCD34D" />
        </Animated.View>

        {/* Active Suit & Direction Banner */}
        <View style={styles.activeColorTopBanner}>
          <View style={[styles.activeSuitDot, { backgroundColor: activeMeta.bgHex }]} />
          <Text style={styles.activeSuitLabel}>
            ACTIVE SUIT: {activeMeta.nameEn.toUpperCase()}
          </Text>
          <View style={styles.directionMiniBadge}>
            <Animated.View style={{ transform: [{ rotate: rotationInterpolate }] }}>
              <Ionicons name="sync" size={12} color="#D4AF37" />
            </Animated.View>
            <Text style={styles.directionMiniText}>
              {gameState.direction === 'clockwise' ? 'CW ↻' : 'CCW ↺'}
            </Text>
          </View>
        </View>

        {/* Core 3-Column Table Row: Carved Draw Deck | Ashtamangala Mandala | Dashain Kite */}
        <View style={styles.tableCoreRow}>
          {/* Left: 3D Stacked Carved Rosewood Draw Deck */}
          <Animated.View
            style={[
              styles.drawPileWrap,
              isHumanTurn && !hasAnyPlayableCard && { transform: [{ scale: turnGlowAnim }] },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleDrawPilePress}
              disabled={!isHumanTurn}
              style={[
                styles.drawDeckButton,
                isHumanTurn && !hasAnyPlayableCard && styles.drawDeckButtonHighlight,
              ]}
            >
              <View
                style={[
                  styles.deckStackUnder2,
                  { width: tableCardWidth, height: tableCardHeight },
                ]}
              />
              <View
                style={[
                  styles.deckStackUnder1,
                  { width: tableCardWidth, height: tableCardHeight },
                ]}
              />
              <UnoCard
                card={{
                  id: 'deck_top',
                  color: 'rato',
                  type: 'number',
                  nepaliLabel: '',
                  englishLabel: '',
                  scoreValue: 0,
                }}
                isFaceUp={false}
                width={tableCardWidth}
                height={tableCardHeight}
              />
              <View style={styles.deckCountPill}>
                <Text style={styles.deckCountText}>{gameState.drawPile.length}</Text>
              </View>
            </TouchableOpacity>
            <View
              style={[
                styles.drawActionTag,
                isHumanTurn && !hasAnyPlayableCard && styles.drawActionTagGlow,
              ]}
            >
              <Text style={styles.drawActionTagText}>
                {isHumanTurn && !hasAnyPlayableCard ? 'TAP TO DRAW!' : 'DRAW DECK'}
              </Text>
            </View>
          </Animated.View>

          {/* Center: Rotating Ancient Copper & Gold Ashtamangala Mandala */}
          <View style={styles.discardCenterAnchor}>
            {/* Landing Shockwave Ripple */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.discardRippleCircle,
                {
                  borderColor: activeMeta.bgHex,
                  backgroundColor: activeMeta.glowHex,
                  opacity: discardRippleOpacity,
                  transform: [{ scale: discardRippleScale }],
                },
              ]}
            />

            {/* Rotating Sacred 8-Pointed Lotus Mandala */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.rotatingMandalaWheel,
                {
                  borderColor: activeMeta.bgHex,
                  backgroundColor: activeMeta.glowHex,
                  width: tableCardHeight + 36,
                  height: tableCardHeight + 36,
                  borderRadius: (tableCardHeight + 36) / 2,
                  transform: [{ rotate: rotationInterpolate }],
                },
              ]}
            >
              <View style={styles.mandalaSacredSquareA} />
              <View style={styles.mandalaSacredSquareB} />
              <View style={[styles.mandalaSpoke, { transform: [{ rotate: '0deg' }] }]} />
              <View style={[styles.mandalaSpoke, { transform: [{ rotate: '45deg' }] }]} />
              <View style={[styles.mandalaSpoke, { transform: [{ rotate: '90deg' }] }]} />
              <View style={[styles.mandalaSpoke, { transform: [{ rotate: '135deg' }] }]} />
            </Animated.View>

            {/* Previous Discard Cards for 3D stack feel */}
            {previousDiscards.map((prevCard, idx) => (
              <View
                key={`prev_${prevCard.id}_${idx}`}
                style={[
                  styles.previousDiscardCard,
                  {
                    transform: [
                      { rotate: `${idx % 2 === 0 ? -12 : 10}deg` },
                      { translateX: idx % 2 === 0 ? -4 : 4 },
                    ],
                  },
                ]}
              >
                <UnoCard
                  card={prevCard}
                  isFaceUp={true}
                  width={tableCardWidth - 4}
                  height={tableCardHeight - 4}
                />
              </View>
            ))}

            {/* Top Discard Card */}
            {topDiscard && (
              <UnoCard
                card={topDiscard}
                isFaceUp={true}
                width={tableCardWidth + 4}
                height={tableCardHeight + 6}
              />
            )}
          </View>

          {/* Right: Traditional Dashain Diamond Kite UNO Button */}
          <View style={styles.unoButtonAnchor}>
            <UnoKiteButton
              onPress={handleCallUnoPress}
              isActive={activeHandPlayer.cards.length <= 2}
              hasCalledUno={activeHandPlayer.hasCalledUno}
              disabled={activeHandPlayer.cards.length > 2}
            />
          </View>
        </View>

        {/* Clean Guidance Footer Bar */}
        <View style={styles.tableStatusFooter}>
          <Ionicons
            name={isHumanTurn ? 'sparkles' : 'hourglass-outline'}
            size={12}
            color="#D4AF37"
          />
          <Text style={styles.tableStatusText} numberOfLines={1}>
            {isHumanTurn
              ? hasAnyPlayableCard
                ? 'Your Turn — tap a glowing card below to play'
                : 'No matching card in hand — tap DRAW DECK on the left!'
              : gameState.lastActionMessage}
          </Text>
        </View>

        {/* Center Action Popup Stamp (Skip, Reverse, +2, +4, UNO, Catch) */}
        {actionBanner && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.actionPopupBanner,
              {
                backgroundColor: actionBanner.colorHex,
                opacity: bannerOpacity,
                transform: [{ scale: bannerScale }],
              },
            ]}
          >
            <Ionicons name={actionBanner.icon} size={22} color="#FEF08A" />
            <View>
              <Text style={styles.actionPopupTitle}>{actionBanner.title}</Text>
              <Text style={styles.actionPopupSub}>{actionBanner.subtitle}</Text>
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );

  const playerGust = gameState.players[0];
  const playerTanuja = gameState.players[1];
  const playerHarsh = gameState.players[2];
  const playerShubho = gameState.players[3];

  const handCardWidth = isLandscape ? 58 : 64;
  const handCardHeight = isLandscape ? 86 : 96;

  return (
    <View
      style={[
        styles.carvedHallBackdrop,
        {
          paddingTop: Math.max(insets.top, 6),
          paddingBottom: Math.max(insets.bottom, 6),
          paddingLeft: Math.max(insets.left, 8),
          paddingRight: Math.max(insets.right, 8),
        },
      ]}
    >
      {/* Top Newari Ankhi Jhyal Carved Wood Lattice Frieze */}
      <View style={styles.ankhiJhyalTopFrieze} pointerEvents="none">
        {Array.from({ length: 18 }).map((_, idx) => (
          <View
            key={`lattice_${idx}`}
            style={[
              styles.friezeDiamond,
              idx % 2 === 0 && styles.friezeDiamondGold,
            ]}
          />
        ))}
      </View>

      {/* Hidden Native Audio Bridge */}
      <UnoAudioBridge ref={audioBridgeRef} isMuted={soundMuted} tuneId={activeTune} />

      <Animated.View
        style={[
          styles.mainFlexContainer,
          { transform: [{ translateX: tableShakeAnim }] },
        ]}
      >
        {/* =============================================================== */}
        {/* 1. CARVED NEWARI ARCH TOP BAR WITH TEMPLE BELLS                 */}
        {/* =============================================================== */}
        <View style={styles.topNavigationBar}>
          <View style={styles.topNavLeft}>
            <TouchableOpacity
              onPress={() => {
                Alert.alert('Exit Match?', 'Return to the UNO lobby?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Exit', style: 'destructive', onPress: onExit },
                ]);
              }}
              style={styles.bronzeCircleBtn}
              accessibilityLabel="Exit Match"
            >
              <Ionicons name="arrow-back" size={17} color="#FCD34D" />
            </TouchableOpacity>

            <TempleBell size={19} onPress={() => triggerAudioSfx('bell_chime')} />

            <TouchableOpacity
              onPress={cycleMusicStyle}
              style={styles.tuneSelectorPill}
              accessibilityLabel="Switch Nepali Tone"
            >
              <Ionicons
                name={soundMuted ? 'volume-mute' : 'musical-notes'}
                size={12}
                color="#D4AF37"
              />
              <Text style={styles.tuneSelectorText} numberOfLines={1}>
                {soundMuted ? 'Muted' : currentTuneMeta.titleEn}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Center Royal Match Crest */}
          <View style={styles.topCenterStatusPill}>
            <Ionicons name="flower" size={12} color="#D4AF37" />
            <Text style={styles.topCenterStatusText} numberOfLines={1}>
              {gameState.lastActionMessage}
            </Text>
          </View>

          <View style={styles.topNavRight}>
            <TouchableOpacity
              onPress={toggleSound}
              style={styles.bronzeCircleBtn}
              accessibilityLabel="Toggle Sound"
            >
              <Ionicons
                name={soundMuted ? 'volume-mute' : 'volume-high'}
                size={16}
                color={soundMuted ? '#94A3B8' : '#FCD34D'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={toggleScreenOrientation}
              style={styles.bronzeCircleBtn}
              accessibilityLabel="Rotate Screen"
            >
              <Ionicons
                name={isLandscape ? 'phone-portrait-outline' : 'phone-landscape-outline'}
                size={16}
                color="#FCD34D"
              />
            </TouchableOpacity>

            <TempleBell size={19} onPress={() => triggerAudioSfx('bell_chime')} />

            <TouchableOpacity
              onPress={() => setShowMenuModal(true)}
              style={styles.bronzeCircleBtn}
              accessibilityLabel="Menu"
            >
              <Ionicons name="menu" size={18} color="#FCD34D" />
            </TouchableOpacity>
          </View>
        </View>

        {/* =============================================================== */}
        {/* 2. ADAPTIVE ARENA: PORTRAIT vs LANDSCAPE                        */}
        {/* =============================================================== */}
        {!isLandscape ? (
          /* ----------------- PORTRAIT LAYOUT ----------------- */
          <View style={styles.portraitArena}>
            {/* Top Row: All 3 Opponents side-by-side in carved medallions */}
            <View style={styles.portraitOpponentsRow}>
              {playerTanuja && renderOpponentSeat(playerTanuja, 1)}
              {playerHarsh && renderOpponentSeat(playerHarsh, 2)}
              {playerShubho && renderOpponentSeat(playerShubho, 3)}
            </View>

            {/* Middle: Bhaktapur Royal Carved Wood & Mandala Table */}
            <View style={styles.portraitTableWrapper}>{renderCenterTableSanctum()}</View>
          </View>
        ) : (
          /* ----------------- LANDSCAPE LAYOUT ----------------- */
          <View style={styles.landscapeArena}>
            {/* Left Seat: Tanuja */}
            <View style={styles.landscapeSideSeat}>
              {playerTanuja && renderOpponentSeat(playerTanuja, 1, true)}
            </View>

            {/* Center Column: Harsh at top + Royal Carved Table below */}
            <View style={styles.landscapeCenterCol}>
              <View style={styles.landscapeTopSeatWrap}>
                {playerHarsh && renderOpponentSeat(playerHarsh, 2, true)}
              </View>
              {renderCenterTableSanctum()}
            </View>

            {/* Right Seat: Shubho */}
            <View style={styles.landscapeSideSeat}>
              {playerShubho && renderOpponentSeat(playerShubho, 3, true)}
            </View>
          </View>
        )}

        {/* =============================================================== */}
        {/* 3. CARVED ROYAL PLAYER HAND DOCK (Full-Width & Visually Clear)  */}
        {/* =============================================================== */}
        <View
          style={[
            styles.playerHandDock,
            isLandscape && styles.playerHandDockLandscape,
            isHumanTurn && styles.playerHandDockActive,
          ]}
        >
          {/* Carved Brass Corner Studs */}
          <View style={[styles.panelBrassStud, styles.studTL]} />
          <View style={[styles.panelBrassStud, styles.studTR]} />

          {/* Player Info Header Strip */}
          <View
            style={[
              styles.playerDockHeader,
              isLandscape && styles.playerDockHeaderLandscape,
            ]}
          >
            <View style={styles.playerIdentityRow}>
              <View
                style={[
                  styles.playerAvatarSmall,
                  isHumanTurn && { borderColor: '#FDE047', borderWidth: 2 },
                ]}
              >
                <Image
                  source={getAvatarSource(activeHandPlayer.id)}
                  style={styles.avatarImg}
                />
              </View>
              <View>
                <View style={styles.playerNameBadgeRow}>
                  <Text style={styles.playerDockName}>
                    {isPassAndPlay ? activeHandPlayer.name : `${playerGust.name} (You)`}
                  </Text>
                  <View
                    style={[
                      styles.yourTurnBadge,
                      !isHumanTurn && styles.waitingTurnBadge,
                    ]}
                  >
                    <Text style={styles.yourTurnBadgeText}>
                      {isHumanTurn ? 'YOUR TURN' : 'WAITING'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.playerCardCountSub}>
                  {activeHandPlayer.cards.length}{' '}
                  {activeHandPlayer.cards.length === 1 ? 'card' : 'cards'} in hand
                </Text>
              </View>

              {reactions[activeHandPlayer.id] && (
                <View style={styles.selfReactionPill}>
                  <Text style={styles.reactionBubbleText}>
                    {reactions[activeHandPlayer.id]}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.playerDockActions}>
              {isHumanTurn && (
                <TouchableOpacity onPress={handlePassPress} style={styles.passTurnBtn}>
                  <Ionicons name="play-skip-forward" size={12} color="#FEF08A" />
                  <Text style={styles.passTurnBtnText}>Pass</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() => setShowReactionPicker(true)}
                style={styles.emoteBtn}
                accessibilityLabel="Send Reaction"
              >
                <Ionicons name="chatbubble-ellipses-outline" size={15} color="#FCD34D" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowRulesModal(true)}
                style={styles.emoteBtn}
                accessibilityLabel="Rules"
              >
                <Ionicons name="information-circle-outline" size={16} color="#FCD34D" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Horizontal Scrollable Fanned Cards Hand */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.handCardsScrollContainer}
          >
            {activeHandPlayer.cards.map((card, idx) => {
              const isPlayable =
                isHumanTurn && canPlayCard(card, topDiscard, gameState.activeColor);

              return (
                <View
                  key={card.id}
                  style={[
                    styles.handCardWrapper,
                    { marginLeft: idx === 0 ? 0 : isLandscape ? -6 : -8 },
                    isHumanTurn && !isPlayable && styles.unplayableCardDim,
                  ]}
                >
                  <UnoCard
                    card={card}
                    isFaceUp={true}
                    isPlayable={isPlayable}
                    onPress={() => handlePlayCard(card)}
                    width={handCardWidth}
                    height={handCardHeight}
                  />
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* =============================================================== */}
        {/* FLYING CARD ANIMATION SPRITE                                    */}
        {/* =============================================================== */}
        {flyingCard && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.flyingCardSprite,
              {
                transform: [
                  { translateX: flyPos.x },
                  { translateY: flyPos.y },
                  { scale: flyScale },
                  {
                    rotate: flyRotate.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['-6deg', '12deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <UnoCard
              card={flyingCard.card}
              isFaceUp={flyingCard.isFaceUp}
              width={tableCardWidth}
              height={tableCardHeight}
            />
          </Animated.View>
        )}

        {/* =============================================================== */}
        {/* QUICK REACTION MODAL                                            */}
        {/* =============================================================== */}
        <Modal
          visible={showReactionPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowReactionPicker(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.dialogCard}>
              <View style={styles.dialogHeader}>
                <Text style={styles.dialogTitle}>Send Reaction</Text>
                <TouchableOpacity onPress={() => setShowReactionPicker(false)}>
                  <Ionicons name="close" size={22} color="#FCD34D" />
                </TouchableOpacity>
              </View>

              <View style={styles.reactionGrid}>
                {QUICK_REACTIONS.map((reactText, idx) => (
                  <TouchableOpacity
                    key={`r_${idx}`}
                    onPress={() => {
                      setShowReactionPicker(false);
                      triggerAudioSfx('bell_chime');
                      triggerReaction(activeHandPlayer.id, reactText);
                    }}
                    style={styles.reactionChipBtn}
                  >
                    <Text style={styles.reactionChipText}>{reactText}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Modal>

        {/* =============================================================== */}
        {/* WILD COLOR SELECTION MODAL                                      */}
        {/* =============================================================== */}
        <Modal
          visible={showColorPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowColorPicker(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitleCenter}>Select Active Suit</Text>
              <Text style={styles.dialogSubCenter}>
                Choose the suit color to lead the royal table:
              </Text>

              <View style={styles.colorPickerGrid}>
                {(
                  [
                    {
                      color: 'rato',
                      label: 'Red',
                      motto: 'Rhododendron',
                      icon: 'flower',
                      hex: '#EF4444',
                    },
                    {
                      color: 'nilo',
                      label: 'Blue',
                      motto: 'Himalayan Sky',
                      icon: 'snow',
                      hex: '#2563EB',
                    },
                    {
                      color: 'hariyo',
                      label: 'Green',
                      motto: 'Terai Forest',
                      icon: 'leaf',
                      hex: '#10B981',
                    },
                    {
                      color: 'pahelo',
                      label: 'Yellow',
                      motto: 'Marigold Gold',
                      icon: 'sunny',
                      hex: '#F59E0B',
                    },
                  ] as const
                ).map(item => (
                  <TouchableOpacity
                    key={item.color}
                    onPress={() => handleSelectColor(item.color)}
                    style={[styles.colorChoiceBtn, { backgroundColor: item.hex }]}
                  >
                    <Ionicons name={item.icon} size={22} color="#FFFFFF" />
                    <Text style={styles.colorChoiceText}>{item.label}</Text>
                    <Text style={styles.colorChoiceMotto}>{item.motto}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Modal>

        {/* =============================================================== */}
        {/* MENU / OPTIONS MODAL                                            */}
        {/* =============================================================== */}
        <Modal
          visible={showMenuModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowMenuModal(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.dialogCard}>
              <View style={styles.dialogHeader}>
                <Text style={styles.dialogTitle}>Royal Court Options</Text>
                <TouchableOpacity onPress={() => setShowMenuModal(false)}>
                  <Ionicons name="close" size={22} color="#FCD34D" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={toggleSound} style={styles.menuRow}>
                <Ionicons
                  name={soundMuted ? 'volume-mute' : 'volume-high'}
                  size={20}
                  color={soundMuted ? '#94A3B8' : '#F59E0B'}
                />
                <Text style={styles.menuRowText}>
                  Nepali Acoustic Tone & SFX ({soundMuted ? 'Muted' : 'Playing'})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={cycleMusicStyle} style={styles.menuRow}>
                <Ionicons name="musical-notes" size={20} color="#10B981" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuRowText}>
                    Background Tone: {currentTuneMeta.titleEn}
                  </Text>
                  <Text style={styles.menuRowSubText}>{currentTuneMeta.subtitle}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity onPress={toggleScreenOrientation} style={styles.menuRow}>
                <Ionicons name="phone-landscape-outline" size={20} color="#38BDF8" />
                <Text style={styles.menuRowText}>
                  Switch to {isLandscape ? 'Portrait' : 'Landscape'} View
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowMenuModal(false);
                  setShowRulesModal(true);
                }}
                style={styles.menuRow}
              >
                <Ionicons name="help-circle-outline" size={20} color="#FDE047" />
                <Text style={styles.menuRowText}>Rules & Guide</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowMenuModal(false);
                  onRestart();
                }}
                style={styles.menuRow}
              >
                <Ionicons name="refresh" size={20} color="#A855F7" />
                <Text style={styles.menuRowText}>Restart Match</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowMenuModal(false);
                  onExit();
                }}
                style={[styles.menuRow, { borderBottomWidth: 0 }]}
              >
                <Ionicons name="exit-outline" size={20} color="#EF4444" />
                <Text style={[styles.menuRowText, { color: '#EF4444' }]}>Exit to Lobby</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* =============================================================== */}
        {/* HOW TO PLAY / RULES MODAL                                       */}
        {/* =============================================================== */}
        <Modal
          visible={showRulesModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowRulesModal(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.dialogCard}>
              <View style={styles.dialogHeader}>
                <Text style={styles.dialogTitle}>UNO: Heritage Edition Rules</Text>
                <TouchableOpacity onPress={() => setShowRulesModal(false)}>
                  <Ionicons name="close" size={22} color="#FCD34D" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
                <Text style={styles.ruleHeading}>1. Objective</Text>
                <Text style={styles.ruleBody}>
                  Be the first player to play all cards from your hand into the central Ashtamangala Mandala. Valid cards automatically lift up with a golden glow on your turn!
                </Text>

                <Text style={styles.ruleHeading}>2. Matching Rules</Text>
                <Text style={styles.ruleBody}>
                  Match the active Suit Color, Number, or Action Symbol on the center Discard Pile, or play a Wild card anytime.
                </Text>

                <Text style={styles.ruleHeading}>3. Dashain Kite & Calling "UNO!"</Text>
                <Text style={styles.ruleBody}>
                  When you have 1 or 2 cards left, tap the Dashain Diamond Kite ("UNO!") button on the right side of the table. If you drop to 1 card without calling UNO and an opponent catches you, you draw 2 penalty cards!
                </Text>

                <Text style={styles.ruleHeading}>4. Action Cards</Text>
                <Text style={styles.ruleBody}>
                  • Skip (⊘): Next player loses their turn (20 pts).{'\n'}
                  • Reverse (⇄): Switches play direction (20 pts).{'\n'}
                  • +2: Next player draws 2 cards and misses turn (20 pts).{'\n'}
                  • Wild: Choose the active suit color (50 pts).{'\n'}
                  • Wild +4: Choose the active color + next player draws 4 cards (50 pts)!
                </Text>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* =============================================================== */}
        {/* ROYAL VICTORY & CAMPUS FEED WIN POST MODAL                      */}
        {/* =============================================================== */}
        <Modal
          visible={gameState.status === 'game_over'}
          transparent
          animationType="fade"
          onRequestClose={onExit}
        >
          <View style={styles.modalBackdrop}>
            {/* Falling Golden Marigold & Rhododendron Petals */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.petalShowerRow,
                {
                  transform: [
                    {
                      translateY: petalAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-160, windowHeight * 0.7],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Ionicons name="flower" size={22} color="#F59E0B" />
              <Ionicons name="sparkles" size={18} color="#FDE047" />
              <Ionicons name="flower" size={24} color="#E11D48" />
              <Ionicons name="sunny" size={20} color="#F59E0B" />
              <Ionicons name="flower" size={22} color="#FB923C" />
            </Animated.View>

            <View
              style={[
                styles.victoryModalCard,
                isLandscape && styles.victoryModalLandscape,
              ]}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.victoryScrollInner}
              >
                <View style={styles.royalVictoryCrestPill}>
                  <Ionicons name="sparkles" size={12} color="#FEF08A" />
                  <Text style={styles.royalVictoryCrestText}>
                    ROYAL HERITAGE VICTORY • MALSHREE FANFARE
                  </Text>
                  <Ionicons name="sparkles" size={12} color="#FEF08A" />
                </View>

                {/* Winner Header */}
                <View style={styles.victoryHeaderRow}>
                  <Animated.View
                    style={[
                      styles.trophyCircle,
                      { transform: [{ scale: victoryTrophyScale }] },
                    ]}
                  >
                    <Ionicons name="trophy" size={38} color="#F59E0B" />
                  </Animated.View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.victoryTitleText}>
                      {matchSummary.winner?.name} Wins!
                    </Text>
                    <Text style={styles.victoryRankBadgeText}>
                      {matchSummary.rankTitle} • +{matchSummary.totalVictoryPoints} pts •{' '}
                      {turnCounter} turns
                    </Text>
                  </View>
                </View>

                {/* Standings Table */}
                <View style={styles.standingsContainer}>
                  {matchSummary.standings.map((p, idx) => {
                    const pts = p.cards.reduce((s, c) => s + c.scoreValue, 0);
                    return (
                      <View
                        key={`st_${p.id}`}
                        style={[
                          styles.standingRowItem,
                          idx === 0 && styles.standingRowFirst,
                        ]}
                      >
                        <Text style={styles.standingRankLabel}>
                          {idx === 0
                            ? '🥇 1st'
                            : idx === 1
                            ? '🥈 2nd'
                            : idx === 2
                            ? '🥉 3rd'
                            : '4th'}
                        </Text>
                        <Text style={styles.standingPlayerLabel} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={styles.standingCardMeta}>
                          {p.cards.length === 0
                            ? '0 cards • WINNER'
                            : `${p.cards.length} cards (${pts} pts)`}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* Win Post Card & Campus Feed Share */}
                <View style={styles.winPostBox}>
                  <View style={styles.winPostTopRow}>
                    <View style={styles.winPostTitleRow}>
                      <Ionicons name="megaphone-outline" size={14} color="#FCD34D" />
                      <Text style={styles.winPostTitle}>Campus Feed Victory Post</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setShowWinPostComposer(!showWinPostComposer)}
                    >
                      <Text style={styles.editPostBtnText}>
                        {showWinPostComposer ? 'Done' : 'Edit Caption'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {showWinPostComposer ? (
                    <TextInput
                      value={winPostCaption}
                      onChangeText={setWinPostCaption}
                      multiline
                      style={styles.winPostInput}
                      placeholder="Write your victory post..."
                      placeholderTextColor="#64748B"
                    />
                  ) : (
                    <Text style={styles.winPostPreviewText} numberOfLines={2}>
                      {winPostCaption}
                    </Text>
                  )}

                  <View style={styles.winPostBtnRow}>
                    <TouchableOpacity
                      onPress={handlePublishWinPostToFeed}
                      disabled={isPostingWin || winPostPublished}
                      style={[
                        styles.postToFeedBtn,
                        winPostPublished && styles.postToFeedBtnSuccess,
                      ]}
                    >
                      {isPostingWin ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Ionicons
                          name={winPostPublished ? 'checkmark-circle' : 'paper-plane'}
                          size={15}
                          color="#FFFFFF"
                        />
                      )}
                      <Text style={styles.postToFeedBtnText}>
                        {winPostPublished ? 'Posted to Feed!' : 'Post Win to Feed'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleNativeShareWin}
                      style={styles.nativeShareBtn}
                    >
                      <Ionicons name="share-social-outline" size={16} color="#FCD34D" />
                      <Text style={styles.nativeShareBtnText}>Share</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Play Again & Exit Buttons */}
                <View style={styles.victoryFooterBtns}>
                  <TouchableOpacity onPress={onRestart} style={styles.playAgainBtn}>
                    <Ionicons name="refresh" size={18} color="#271203" />
                    <Text style={styles.playAgainBtnText}>Play Again</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={onExit} style={styles.exitLobbyBtn}>
                    <Text style={styles.exitLobbyBtnText}>Lobby</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Brand-New Traditional Nepali Wood Carving & Gilded Architecture Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  carvedHallBackdrop: {
    flex: 1,
    backgroundColor: '#160B06',
  },
  ankhiJhyalTopFrieze: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
  mainFlexContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topNavigationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    height: 42,
  },
  topNavLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topNavRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bronzeCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2D1409',
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  tuneSelectorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2D1409',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D4AF37',
    maxWidth: 130,
  },
  tuneSelectorText: {
    color: '#FEF08A',
    fontSize: 10,
    fontWeight: '800',
  },
  topCenterStatusPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginHorizontal: 8,
    backgroundColor: '#261107',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.55)',
  },
  topCenterStatusText: {
    color: '#FEF3C7',
    fontSize: 11,
    fontWeight: '700',
  },

  // ----------------- PORTRAIT ARENA -----------------
  portraitArena: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  portraitOpponentsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 2,
  },
  portraitTableWrapper: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 6,
  },

  // ----------------- LANDSCAPE ARENA -----------------
  landscapeArena: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  landscapeSideSeat: {
    width: 118,
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeCenterCol: {
    flex: 1,
    height: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  landscapeTopSeatWrap: {
    marginBottom: 2,
  },

  // ----------------- CARVED NEWARI OPPONENT MEDALLION -----------------
  opponentCarvedCard: {
    flex: 1,
    backgroundColor: '#261107',
    borderRadius: 14,
    padding: 8,
    borderWidth: 1.8,
    borderColor: '#78350F',
    alignItems: 'center',
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 4,
  },
  opponentCarvedCardCompact: {
    flex: 0,
    width: 114,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  opponentCarvedCardActive: {
    borderColor: '#D4AF37',
    backgroundColor: '#3B1A0B',
  },
  panelBrassStud: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4AF37',
  },
  studTL: { top: 4, left: 4 },
  studTR: { top: 4, right: 4 },
  opponentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  avatarBrassFrame: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#D4AF37',
    overflow: 'hidden',
    backgroundColor: '#1E293B',
  },
  avatarBrassFrameSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  opponentMetaCol: {
    flexShrink: 1,
  },
  opponentNameText: {
    color: '#FFFBEB',
    fontSize: 12,
    fontWeight: '800',
  },
  opponentCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 1,
  },
  opponentCountText: {
    color: '#FCD34D',
    fontSize: 10.5,
    fontWeight: '800',
  },
  turnTagPill: {
    marginTop: 4,
    backgroundColor: '#B45309',
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FEF08A',
  },
  turnTagText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '900',
  },
  unoSafeBadge: {
    marginTop: 4,
    backgroundColor: '#059669',
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  unoSafeBadgeText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '900',
  },
  catchNowBtn: {
    marginTop: 4,
    backgroundColor: '#DC2626',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FEF08A',
  },
  catchNowBtnText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  reactionBubble: {
    position: 'absolute',
    top: -22,
    backgroundColor: '#FEF08A',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#78350F',
    zIndex: 50,
  },
  reactionBubbleText: {
    color: '#271203',
    fontSize: 10,
    fontWeight: '900',
  },

  // ----------------- BHAKTAPUR ROYAL CARVED WOOD & MANDALA TABLE -----------------
  carvedTimberOuterFrame: {
    width: '100%',
    borderRadius: 24,
    padding: 5,
    backgroundColor: '#3A190A',
    borderWidth: 2.5,
    borderColor: '#92400E',
    shadowColor: '#000',
    shadowOpacity: 0.75,
    shadowRadius: 12,
    elevation: 10,
  },
  tableFeltPortrait: {
    flex: 1,
    maxHeight: 285,
  },
  tableFeltLandscape: {
    flex: 1,
    width: '100%',
  },
  royalTableSanctum: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 19,
    backgroundColor: '#0E231F',
    borderWidth: 1.8,
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 14,
    position: 'relative',
  },
  cornerDiyoLamp: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2B1308',
    borderWidth: 1.2,
    borderColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
  },
  diyoTL: { top: 8, left: 10 },
  diyoTR: { top: 8, right: 10 },
  diyoBL: { bottom: 8, left: 10 },
  diyoBR: { bottom: 8, right: 10 },
  activeColorTopBanner: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#261107',
    paddingHorizontal: 12,
    paddingVertical: 3.5,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: '#D4AF37',
  },
  activeSuitDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  activeSuitLabel: {
    color: '#FEF3C7',
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  directionMiniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 4,
    paddingLeft: 6,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(212, 175, 55, 0.35)',
  },
  directionMiniText: {
    color: '#FCD34D',
    fontSize: 9.5,
    fontWeight: '800',
  },
  tableCoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    flex: 1,
  },
  drawPileWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawDeckButton: {
    position: 'relative',
    borderRadius: 10,
    padding: 2,
  },
  drawDeckButtonHighlight: {
    backgroundColor: 'rgba(250, 204, 21, 0.25)',
    borderWidth: 1.5,
    borderColor: '#FDE047',
  },
  deckStackUnder1: {
    position: 'absolute',
    top: -3,
    left: -3,
    borderRadius: 8,
    backgroundColor: '#2B1308',
    borderWidth: 1.2,
    borderColor: '#D4AF37',
    opacity: 0.85,
  },
  deckStackUnder2: {
    position: 'absolute',
    top: -6,
    left: -6,
    borderRadius: 8,
    backgroundColor: '#1E0D05',
    borderWidth: 1.2,
    borderColor: '#92400E',
    opacity: 0.6,
  },
  deckCountPill: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#B45309',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1.2,
    borderColor: '#FEF08A',
  },
  deckCountText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '900',
  },
  drawActionTag: {
    marginTop: 4,
    backgroundColor: '#261107',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  drawActionTagGlow: {
    backgroundColor: '#D97706',
    borderColor: '#FEF08A',
  },
  drawActionTagText: {
    color: '#FEF08A',
    fontSize: 8.5,
    fontWeight: '900',
  },
  discardCenterAnchor: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  discardRippleCircle: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 3,
  },
  rotatingMandalaWheel: {
    position: 'absolute',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mandalaSacredSquareA: {
    position: 'absolute',
    width: '74%',
    height: '74%',
    borderWidth: 1.2,
    borderColor: 'rgba(212, 175, 55, 0.45)',
  },
  mandalaSacredSquareB: {
    position: 'absolute',
    width: '74%',
    height: '74%',
    borderWidth: 1.2,
    borderColor: 'rgba(212, 175, 55, 0.45)',
    transform: [{ rotate: '45deg' }],
  },
  mandalaSpoke: {
    position: 'absolute',
    width: '100%',
    height: 1.2,
    backgroundColor: 'rgba(212, 175, 55, 0.25)',
  },
  previousDiscardCard: {
    position: 'absolute',
    opacity: 0.72,
  },
  unoButtonAnchor: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableStatusFooter: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#261107',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.5)',
  },
  tableStatusText: {
    color: '#FEF3C7',
    fontSize: 10.5,
    fontWeight: '700',
  },
  actionPopupBanner: {
    position: 'absolute',
    alignSelf: 'center',
    top: '34%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FEF08A',
    shadowColor: '#000',
    shadowOpacity: 0.75,
    shadowRadius: 10,
    elevation: 14,
    zIndex: 100,
  },
  actionPopupTitle: {
    color: '#FEF08A',
    fontSize: 14,
    fontWeight: '900',
  },
  actionPopupSub: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '700',
  },

  // ----------------- CARVED ROYAL PLAYER HAND DOCK -----------------
  playerHandDock: {
    backgroundColor: '#261107',
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 2,
    borderColor: '#78350F',
    position: 'relative',
  },
  playerHandDockLandscape: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  playerHandDockActive: {
    borderColor: '#D4AF37',
  },
  playerDockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  playerDockHeaderLandscape: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: 0,
    marginRight: 10,
    width: 136,
  },
  playerIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerAvatarSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    overflow: 'hidden',
    backgroundColor: '#1E293B',
  },
  playerNameBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playerDockName: {
    color: '#FFFBEB',
    fontSize: 12.5,
    fontWeight: '800',
  },
  yourTurnBadge: {
    backgroundColor: '#059669',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  waitingTurnBadge: {
    backgroundColor: '#451A0A',
    borderColor: '#92400E',
  },
  yourTurnBadgeText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '900',
  },
  playerCardCountSub: {
    color: '#FDE68A',
    fontSize: 10,
    fontWeight: '700',
  },
  selfReactionPill: {
    backgroundColor: '#FEF08A',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  playerDockActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  passTurnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#065F46',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#34D399',
  },
  passTurnBtnText: {
    color: '#FEF08A',
    fontSize: 11,
    fontWeight: '800',
  },
  emoteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#3B1A0B',
    borderWidth: 1,
    borderColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
  },
  handCardsScrollContainer: {
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 2,
    alignItems: 'flex-end',
  },
  handCardWrapper: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 4,
  },
  unplayableCardDim: {
    opacity: 0.45,
  },
  flyingCardSprite: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 9999,
  },

  // ----------------- MODALS -----------------
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 5, 2, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#220F06',
    borderRadius: 20,
    padding: 18,
    borderWidth: 2,
    borderColor: '#D4AF37',
  },
  dialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dialogTitle: {
    color: '#FCD34D',
    fontSize: 17,
    fontWeight: '900',
  },
  dialogTitleCenter: {
    color: '#FCD34D',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  dialogSubCenter: {
    color: '#FDE68A',
    fontSize: 12.5,
    textAlign: 'center',
    marginVertical: 8,
  },
  reactionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  reactionChipBtn: {
    backgroundColor: '#3B1A0B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  reactionChipText: {
    color: '#FEF08A',
    fontSize: 12,
    fontWeight: '800',
  },
  colorPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 6,
  },
  colorChoiceBtn: {
    width: 140,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FEF08A',
  },
  colorChoiceText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 3,
  },
  colorChoiceMotto: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 10,
    fontWeight: '700',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.2)',
  },
  menuRowText: {
    color: '#FFFBEB',
    fontSize: 14,
    fontWeight: '700',
  },
  menuRowSubText: {
    color: '#FDE68A',
    fontSize: 11,
    opacity: 0.8,
  },
  ruleHeading: {
    color: '#FCD34D',
    fontSize: 13.5,
    fontWeight: '800',
    marginTop: 10,
    marginBottom: 3,
  },
  ruleBody: {
    color: '#FDE68A',
    fontSize: 12,
    lineHeight: 18,
  },

  // ----------------- ROYAL VICTORY MODAL -----------------
  petalShowerRow: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-around',
    zIndex: 999,
  },
  victoryModalCard: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '90%',
    backgroundColor: '#220F06',
    borderRadius: 22,
    padding: 18,
    borderWidth: 2.5,
    borderColor: '#D4AF37',
  },
  victoryModalLandscape: {
    maxWidth: 490,
    paddingVertical: 14,
  },
  victoryScrollInner: {
    alignItems: 'center',
  },
  royalVictoryCrestPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#5B131A',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D4AF37',
    marginBottom: 10,
  },
  royalVictoryCrestText: {
    color: '#FEF08A',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  victoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    marginBottom: 12,
  },
  trophyCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#3B1A0B',
    borderWidth: 2,
    borderColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
  },
  victoryTitleText: {
    color: '#FCD34D',
    fontSize: 20,
    fontWeight: '900',
  },
  victoryRankBadgeText: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  standingsContainer: {
    width: '100%',
    backgroundColor: '#160B06',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    marginBottom: 12,
  },
  standingRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  standingRowFirst: {
    backgroundColor: 'rgba(212, 175, 55, 0.18)',
  },
  standingRankLabel: {
    color: '#FCD34D',
    fontSize: 11.5,
    fontWeight: '900',
    width: 48,
  },
  standingPlayerLabel: {
    color: '#FFFBEB',
    fontSize: 12,
    fontWeight: '800',
    flex: 1,
  },
  standingCardMeta: {
    color: '#FDE68A',
    fontSize: 11,
    fontWeight: '700',
  },
  winPostBox: {
    width: '100%',
    backgroundColor: '#160B06',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    marginBottom: 12,
  },
  winPostTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  winPostTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  winPostTitle: {
    color: '#FCD34D',
    fontSize: 11.5,
    fontWeight: '800',
  },
  editPostBtnText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
  },
  winPostPreviewText: {
    color: '#FFFBEB',
    fontSize: 11.5,
    lineHeight: 16,
    marginBottom: 8,
  },
  winPostInput: {
    color: '#FFFFFF',
    fontSize: 11.5,
    lineHeight: 16,
    backgroundColor: '#2B1308',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D4AF37',
    marginBottom: 8,
    minHeight: 50,
  },
  winPostBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  postToFeedBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#B45309',
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE047',
  },
  postToFeedBtnSuccess: {
    backgroundColor: '#059669',
    borderColor: '#6EE7B7',
  },
  postToFeedBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  nativeShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#2B1308',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  nativeShareBtnText: {
    color: '#FCD34D',
    fontSize: 12,
    fontWeight: '800',
  },
  victoryFooterBtns: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  playAgainBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#D4AF37',
    paddingVertical: 11,
    borderRadius: 12,
  },
  playAgainBtnText: {
    color: '#1E0D05',
    fontSize: 13.5,
    fontWeight: '900',
  },
  exitLobbyBtn: {
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B1A0B',
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  exitLobbyBtnText: {
    color: '#FDE68A',
    fontSize: 13.5,
    fontWeight: '800',
  },
});
