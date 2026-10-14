import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Platform,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import { getBaseUrl } from '@/services/api';

/**
 * Code Lab Assignment In-App WebView Screen
 * Opens the Code Lab assignment page in an in-app WebView,
 * with a fallback to the system browser if the student session
 * does not carry over or if the page fails to load.
 */
export default function AssignmentWebViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const webViewRef = useRef<WebView>(null);

  const [assignmentUrl, setAssignmentUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const base = await getBaseUrl();
        const cleanBase = (base || '').replace(/\/+$/, '');
        const target = `${cleanBase}/code-lab/assignment.html?id=${encodeURIComponent(id || '')}`;
        if (isMounted) {
          setAssignmentUrl(target);
        }
      } catch (err) {
        console.warn('[AssignmentWebView] Failed to resolve base URL:', err);
        if (isMounted) {
          setAssignmentUrl(`https://semestar-library.vercel.app/code-lab/assignment.html?id=${encodeURIComponent(id || '')}`);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [id]);

  const handleOpenInSystemBrowser = useCallback(async () => {
    if (assignmentUrl) {
      try {
        await Linking.openURL(assignmentUrl);
      } catch (e) {
        console.warn('[AssignmentWebView] Linking error:', e);
      }
    }
  }, [assignmentUrl]);

  const handleShare = useCallback(async () => {
    if (assignmentUrl) {
      try {
        await Share.share({
          url: assignmentUrl,
          message: `Code Lab Assignment #${id}: ${assignmentUrl}`,
          title: `Assignment #${id}`,
        });
      } catch (_) {}
    }
  }, [assignmentUrl, id]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Navigation Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.titleContainer}>
          <Text variant="sm" weight="700" numberOfLines={1}>
            Code Lab Assignment #{id}
          </Text>
          <Text variant="xs" color="secondary" numberOfLines={1}>
            Interactive Workspace
          </Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Share assignment"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="share-outline" size={20} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleOpenInSystemBrowser}
            accessibilityRole="button"
            accessibilityLabel="Open in system browser"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="open-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main WebView Content */}
      <View style={styles.webviewWrapper}>
        {assignmentUrl ? (
          <WebView
            ref={webViewRef}
            source={{ uri: assignmentUrl }}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={true}
            scalesPageToFit={true}
            renderLoading={() => (
              <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.text} />
                <Text variant="sm" color="secondary" style={styles.loadingText}>
                  Loading assignment workspace…
                </Text>
              </View>
            )}
            onLoadStart={() => setIsLoading(true)}
            onLoadEnd={() => setIsLoading(false)}
            onError={(syntheticEvent) => {
              const { nativeEvent } = syntheticEvent;
              console.warn('[AssignmentWebView] Load error:', nativeEvent);
              setHasError(true);
              setIsLoading(false);
            }}
          />
        ) : (
          <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        )}

        {/* Error Fallback Banner */}
        {hasError && (
          <View style={[styles.errorBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.text} />
            <Text variant="sm" style={styles.errorText}>
              Could not display the assignment directly inside the app.
            </Text>
            <TouchableOpacity
              style={[styles.fallbackBtn, { backgroundColor: colors.text }]}
              onPress={handleOpenInSystemBrowser}
            >
              <Text variant="xs" weight="700" style={{ color: colors.background }}>
                Open in System Browser
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  titleContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  webviewWrapper: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
  },
  errorBanner: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  errorText: {
    textAlign: 'center',
    marginVertical: 8,
  },
  fallbackBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 4,
  },
});
