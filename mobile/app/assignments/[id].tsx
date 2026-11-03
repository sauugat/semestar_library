import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { apiFetch, getBaseUrl, getAuthToken } from '@/services/api';

interface AssignmentQuestion {
  id: number;
  assignmentId: number;
  questionNumber: number;
  title: string;
  description?: string;
  language?: string;
  maxPoints?: number;
}

interface AssignmentDetail {
  id: number;
  title: string;
  description?: string;
  teacherName?: string;
  createdBy?: string;
  subject?: string;
  semester?: string;
  language?: string;
  pdfUrl?: string | null;
  pdfName?: string | null;
  createdAt: string;
  deadline?: string | null;
  questions?: AssignmentQuestion[];
}

function isBoilerplatePdfDescription(desc?: string | null): boolean {
  if (!desc) return true;
  const clean = desc.trim().toLowerCase();
  return (
    clean === '' ||
    clean === 'refer to attached assignment pdf for problem statement' ||
    clean === 'refer to attached assignment pdf for problem statement.' ||
    clean === 'question solution from attached pdf'
  );
}

const WEBVIEW_GESTURE_BRIDGE_JS = `
(function() {
  if (window.__slAssignGestureBridge) return;
  window.__slAssignGestureBridge = true;
  var lastY = window.scrollY || document.documentElement.scrollTop || 0;
  var touchStartX = 0;
  var touchStartY = 0;
  var touchStartTime = 0;
  var wasMultiTouch = false;
  var didMove = false;

  function sendMsg(msg) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(msg);
      }
    } catch (e) {}
  }

  window.addEventListener('scroll', function() {
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    if (y > lastY + 6) {
      sendMsg('HIDE_CHROME');
    }
    lastY = y;
  }, { passive: true });

  document.addEventListener('touchstart', function(e) {
    if (e.touches && e.touches.length >= 2) {
      wasMultiTouch = true;
      sendMsg('HIDE_CHROME');
    } else if (e.touches && e.touches.length === 1) {
      wasMultiTouch = false;
      didMove = false;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (e.touches && e.touches.length >= 2) {
      wasMultiTouch = true;
      sendMsg('HIDE_CHROME');
      return;
    }
    if (e.touches && e.touches.length === 1) {
      var dx = e.touches[0].clientX - touchStartX;
      var dy = e.touches[0].clientY - touchStartY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        didMove = true;
      }
      if (dy < -14) {
        sendMsg('HIDE_CHROME');
      }
    }
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!wasMultiTouch && !didMove && (Date.now() - touchStartTime) < 280) {
      sendMsg('TOGGLE_CHROME');
    }
  }, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function() {
      if (window.visualViewport.scale > 1.05) {
        sendMsg('HIDE_CHROME');
      }
    });
  }
})();
true;
`;

function getPdfViewerHtml(
  base64Data: string,
  isDark: boolean,
  topOffset: number,
  bottomOffset: number
): string {
  const bgColor = isDark ? '#121214' : '#F3F4F6';
  const textColor = isDark ? '#F4F4F5' : '#18181B';
  const subtextColor = isDark ? '#A1A1AA' : '#71717A';
  const pillBg = isDark ? 'rgba(24, 24, 27, 0.94)' : 'rgba(255, 255, 255, 0.94)';
  const pillBorder = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.1)';
  const pageBorder = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
  const pageShadow = isDark ? '0 10px 32px rgba(0, 0, 0, 0.65)' : '0 6px 24px rgba(0, 0, 0, 0.12)';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, minimum-scale=1.0, user-scalable=yes">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      background-color: ${bgColor};
      color: ${textColor};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-x pan-y pinch-zoom;
    }
    #stage {
      min-height: 100vh;
      width: 100%;
      display: flex;
      flex-direction: column;
      padding: ${topOffset}px 14px ${bottomOffset}px 14px;
    }
    #status {
      margin: auto;
      padding: 40px 20px;
      text-align: center;
      font-size: 13px;
      color: ${subtextColor};
    }
    #container {
      width: 100%;
      max-width: 720px;
      margin: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }
    .pdf-page-sheet {
      width: 100%;
      background: #FFFFFF;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid ${pageBorder};
      box-shadow: ${pageShadow};
    }
    canvas {
      display: block;
      width: 100% !important;
      height: auto !important;
      background: #FFFFFF;
    }
    #page-pill {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: ${pillBg};
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      color: ${textColor};
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      border: 1px solid ${pillBorder};
      z-index: 99;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    }
  </style>
