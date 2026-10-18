import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { HORROR_CONFIG, EXPLORE_MODE, GraphicsQuality, QualityPinMode } from './horrorConfig';

export type FearIntensity = 'low' | 'medium' | 'high';

interface HorrorHUDProps {
  exploreMode?: boolean;
  hidersRemaining: number;
  timeLeft: number;
  fusesRestored?: number;
  totalFuses?: number;
  gateUnlocked?: boolean;
  isMuted: boolean;
  quality: GraphicsQuality;
  qualityPinMode?: QualityPinMode;
  batterySaver?: boolean;
  fearIntensity?: FearIntensity;
  flickerReduction?: boolean;
  screenShakeOff?: boolean;
  onExitLobby: () => void;
  onToggleMute: () => void;
  onToggleQuality: () => void;
  onToggleBatterySaver?: () => void;
  onCycleFearIntensity?: () => void;
  onToggleFlickerReduction?: () => void;
  onToggleScreenShake?: () => void;
  formatTimer: (secs: number) => string;
}

export const HorrorHUD: React.FC<HorrorHUDProps> = ({
  exploreMode = EXPLORE_MODE,
  hidersRemaining,
  timeLeft,
  fusesRestored = 0,
  totalFuses = 4,
  gateUnlocked = false,
  isMuted,
  quality,
  qualityPinMode = 'auto',
  batterySaver = false,
  fearIntensity = 'high',
  flickerReduction = false,
  screenShakeOff = false,
  onExitLobby,
  onToggleMute,
  onToggleQuality,
  onToggleBatterySaver,
  onCycleFearIntensity,
  onToggleFlickerReduction,
  onToggleScreenShake,
  formatTimer,
}) => {
  const tierLabel = HORROR_CONFIG.qualityPresets[quality]?.label || quality.toUpperCase();
  const gfxLabel = qualityPinMode === 'auto' ? `AUTO (${tierLabel})` : `PIN: ${tierLabel}`;

  return (
    <>
      {/* Lightweight Vignette Overlay above 3D view and below HUD */}
      <View style={styles.vignetteContainer} pointerEvents="none">
        <LinearGradient
          colors={[
            'rgba(4, 7, 11, 0.68)',
            'rgba(4, 7, 11, 0.0)',
            'rgba(4, 7, 11, 0.0)',
            'rgba(4, 7, 11, 0.74)',
          ]}
          locations={[0, 0.24, 0.76, 1]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[
            'rgba(4, 7, 11, 0.62)',
            'rgba(4, 7, 11, 0.0)',
            'rgba(4, 7, 11, 0.0)',
            'rgba(4, 7, 11, 0.62)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          locations={[0, 0.20, 0.80, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Dark Slate & Warm Amber HUD */}
      <View style={styles.hudOverlay} pointerEvents="box-none">
        <View style={styles.hudTopRow} pointerEvents="box-none">
          <View style={styles.hudLeftCluster} pointerEvents="box-none">
            <TouchableOpacity
              onPress={onExitLobby}
              style={styles.hudButton}
              activeOpacity={0.8}
            >
              <Ionicons name="chevron-back" size={16} color={HORROR_CONFIG.palette.dimAmber} />
              <Text style={styles.hudButtonText}>LOBBY</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onToggleMute}
              style={styles.hudIconButton}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isMuted ? 'volume-mute' : 'volume-high'}
                size={16}
                color={isMuted ? '#64748b' : HORROR_CONFIG.palette.dimAmber}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onToggleQuality}
              style={[
                styles.hudButton,
                (quality === 'low' || quality === 'fast') && { borderColor: 'rgba(148, 163, 184, 0.18)' },
              ]}
              activeOpacity={0.8}
            >
              <Ionicons
                name="sparkles-outline"
                size={13}
                color={quality === 'ultra' || quality === 'high' ? HORROR_CONFIG.palette.dimAmber : '#64748b'}
              />
              <Text style={styles.hudButtonText}>
                GFX: {gfxLabel}
              </Text>
            </TouchableOpacity>

            {onToggleBatterySaver && (
              <TouchableOpacity
                onPress={onToggleBatterySaver}
                style={[
                  styles.hudButton,
                  batterySaver && { borderColor: '#22c55e' },
                ]}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={batterySaver ? 'battery-charging' : 'battery-full-outline'}
                  size={13}
                  color={batterySaver ? '#22c55e' : '#64748b'}
                />
                <Text style={styles.hudButtonText}>
                  SAVER: {batterySaver ? '30 FPS' : 'OFF'}
                </Text>
              </TouchableOpacity>
            )}

            {onToggleFlickerReduction && (
              <TouchableOpacity
                onPress={onToggleFlickerReduction}
                style={[
                  styles.hudButton,
                  flickerReduction && { borderColor: '#38bdf8' },
                ]}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="flash-off-outline"
                  size={13}
                  color={flickerReduction ? '#38bdf8' : '#64748b'}
                />
                <Text style={styles.hudButtonText}>
                  FLICKER: {flickerReduction ? 'REDUCED' : 'FULL'}
                </Text>
              </TouchableOpacity>
            )}

            {!exploreMode && onCycleFearIntensity && (
              <TouchableOpacity
                onPress={onCycleFearIntensity}
                style={styles.hudButton}
                activeOpacity={0.8}
              >
                <Ionicons name="pulse-outline" size={13} color={HORROR_CONFIG.palette.dimAmber} />
                <Text style={styles.hudButtonText}>
                  FEAR: {fearIntensity.toUpperCase()}
                </Text>
              </TouchableOpacity>
            )}

            {!exploreMode && onToggleScreenShake && (
              <TouchableOpacity
                onPress={onToggleScreenShake}
                style={[
                  styles.hudButton,
                  screenShakeOff && { borderColor: '#38bdf8' },
                ]}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="phone-portrait-outline"
                  size={13}
                  color={screenShakeOff ? '#38bdf8' : '#64748b'}
                />
                <Text style={styles.hudButtonText}>
                  SHAKE: {screenShakeOff ? 'OFF' : 'ON'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {exploreMode ? (
            <View style={styles.hudStatsPill} pointerEvents="none">
              <View style={styles.hudStatBlock}>
                <Ionicons name="compass-outline" size={13} color={HORROR_CONFIG.palette.dimAmber} />
                <Text style={styles.hudStatText}>MAP EXPLORATION MODE</Text>
              </View>
            </View>
          ) : (
            <View style={styles.hudStatsPill} pointerEvents="none">
              <View style={styles.hudStatBlock}>
                <Ionicons
                  name={gateUnlocked ? 'lock-open' : 'flash'}
                  size={13}
                  color={gateUnlocked ? '#22c55e' : HORROR_CONFIG.palette.dimAmber}
                />
                <Text style={[styles.hudStatText, gateUnlocked && { color: '#4ade80' }]}>
                  {gateUnlocked ? 'GATE OPEN!' : `Fuses: ${fusesRestored}/${totalFuses}`}
                </Text>
              </View>
              <View style={styles.hudDivider} />
              <View style={styles.hudStatBlock}>
                <Ionicons name="people" size={13} color={HORROR_CONFIG.palette.dimAmber} />
                <Text style={styles.hudStatText}>{hidersRemaining} Scholars</Text>
              </View>
              <View style={styles.hudDivider} />
              <View style={styles.hudStatBlock}>
                <Ionicons
                  name="time-outline"
                  size={13}
                  color={timeLeft < 60 ? '#ef4444' : HORROR_CONFIG.palette.dimAmber}
                />
                <Text
                  style={[
                    styles.hudStatText,
                    timeLeft < 60 && { color: '#fca5a5' },
                  ]}
                >
                  {formatTimer(timeLeft)}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  vignetteContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    opacity: 0.38,
  },
  hudOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 40 : 20,
    left: 14,
    right: 14,
    zIndex: 10,
  },
  hudTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hudLeftCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  hudButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
  hudButtonText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  hudIconButton: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudStatsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
  hudStatBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hudStatText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 11,
    fontWeight: '800',
  },
  hudDivider: {
    width: 1,
    height: 13,
    backgroundColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
});
