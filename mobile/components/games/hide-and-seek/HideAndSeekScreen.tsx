import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
  StatusBar,
  ScrollView,
  useWindowDimensions,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system/legacy';
import { getHideAndSeekHtml } from './gameHtml';
import { HORROR_CONFIG, GraphicsQuality } from './horrorConfig';
import { HorrorHUD, FearIntensity } from './HorrorHUD';

interface HideAndSeekProps {
  onBack?: () => void;
}

type Role = 'seeker' | 'hider';
type Difficulty = 'easy' | 'medium' | 'hard';

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

export const HideAndSeekScreen: React.FC<HideAndSeekProps> = ({ onBack }) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [role, setRole] = useState<Role>('hider');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [quality, setQuality] = useState<GraphicsQuality>('high');
  const [fearIntensity, setFearIntensity] = useState<FearIntensity>(
    (HORROR_CONFIG as any).accessibility?.fearIntensity || 'high'
  );
  const [flickerReduction, setFlickerReduction] = useState<boolean>(
    !!(HORROR_CONFIG as any).accessibility?.flickerReduction
  );
  const [screenShakeOff, setScreenShakeOff] = useState<boolean>(
    !!(HORROR_CONFIG as any).accessibility?.screenShakeOff
  );
  const [gameStarted, setGameStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [webViewError, setWebViewError] = useState<string | null>(null);
  const [cachedHtmlUri, setCachedHtmlUri] = useState<string | null>(null);
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
  const moonAnim = useRef(new Animated.Value(1)).current;

  // Cache large Three.js HTML string to local device storage to prevent Android WebView Binder limit black screen
  useEffect(() => {
    let isCancelled = false;
    const cacheHtml = async () => {
      try {
        const targetPath = `${FileSystem.cacheDirectory}hide-and-seek-nightfall-v12-main-bldg.html`;
        const content = getHideAndSeekHtml();
        await FileSystem.writeAsStringAsync(targetPath, content, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (!isCancelled) {
          setCachedHtmlUri(targetPath);
        }
      } catch (err) {
        console.warn('[HideAndSeek] Could not write HTML cache, falling back to string:', err);
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
    return { html: getHideAndSeekHtml() };
  }, [cachedHtmlUri]);

  useEffect(() => {
    return () => {
      try {
        webViewRef.current?.postMessage(JSON.stringify({ type: 'DISPOSE' }));
      } catch (e) {}
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {
        ScreenOrientation.unlockAsync().catch(() => {});
      });
    };
  }, []);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(moonAnim, {
          toValue: 1.08,
          duration: 2600,
          useNativeDriver: true,
        }),
        Animated.timing(moonAnim, {
          toValue: 1.0,
          duration: 2600,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [moonAnim]);

  const startGame = async () => {
    setWebViewError(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } catch (e) {
      console.warn('Failed to lock orientation to landscape:', e);
    }
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
    const order: GraphicsQuality[] = ['high', 'fast', 'low', 'ultra'];
    const nextQuality: GraphicsQuality = order[(order.indexOf(quality) + 1) % order.length];
    setQuality(nextQuality);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'SET_QUALITY',
        quality: nextQuality,
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
            role,
            difficulty,
            muted: isMuted,
            quality,
            fearIntensity,
            flickerReduction,
            screenShakeOff,
          })
        );
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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setGameState((prev) => ({
          ...prev,
          hidersRemaining: data.remaining,
        }));
      } else if (data.type === 'ACCESSIBILITY_SYNC') {
        if (data.fearIntensity) setFearIntensity(data.fearIntensity);
        if (typeof data.flickerReduction === 'boolean') setFlickerReduction(data.flickerReduction);
        if (typeof data.screenShakeOff === 'boolean') setScreenShakeOff(data.screenShakeOff);
      } else if (data.type === 'GAMEOVER') {
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
      } else if (data.type === 'HUNTER_PROXIMITY') {
        const prox = Math.max(0, Math.min(1, Number(data.proximity) || 0));
        hunterProximityRef.current = prox;
      } else if (data.type === 'AUTO_STEP_DOWN_QUALITY') {
        setQuality('low');
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
    try {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'DISPOSE' }));
    } catch (e) {}
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {
      ScreenOrientation.unlockAsync().catch(() => {});
    });
    setGameStarted(false);
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {!gameStarted ? (
        <LinearGradient
          colors={['#070b14', '#0d1322', '#141b2c']}
          style={[
            styles.lobbyContainer,
            {
              paddingTop: Math.max(insets.top, Platform.OS === 'ios' ? 44 : 24),
              paddingBottom: Math.max(insets.bottom, 14),
              paddingLeft: Math.max(insets.left, 18),
              paddingRight: Math.max(insets.right, 18),
            },
          ]}
        >
          <View style={styles.skyBackdrop} pointerEvents="none">
            <Animated.View style={[styles.fullMoonOrb, { transform: [{ scale: moonAnim }] }]}>
              <View style={styles.fullMoonCore} />
            </Animated.View>
          </View>

          <View style={[styles.lobbyTopBar, isLandscape && styles.lobbyTopBarLandscape]}>
            <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.8}>
              <Ionicons name="arrow-back" size={18} color={HORROR_CONFIG.palette.dimAmber} />
              <Text style={styles.backButtonText}>EXIT</Text>
            </TouchableOpacity>

            <View style={styles.topRightRow}>
              <TouchableOpacity
                onPress={toggleQuality}
                style={styles.qualityPill}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="options-outline"
                  size={13}
                  color={HORROR_CONFIG.palette.dimAmber}
                />
                <Text style={styles.qualityPillText}>
                  {HORROR_CONFIG.qualityPresets[quality].label}
                </Text>
              </TouchableOpacity>

              <View style={styles.cultureBadge}>
                <Ionicons name="moon" size={13} color={HORROR_CONFIG.palette.dimAmber} />
                <Text style={styles.cultureBadgeText}>
                  GANDAKI UNIVERSITY • 1 HUNTER VS 3–7 SCHOLARS
                </Text>
              </View>
            </View>
          </View>

          <ScrollView
            style={styles.lobbyScrollView}
            contentContainerStyle={[
              styles.lobbyScroll,
              isLandscape && styles.lobbyScrollLandscape,
            ]}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.heroSection,
                isLandscape && styles.heroSectionLandscape,
              ]}
            >
              <View style={styles.carvedHeaderFrame}>
                <Text style={styles.eyebrowText}>POKHARA • 9-MINUTE SURVIVAL</Text>
                <Text style={[styles.title, isLandscape && styles.titleLandscape]}>
                  GANDAKI CAMPUS 3D
                </Text>
                <Text style={styles.subtitle}>
                  Restore 4 fuse boxes across the campus wings to unlock the Main Gate and escape the Hollow Entity. Hide under desks, inside lockers, or behind bookshelves—and hold your breath when it checks your room.
                </Text>

                <View style={styles.featurePillsRow}>
                  <View style={styles.featurePill}>
                    <Ionicons name="flash-outline" size={12} color={HORROR_CONFIG.palette.dimAmber} />
                    <Text style={styles.featurePillText}>4 Fuse Boxes & Main Gate</Text>
                  </View>
                  <View style={styles.featurePill}>
                    <Ionicons name="skull-outline" size={12} color={HORROR_CONFIG.palette.bloodRed} />
                    <Text style={styles.featurePillText}>Hold-Your-Breath Hiding</Text>
                  </View>
                  <View style={styles.featurePill}>
                    <Ionicons name="volume-medium-outline" size={12} color={HORROR_CONFIG.palette.dimAmber} />
                    <Text style={styles.featurePillText}>Acoustic Noise & Distractions</Text>
                  </View>
                </View>
              </View>
            </View>

            <View
              style={[
                styles.configColumn,
                isLandscape && styles.configColumnLandscape,
              ]}
            >
              <Text style={styles.sectionTitle}>CHOOSE YOUR ROLE</Text>
              <View style={styles.roleContainer}>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setRole('hider');
                  }}
                  activeOpacity={0.85}
                  style={[
                    styles.roleCard,
                    role === 'hider' && styles.roleCardActiveAmber,
                  ]}
                >
                  <View style={styles.roleInner}>
                    <Ionicons
                      name="eye-off"
                      size={24}
                      color={role === 'hider' ? HORROR_CONFIG.palette.dimAmber : HORROR_CONFIG.palette.mutedBone}
                    />
                    <Text style={[styles.roleTitle, role === 'hider' && styles.roleTitleActive]}>
                      SCHOLAR
                    </Text>
                    <Text style={styles.roleSub}>3–7 Survivors</Text>
                    <Text style={styles.roleDesc}>
                      Repair 4 fuse boxes, manage flashlight battery, throw distractions, and rescue caught teammates
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setRole('seeker');
                  }}
                  activeOpacity={0.85}
                  style={[
                    styles.roleCard,
                    role === 'seeker' && styles.roleCardActiveRed,
                  ]}
                >
                  <View style={styles.roleInner}>
                    <Ionicons
                      name="eye"
                      size={24}
                      color={role === 'seeker' ? '#d93838' : HORROR_CONFIG.palette.mutedBone}
                    />
                    <Text style={[styles.roleTitle, role === 'seeker' && styles.roleTitleActive]}>
                      HUNTER
                    </Text>
                    <Text style={[styles.roleSub, { color: '#d93838' }]}>
                      The Hollow Proctor (Entity)
                    </Text>
                    <Text style={styles.roleDesc}>
                      Track noise pings every 30s, lock classroom doors, trigger power-cut pulses, and search hiding spots
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionTitle}>NIGHT INTENSITY & SCHOLAR COUNT</Text>
              <View style={styles.diffContainer}>
                {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => {
                  const meta = DIFFICULTY_META[d];
                  const active = difficulty === d;
                  return (
                    <TouchableOpacity
                      key={d}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setDifficulty(d);
                      }}
                      activeOpacity={0.85}
                      style={[
                        styles.diffButton,
                        active && {
                          borderColor: HORROR_CONFIG.palette.dimAmber,
                          backgroundColor: 'rgba(201, 146, 58, 0.14)',
                        },
                      ]}
                    >
                      <Text style={[styles.diffButtonTitle, active && { color: HORROR_CONFIG.palette.boneWhite }]}>
                        {meta.label}
                      </Text>
                      <Text style={[styles.diffButtonSub, active && { color: HORROR_CONFIG.palette.dimAmber }]}>
                        {meta.sub}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.sectionTitle}>ACCESSIBILITY & COMFORT</Text>
              <View style={styles.diffContainer}>
                <TouchableOpacity
                  onPress={cycleFearIntensity}
                  activeOpacity={0.85}
                  style={styles.diffButton}
                >
                  <Text style={[styles.diffButtonTitle, { color: HORROR_CONFIG.palette.boneWhite }]}>
                    FEAR: {fearIntensity.toUpperCase()}
                  </Text>
                  <Text style={styles.diffButtonSub}>Heartbeat & Vignette</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={toggleFlickerReduction}
                  activeOpacity={0.85}
                  style={[
                    styles.diffButton,
                    flickerReduction && {
                      borderColor: HORROR_CONFIG.palette.dimAmber,
                      backgroundColor: 'rgba(201, 146, 58, 0.14)',
                    },
                  ]}
                >
                  <Text style={[styles.diffButtonTitle, { color: HORROR_CONFIG.palette.boneWhite }]}>
                    FLICKER: {flickerReduction ? 'REDUCED' : 'NORMAL'}
                  </Text>
                  <Text style={styles.diffButtonSub}>Smooth Tube Lights</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={toggleScreenShakeOff}
                  activeOpacity={0.85}
                  style={[
                    styles.diffButton,
                    screenShakeOff && {
                      borderColor: HORROR_CONFIG.palette.dimAmber,
                      backgroundColor: 'rgba(201, 146, 58, 0.14)',
                    },
                  ]}
                >
                  <Text style={[styles.diffButtonTitle, { color: HORROR_CONFIG.palette.boneWhite }]}>
                    SHAKE: {screenShakeOff ? 'OFF' : 'ON'}
                  </Text>
                  <Text style={styles.diffButtonSub}>Camera Motion</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={startGame}
                style={styles.startButton}
                activeOpacity={0.88}
              >
                <LinearGradient
                  colors={[HORROR_CONFIG.palette.bloodRed, '#4a0c0c']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.startGradient}
                >
                  <Ionicons name="moon" size={18} color={HORROR_CONFIG.palette.boneWhite} />
                  <Text style={styles.startText}>ENTER GANDAKI CAMPUS</Text>
                  <Ionicons name="arrow-forward" size={18} color={HORROR_CONFIG.palette.boneWhite} />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </LinearGradient>
      ) : (
        <View style={styles.gameWrapper}>
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={webViewSource}
            style={styles.webview}
            androidLayerType="hardware"
            androidHardwareAccelerationDisabled={false}
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
                <Text style={styles.loadingTitle}>IGNITING NIGHTFALL 3D ENGINE...</Text>
                <Text style={styles.loadingSub}>Loading Main Building baked AO, colliders & procedural audio</Text>
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
                  role,
                  difficulty,
                  muted: isMuted,
                  quality,
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

          <HorrorHUD
            hidersRemaining={gameState.hidersRemaining}
            timeLeft={gameState.timeLeft}
            fusesRestored={gameState.fusesRestored}
            totalFuses={4}
            gateUnlocked={gameState.gateUnlocked}
            isMuted={isMuted}
            quality={quality}
            fearIntensity={fearIntensity}
            flickerReduction={flickerReduction}
            screenShakeOff={screenShakeOff}
            onExitLobby={exitToLobby}
            onToggleMute={toggleSound}
            onToggleQuality={toggleQuality}
            onCycleFearIntensity={cycleFearIntensity}
            onToggleFlickerReduction={toggleFlickerReduction}
            onToggleScreenShake={toggleScreenShakeOff}
            formatTimer={formatTimer}
          />

          {gameState.status === 'GAMEOVER' && (
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
                    style={styles.menuButton}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.menuText}>RETURN TO LOBBY</Text>
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
    backgroundColor: '#070b14',
  },
  lobbyContainer: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'ios' ? 46 : 28,
    paddingBottom: 14,
  },
  skyBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  fullMoonOrb: {
    position: 'absolute',
    top: 32,
    right: 34,
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(58, 74, 122, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullMoonCore: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#d8e2f2',
  },
  lobbyTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    zIndex: 10,
  },
  lobbyTopBarLandscape: {
    marginBottom: 8,
  },
  topRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
  backButtonText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 1,
  },
  qualityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
  qualityPillText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  cultureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
  cultureBadgeText: {
    color: HORROR_CONFIG.palette.dimAmber,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  lobbyScrollView: {
    flex: 1,
    width: '100%',
  },
  lobbyScroll: {
    flexGrow: 1,
    paddingTop: 8,
    paddingBottom: 36,
    gap: 16,
    width: '100%',
  },
  lobbyScrollLandscape: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    gap: 16,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#070b14',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 10,
  },
  loadingTitle: {
    color: '#fef08a',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 16,
    textAlign: 'center',
  },
  loadingSub: {
    color: '#94a3b8',
    fontSize: 12.5,
    marginTop: 6,
    textAlign: 'center',
  },
  heroSection: {
    width: '100%',
  },
  heroSectionLandscape: {
    width: '47%',
  },
  carvedHeaderFrame: {
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
  eyebrowText: {
    color: HORROR_CONFIG.palette.dimAmber,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 4,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: HORROR_CONFIG.palette.boneWhite,
    letterSpacing: 1.4,
  },
  titleLandscape: {
    fontSize: 22,
  },
  subtitle: {
    fontSize: 12,
    color: HORROR_CONFIG.palette.mutedBone,
    lineHeight: 17.5,
    marginTop: 6,
  },
  featurePillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(11, 13, 18, 0.9)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
  featurePillText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 10,
    fontWeight: '700',
  },
  configColumn: {
    width: '100%',
  },
  configColumnLandscape: {
    width: '50%',
  },
  sectionTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    color: HORROR_CONFIG.palette.dimAmber,
    letterSpacing: 1.5,
    marginBottom: 7,
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  roleCard: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    borderWidth: 1,
    borderColor: 'rgba(158, 154, 145, 0.25)',
  },
  roleCardActiveAmber: {
    borderColor: HORROR_CONFIG.palette.dimAmber,
    backgroundColor: 'rgba(201, 146, 58, 0.12)',
  },
  roleCardActiveRed: {
    borderColor: HORROR_CONFIG.palette.bloodRed,
    backgroundColor: 'rgba(139, 26, 26, 0.18)',
  },
  roleInner: {
    padding: 12,
    alignItems: 'center',
    minHeight: 128,
    justifyContent: 'center',
  },
  roleTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: HORROR_CONFIG.palette.mutedBone,
    letterSpacing: 1,
    marginTop: 6,
  },
  roleTitleActive: {
    color: HORROR_CONFIG.palette.boneWhite,
  },
  roleSub: {
    fontSize: 10,
    fontWeight: '800',
    color: HORROR_CONFIG.palette.dimAmber,
    marginTop: 2,
    marginBottom: 4,
  },
  roleDesc: {
    fontSize: 10.5,
    color: HORROR_CONFIG.palette.mutedBone,
    textAlign: 'center',
    lineHeight: 14.5,
  },
  diffContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  diffButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(158, 154, 145, 0.25)',
  },
  diffButtonTitle: {
    color: HORROR_CONFIG.palette.mutedBone,
    fontWeight: '800',
    fontSize: 9.5,
    letterSpacing: 0.5,
  },
  diffButtonSub: {
    color: HORROR_CONFIG.palette.mutedBone,
    fontSize: 8.5,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
  startButton: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmber,
  },
  startGradient: {
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  startText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  gameWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#04060b',
  },
  webview: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#04060b',
  },
  gameOverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4, 6, 11, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 20,
  },
  gameOverCard: {
    width: '100%',
    maxWidth: 390,
    backgroundColor: HORROR_CONFIG.palette.charcoal,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: HORROR_CONFIG.palette.bloodRed,
  },
  gameOverEyebrow: {
    color: HORROR_CONFIG.palette.dimAmber,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  gameOverTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: HORROR_CONFIG.palette.boneWhite,
    marginTop: 4,
    marginBottom: 8,
    letterSpacing: 1.2,
  },
  gameOverReason: {
    fontSize: 13.5,
    color: HORROR_CONFIG.palette.mutedBone,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  gameOverButtons: {
    width: '100%',
    gap: 10,
  },
  replayButton: {
    width: '100%',
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: HORROR_CONFIG.palette.bloodRed,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmber,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  replayText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontWeight: '900',
    fontSize: 13.5,
    letterSpacing: 1,
  },
  menuButton: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
    alignItems: 'center',
  },
  menuText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontWeight: '800',
    fontSize: 12.5,
    letterSpacing: 1,
  },
  errorBannerContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 70 : 40,
    left: 16,
    right: 16,
    zIndex: 25,
    alignItems: 'center',
  },
  errorBannerCard: {
    width: '100%',
    maxWidth: 600,
    backgroundColor: 'rgba(24, 12, 14, 0.95)',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: HORROR_CONFIG.palette.bloodRed,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  errorTextCol: {
    flex: 1,
  },
  errorBannerTitle: {
    color: HORROR_CONFIG.palette.bloodRed,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  errorBannerDesc: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '500',
  },
  errorReloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: HORROR_CONFIG.palette.bloodRed,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmber,
  },
  errorReloadText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
