import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { requireOptionalNativeModule } from 'expo';
import 'react-native-reanimated';
import {
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, asyncStoragePersister } from '@/services/query-client';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useTheme, ThemeProvider } from '@/constants/useTheme';
import { AppUpdateChecker } from '@/components/AppUpdateChecker';
import * as Notifications from 'expo-notifications';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  configureNotificationChannels,
  navigateFromNotification,
  syncAppBadge,
  getPendingNotification,
  setPendingNotification,
  executePendingNotificationNavigation,
  parseNotificationData,
} from '@/services/notifications';

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: asyncStoragePersister, maxAge: 1000 * 60 * 60 * 24 }}
    >
      <ThemeProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <AuthProvider>
            <RootLayoutNav />
            <AppUpdateChecker />
          </AuthProvider>
        </KeyboardProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}

function RootLayoutNav() {
  const { colors } = useTheme();
  const { token, isLoading } = useAuth();

  // 1. Initial channel setup, developer overlay suppression, and pre-emptive cold-start notification lock
  useEffect(() => {
    void configureNotificationChannels();

    // Pre-emptively inspect cold-start notification to lock navigation before splash timer
    void (async () => {
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        if (response?.notification) {
          const data = response.notification.request.content.data;
          const payload = parseNotificationData(data);
          if (payload) {
            setPendingNotification(payload);
          }
        }
      } catch {}
    })();
  }, []);

  // 2. Notification response listeners
  useEffect(() => {
    if (token) void syncAppBadge();

    // Foreground notification listener
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      if (__DEV__) {
        console.log('[Push] notification received in foreground:', notification.request.content.title);
      }
    });

    // Background & foreground notification tap response listener
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      const identifier = response.notification.request.identifier;
      if (__DEV__) {
        console.log('[Push] Notification tapped from system tray:', identifier);
      }
      if (isLoading) {
        // Auth session restore is still loading: queue destination to prevent false unauth redirect
        const payload = parseNotificationData(data);
        if (payload) {
          setPendingNotification(payload);
        }
      } else {
        navigateFromNotification(data, Boolean(token), identifier);
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [token, isLoading]);

  // 3. Dispatch pending or cold-start notification once auth session restoration resolves
  useEffect(() => {
    if (isLoading) return; // Wait until auth restoration is resolved

    let isMounted = true;
    void (async () => {
      try {
        // Check if a notification response was queued during initial mount / auth loading
        const pending = getPendingNotification();
        if (pending) {
          if (isMounted) {
            executePendingNotificationNavigation(Boolean(token));
            await Notifications.clearLastNotificationResponseAsync().catch(() => {});
          }
          return;
        }

        // Check native cold-start notification response
        const response = await Notifications.getLastNotificationResponseAsync();
        if (isMounted && response?.notification) {
          const data = response.notification.request.content.data;
          const identifier = response.notification.request.identifier;
          if (__DEV__) {
            console.log('[Push] Cold-start notification response detected:', identifier);
          }
          navigateFromNotification(data, Boolean(token), identifier);
          await Notifications.clearLastNotificationResponseAsync().catch(() => {});
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[Push] Error checking cold-start notification:', err);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isLoading, token]);

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: '700',
        },
        headerShadowVisible: false,
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="teacher-onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notices" options={{ title: 'Official Notices', headerBackTitle: 'Back' }} />
      <Stack.Screen name="notice/[id]" options={{ title: 'Notice Details', headerBackTitle: 'Notices' }} />
      <Stack.Screen name="post/[id]" options={{ title: 'Post', headerBackTitle: 'Back' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings', headerBackTitle: 'Profile' }} />
      <Stack.Screen name="admin/teachers" options={{ title: 'Teacher Management', headerBackTitle: 'Admin' }} />
      <Stack.Screen name="user/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="routine" options={{ title: 'Class Routine', headerBackTitle: 'Back' }} />
      <Stack.Screen name="material/[id]" options={{ title: 'Material Details', headerBackTitle: 'Back' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
      <Stack.Screen name="notification-settings" options={{ title: 'Notification Settings', headerBackTitle: 'Notifications' }} />
      <Stack.Screen
        name="edit-profile"
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="modal"
        options={{
          presentation: 'modal',
          title: 'About Semester Library',
          headerBackTitle: 'Close',
        }}
      />
    </Stack>
  );
}
