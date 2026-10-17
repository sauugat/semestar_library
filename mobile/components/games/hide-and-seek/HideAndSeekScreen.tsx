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
import { HorrorHUD } from './HorrorHUD';

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
    sub: '4 Bots • Quiet Fog',
    bots: 4,
    accent: HORROR_CONFIG.palette.dimAmber,
  },
  medium: {
    label: 'CAMPUS WATCH',
    sub: '5 Bots • Active Hunt',
    bots: 5,
    accent: HORROR_CONFIG.palette.dimAmber,
  },
  hard: {
    label: 'CAMPUS LOCKDOWN',
    sub: '6 Bots • Full Horror',
    bots: 6,
    accent: HORROR_CONFIG.palette.bloodRed,
  },
};

export const HideAndSeekScreen: React.FC<HideAndSeekProps> = ({ onBack }) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [role, setRole] = useState<Role>('hider');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [quality, setQuality] = useState<GraphicsQuality>('high');
  const [gameStarted, setGameStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [webViewError, setWebViewError] = useState<string | null>(null);
  const [cachedHtmlUri, setCachedHtmlUri] = useState<string | null>(null);
  const [gameState, setGameState] = useState<{
    status: 'LOBBY' | 'PLAYING' | 'GAMEOVER';
    hidersRemaining: number;
    timeLeft: number;
    winner?: 'SEEKER' | 'HIDERS';
    reason?: string;
    foundCount?: number;
  }>({
    status: 'LOBBY',
    hidersRemaining: 5,
    timeLeft: 135,
  });

  const webViewRef = useRef<WebView>(null);
  const hunterProximityRef = useRef<number>(0);
  const moonAnim = useRef(new Animated.Value(1)).current;

  // Cache large Three.js HTML string to local device storage to prevent Android WebView Binder limit black screen
  useEffect(() => {
    console.log('[HideAndSeek] HideAndSeekScreen mounted. Dimensions:', { width, height, isLandscape });
    let isCancelled = false;
    const cacheHtml = async () => {
      try {
        const targetPath = `${FileSystem.cacheDirectory}hide-and-seek-nightfall-v11-phase-a.html`;
        const content = getHideAndSeekHtml();
        await FileSystem.writeAsStringAsync(targetPath, content, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (!isCancelled) {
          console.log('[HideAndSeek] Successfully cached HTML to file:', targetPath);
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

  // Note: All atmospheric horror audio, heartbeat, wind, creaks, footsteps, and jumpscares
  // are generated procedurally by CampusNightSoundEngine via the HTML5 Web Audio API inside the WebView.

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
      timeLeft: 135,
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
          })
        );
      } else if (data.type === 'STATUS') {
        setGameState((prev) => ({
          ...prev,
          status: 'PLAYING',
          hidersRemaining: data.hidersRemaining,
          timeLeft: data.timeLeft,
        }));
      } else if (data.type === 'HIDER_CAUGHT') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setGameState((prev) => ({
          ...prev,
          hidersRemaining: data.remaining,
        }));
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
        // TASK 2: Mutate ref & modulate heartbeat rate/volume without setting React state!
        const prox = Math.max(0, Math.min(1, Number(data.proximity) || 0));
        hunterProximityRef.current = prox;
      } else if (data.type === 'AUTO_STEP_DOWN_QUALITY') {
        // TASK 4: Auto step quality down from ULTRA to FAST if FPS drops below 30
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
      timeLeft: 135,
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
                  GANDAKI UNIVERSITY • HORROR NIGHT
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
                <Text style={styles.eyebrowText}>POKHARA • MIDNIGHT CURFEW</Text>
                <Text style={[styles.title, isLandscape && styles.titleLandscape]}>
                  GANDAKI CAMPUS 3D
                </Text>
                <Text style={styles.subtitle}>
                  Cold moonlit darkness, warm #ffb35c streetlamp pools, linear silhouette fog, glowing windows, and stereo horror whispers across Gandaki University.
                </Text>

                <View style={styles.featurePillsRow}>
                  <View style={styles.featurePill}>
                    <Ionicons name="sunny-outline" size={12} color={HORROR_CONFIG.palette.dimAmber} />
                    <Text style={styles.featurePillText}>Warm Lamp Pools & Cold Fog</Text>
                  </View>
                  <View style={styles.featurePill}>
                    <Ionicons name="skull-outline" size={12} color={HORROR_CONFIG.palette.bloodRed} />
                    <Text style={styles.featurePillText}>Dynamic Horror Director</Text>
                  </View>
                  <View style={styles.featurePill}>
                    <Ionicons name="headset-outline" size={12} color={HORROR_CONFIG.palette.dimAmber} />
                    <Text style={styles.featurePillText}>Panned Whispers & Crickets</Text>
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
                      HIDER
                    </Text>
                    <Text style={styles.roleSub}>University Scholar</Text>
                    <Text style={styles.roleDesc}>
                      Stay in the dark, crouch to muffle footsteps, and evade the Warden
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
                      SEEKER
                    </Text>
                    <Text style={[styles.roleSub, { color: '#d93838' }]}>
                      Campus Night Warden
                    </Text>
                    <Text style={styles.roleDesc}>
                      Hunt through the warm lamp pools and cold fog to track down scholars
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionTitle}>NIGHT INTENSITY</Text>
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
                <Text style={styles.loadingSub}>Loading Gandaki Campus colliders & horror audio</Text>
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
            isMuted={isMuted}
            quality={quality}
            onExitLobby={exitToLobby}
            onToggleMute={toggleSound}
            onToggleQuality={toggleQuality}
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
    minHeight: 132,
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
    marginBottom: 14,
  },
  diffButton: {
    flex: 1,
    paddingVertical: 9,
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
    fontSize: 10,
    letterSpacing: 0.5,
  },
  diffButtonSub: {
    color: HORROR_CONFIG.palette.mutedBone,
    fontSize: 9,
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