</head>
<body>
  <div id="stage">
    <div id="status">Loading assignment PDF…</div>
    <div id="container" style="display:none;"></div>
  </div>
  <div id="page-pill" style="display:none;"></div>
  <script>
    ${WEBVIEW_GESTURE_BRIDGE_JS}
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    try {
      const raw = atob("${base64Data}");
      const uint8 = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) uint8[i] = raw.charCodeAt(i);
      pdfjsLib.getDocument({ data: uint8 }).promise.then(async function(pdf) {
        document.getElementById('status').style.display = 'none';
        const container = document.getElementById('container');
        container.style.display = 'flex';
        const pill = document.getElementById('page-pill');
        pill.style.display = 'block';
        const total = pdf.numPages;
        const updatePill = function(current) {
          pill.innerText = total === 1 ? '1 / 1' : ('Page ' + current + ' of ' + total);
        };
        updatePill(1);

        const dpr = Math.min(window.devicePixelRatio || 2, 2.5);
        const pageEls = [];
        for (let num = 1; num <= total; num++) {
          const page = await pdf.getPage(num);
          const viewport = page.getViewport({ scale: dpr });
          const sheet = document.createElement('div');
          sheet.className = 'pdf-page-sheet';
          sheet.setAttribute('data-page', String(num));
          const canvas = document.createElement('canvas');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          sheet.appendChild(canvas);
          container.appendChild(sheet);
          pageEls.push(sheet);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }

        if (total > 1) {
          window.addEventListener('scroll', function() {
            const mid = window.innerHeight * 0.45;
            let activePage = 1;
            for (let i = 0; i < pageEls.length; i++) {
              const rect = pageEls[i].getBoundingClientRect();
              if (rect.top <= mid) {
                activePage = i + 1;
              }
            }
            updatePill(activePage);
          }, { passive: true });
        }
      }).catch(function() {
        document.getElementById('status').innerText = 'Unable to render PDF preview.';
      });
    } catch (e) {
      document.getElementById('status').innerText = 'Unable to decode PDF document.';
    }
  </script>
