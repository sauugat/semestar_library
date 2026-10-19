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
  onExitLobby,
  onToggleMute,
  onToggleQuality,
  formatTimer,
}) => {
  const tierLabel = HORROR_CONFIG.qualityPresets[quality]?.label || quality.toUpperCase();
  const gfxLabel = qualityPinMode === 'auto' ? `PIN: ${tierLabel}` : `PIN: ${tierLabel}`;

  return (
    <>
      {/* Subtle Edge Vignette Overlay above 3D view and below HUD */}
      <View style={styles.vignetteContainer} pointerEvents="none">
        <LinearGradient
          colors={[
            'rgba(2, 5, 10, 0.55)',
            'rgba(2, 5, 10, 0.0)',
            'rgba(2, 5, 10, 0.0)',
            'rgba(2, 5, 10, 0.62)',
          ]}
          locations={[0, 0.22, 0.78, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Top-Left Sleek Dark-Glass Pill Bar matching Reference Image (5E872F9F) */}
      <View style={styles.hudOverlay} pointerEvents="box-none">
        <View style={styles.hudTopRow} pointerEvents="box-none">
          <View style={styles.hudLeftCluster} pointerEvents="box-none">
            <TouchableOpacity
              onPress={onExitLobby}
              style={styles.hudPillButton}
              activeOpacity={0.8}
            >
              <Ionicons name="chevron-back" size={16} color="#ffffff" />
              <Text style={styles.hudPillText}>LOBBY</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onToggleMute}
              style={styles.hudCircleButton}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isMuted ? 'volume-mute' : 'volume-high'}
                size={17}
                color={isMuted ? '#94a3b8' : '#ffffff'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onToggleQuality}
              style={styles.hudPillButton}
              activeOpacity={0.8}
            >
              <Ionicons
                name="settings-sharp"
                size={15}
                color="#ffffff"
              />
              <Text style={styles.hudPillText}>
                GFX: {gfxLabel}
              </Text>
            </TouchableOpacity>
          </View>

          {!exploreMode && (
            <View style={styles.hudStatsPill} pointerEvents="none">
              <View style={styles.hudStatBlock}>
                <Ionicons
                  name={gateUnlocked ? 'lock-open' : 'flash'}
                  size={13}
                  color={gateUnlocked ? '#22c55e' : '#f8fafc'}
                />
                <Text style={[styles.hudStatText, gateUnlocked && { color: '#4ade80' }]}>
                  {gateUnlocked ? 'GATE OPEN!' : `Fuses: ${fusesRestored}/${totalFuses}`}
                </Text>
              </View>
              <View style={styles.hudDivider} />
              <View style={styles.hudStatBlock}>
                <Ionicons name="people" size={13} color="#f8fafc" />
                <Text style={styles.hudStatText}>{hidersRemaining} Scholars</Text>
              </View>
              <View style={styles.hudDivider} />
              <View style={styles.hudStatBlock}>
                <Ionicons
                  name="time-outline"
                  size={13}
                  color={timeLeft < 60 ? '#ef4444' : '#f8fafc'}
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
    opacity: 0.32,
  },
  hudOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 20 : 16,
    left: 20,
    right: 20,
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
    gap: 10,
  },
  hudPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(8, 13, 20, 0.72)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  hudPillText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  hudCircleButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(8, 13, 20, 0.72)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudStatsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(8, 13, 20, 0.72)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  hudStatBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hudStatText: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '800',
  },
  hudDivider: {
    width: 1,
    height: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
});
