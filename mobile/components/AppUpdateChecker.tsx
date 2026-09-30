import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { useTheme } from '@/constants/useTheme';
import { getBaseUrl } from '@/services/api';

import * as Updates from 'expo-updates';

interface VersionInfo {
  latestVersion: string;
  versionCode: number;
  apkUrl: string;
  cdnUrl: string;
  releaseNotes: string;
  forceUpdate?: boolean;
}

export function AppUpdateChecker() {
  const { colors, radii, spacing } = useTheme();
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [visible, setVisible] = useState(false);
  const [otaReady, setOtaReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // 1. Silent Over-The-Air (OTA) update check
    async function checkOtaUpdates() {
      if (Platform.OS === 'web' || !Updates.isEnabled) return;
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          if (isMounted) setOtaReady(true);
        }
      } catch {
        // Silently ignore OTA errors
      }
    }

    // 2. Binary APK version check (only prompts if native versionCode incremented)
    async function checkBinaryUpdates() {
      if (Platform.OS !== 'android') return;
      try {
        const baseUrl = getBaseUrl() || 'https://semestar-library.vercel.app';
        const res = await fetch(`${baseUrl}/api/app/version`, {
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return;

        const data: VersionInfo = await res.json();
        const currentCode = Constants.expoConfig?.android?.versionCode ?? 1;

        if (isMounted && data.versionCode > currentCode) {
          setUpdateInfo(data);
          setVisible(true);
        }
      } catch {
        // Silently ignore network failures on startup
      }
    }

    const timer = setTimeout(() => {
      checkOtaUpdates();
      checkBinaryUpdates();
    }, 1500);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, []);

  const handleUpdate = () => {
    const targetUrl = updateInfo?.apkUrl || 'https://semestar-library.vercel.app/download/apk';
    Linking.openURL(targetUrl).catch(() => {});
    if (!updateInfo?.forceUpdate) {
      setVisible(false);
    }
  };

  if (!visible && !otaReady) return null;

  return (
    <>
      {/* 1. Seamless Over-The-Air Update Banner */}
      {otaReady && !visible && (
        <View style={styles.otaContainer} pointerEvents="box-none">
          <View
            style={[
              styles.otaCard,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.borderStrong,
                borderRadius: radii.lg,
              },
            ]}
          >
            <Ionicons name="sparkles" size={18} color={colors.primary} style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text variant="xs" weight="700" style={{ color: colors.text }}>
                Update Ready
              </Text>
              <Caption color="muted">Restart to apply latest improvements</Caption>
            </View>
            <TouchableOpacity
              onPress={() => Updates.reloadAsync()}
              style={[styles.otaReloadBtn, { backgroundColor: colors.primary, borderRadius: radii.sm }]}
              activeOpacity={0.8}
            >
              <Text variant="xs" weight="700" style={{ color: '#000000' }}>
                Restart
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setOtaReady(false)}
              style={{ marginLeft: 8, padding: 4 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 2. Full Binary APK Update Dialog (only on native versionCode bump) */}
      {visible && updateInfo && (
        <Modal
          visible={visible}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!updateInfo.forceUpdate) setVisible(false);
          }}
        >
          <View style={styles.overlay}>
            <View
              style={[
                styles.dialog,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.borderStrong,
                  borderRadius: radii.xl,
                  padding: spacing.lg,
                },
              ]}
            >
              {/* Header Icon */}
              <View
                style={[
                  styles.iconWrapper,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons name="sparkles" size={28} color={colors.primary} />
              </View>

              {/* Title & Badge */}
              <Heading
                variant="xl"
                style={{ textAlign: 'center', marginTop: 12, marginBottom: 4 }}
              >
                Update Available
              </Heading>
              <View style={styles.badgeRow}>
                <View style={[styles.pill, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                  <Caption color="secondary" style={{ fontWeight: '700' }}>
                    v{updateInfo.latestVersion} (Build {updateInfo.versionCode})
                  </Caption>
                </View>
              </View>

              {/* Release Notes */}
              <Text
                variant="sm"
                color="secondary"
                style={{ textAlign: 'center', marginVertical: 12, lineHeight: 20 }}
              >
                {updateInfo.releaseNotes ||
                  'A new build is available with official app enhancements.'}
              </Text>

              {/* Data Preservation Assurance */}
              <View
                style={[
                  styles.infoBox,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.border,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} style={{ marginRight: 6 }} />
                <Caption color="muted" style={{ flex: 1 }}>
                  Your login session, notes, and offline routine will not be lost.
                </Caption>
              </View>

              {/* Action Buttons */}
              <View style={styles.actionRow}>
                {!updateInfo.forceUpdate && (
                  <TouchableOpacity
                    onPress={() => setVisible(false)}
                    style={[
                      styles.button,
                      styles.buttonSecondary,
                      {
                        borderColor: colors.border,
                        borderRadius: radii.md,
                      },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Text variant="sm" weight="600" color="muted">
                      Later
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={handleUpdate}
                  style={[
                    styles.button,
                    styles.buttonPrimary,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: radii.md,
                    },
                  ]}
                  activeOpacity={0.8}
                >
                  <Ionicons name="cloud-download-outline" size={16} color="#000000" style={{ marginRight: 6 }} />
                  <Text variant="sm" weight="700" style={{ color: '#000000' }}>
                    Update Now
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  iconWrapper: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 4,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    width: '100%',
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  button: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: {
    borderWidth: 1,
  },
  buttonPrimary: {},
  otaContainer: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 99999,
    alignItems: 'center',
  },
  otaCard: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  otaReloadBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
