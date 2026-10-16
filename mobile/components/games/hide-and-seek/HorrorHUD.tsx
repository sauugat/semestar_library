import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { HORROR_CONFIG, GraphicsQuality } from './horrorConfig';

interface HorrorHUDProps {
  hidersRemaining: number;
  timeLeft: number;
  isMuted: boolean;
  quality: GraphicsQuality;
  onExitLobby: () => void;
  onToggleMute: () => void;
  onToggleQuality: () => void;
  formatTimer: (secs: number) => string;
}

export const HorrorHUD: React.FC<HorrorHUDProps> = ({
  hidersRemaining,
  timeLeft,
  isMuted,
  quality,
  onExitLobby,
  onToggleMute,
  onToggleQuality,
  formatTimer,
}) => {
  return (
    <>
      {/* TASK 1: Lightweight Vignette Overlay above 3D view and below HUD (No film grain / post-processing) */}
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
                quality === 'low' && { borderColor: 'rgba(148, 163, 184, 0.18)' },
              ]}
              activeOpacity={0.8}
            >
              <Ionicons
                name="sparkles-outline"
                size={13}
                color={quality === 'high' ? HORROR_CONFIG.palette.dimAmber : '#64748b'}
              />
              <Text style={styles.hudButtonText}>
                {quality === 'high' ? 'GFX: ULTRA' : 'GFX: FAST'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.hudStatsPill} pointerEvents="none">
            <View style={styles.hudStatBlock}>
              <Ionicons name="people" size={13} color={HORROR_CONFIG.palette.dimAmber} />
              <Text style={styles.hudStatText}>{hidersRemaining} Hiders</Text>
            </View>
            <View style={styles.hudDivider} />
            <View style={styles.hudStatBlock}>
              <Ionicons
                name="time-outline"
                size={13}
                color={timeLeft < 25 ? '#ef4444' : HORROR_CONFIG.palette.dimAmber}
              />
              <Text
                style={[
                  styles.hudStatText,
                  timeLeft < 25 && { color: '#fca5a5' },
                ]}
              >
                {formatTimer(timeLeft)}
              </Text>
            </View>
          </View>
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
    gap: 8,
  },
  hudButton: {
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
  hudButtonText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  hudIconButton: {
    width: 32,
    height: 32,
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
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: HORROR_CONFIG.palette.charcoalTranslucent,
    borderWidth: 1,
    borderColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
  hudStatBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  hudStatText: {
    color: HORROR_CONFIG.palette.boneWhite,
    fontSize: 11.5,
    fontWeight: '800',
  },
  hudDivider: {
    width: 1,
    height: 13,
    backgroundColor: HORROR_CONFIG.palette.dimAmberBorder,
  },
});
