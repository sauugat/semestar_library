import React, { useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Typography';

export interface GameDirectoryItem {
  id: string;
  title: string;
  category: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  status: 'playable' | 'coming_soon';
  modes?: {
    id: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    action: string;
    disabled?: boolean;
    badge?: string;
  }[];
}

export function GamesView() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleGoHome = useCallback(() => {
    try {
      router.replace('/(tabs)' as any);
    } catch {
      router.navigate('/(tabs)' as any);
    }
  }, [router]);

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

      {/* Main Notice Body */}
      <ScrollView
        contentContainerStyle={[
          styles.contentContainer,
          {
            paddingBottom: Math.max(insets.bottom + 100, 120),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.noticeCard}>
          {/* Glowing Icon Wrapper */}
          <View style={styles.iconCircle}>
            <Ionicons name="game-controller" size={38} color="#FFFFFF" />
            <View style={styles.iconPillBadge}>
              <Ionicons name="construct" size={12} color="#F59E0B" />
            </View>
          </View>

          {/* Notice Status Pill */}
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusPillText}>UNDER DEVELOPMENT</Text>
          </View>

          {/* Main Notice Title */}
          <Text style={styles.noticeTitle}>Games Are under development</Text>

          {/* Notice Description */}
          <Text style={styles.noticeDescription}>
            Games are currently under development. Stay tuned for exciting multiplayer games with your classmates!
          </Text>

          {/* OK Button to redirect to Homepage */}
          <TouchableOpacity
            style={styles.okButton}
            onPress={handleGoHome}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="OK, go to homepage"
            testID="games-notice-ok-btn"
          >
            <Text style={styles.okButtonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  contentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  noticeCard: {
    backgroundColor: '#141414',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#282828',
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 380,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  iconPillBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#262626',
    borderWidth: 1.5,
    borderColor: '#383838',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 16,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F59E0B',
    letterSpacing: 0.8,
  },
  noticeTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 12,
    lineHeight: 28,
  },
  noticeDescription: {
    fontSize: 14,
    color: '#A1A1A1',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  okButton: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  okButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
    letterSpacing: 0.2,
  },
});
