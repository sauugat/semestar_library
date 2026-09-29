import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';

export default function Index() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const { colors } = useTheme();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    // Smooth entrance animation for brand logo and text
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse animation for bottom loading track
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    // Show brand intro cleanly for a brief moment
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 750);

    return () => {
      clearTimeout(timer);
      pulseLoop.stop();
    };
  }, []);

  useEffect(() => {
    if (!isLoading && minTimeElapsed) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        if (token) {
          router.replace('/(tabs)');
        } else {
          router.replace('/login');
        }
      });
    }
  }, [isLoading, minTimeElapsed, token, router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Official App Logo */}
        <View
          style={[
            styles.logoContainer,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.borderStrong,
            },
          ]}
        >
          <Image
            source={require('@/assets/images/app-logo.jpg')}
            style={styles.logoImage}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        </View>

        {/* Brand Name */}
        <Text
          style={[
            styles.appName,
            { color: colors.text },
          ]}
        >
          Semester Library
        </Text>

        {/* University Subtitle */}
        <Text
          variant="sm"
          color="muted"
          style={styles.tagline}
        >
          Gandaki University Academic Portal
        </Text>

        {/* Minimal Progress Indicator */}
        <View style={[styles.progressTrack, { backgroundColor: colors.surfaceSubtle }]}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                backgroundColor: colors.primary,
                opacity: pulseAnim,
              },
            ]}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    width: 96,
    height: 96,
    borderRadius: 26,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
    marginBottom: 20,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  appName: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 6,
  },
  tagline: {
    letterSpacing: 0.2,
    textAlign: 'center',
    marginBottom: 36,
  },
  progressTrack: {
    width: 140,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
  },
});
