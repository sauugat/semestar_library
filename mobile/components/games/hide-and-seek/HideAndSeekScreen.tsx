import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
  StatusBar,
  ScrollView,
  ImageBackground,
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system/legacy';
import { getHideAndSeekHtml } from './gameHtml';
import { HORROR_CONFIG, EXPLORE_MODE, GraphicsQuality, QualityPinMode } from './horrorConfig';
import { HorrorHUD, FearIntensity } from './HorrorHUD';

const GANDAKI_HORROR_BG = require('../../../assets/games/hide-and-seek/gandaki_horror_bg.jpg');

interface HideAndSeekProps {
  onBack?: () => void;
}

type Role = 'seeker' | 'hider';
type Difficulty = 'easy' | 'medium' | 'hard';
type LobbyView = 'MAIN' | 'SETTINGS';

const DIFFICULTY_META: Record<
  Difficulty,
  { label: string; sub: string; bots: number; accent: string }
> = {
  easy: {
    label: 'CALM PATROL',
    sub: '3 Scholars • 4 Fuses',
    bots: 3,
    accent: HORROR_CONFIG.palette.dimAmber,
  },
  medium: {
    label: 'CAMPUS WATCH',
    sub: '5 Scholars • Active Hunt',
    bots: 5,
    accent: HORROR_CONFIG.palette.dimAmber,
  },
  hard: {
    label: 'CAMPUS LOCKDOWN',
    sub: '7 Scholars • Relentless Entity',
    bots: 7,
    accent: HORROR_CONFIG.palette.bloodRed,
  },
};

const DEFAULT_MATCH_DURATION = (HORROR_CONFIG as any).gameplay?.roundDurationSec || 540;

const RESOLUTIONS = ['1920 x 1080 (16:9)', '1600 x 900 (16:9)', '1280 x 720 (16:9)'];
const SHADOW_TIERS = ['Off', 'Low', 'Medium', 'High', 'Ultra'];
const TEXTURE_TIERS = ['Low', 'Medium', 'High', 'Ultra'];
const AA_MODES = ['Off', 'FXAA', 'TAA', 'MSAA 4x'];
const TIME_OPTIONS = ['3 minutes', '5 minutes', '7 minutes', '9 minutes'];
const PLAYER_COUNTS = ['2 Players', '4 Players', '6 Players', '8 Players'];
const LANGUAGES = ['English', 'नेपाली (Nepali)', 'हिन्दी (Hindi)'];
const GRAPHICS_MODES = ['Fullscreen', 'Borderless', 'Windowed'];

