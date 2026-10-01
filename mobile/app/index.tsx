import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import {
  isNotificationNavigating,
  hasNotificationNavigationCompleted,
} from '@/services/notifications';

export default function Index() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const { colors } = useTheme();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    // Smooth entrance animation for brand logo and wordmark
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

    // Pulse animation for loading track
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

    // Brief splash display before transition
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 750);

    return () => {
      clearTimeout(timer);
      pulseLoop.stop();
    };
  }, []);

  useEffect(() => {
    // If a notification has claimed navigation or completed navigation,
    // SUPPRESS the default redirect to Home or Login completely!
    if (isNotificationNavigating() || hasNotificationNavigationCompleted()) {
      return;
    }

    if (!isLoading && minTimeElapsed) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        // Double check again after fade animation completes
        if (isNotificationNavigating() || hasNotificationNavigationCompleted()) {
          return;
        }
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

        {/* Semester Library Wordmark in Dashboard Header Font */}
        <Text
          style={[
            styles.appName,
            { color: colors.text },
          ]}
        >
          Semester Library
        </Text>

        {/* Loading Progress Bar Only */}
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
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    width: 86,
    height: 86,
    borderRadius: 22,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  appName: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 25,
    letterSpacing: -0.6,
    textAlign: 'center',
    marginBottom: 26,
  },
  progressTrack: {
    width: 110,
    height: 3.5,
    borderRadius: 2,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  progressBar: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
  },
});