</body>
</html>`;
}

export default function AssignmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const numericId = Number(id);

  // Unlock orientation while viewing assignment, lock back to portrait on exit
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // Fetch Assignment Details
  const {
    data: assignment,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery<AssignmentDetail>({
    queryKey: ['assignment-detail', numericId],
    queryFn: async () => {
      const res = await apiFetch(`/api/code-lab/assignments/${numericId}`);
      if (res.ok) {
        return (await res.json()) as AssignmentDetail;
      }
      const listRes = await apiFetch('/api/code-lab/assignments');
      if (listRes.ok) {
        const list = (await listRes.json()) as AssignmentDetail[];
        const found = list.find((a) => Number(a.id) === numericId);
        if (found) return found;
      }
      throw new Error('Could not load assignment.');
    },
    enabled: Boolean(numericId && !isNaN(numericId)),
    staleTime: 60 * 1000,
  });

  // PDF Download & Preview state
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [localPdfUri, setLocalPdfUri] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);

  const downloadAssignmentPdf = useCallback(async (): Promise<string | null> => {
    if (!assignment?.pdfUrl) return null;
    if (localPdfUri && pdfBase64) return localPdfUri;

    setDownloadingPdf(true);
    setDownloadProgress(0);
    try {
      const [resolvedBase, token] = await Promise.all([getBaseUrl(), getAuthToken()]);
      const cleanBase = (resolvedBase || '').replace(/\/+$/, '');
      const pdfUrl = assignment.pdfUrl.startsWith('http')
        ? assignment.pdfUrl
        : `${cleanBase}${assignment.pdfUrl.startsWith('/') ? '' : '/'}${assignment.pdfUrl}`;
      const safeName = (assignment.pdfName || `assignment_${assignment.id}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const destUri = `${FileSystem.documentDirectory}assign_${assignment.id}_${safeName}`;

      const existing = await FileSystem.getInfoAsync(destUri);
      if (existing.exists && existing.size && existing.size > 100) {
        setLocalPdfUri(existing.uri);
        const b64 = await FileSystem.readAsStringAsync(existing.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setPdfBase64(b64);
        return existing.uri;
      }

      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const resumable = FileSystem.createDownloadResumable(
        pdfUrl,
        destUri,
        { headers },
        (prog) => {
          if (prog.totalBytesExpectedToWrite > 0) {
            setDownloadProgress(
              Math.min(100, Math.round((prog.totalBytesWritten / prog.totalBytesExpectedToWrite) * 100))
            );
          }
        }
      );

      const res = await resumable.downloadAsync();
      if (!res || res.status !== 200) {
        if (res?.uri) await FileSystem.deleteAsync(res.uri, { idempotent: true });
        throw new Error(`Failed to download PDF (HTTP ${res?.status || 'error'})`);
      }

      setLocalPdfUri(res.uri);
      setDownloadProgress(100);
      const b64 = await FileSystem.readAsStringAsync(res.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      setPdfBase64(b64);
      return res.uri;
    } catch (err: any) {
      console.warn('[AssignmentDetail] PDF download error:', err?.message);
      return null;
    } finally {
      setDownloadingPdf(false);
    }
  }, [assignment?.pdfUrl, assignment?.pdfName, assignment?.id, localPdfUri, pdfBase64]);

  useEffect(() => {
    if (assignment?.pdfUrl) {
      void downloadAssignmentPdf();
    }
  }, [assignment?.pdfUrl, downloadAssignmentPdf]);

  const handleSharePdf = async () => {
    const uri = localPdfUri || (await downloadAssignmentPdf());
    if (!uri) {
      Alert.alert('Download Error', 'Could not download the assignment PDF.');
      return;
    }
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: assignment?.pdfName || assignment?.title || 'Assignment PDF',
          UTI: 'com.adobe.pdf',
        });
      }
    } catch (err: any) {
      Alert.alert('Share Error', err?.message || 'Could not share PDF.');
    }
  };

  const hasPdf = Boolean(assignment?.pdfUrl);

  // ─────────────────────────────────────────────────────────────
  // AUTO-HIDE HEADER STATE (Hides after 3s, or on scroll down, zoom, or rotate)
  // ─────────────────────────────────────────────────────────────
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeVisibleRef = useRef(true);
  const chromeAnim = useRef(new Animated.Value(1)).current;
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLandscapeRef = useRef(isLandscape);

  const clearAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }, []);

  const hideChrome = useCallback(() => {
    clearAutoHideTimer();
    if (!chromeVisibleRef.current) return;
    chromeVisibleRef.current = false;
    Animated.timing(chromeAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setChromeVisible(false);
    });
  }, [chromeAnim, clearAutoHideTimer]);

  const scheduleAutoHide = useCallback(() => {
    clearAutoHideTimer();
    autoHideTimerRef.current = setTimeout(() => {
      hideChrome();
    }, 3000);
  }, [clearAutoHideTimer, hideChrome]);

  const showChrome = useCallback(() => {
    chromeVisibleRef.current = true;
    setChromeVisible(true);
    Animated.timing(chromeAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    scheduleAutoHide();
  }, [chromeAnim, scheduleAutoHide]);

  const toggleChrome = useCallback(() => {
    if (chromeVisibleRef.current) {
      hideChrome();
    } else {
      showChrome();
    }
  }, [hideChrome, showChrome]);

  useEffect(() => {
    if (!isLoading && assignment && (!hasPdf || pdfBase64)) {
      scheduleAutoHide();
    }
    return () => clearAutoHideTimer();
  }, [isLoading, assignment, hasPdf, pdfBase64, scheduleAutoHide, clearAutoHideTimer]);

  useEffect(() => {
    if (prevLandscapeRef.current !== isLandscape) {
      prevLandscapeRef.current = isLandscape;
      hideChrome();
    }
  }, [isLandscape, hideChrome]);

  const handleToggleOrientation = async () => {
    try {
      hideChrome();
      if (isLandscape) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      }
      setTimeout(() => {
        ScreenOrientation.unlockAsync().catch(() => {});
      }, 500);
    } catch {}
  };

  const handleWebViewMessage = useCallback(
    (event: any) => {
      const msg = event?.nativeEvent?.data;
      if (msg === 'HIDE_CHROME') {
        hideChrome();
      } else if (msg === 'TOGGLE_CHROME') {
        toggleChrome();
      }
    },
    [hideChrome, toggleChrome]
  );

  const lastScrollY = useRef(0);
  const handleQuestionsScroll = useCallback(
    (e: any) => {
      const y = e?.nativeEvent?.contentOffset?.y ?? 0;
      if (y > lastScrollY.current + 8) {
        hideChrome();
      }
      lastScrollY.current = y;
    },
    [hideChrome]
  );

  const writtenQuestions = useMemo<AssignmentQuestion[]>(() => {
    const raw = assignment?.questions || [];
    if (!hasPdf) return raw;
    return raw.filter((q) => {
      const isDefaultTitle = !q.title || q.title.trim().toLowerCase() === 'question 1';
      return !(isDefaultTitle && isBoilerplatePdfDescription(q.description));
    });
  }, [assignment?.questions, hasPdf]);

  const topPad = Math.max(insets.top, isLandscape ? 12 : Platform.OS === 'ios' ? 44 : 24);
  const defaultHeaderClearance = topPad + 64;
  const headerTranslateY = chromeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-(topPad + 64), 0],
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Status Bar Scrim so PDF content never collides with iOS status bar icons */}
      {!isLandscape && insets.top > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: insets.top,
            backgroundColor: isDark ? 'rgba(18, 18, 20, 0.88)' : 'rgba(243, 244, 246, 0.88)',
            zIndex: 25,
          }}
        />
      )}

      {/* Single Floating Auto-Hiding Header (Hides after 3s, or on scroll down, zoom, or rotate) */}
      <Animated.View
        pointerEvents={chromeVisible ? 'auto' : 'none'}
        style={[
          styles.header,
          {
            paddingTop: topPad,
            backgroundColor: isDark ? 'rgba(10, 10, 10, 0.94)' : 'rgba(255, 255, 255, 0.94)',
            borderBottomColor: colors.border,
            opacity: chromeAnim,
            transform: [{ translateY: headerTranslateY }],
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
          onPress={() => {
            clearAutoHideTimer();
            ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
            router.back();
          }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text variant="sm" weight="700" numberOfLines={1}>
            {assignment?.title || `Assignment #${id}`}
          </Text>
          {Boolean(assignment?.subject) && (
            <Caption color="muted" numberOfLines={1}>
              {assignment?.subject}
            </Caption>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
            onPress={() => void handleToggleOrientation()}
            accessibilityRole="button"
            accessibilityLabel="Rotate screen"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={isLandscape ? 'phone-portrait-outline' : 'phone-landscape-outline'}
              size={18}
              color={colors.text}
            />
          </TouchableOpacity>

          {hasPdf && (
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
              onPress={() => void handleSharePdf()}
              accessibilityRole="button"
              accessibilityLabel="Download or share PDF"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="download-outline" size={18} color={colors.text} />
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.text} />
          <Text variant="sm" color="secondary" style={{ marginTop: 12 }}>
            Loading assignment…
          </Text>
        </View>
      ) : queryError || !assignment ? (
        <View style={[styles.centerContainer, { paddingHorizontal: 24 }]}>
          <Ionicons name="alert-circle-outline" size={44} color={colors.textMuted} style={{ marginBottom: 12 }} />
          <Heading style={{ textAlign: 'center', marginBottom: 6 }}>Unable to Load Assignment</Heading>
          <Text variant="sm" color="secondary" style={{ textAlign: 'center', marginBottom: 18 }}>
            {(queryError as any)?.message || 'This assignment could not be loaded right now.'}
          </Text>
          <Button title="Try Again" variant="primary" size="sm" onPress={() => void refetch()} />
        </View>
      ) : hasPdf ? (
        /* CASE 1: ASSIGNMENT HAS PDF -> SHOW PDF VIEWER DIRECTLY + LAPTOP/DESKTOP FOOTER */
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {pdfBase64 ? (
              <WebView
                originWhitelist={['*']}
                source={{
                  html: getPdfViewerHtml(pdfBase64, isDark, defaultHeaderClearance, 64),
                }}
                injectedJavaScript={WEBVIEW_GESTURE_BRIDGE_JS}
                onMessage={handleWebViewMessage}
                style={{ flex: 1, backgroundColor: isDark ? '#121214' : '#F3F4F6' }}
              />
            ) : (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.text} />
                <Text variant="sm" color="secondary" style={{ marginTop: 12 }}>
                  {downloadingPdf && downloadProgress !== null
                    ? `Loading PDF (${downloadProgress}%)…`
                    : 'Loading PDF document…'}
                </Text>
              </View>
            )}
          </View>

          <View
            style={[
              styles.bottomDesktopBar,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <Ionicons name="laptop-outline" size={17} color={colors.textSecondary} style={{ marginRight: 8 }} />
            <Text variant="xs" weight="600" color="secondary" style={{ flex: 1 }}>
              Do assignment in laptop/desktop
            </Text>
          </View>
        </View>
      ) : (
        /* CASE 2: WRITTEN QUESTIONS ONLY -> SHOW QUESTIONS ONLY + LAPTOP/DESKTOP NOTICE */
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.md,
            paddingTop: defaultHeaderClearance,
            paddingBottom: Math.max(insets.bottom, 20) + 24,
          }}
          showsVerticalScrollIndicator={false}
          onScroll={handleQuestionsScroll}
          scrollEventThrottle={16}
        >
          <TouchableOpacity activeOpacity={1} onPress={toggleChrome}>
            {writtenQuestions.length > 0 ? (
              writtenQuestions.map((q, idx) => (
                <Card
                  key={q.id || idx}
                  variant="elevated"
                  padding="md"
                  style={[styles.questionCard, { borderColor: colors.border }]}
                >
                  <View style={styles.questionHeaderRow}>
                    <View
                      style={[
                        styles.questionNumberPill,
                        { backgroundColor: '#27272A', borderRadius: radii.sm },
                      ]}
                    >
                      <Text variant="xs" weight="800" style={{ color: '#FFFFFF' }}>
                        Q{q.questionNumber || idx + 1}
                      </Text>
                    </View>
                    <Text variant="sm" weight="700" style={{ flex: 1, marginHorizontal: 10 }}>
                      {q.title || `Question ${q.questionNumber || idx + 1}`}
                    </Text>
                    {Boolean(q.maxPoints) && (
                      <Caption weight="700" color="secondary">
                        {q.maxPoints} pts
                      </Caption>
                    )}
                  </View>

                  {Boolean(q.description && !isBoilerplatePdfDescription(q.description)) && (
                    <View
                      style={[
                        styles.questionBodyBox,
                        {
                          backgroundColor: colors.surfaceRaised,
                          borderColor: colors.borderSubtle,
                          borderRadius: radii.md,
                        },
                      ]}
                    >
                      <Text variant="sm" style={{ lineHeight: 21, color: colors.text }}>
                        {q.description}
                      </Text>
                    </View>
                  )}
                </Card>
              ))
            ) : !isBoilerplatePdfDescription(assignment.description) ? (
              <Card
                variant="elevated"
                padding="md"
                style={[styles.questionCard, { borderColor: colors.border }]}
              >
                <Text variant="sm" style={{ lineHeight: 21, color: colors.text }}>
                  {assignment.description}
                </Text>
              </Card>
            ) : (
              <Card
                variant="elevated"
                padding="md"
                style={[styles.questionCard, { borderColor: colors.border }]}
              >
                <Text variant="sm" weight="700">
                  {assignment.title}
                </Text>
              </Card>
            )}

            {/* Laptop / Desktop Notice */}
            <View
              style={[
                styles.desktopBanner,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Ionicons name="laptop-outline" size={18} color={colors.textSecondary} style={{ marginRight: 10 }} />
              <Text variant="xs" weight="600" color="secondary" style={{ flex: 1, lineHeight: 18 }}>
                Do assignment in laptop/desktop
              </Text>
            </View>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 30,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionCard: {
    borderWidth: 1,
    marginBottom: 12,
  },
  questionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  questionNumberPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  questionBodyBox: {
    marginTop: 10,
    padding: 12,
    borderWidth: 1,
  },
  desktopBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  bottomDesktopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