export const HideAndSeekScreen: React.FC<HideAndSeekProps> = ({ onBack }) => {
  const insets = useSafeAreaInsets();
  const exploreMode = EXPLORE_MODE;

  const [lobbyView, setLobbyView] = useState<LobbyView>('MAIN');
  const [role] = useState<Role>('hider');
  const [difficulty, setDifficulty] = useState<Difficulty>('hard');
  const [uiDifficultyLabel, setUiDifficultyLabel] = useState<'Easy' | 'Normal' | 'Hard' | 'Nightmare'>('Hard');
  const [quality, setQuality] = useState<GraphicsQuality>('high');
  const [uiQualityLabel, setUiQualityLabel] = useState<'Low' | 'Medium' | 'High' | 'Ultra'>('High');
  const [qualityPinMode, setQualityPinMode] = useState<QualityPinMode>('high');

  // Detailed Settings Screen state (matching E265712E-67D6-45FC-A27D-76230A1F2564.PNG)
  const [resolutionIdx, setResolutionIdx] = useState(0);
  const [shadowIdx, setShadowIdx] = useState(3); // 'High'
  const [textureIdx, setTextureIdx] = useState(2); // 'High'
  const [aaIdx, setAaIdx] = useState(2); // 'TAA'
  const [vsync, setVsync] = useState(false);
  const [motionBlur, setMotionBlur] = useState(false);

  const [hideTimeIdx, setHideTimeIdx] = useState(1); // '5 minutes'
  const [seekTimeIdx, setSeekTimeIdx] = useState(1); // '5 minutes'
  const [playerCountIdx, setPlayerCountIdx] = useState(1); // '4 Players'
  const [respawn, setRespawn] = useState(true);
  const [randomSpawn, setRandomSpawn] = useState(true);

  const [masterVolume, setMasterVolume] = useState(70);
  const [musicVolume, setMusicVolume] = useState(60);
  const [sfxVolume, setSfxVolume] = useState(80);
  const [voiceChat, setVoiceChat] = useState(false);

  const [languageIdx, setLanguageIdx] = useState(0);
  const [cameraShake, setCameraShake] = useState(true);
  const [showHints, setShowHints] = useState(true);
  const [crossplay, setCrossplay] = useState(false);
  const [graphicsModeIdx, setGraphicsModeIdx] = useState(0);

  const [batterySaver, setBatterySaver] = useState<boolean>(
    !!(HORROR_CONFIG as any).accessibility?.batterySaver
  );
  const [fearIntensity, setFearIntensity] = useState<FearIntensity>(
    (HORROR_CONFIG as any).accessibility?.fearIntensity || 'high'
  );
  const [flickerReduction, setFlickerReduction] = useState<boolean>(
    !!(HORROR_CONFIG as any).accessibility?.flickerReduction
  );
  const [screenShakeOff, setScreenShakeOff] = useState<boolean>(false);

  const [gameStarted, setGameStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [hideUiForScreenshot, setHideUiForScreenshot] = useState(false);
  const [webViewError, setWebViewError] = useState<string | null>(null);
  const [cachedHtmlUri, setCachedHtmlUri] = useState<string | null>(null);
  const [fallbackInline, setFallbackInline] = useState<boolean>(false);
  const [gameState, setGameState] = useState<{
    status: 'LOBBY' | 'PLAYING' | 'GAMEOVER';
    hidersRemaining: number;
    timeLeft: number;
    fusesRestored: number;
    gateUnlocked: boolean;
    winner?: 'SEEKER' | 'HIDERS';
    reason?: string;
    foundCount?: number;
  }>({
    status: 'LOBBY',
    hidersRemaining: 5,
    timeLeft: DEFAULT_MATCH_DURATION,
    fusesRestored: 0,
    gateUnlocked: false,
  });

  const webViewRef = useRef<WebView>(null);
  const hunterProximityRef = useRef<number>(0);
  const disposeFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExitingRef = useRef<boolean>(false);

  // Lock to LANDSCAPE immediately on mount so Front Menu, Settings & Gameplay all display in 16:9 widescreen
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      if (disposeFallbackTimerRef.current) {
        clearTimeout(disposeFallbackTimerRef.current);
        disposeFallbackTimerRef.current = null;
      }
      try {
        webViewRef.current?.postMessage(JSON.stringify({ type: 'DISPOSE' }));
      } catch (e) {}
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {
        ScreenOrientation.unlockAsync().catch(() => {});
      });
    };
  }, []);

  // Cache large Three.js HTML string to local device storage to prevent Android WebView Binder limit black screen
  useEffect(() => {
    let isCancelled = false;
    const cacheHtml = async () => {
      try {
        const targetPath = `${FileSystem.cacheDirectory}hide-and-seek-nightfall-v17-render-fix.html`;
        const content = getHideAndSeekHtml();
        await FileSystem.writeAsStringAsync(targetPath, content, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (!isCancelled) {
          setCachedHtmlUri(targetPath);
        }
      } catch (err) {
        console.warn('[HideAndSeek] Could not write HTML cache, falling back to string:', err);
        if (!isCancelled) {
          setFallbackInline(true);
        }
      }
    };
    cacheHtml();
    return () => {
      isCancelled = true;
    };
  }, []);

  const webViewSource = useMemo(() => {
    if (cachedHtmlUri) {
      return { uri: cachedHtmlUri };
    }
    if (fallbackInline) {
      return { html: getHideAndSeekHtml() };
    }
    return null;
  }, [cachedHtmlUri, fallbackInline]);

  // Suspend/resume WebView audio & timers when app is backgrounded or interrupted
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const isActive = nextAppState === 'active';
      try {
        webViewRef.current?.postMessage(
          JSON.stringify({
            type: 'APP_STATE_CHANGE',
            active: isActive,
            state: nextAppState,
          })
        );
      } catch (e) {}
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const startGame = async () => {
    setWebViewError(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } catch (e) {}
    const botCount = DIFFICULTY_META[difficulty].bots;
    setGameState({
      status: 'PLAYING',
      hidersRemaining: botCount,
      timeLeft: DEFAULT_MATCH_DURATION,
      fusesRestored: 0,
      gateUnlocked: false,
    });
    setGameStarted(true);
  };

  const selectGraphicsQualityPill = (label: 'Low' | 'Medium' | 'High' | 'Ultra') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUiQualityLabel(label);
    const mapped: GraphicsQuality =
      label === 'Low' ? 'fast' : label === 'Medium' ? 'low' : label === 'High' ? 'high' : 'ultra';
    setQuality(mapped);
    setQualityPinMode(mapped);
    setShadowIdx(label === 'Low' ? 1 : label === 'Medium' ? 2 : label === 'High' ? 3 : 4);
    setTextureIdx(label === 'Low' ? 0 : label === 'Medium' ? 1 : label === 'High' ? 2 : 3);
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'SET_QUALITY',
        quality: mapped,
        pinMode: mapped,
      })
    );
  };

  const selectDifficultyPill = (label: 'Easy' | 'Normal' | 'Hard' | 'Nightmare') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUiDifficultyLabel(label);
    const mapped: Difficulty =
      label === 'Easy' ? 'easy' : label === 'Normal' ? 'medium' : 'hard';
    setDifficulty(mapped);
  };

  const toggleSound = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'SET_MUTE',
        muted: nextMuted,
      })
    );
  };

  const toggleQuality = () => {
    const order: QualityPinMode[] = ['ultra', 'high', 'low', 'fast'];
    const nextPinMode: QualityPinMode = order[(order.indexOf(qualityPinMode) + 1) % order.length];
    const nextQuality: GraphicsQuality = nextPinMode === 'auto' ? 'ultra' : nextPinMode;
    setQualityPinMode(nextPinMode);
    setQuality(nextQuality);
    setUiQualityLabel(
      nextQuality === 'ultra' ? 'Ultra' : nextQuality === 'high' ? 'High' : nextQuality === 'low' ? 'Medium' : 'Low'
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'SET_QUALITY',
        quality: nextQuality,
        pinMode: nextPinMode,
      })
    );
  };

  const toggleBatterySaver = () => {
    const nextSaver = !batterySaver;
    setBatterySaver(nextSaver);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'SET_BATTERY_SAVER',
        enabled: nextSaver,
      })
    );
  };

  const cycleFearIntensity = () => {
    const order: FearIntensity[] = ['high', 'medium', 'low'];
    const nextFear = order[(order.indexOf(fearIntensity) + 1) % order.length];
    setFearIntensity(nextFear);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'SET_ACCESSIBILITY',
        fearIntensity: nextFear,
        flickerReduction,
        screenShakeOff,
      })
    );
  };

  const toggleFlickerReduction = () => {
    const nextVal = !flickerReduction;
    setFlickerReduction(nextVal);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'SET_ACCESSIBILITY',
        fearIntensity,
        flickerReduction: nextVal,
        screenShakeOff,
      })
    );
  };

  const toggleScreenShakeOff = () => {
    const nextVal = !screenShakeOff;
    setScreenShakeOff(nextVal);
    setCameraShake(!nextVal);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'SET_ACCESSIBILITY',
        fearIntensity,
        flickerReduction,
        screenShakeOff: nextVal,
      })
    );
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ENGINE_READY') {
        setWebViewError(null);
        webViewRef.current?.postMessage(
          JSON.stringify({
            type: 'CONFIGURE',
            exploreMode,
            role,
            difficulty,
            muted: isMuted || masterVolume === 0,
            quality,
            pinMode: qualityPinMode,
            batterySaver,
            fearIntensity,
            flickerReduction,
            screenShakeOff,
          })
        );
      } else if (data.type === 'SCREENSHOT_UI_VISIBILITY') {
        setHideUiForScreenshot(Boolean(data.hidden));
      } else if (data.type === 'COPY_DESIGN_NOTES') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        console.log('[Gandaki Map Design Notes]\n' + (data.text || ''));
      } else if (data.type === 'STATUS') {
        setGameState((prev) => ({
          ...prev,
          status: 'PLAYING',
          hidersRemaining: typeof data.hidersRemaining === 'number' ? data.hidersRemaining : prev.hidersRemaining,
          timeLeft: typeof data.timeLeft === 'number' ? data.timeLeft : prev.timeLeft,
          fusesRestored: typeof data.fusesRestored === 'number' ? data.fusesRestored : prev.fusesRestored,
          gateUnlocked: typeof data.gateUnlocked === 'boolean' ? data.gateUnlocked : prev.gateUnlocked,
        }));
      } else if (data.type === 'HIDER_CAUGHT') {
        if (!exploreMode) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          setGameState((prev) => ({
            ...prev,
            hidersRemaining: data.remaining,
          }));
        }
      } else if (data.type === 'ACCESSIBILITY_SYNC') {
        if (data.fearIntensity) setFearIntensity(data.fearIntensity);
        if (typeof data.flickerReduction === 'boolean') setFlickerReduction(data.flickerReduction);
        if (typeof data.screenShakeOff === 'boolean') {
          setScreenShakeOff(data.screenShakeOff);
          setCameraShake(!data.screenShakeOff);
        }
        if (typeof data.batterySaver === 'boolean') setBatterySaver(data.batterySaver);
        if (data.pinMode) setQualityPinMode(data.pinMode);
      } else if (data.type === 'GAMEOVER') {
        if (!exploreMode) {
          const didPlayerWin =
            (role === 'seeker' && data.winner === 'SEEKER') ||
            (role === 'hider' && data.winner === 'HIDERS');
          Haptics.notificationAsync(
            didPlayerWin
              ? Haptics.NotificationFeedbackType.Success
              : Haptics.NotificationFeedbackType.Warning
          );
          setGameState((prev) => ({
            ...prev,
            status: 'GAMEOVER',
            winner: data.winner,
            reason: data.reason,
            foundCount: data.foundCount,
          }));
        }
      } else if (data.type === 'HUNTER_PROXIMITY') {
        const prox = Math.max(0, Math.min(1, Number(data.proximity) || 0));
        hunterProximityRef.current = prox;
      } else if (data.type === 'DISPOSE_ACK') {
        if (disposeFallbackTimerRef.current) {
          clearTimeout(disposeFallbackTimerRef.current);
          disposeFallbackTimerRef.current = null;
        }
        if (isExitingRef.current) {
          isExitingRef.current = false;
          setGameStarted(false);
        }
      } else if (data.type === 'AUTO_STEP_DOWN_QUALITY') {
        if (data.quality) setQuality(data.quality as GraphicsQuality);
        else setQuality('low');
      } else if (data.type === 'MISSION_ITEM_FOUND') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else if (data.type === 'POWER_STATE_CHANGED') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      } else if (data.type === 'MISSION_UPDATED') {
        if (data.completed) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      } else if (data.type === 'SESSION_TELEMETRY_REPORT') {
        console.log('[HideAndSeek 10-Min Telemetry]', JSON.stringify(data));
      } else if (data.type === 'LOG_ERROR') {
        console.warn('[HideAndSeek WebView Error]', data.message, data.stack);
        setWebViewError(data.message || 'Game engine encountered an unexpected error.');
      }
    } catch (e) {
      console.error('Failed to parse game message', e);
    }
  };

  const restartGame = () => {
    setWebViewError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const botCount = DIFFICULTY_META[difficulty].bots;
    setGameState({
      status: 'PLAYING',
      hidersRemaining: botCount,
      timeLeft: DEFAULT_MATCH_DURATION,
      fusesRestored: 0,
      gateUnlocked: false,
    });
    webViewRef.current?.postMessage(JSON.stringify({ type: 'RESTART_GAME' }));
  };

  const exitToLobby = () => {
    setWebViewError(null);
    setHideUiForScreenshot(false);
    isExitingRef.current = true;
    try {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'DISPOSE' }));
    } catch (e) {}
    if (disposeFallbackTimerRef.current) {
      clearTimeout(disposeFallbackTimerRef.current);
    }
    disposeFallbackTimerRef.current = setTimeout(() => {
      disposeFallbackTimerRef.current = null;
      if (isExitingRef.current) {
        isExitingRef.current = false;
        setGameStarted(false);
      }
    }, 140);
  };

  const didWin =
    (role === 'seeker' && gameState.winner === 'SEEKER') ||
    (role === 'hider' && gameState.winner === 'HIDERS');

  const formatTimer = (secs: number) => {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  };

  // Reusable Toggle Switch matching E265712E Settings UI
  const renderHorrorSwitch = (val: boolean, onToggle: () => void) => (
    <TouchableOpacity
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggle();
      }}
      activeOpacity={0.85}
      style={[styles.switchTrack, val && styles.switchTrackOn]}
    >
      <View style={[styles.switchThumb, val && styles.switchThumbOn]} />
    </TouchableOpacity>
  );

  // Reusable < Value > Stepper matching E265712E Settings UI
  const renderStepper = (label: string, onPrev: () => void, onNext: () => void) => (
    <View style={styles.stepperBox}>
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPrev();
        }}
        style={styles.stepperArrowBtn}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-back" size={14} color="#cbd5e1" />
      </TouchableOpacity>
      <Text style={styles.stepperValueText} numberOfLines={1}>
        {label}
      </Text>
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onNext();
        }}
        style={styles.stepperArrowBtn}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-forward" size={14} color="#cbd5e1" />
      </TouchableOpacity>
    </View>
  );

  // Reusable Interactive Volume Slider Row matching E265712E Settings UI
  const renderVolumeSlider = (label: string, value: number, onChange: (v: number) => void) => (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.sliderRowRight}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            const next = value >= 100 ? 0 : Math.min(100, value + 10);
            onChange(next);
          }}
          style={styles.sliderTrackHitbox}
        >
          <View style={styles.sliderTrackBg}>
            <View style={[styles.sliderTrackFill, { width: `${value}%` }]} />
            <View style={[styles.sliderThumb, { left: `${Math.max(0, Math.min(94, value - 3))}%` }]} />
          </View>
        </TouchableOpacity>
        <Text style={styles.sliderPercentText}>{value}%</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" hidden />

      {!gameStarted ? (
        <ImageBackground
          source={GANDAKI_HORROR_BG}
          resizeMode="cover"
          style={styles.bgImageContainer}
        >
          {/* Subtle Dark Atmospheric Vignette & Distressed Outer Frame Border (D039AE54 & E265712E) */}
          <LinearGradient
            colors={[
              'rgba(2, 4, 8, 0.58)',
              'rgba(4, 8, 12, 0.18)',
              'rgba(4, 8, 12, 0.28)',
              'rgba(2, 4, 8, 0.72)',
            ]}
            locations={[0, 0.3, 0.7, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.distressedOuterFrame} pointerEvents="none" />

          {lobbyView === 'MAIN' ? (
            /* ================================================================
               SCREEN 1: FRONT MENU UI (Exact match to D039AE54-B35E-4EA1-A6FC-928C1A46C91D.PNG)
               ================================================================ */
            <View
              style={[
                styles.frontMenuWrapper,
                {
                  paddingTop: Math.max(insets.top, 18),
                  paddingBottom: Math.max(insets.bottom, 18),
                },
              ]}
            >
              {/* Top Horror Brush Logo: HIDE N SEEK / LOST IN GANDAKI UNIVERSITY */}
              <View style={styles.heroLogoBlock}>
                <View style={styles.titleWordsRow}>
                  <Text style={styles.horrorTitleWord}>HIDE</Text>
                  <View style={styles.redNContainer}>
                    <Text style={styles.horrorTitleRedN}>N</Text>
                    <View style={styles.redDripLeft} />
                    <View style={styles.redDripRight} />
                  </View>
                  <Text style={styles.horrorTitleWord}>SEEK</Text>
                </View>

                <Text style={styles.horrorSubtitleText}>LOST IN GANDAKI UNIVERSITY</Text>
                {/* Tapered Distressed White Brush-Stroke Underline */}
                <View style={styles.brushUnderlineOuter}>
                  <View style={styles.brushUnderlineCore} />
                  <View style={styles.brushUnderlineSub} />
                </View>
              </View>

              {/* Center Stacked Brush-Stroke Menu Buttons: PLAY, SETTING, EXIT */}
              <View style={styles.mainMenuButtonsColumn}>
                {/* 1. PLAY (Highlighted with White Distressed Brush-Stroke Frame) */}
                <TouchableOpacity
                  onPress={startGame}
                  activeOpacity={0.85}
                  style={[styles.brushMenuButton, styles.brushMenuButtonActive]}
                >
                  <View style={styles.brushStrokeTopEdge} />
                  <View style={styles.brushStrokeBottomEdge} />
                  <View style={styles.brushButtonContent}>
                    <Ionicons name="play" size={22} color="#f8fafc" style={styles.menuBtnIcon} />
                    <Text style={styles.brushMenuTextActive}>PLAY</Text>
                  </View>
                </TouchableOpacity>

                {/* 2. SETTING */}
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setLobbyView('SETTINGS');
                  }}
                  activeOpacity={0.85}
                  style={styles.brushMenuButton}
                >
                  <View style={styles.brushButtonContent}>
                    <Ionicons name="settings-sharp" size={20} color="#94a3b8" style={styles.menuBtnIcon} />
                    <Text style={styles.brushMenuTextInactive}>SETTING</Text>
                  </View>
                </TouchableOpacity>

                {/* 3. EXIT */}
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (onBack) onBack();
                  }}
                  activeOpacity={0.85}
                  style={styles.brushMenuButton}
                >
                  <View style={styles.brushButtonContent}>
                    <Ionicons name="exit-outline" size={21} color="#94a3b8" style={styles.menuBtnIcon} />
                    <Text style={styles.brushMenuTextInactive}>EXIT</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* ================================================================
               SCREEN 2: SETTINGS UI (Exact match to E265712E-67D6-45FC-A27D-76230A1F2564.PNG)
               ================================================================ */
            <View
              style={[
                styles.settingsScreenWrapper,
                {
                  paddingTop: Math.max(insets.top, 14),
                  paddingBottom: Math.max(insets.bottom, 14),
                  paddingLeft: Math.max(insets.left, 20),
                  paddingRight: Math.max(insets.right, 20),
                },
              ]}
            >
              {/* LEFT SIDEBAR: Compact Logo, Vertical Nav (PLAY / SETTINGS / EXIT) & Horror Quote */}
              <View style={styles.settingsSidebar}>
                <View style={styles.sidebarLogoBlock}>
                  <View style={styles.sidebarTitleRow}>
                    <Text style={styles.sidebarTitleWord}>HIDE</Text>
                    <Text style={styles.sidebarTitleRedN}>N</Text>
                    <Text style={styles.sidebarTitleWord}>SEEK</Text>
                  </View>
                  <Text style={styles.sidebarSubtitle}>LOST IN GANDAKI UNIVERSITY</Text>
                  <View style={styles.sidebarBrushUnderline} />
                </View>

                <View style={styles.sidebarNavList}>
                  <TouchableOpacity
                    onPress={startGame}
                    activeOpacity={0.8}
                    style={styles.sidebarNavBtn}
                  >
                    <Ionicons name="play" size={18} color="#7e8a96" />
                    <Text style={styles.sidebarNavText}>PLAY</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setLobbyView('SETTINGS')}
                    activeOpacity={0.9}
                    style={[styles.sidebarNavBtn, styles.sidebarNavBtnActive]}
                  >
                    <View style={styles.brushStrokeTopEdge} />
                    <View style={styles.brushStrokeBottomEdge} />
                    <Ionicons name="settings-sharp" size={18} color="#f8fafc" />
                    <Text style={styles.sidebarNavTextActive}>SETTINGS</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setLobbyView('MAIN');
                    }}
                    activeOpacity={0.8}
                    style={styles.sidebarNavBtn}
                  >
                    <Ionicons name="exit-outline" size={19} color="#7e8a96" />
                    <Text style={styles.sidebarNavText}>EXIT</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.sidebarQuoteWrapper}>
                  <Text style={styles.sidebarQuoteText}>
                    {'Some places are\nbetter left\nunexplored...'}
                  </Text>
                </View>
              </View>

              {/* RIGHT MAIN PANEL: SETTINGS Header + 2x2 Grid (GRAPHICS, GAMEPLAY, AUDIO, OTHER) */}
              <View style={styles.settingsMainPanel}>
                <View style={styles.settingsHeaderRow}>
                  <Ionicons name="settings-sharp" size={22} color="#cbd5e1" />
                  <Text style={styles.settingsHeaderTitle}>SETTINGS</Text>
                </View>
                <View style={styles.settingsHeaderDivider} />

                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.settingsGridContainer}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.settingsGridRow}>
                    {/* PANEL 1: GRAPHICS */}
                    <View style={styles.settingsCard}>
                      <View style={styles.cardHeaderRow}>
                        <Ionicons name="desktop-outline" size={15} color="#cbd5e1" />
                        <Text style={styles.cardHeaderTitle}>GRAPHICS</Text>
                      </View>
                      <View style={styles.cardHeaderLine} />

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Quality</Text>
                        <View style={styles.segmentedGroup}>
                          {(['Low', 'Medium', 'High', 'Ultra'] as const).map((q) => {
                            const active = uiQualityLabel === q;
                            return (
                              <TouchableOpacity
                                key={q}
                                onPress={() => selectGraphicsQualityPill(q)}
                                style={[styles.segBtn, active && styles.segBtnActive]}
                                activeOpacity={0.8}
                              >
                                <Text style={[styles.segBtnText, active && styles.segBtnTextActive]}>
                                  {q}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Resolution</Text>
                        <TouchableOpacity
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setResolutionIdx((resolutionIdx + 1) % RESOLUTIONS.length);
                          }}
                          style={styles.dropdownBox}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.dropdownText}>{RESOLUTIONS[resolutionIdx]}</Text>
                          <Ionicons name="chevron-down" size={14} color="#cbd5e1" />
                        </TouchableOpacity>
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Shadow Quality</Text>
                        {renderStepper(
                          SHADOW_TIERS[shadowIdx],
                          () => setShadowIdx((shadowIdx - 1 + SHADOW_TIERS.length) % SHADOW_TIERS.length),
                          () => setShadowIdx((shadowIdx + 1) % SHADOW_TIERS.length)
                        )}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Texture Quality</Text>
                        {renderStepper(
                          TEXTURE_TIERS[textureIdx],
                          () => setTextureIdx((textureIdx - 1 + TEXTURE_TIERS.length) % TEXTURE_TIERS.length),
                          () => setTextureIdx((textureIdx + 1) % TEXTURE_TIERS.length)
                        )}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Anti-Aliasing</Text>
                        {renderStepper(
                          AA_MODES[aaIdx],
                          () => setAaIdx((aaIdx - 1 + AA_MODES.length) % AA_MODES.length),
                          () => setAaIdx((aaIdx + 1) % AA_MODES.length)
                        )}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>VSync</Text>
                        {renderHorrorSwitch(vsync, () => setVsync(!vsync))}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Motion Blur</Text>
                        {renderHorrorSwitch(motionBlur, () => setMotionBlur(!motionBlur))}
                      </View>
                    </View>

                    {/* PANEL 2: GAMEPLAY */}
                    <View style={styles.settingsCard}>
                      <View style={styles.cardHeaderRow}>
                        <Ionicons name="game-controller-outline" size={15} color="#cbd5e1" />
                        <Text style={styles.cardHeaderTitle}>GAMEPLAY</Text>
                      </View>
                      <View style={styles.cardHeaderLine} />

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Difficulty Level</Text>
                        <View style={styles.segmentedGroup}>
                          {(['Easy', 'Normal', 'Hard', 'Nightmare'] as const).map((d) => {
                            const active = uiDifficultyLabel === d;
                            return (
                              <TouchableOpacity
                                key={d}
                                onPress={() => selectDifficultyPill(d)}
                                style={[styles.segBtn, active && styles.segBtnActive]}
                                activeOpacity={0.8}
                              >
                                <Text style={[styles.segBtnText, active && styles.segBtnTextActive]}>
                                  {d}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Hide Time</Text>
                        {renderStepper(
                          TIME_OPTIONS[hideTimeIdx],
                          () => setHideTimeIdx((hideTimeIdx - 1 + TIME_OPTIONS.length) % TIME_OPTIONS.length),
                          () => setHideTimeIdx((hideTimeIdx + 1) % TIME_OPTIONS.length)
                        )}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Seek Time</Text>
                        {renderStepper(
                          TIME_OPTIONS[seekTimeIdx],
                          () => setSeekTimeIdx((seekTimeIdx - 1 + TIME_OPTIONS.length) % TIME_OPTIONS.length),
                          () => setSeekTimeIdx((seekTimeIdx + 1) % TIME_OPTIONS.length)
                        )}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Player Count</Text>
                        {renderStepper(
                          PLAYER_COUNTS[playerCountIdx],
                          () => setPlayerCountIdx((playerCountIdx - 1 + PLAYER_COUNTS.length) % PLAYER_COUNTS.length),
                          () => setPlayerCountIdx((playerCountIdx + 1) % PLAYER_COUNTS.length)
                        )}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Respawn</Text>
                        {renderHorrorSwitch(respawn, () => setRespawn(!respawn))}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Random Spawn</Text>
                        {renderHorrorSwitch(randomSpawn, () => setRandomSpawn(!randomSpawn))}
                      </View>
                    </View>
                  </View>

                  <View style={styles.settingsGridRow}>
                    {/* PANEL 3: AUDIO */}
                    <View style={styles.settingsCard}>
                      <View style={styles.cardHeaderRow}>
                        <Ionicons name="volume-high-outline" size={15} color="#cbd5e1" />
                        <Text style={styles.cardHeaderTitle}>AUDIO</Text>
                      </View>
                      <View style={styles.cardHeaderLine} />

                      {renderVolumeSlider('Master Volume', masterVolume, (v) => {
                        setMasterVolume(v);
                        setIsMuted(v === 0);
                      })}
                      {renderVolumeSlider('Music Volume', musicVolume, setMusicVolume)}
                      {renderVolumeSlider('SFX Volume', sfxVolume, setSfxVolume)}

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Voice Chat</Text>
                        {renderHorrorSwitch(voiceChat, () => setVoiceChat(!voiceChat))}
                      </View>
                    </View>

                    {/* PANEL 4: OTHER */}
                    <View style={styles.settingsCard}>
                      <View style={styles.cardHeaderRow}>
                        <Ionicons name="list-outline" size={15} color="#cbd5e1" />
                        <Text style={styles.cardHeaderTitle}>OTHER</Text>
                      </View>
                      <View style={styles.cardHeaderLine} />

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Language</Text>
                        <TouchableOpacity
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setLanguageIdx((languageIdx + 1) % LANGUAGES.length);
                          }}
                          style={styles.dropdownBox}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.dropdownText}>{LANGUAGES[languageIdx]}</Text>
                          <Ionicons name="chevron-down" size={14} color="#cbd5e1" />
                        </TouchableOpacity>
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Camera Shake</Text>
                        {renderHorrorSwitch(cameraShake, toggleScreenShakeOff)}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Show Hints</Text>
                        {renderHorrorSwitch(showHints, () => setShowHints(!showHints))}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Crossplay</Text>
                        {renderHorrorSwitch(crossplay, () => setCrossplay(!crossplay))}
                      </View>

                      <View style={styles.settingRow}>
                        <Text style={styles.settingLabel}>Graphics Mode</Text>
                        {renderStepper(
                          GRAPHICS_MODES[graphicsModeIdx],
                          () => setGraphicsModeIdx((graphicsModeIdx - 1 + GRAPHICS_MODES.length) % GRAPHICS_MODES.length),
                          () => setGraphicsModeIdx((graphicsModeIdx + 1) % GRAPHICS_MODES.length)
                        )}
                      </View>
                    </View>
                  </View>
                </ScrollView>
              </View>
            </View>
          )}
        </ImageBackground>
      ) : (
        <View style={styles.gameWrapper}>
          {!webViewSource ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={HORROR_CONFIG.palette.dimAmber} />
              <Text style={styles.loadingTitle}>ENTERING GANDAKI UNIVERSITY...</Text>
              <Text style={styles.loadingSub}>Loading 3D campus architecture, night lighting & audio</Text>
            </View>
          ) : (
            <WebView
              ref={webViewRef}
              originWhitelist={['*']}
              source={webViewSource}
              style={styles.webview}
              androidLayerType="hardware"
              allowingReadAccessToURL={FileSystem.cacheDirectory || undefined}
              webviewDebuggingEnabled={true}
              allowFileAccess={true}
              allowFileAccessFromFileURLs={true}
              allowUniversalAccessFromFileURLs={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              scrollEnabled={false}
              bounces={false}
              overScrollMode="never"
              mixedContentMode="always"
              cacheEnabled={false}
              startInLoadingState={true}
              renderLoading={() => (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color={HORROR_CONFIG.palette.dimAmber} />
                  <Text style={styles.loadingTitle}>ENTERING GANDAKI UNIVERSITY...</Text>
                  <Text style={styles.loadingSub}>Loading 3D campus architecture, night lighting & audio</Text>
                </View>
              )}
              onLoadStart={() => {
                console.log('[HideAndSeek] WebView onLoadStart');
              }}
              onLoadEnd={() => {
                console.log('[HideAndSeek] WebView onLoadEnd');
                webViewRef.current?.postMessage(
                  JSON.stringify({
                    type: 'CONFIGURE',
                    exploreMode,
                    role,
                    difficulty,
                    muted: isMuted,
                    quality,
                    pinMode: qualityPinMode,
                    batterySaver,
                    fearIntensity,
                    flickerReduction,
                    screenShakeOff,
                  })
                );
              }}
              onMessage={handleMessage}
              onError={(e) => {
                console.warn('[HideAndSeek WebView onError]', e.nativeEvent);
                setWebViewError('WebView failed to load: ' + (e.nativeEvent.description || 'Unknown network or layout error'));
              }}
              onHttpError={(e) => {
                console.warn('[HideAndSeek WebView onHttpError]', e.nativeEvent);
                setWebViewError('WebView HTTP error: ' + e.nativeEvent.statusCode);
              }}
              onRenderProcessGone={(e) => {
                console.warn('[HideAndSeek WebView onRenderProcessGone]', e.nativeEvent);
                setWebViewError('3D WebGL render process ran out of memory. Please reload.');
              }}
            />
          )}

          {webViewError && (
            <View style={styles.errorBannerContainer}>
              <View style={styles.errorBannerCard}>
                <Ionicons name="warning" size={24} color={HORROR_CONFIG.palette.dimAmber} />
                <View style={styles.errorTextCol}>
                  <Text style={styles.errorBannerTitle}>NIGHTFALL ENGINE ERROR</Text>
                  <Text style={styles.errorBannerDesc} numberOfLines={3}>{webViewError}</Text>
                </View>
                <TouchableOpacity
                  style={styles.errorReloadButton}
                  onPress={() => {
                    setWebViewError(null);
                    webViewRef.current?.reload();
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh" size={16} color={HORROR_CONFIG.palette.boneWhite} />
                  <Text style={styles.errorReloadText}>RELOAD</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {!hideUiForScreenshot && (
            <HorrorHUD
              exploreMode={exploreMode}
              hidersRemaining={gameState.hidersRemaining}
              timeLeft={gameState.timeLeft}
              fusesRestored={gameState.fusesRestored}
              totalFuses={4}
              gateUnlocked={gameState.gateUnlocked}
              isMuted={isMuted}
              quality={quality}
              qualityPinMode={qualityPinMode}
              batterySaver={batterySaver}
              fearIntensity={fearIntensity}
              flickerReduction={flickerReduction}
              screenShakeOff={screenShakeOff}
              onExitLobby={exitToLobby}
              onToggleMute={toggleSound}
              onToggleQuality={toggleQuality}
              onToggleBatterySaver={toggleBatterySaver}
              onCycleFearIntensity={cycleFearIntensity}
              onToggleFlickerReduction={toggleFlickerReduction}
              onToggleScreenShake={toggleScreenShakeOff}
              formatTimer={formatTimer}
            />
          )}

          {!exploreMode && gameState.status === 'GAMEOVER' && (
            <View style={styles.gameOverOverlay}>
              <View style={styles.gameOverCard}>
                <Text style={styles.gameOverEyebrow}>
                  {didWin ? 'SURVIVED THE NIGHT' : 'CLAIMED BY THE FOG'}
                </Text>
                <Text style={styles.gameOverTitle}>
                  {didWin ? 'VICTORY' : 'CAUGHT'}
                </Text>
                <Text style={styles.gameOverReason}>{gameState.reason}</Text>

                <View style={styles.gameOverButtons}>
                  <TouchableOpacity
                    onPress={restartGame}
                    style={styles.replayButton}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="refresh" size={18} color={HORROR_CONFIG.palette.boneWhite} />
                    <Text style={styles.replayText}>PLAY AGAIN</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={exitToLobby}
                    style={styles.lobbyReturnButton}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.lobbyReturnText}>MAIN MENU</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020408',
  },
  bgImageContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
  },
  distressedOuterFrame: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    bottom: 8,
    borderWidth: 1.2,
    borderColor: 'rgba(226, 232, 240, 0.22)',
  },

  /* =========================================================================
     SCREEN 1: FRONT MENU STYLES (D039AE54-B35E-4EA1-A6FC-928C1A46C91D.PNG)
     ========================================================================= */
  frontMenuWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
  },
  heroLogoBlock: {
    alignItems: 'center',
    marginTop: 6,
  },
  titleWordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  horrorTitleWord: {
    color: '#e5ebf0',
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: 3.5,
    fontStyle: 'italic',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 5 },
    textShadowRadius: 14,
  },
  redNContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  horrorTitleRedN: {
    color: '#b91c1c',
    fontSize: 60,
    fontWeight: '900',
    fontStyle: 'italic',
    textShadowColor: 'rgba(220, 38, 38, 0.65)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 16,
  },
  redDripLeft: {
    position: 'absolute',
    bottom: -10,
    left: 8,
    width: 3,
    height: 16,
    borderRadius: 2,
    backgroundColor: '#991b1b',
  },
  redDripRight: {
    position: 'absolute',
    bottom: -16,
    right: 10,
    width: 2.5,
    height: 22,
    borderRadius: 2,
    backgroundColor: '#7f1d1d',
  },
  horrorSubtitleText: {
    color: '#d8e0e8',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 3.2,
    fontStyle: 'italic',
    marginTop: -2,
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  brushUnderlineOuter: {
    width: 390,
    alignItems: 'center',
    marginTop: 5,
  },
  brushUnderlineCore: {
    width: '100%',
    height: 3,
    backgroundColor: '#e2e8f0',
    borderRadius: 2,
    opacity: 0.92,
  },
  brushUnderlineSub: {
    width: '76%',
    height: 1.5,
    backgroundColor: 'rgba(226, 232, 240, 0.45)',
    marginTop: 2,
  },

  mainMenuButtonsColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 26,
  },
  brushMenuButton: {
    width: 255,
    height: 48,
    backgroundColor: 'rgba(6, 9, 13, 0.82)',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.14)',
    position: 'relative',
    overflow: 'hidden',
  },
  brushMenuButtonActive: {
    width: 275,
    height: 52,
    backgroundColor: 'rgba(5, 8, 12, 0.92)',
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.85,
    shadowRadius: 14,
    elevation: 8,
  },
  brushStrokeTopEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: '#e5ebf0',
  },
  brushStrokeBottomEdge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: '#e5ebf0',
  },
  brushButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  menuBtnIcon: {
    marginTop: 1,
  },
  brushMenuTextActive: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 2.8,
  },
  brushMenuTextInactive: {
    color: '#94a3b8',
    fontSize: 19,
    fontWeight: '800',
    fontStyle: 'italic',
    letterSpacing: 2.4,
  },

  /* =========================================================================
     SCREEN 2: SETTINGS UI STYLES (E265712E-67D6-45FC-A27D-76230A1F2564.PNG)
     ========================================================================= */
  settingsScreenWrapper: {
    flex: 1,
    flexDirection: 'row',
    gap: 18,
  },
  settingsSidebar: {
    width: 215,
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  sidebarLogoBlock: {
    alignItems: 'flex-start',
  },
  sidebarTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sidebarTitleWord: {
    color: '#e5ebf0',
    fontSize: 29,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 1.8,
  },
  sidebarTitleRedN: {
    color: '#b91c1c',
    fontSize: 31,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  sidebarSubtitle: {
    color: '#cbd5e1',
    fontSize: 9.5,
    fontWeight: '800',
    fontStyle: 'italic',
    letterSpacing: 1.5,
    marginTop: 1,
  },
  sidebarBrushUnderline: {
    width: 195,
    height: 2,
    backgroundColor: 'rgba(226, 232, 240, 0.78)',
    marginTop: 4,
  },
  sidebarNavList: {
    gap: 10,
    marginVertical: 10,
  },
  sidebarNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 4,
    position: 'relative',
  },
  sidebarNavBtnActive: {
    backgroundColor: 'rgba(8, 12, 18, 0.90)',
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderColor: '#e2e8f0',
  },
  sidebarNavText: {
    color: '#7e8a96',
    fontSize: 17,
    fontWeight: '800',
    fontStyle: 'italic',
    letterSpacing: 2.0,
  },
  sidebarNavTextActive: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 2.0,
  },
  sidebarQuoteWrapper: {
    paddingLeft: 10,
    paddingBottom: 8,
    transform: [{ rotate: '-10deg' }],
  },
  sidebarQuoteText: {
    color: 'rgba(148, 163, 184, 0.42)',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 17,
  },

  settingsMainPanel: {
    flex: 1,
  },
  settingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  settingsHeaderTitle: {
    color: '#e2e8f0',
    fontSize: 22,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 2.5,
  },
  settingsHeaderDivider: {
    width: '100%',
    height: 1.5,
    backgroundColor: 'rgba(203, 213, 225, 0.35)',
    marginBottom: 10,
  },
  settingsGridContainer: {
    gap: 10,
    paddingBottom: 12,
  },
  settingsGridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  settingsCard: {
    flex: 1,
    backgroundColor: 'rgba(7, 10, 15, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(203, 213, 225, 0.22)',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 5,
  },
  cardHeaderTitle: {
    color: '#e2e8f0',
    fontSize: 12.5,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 1.4,
  },
  cardHeaderLine: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(148, 163, 184, 0.22)',
    marginBottom: 6,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3.5,
  },
  settingLabel: {
    color: '#cbd5e1',
    fontSize: 10.5,
    fontWeight: '600',
    flex: 0.42,
  },
  segmentedGroup: {
    flex: 0.58,
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 34, 0.90)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.25)',
    overflow: 'hidden',
  },
  segBtn: {
    flex: 1,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnActive: {
    backgroundColor: '#c8d0d8',
  },
  segBtnText: {
    color: '#94a3b8',
    fontSize: 9.5,
    fontWeight: '700',
  },
  segBtnTextActive: {
    color: '#090d14',
    fontWeight: '900',
  },
  dropdownBox: {
    flex: 0.58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 34, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.25)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dropdownText: {
    color: '#e2e8f0',
    fontSize: 9.5,
    fontWeight: '600',
  },
  stepperBox: {
    flex: 0.58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 34, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.25)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  stepperArrowBtn: {
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  stepperValueText: {
    color: '#e2e8f0',
    fontSize: 9.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  switchTrack: {
    width: 34,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  switchTrackOn: {
    backgroundColor: 'rgba(71, 85, 105, 0.95)',
    borderColor: '#cbd5e1',
  },
  switchThumb: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#94a3b8',
    alignSelf: 'flex-start',
  },
  switchThumbOn: {
    backgroundColor: '#f8fafc',
    alignSelf: 'flex-end',
  },
  sliderRowRight: {
    flex: 0.58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sliderTrackHitbox: {
    flex: 1,
    paddingVertical: 6,
  },
  sliderTrackBg: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    position: 'relative',
    justifyContent: 'center',
  },
  sliderTrackFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
  },
  sliderThumb: {
    position: 'absolute',
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: '#f8fafc',
    top: -3.5,
  },
  sliderPercentText: {
    color: '#cbd5e1',
    fontSize: 9.5,
    fontWeight: '700',
    minWidth: 28,
    textAlign: 'right',
  },

  /* =========================================================================
     IN-GAME WEBVIEW & OVERLAY STYLES
     ========================================================================= */
  gameWrapper: {
    flex: 1,
    backgroundColor: '#020408',
  },
  webview: {
    flex: 1,
    backgroundColor: '#020408',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#050811',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.8,
    marginTop: 14,
  },
  loadingSub: {
    color: '#94a3b8',
    fontSize: 11.5,
    marginTop: 6,
    textAlign: 'center',
  },
  errorBannerContainer: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    zIndex: 30,
    alignItems: 'center',
  },
  errorBannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderWidth: 1.5,
    borderColor: '#ef4444',
    borderRadius: 14,
    padding: 12,
    gap: 12,
    maxWidth: 520,
  },
  errorTextCol: {
    flex: 1,
  },
  errorBannerTitle: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  errorBannerDesc: {
    color: '#e2e8f0',
    fontSize: 10.5,
    marginTop: 2,
  },
  errorReloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#991b1b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  errorReloadText: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '900',
  },
  gameOverOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(3, 6, 12, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 25,
  },
  gameOverCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(9, 14, 24, 0.96)',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(226, 232, 240, 0.25)',
    padding: 24,
    alignItems: 'center',
  },
  gameOverEyebrow: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },
  gameOverTitle: {
    color: '#f8fafc',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 4,
  },
  gameOverReason: {
    color: '#cbd5e1',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 19,
  },
  gameOverButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  replayButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#991b1b',
    paddingVertical: 12,
    borderRadius: 10,
  },
  replayText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  lobbyReturnButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  lobbyReturnText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
