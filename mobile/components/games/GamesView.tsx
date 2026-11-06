import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
} from 'react-native';
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
}

export function GamesView() {
  const insets = useSafeAreaInsets();

  const upcomingFeatures = [
    {
      id: 'multiplayer',
      title: 'Multiplayer Cohort Matches',
      description: 'Compete in head-to-head card and board games with your classmates in real time.',
      icon: 'people-outline' as const,
    },
    {
      id: 'offline',
      title: 'Offline Pass-and-Play',
      description: 'Quick casual games playable on a single device between lectures without internet.',
      icon: 'phone-portrait-outline' as const,
    },
    {
      id: 'tournaments',
      title: 'Campus Tournaments & Ranks',
      description: 'Participate in semester-wide challenges and earn bragging rights for your department.',
      icon: 'trophy-outline' as const,
    },
    {
      id: 'trivia',
      title: 'Subject & Academic Trivia',
      description: 'Timed quiz showdowns designed specifically for your semester courses and syllabus.',
      icon: 'bulb-outline' as const,
    },
  ];

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

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 100, 120) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Main Hero Card with Coming Soon Badge */}
        <View style={styles.heroCard}>
          <View style={styles.badgeRow}>
            <View style={styles.comingSoonBadge}>
              <Ionicons name="sparkles" size={13} color="#FFFFFF" style={styles.badgeIcon} />
              <Text style={styles.comingSoonBadgeText}>COMING SOON</Text>
            </View>
          </View>

          <View style={styles.iconCircle}>
            <Ionicons name="game-controller" size={44} color="#FFFFFF" />
          </View>

          <Text style={styles.heroTitle}>Games Arena Coming Soon</Text>

          <Text style={styles.heroSubtitle}>
            {"We're building an exciting gaming and challenge hub for Gandaki University students. Multiplayer matches, offline pass-and-play, and campus leaderboards are currently in development."}
          </Text>

          <View style={styles.heroDivider} />

          <View style={styles.stayTunedRow}>
            <Ionicons name="time-outline" size={15} color="#A1A1A1" />
            <Text style={styles.stayTunedText}>
              Keep your app updated. Games will launch in an upcoming release!
            </Text>
          </View>
        </View>

        {/* Sneak Peek Features Section */}
        <Text style={styles.sectionHeader}>What to Expect</Text>

        <View style={styles.featuresList}>
          {upcomingFeatures.map((feat) => (
            <View key={feat.id} style={styles.featureCard}>
              <View style={styles.featureIconBox}>
                <Ionicons name={feat.icon} size={20} color="#FFFFFF" />
              </View>
              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>{feat.title}</Text>
                <Text style={styles.featureDesc}>{feat.description}</Text>
              </View>
            </View>
          ))}
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
  scrollContent: {
    padding: 16,
  },
  heroCard: {
    backgroundColor: '#141414',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#282828',
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  badgeRow: {
    marginBottom: 16,
  },
  comingSoonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#262626',
    borderWidth: 1,
    borderColor: '#404040',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeIcon: {
    marginRight: 6,
  },
  comingSoonBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#A1A1A1',
    textAlign: 'center',
    maxWidth: 320,
  },
  heroDivider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#282828',
    marginVertical: 18,
  },
  stayTunedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  stayTunedText: {
    flex: 1,
    fontSize: 12,
    color: '#737373',
    lineHeight: 16,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#A1A1A1',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginLeft: 4,
  },
  featuresList: {
    gap: 12,
  },
  featureCard: {
    flexDirection: 'row',
    backgroundColor: '#141414',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#262626',
    padding: 16,
    alignItems: 'flex-start',
    gap: 14,
  },
  featureIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#303030',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: 13,
    lineHeight: 18,
    color: '#8E8E8E',
  },
});
