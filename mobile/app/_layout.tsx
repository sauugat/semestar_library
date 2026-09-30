import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';
import {
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, asyncStoragePersister } from '@/services/query-client';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { AppUpdateChecker } from '@/components/AppUpdateChecker';
import * as Notifications from 'expo-notifications';
import {
  configureNotificationChannels,
  navigateFromNotification,
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
      <AuthProvider>
        <RootLayoutNav />
        <AppUpdateChecker />
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}

function RootLayoutNav() {
  const { colors } = useTheme();
  const { token, isLoading } = useAuth();

  // Configure Android notification channels and setup notification listeners
  useEffect(() => {
    void configureNotificationChannels();

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
      navigateFromNotification(data, Boolean(token), identifier);
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [token]);

  // Handle cold-start notification tap when the app starts from terminated state
  useEffect(() => {
    if (isLoading) return; // Wait until auth restoration is resolved

    let isMounted = true;
    void (async () => {
      try {
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
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notices" options={{ title: 'Notices', headerBackTitle: 'Back' }} />
      <Stack.Screen name="routine" options={{ title: 'Class Routine', headerBackTitle: 'Back' }} />
      <Stack.Screen name="forum" options={{ title: 'Campus Forum', headerBackTitle: 'Back' }} />
      <Stack.Screen name="material/[id]" options={{ title: 'Material Details', headerBackTitle: 'Back' }} />
      <Stack.Screen name="user/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
