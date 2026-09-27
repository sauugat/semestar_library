import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Platform,
  useWindowDimensions,
  Alert,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { LibraryFile } from '@/services/library';
import { useTheme } from '@/constants/useTheme';

export interface FullScreenFilePreviewProps {
  visible: boolean;
  onClose: () => void;
  file: LibraryFile | null;
  localFileUri: string | null;
  onDownloadFile: () => Promise<string | null>;
  onShareFile: () => Promise<void>;
  downloading?: boolean;
  downloadProgress?: number | null;
  downloadStatusText?: string;
}

function formatBytes(bytes: number | string): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileCategory(filename: string): 'pdf' | 'image' | 'office' | 'other' {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.bmp')
  ) {
    return 'image';
  }
  if (
    lower.endsWith('.pptx') ||
    lower.endsWith('.ppt') ||
    lower.endsWith('.docx') ||
    lower.endsWith('.doc') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.html')
  ) {
    return 'office';
  }
  return 'other';
}

function getImageMime(filename: string): string {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

function getPdfJsHtml(base64Data: string, title: string, isDark: boolean = true): string {
  const bgColor = isDark ? '#0a0a0a' : '#fafafa';
  const textColor = isDark ? '#f5f5f5' : '#0a0a0a';
  const subtextColor = isDark ? '#b5b5b5' : '#737373';
  const spinnerBorder = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';
  const spinnerActive = isDark ? '#f5f5f5' : '#0a0a0a';
  const pillBg = isDark ? 'rgba(23, 23, 23, 0.92)' : 'rgba(255, 255, 255, 0.92)';
  const pillBorder = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
  const shadowOpacity = isDark ? '0.7' : '0.15';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, minimum-scale=1.0, user-scalable=yes">
  <title>${title || 'PDF Preview'}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      min-height: 100%;
      background-color: ${bgColor};
      color: ${textColor};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Plus Jakarta Sans", sans-serif;
      touch-action: pan-x pan-y pinch-zoom;
    }
    #status {
      padding: 60px 20px;
      text-align: center;
      font-size: 14px;
      color: ${subtextColor};
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid ${spinnerBorder};
      border-top-color: ${spinnerActive};
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 16px auto;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    #container {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 16px 12px 64px 12px;
    }
    canvas {
      width: 100% !important;
      max-width: 100%;
      height: auto !important;
      background: #FFFFFF;
      border-radius: 6px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, ${shadowOpacity});
      border: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'};
    }
    #page-pill {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: ${pillBg};
      backdrop-filter: blur(8px);
      color: ${textColor};
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid ${pillBorder};
      z-index: 99;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
  </style>
</head>
<body>
  <div id="status">
    <div class="spinner"></div>
    <div id="status-text">Loading document pages...</div>
  </div>
  <div id="container"></div>
  <div id="page-pill" style="display:none;"></div>
  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    try {
      const raw = atob("${base64Data}");
      const uint8 = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        uint8[i] = raw.charCodeAt(i);
      }
      pdfjsLib.getDocument({ data: uint8 }).promise.then(async function(pdf) {
        document.getElementById('status').style.display = 'none';
        const container = document.getElementById('container');
        const pagePill = document.getElementById('page-pill');
        pagePill.style.display = 'block';
        pagePill.innerText = pdf.numPages + ' page' + (pdf.numPages > 1 ? 's' : '');
        for (let num = 1; num <= pdf.numPages; num++) {
          const page = await pdf.getPage(num);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        }
      }).catch(function(err) {
        document.getElementById('status').innerHTML = '<div style="color:#EF4444; margin-top:20px;">Could not render PDF: ' + err.message + '</div>';
      });
    } catch(e) {
      document.getElementById('status').innerHTML = '<div style="color:#EF4444; margin-top:20px;">Unable to decode PDF: ' + e.message + '</div>';
    }
  </script>
</body>
</html>`;
}

function getImageHtml(base64Data: string, mime: string, title: string, isDark: boolean = true): string {
  const bgColor = isDark ? '#0a0a0a' : '#fafafa';
  const shadowOpacity = isDark ? '0.7' : '0.15';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, minimum-scale=1.0, user-scalable=yes">
  <title>${title || 'Image Preview'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background-color: ${bgColor};
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      touch-action: pan-x pan-y pinch-zoom;
    }
    .wrapper {
      min-width: 100%;
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
    }
    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      user-select: none;
      -webkit-user-select: none;
      box-shadow: 0 4px 28px rgba(0, 0, 0, ${shadowOpacity});
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <img src="data:${mime};base64,${base64Data}" alt="Note image" />
  </div>
</body>
</html>`;
}

export function FullScreenFilePreview({
  visible,
  onClose,
  file,
  localFileUri,
  onDownloadFile,
  onShareFile,
  downloading = false,
  downloadProgress = null,
  downloadStatusText = '',
}: FullScreenFilePreviewProps) {
  const { colors, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [preparing, setPreparing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [activeUri, setActiveUri] = useState<string | null>(localFileUri);

  // Sync activeUri with incoming localFileUri
  useEffect(() => {
    if (localFileUri) {
      setActiveUri(localFileUri);
    }
  }, [localFileUri]);

  // Requirement 2: Screen orientation unlock on enter, lock to portrait on exit/unmount
  useEffect(() => {
    if (visible) {
      ScreenOrientation.unlockAsync().catch((err) => {
        console.warn('Could not unlock screen orientation:', err);
      });
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [visible]);

  const fileCategory = useMemo(() => {
    return file ? getFileCategory(file.originalName) : 'other';
  }, [file]);

  // Prepare file for rendering (download if needed, extract base64 for Android PDF or Image)
  const preparePreview = useCallback(async () => {
    if (!file) return;
    setErrorMsg(null);
    setPreparing(true);

    try {
      let targetUri = activeUri || localFileUri;
      if (!targetUri) {
        targetUri = await onDownloadFile();
        if (!targetUri) {
          throw new Error('Could not download file from server.');
        }
        setActiveUri(targetUri);
      }

      const cat = getFileCategory(file.originalName);

      if (cat === 'pdf') {
        if (Platform.OS === 'android') {
          const b64 = await FileSystem.readAsStringAsync(targetUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          setPdfBase64(b64);
        }
      } else if (cat === 'image') {
        const b64 = await FileSystem.readAsStringAsync(targetUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setImageBase64(b64);
      }
    } catch (err: any) {
      console.error('Error preparing preview:', err);
      setErrorMsg(err.message || 'Could not load this file. Please check your connection and try again.');
    } finally {
      setPreparing(false);
    }
  }, [file, activeUri, localFileUri, onDownloadFile]);

  // Trigger preparePreview whenever visible becomes true or activeUri updates
  useEffect(() => {
    if (visible && file) {
      preparePreview();
    } else if (!visible) {
      setPdfBase64(null);
      setImageBase64(null);
      setErrorMsg(null);
    }
  }, [visible, file, preparePreview]);

  // Manual orientation toggle button (especially helpful if user has OS portrait lock on)
  const handleToggleOrientation = async () => {
    try {
      if (isLandscape) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      }
      // Re-unlock to allow sensor rotation after setting preferred orientation
      setTimeout(() => {
        ScreenOrientation.unlockAsync().catch(() => {});
      }, 500);
    } catch (e) {
      console.warn('Orientation toggle error:', e);
    }
  };

  const handleClose = () => {
    // Lock back to portrait immediately on close
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    onClose();
  };

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: Platform.OS === 'ios' ? 48 : 28,
      paddingBottom: 10,
      paddingHorizontal: 16,
      backgroundColor: isDark ? 'rgba(10, 10, 10, 0.96)' : 'rgba(255, 255, 255, 0.96)',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      zIndex: 10,
    },
    headerLandscape: {
      paddingTop: Platform.OS === 'ios' ? 20 : 16,
      paddingBottom: 8,
    },
    circleBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerInfo: {
      flex: 1,
      marginHorizontal: 12,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 15,
      fontFamily: 'PlusJakartaSans_700Bold',
    },
    headerSubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    viewerBody: {
      flex: 1,
      backgroundColor: colors.background,
    },
    webView: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centerBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    loadingText: {
      color: colors.text,
      fontSize: 15,
      fontFamily: 'PlusJakartaSans_700Bold',
      marginTop: 16,
      textAlign: 'center',
    },
    loadingSubtext: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 8,
      textAlign: 'center',
      maxWidth: 280,
    },
    progressTrack: {
      width: 220,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 14,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: 3,
    },
    errorBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    errorIconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.12)' : 'rgba(239, 68, 68, 0.08)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.18)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    errorTitle: {
      color: colors.text,
      fontSize: 18,
      fontFamily: 'PlusJakartaSans_700Bold',
      marginBottom: 8,
      textAlign: 'center',
    },
    errorMessage: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
      marginBottom: 24,
      maxWidth: 320,
    },
    errorActions: {
      flexDirection: 'column',
      gap: 12,
      width: '100%',
      maxWidth: 260,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 10,
    },
    primaryButtonText: {
      color: colors.primaryText,
      fontSize: 14,
      fontFamily: 'PlusJakartaSans_700Bold',
    },
    secondaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 14,
      fontFamily: 'PlusJakartaSans_700Bold',
    },
    docBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
    },
    docIconCircle: {
      width: 90,
      height: 90,
      borderRadius: 45,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    docTitle: {
      color: colors.text,
      fontSize: 18,
      fontFamily: 'PlusJakartaSans_700Bold',
      marginBottom: 6,
      textAlign: 'center',
    },
    docSubtitle: {
      color: colors.textSecondary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans_700Bold',
      marginBottom: 12,
    },
    docDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
      marginBottom: 24,
      maxWidth: 320,
    },
    hintPill: {
      position: 'absolute',
      bottom: 16,
      left: 16,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? 'rgba(23, 23, 23, 0.92)' : 'rgba(255, 255, 255, 0.92)',
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    hintPillText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '500',
    },
  }), [colors, isDark]);

  if (!visible) return null;

  const ext = (file?.originalName.split('.').pop() || 'FILE').toUpperCase();
  const isLoading = downloading || preparing;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={handleClose}
    >
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      <View style={styles.container}>
        {/* Floating Top Navigation Chrome */}
        <View style={[styles.header, isLandscape && styles.headerLandscape]}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.circleBtn}
            accessibilityLabel="Close file preview"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.headerInfo}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              {file?.title || file?.originalName || 'Note Preview'}
            </Text>
            <Text numberOfLines={1} style={styles.headerSubtitle}>
              {ext} • {formatBytes(file?.sizeBytes || 0)}
              {file?.semester ? ` • ${file.semester}` : ''}
            </Text>
          </View>

          <View style={styles.headerActions}>
            {/* Quick Rotate Button */}
            <TouchableOpacity
              onPress={handleToggleOrientation}
              style={styles.circleBtn}
              accessibilityLabel={isLandscape ? 'Rotate to portrait' : 'Rotate to landscape'}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={isLandscape ? 'phone-portrait-outline' : 'phone-landscape-outline'}
                size={20}
                color={colors.text}
              />
            </TouchableOpacity>

            {/* Share / Save Button */}
            <TouchableOpacity
              onPress={onShareFile}
              style={styles.circleBtn}
              accessibilityLabel="Share or save note"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="share-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content Viewer Body */}
        <View style={styles.viewerBody}>
          {/* 1. Loading State with Progress Bar (Requirement 5) */}
          {isLoading && (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>
                {downloadStatusText || (preparing ? 'Preparing high-res preview...' : 'Loading note...')}
              </Text>
              {downloadProgress !== null && downloadProgress > 0 && (
                <View style={styles.progressTrack}>
                  <View style={[styles.progressBar, { width: `${downloadProgress}%` }]} />
                </View>
              )}
              <Text style={styles.loadingSubtext}>
                Pinch-to-zoom and landscape rotation will be available once loaded
              </Text>
            </View>
          )}

          {/* 2. Error State with Retry Button (Requirement 5) */}
          {!isLoading && errorMsg && (
            <View style={styles.errorBox}>
              <View style={styles.errorIconCircle}>
                <Ionicons name="alert-circle-outline" size={48} color={isDark ? '#f87171' : '#dc2626'} />
              </View>
              <Text style={styles.errorTitle}>Couldn't load this file</Text>
              <Text style={styles.errorMessage}>{errorMsg}</Text>
              <View style={styles.errorActions}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={preparePreview}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh-outline" size={18} color={colors.primaryText} style={{ marginRight: 6 }} />
                  <Text style={styles.primaryButtonText}>Try Again</Text>
                </TouchableOpacity>

                {activeUri && (
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={onShareFile}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="share-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                    <Text style={styles.secondaryButtonText}>Open in External App</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* 3. PDF Viewer */}
          {!isLoading && !errorMsg && fileCategory === 'pdf' && activeUri && (
            <WebView
              source={
                Platform.OS === 'ios'
                  ? { uri: activeUri }
                  : { html: getPdfJsHtml(pdfBase64 || '', file?.title || '', isDark) }
              }
              originWhitelist={['*']}
              allowFileAccess={true}
              allowFileAccessFromFileURLs={true}
              allowUniversalAccessFromFileURLs={true}
              scalesPageToFit={true}
              nestedScrollEnabled={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={true}
              renderLoading={() => (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.loadingText}>Rendering PDF pages...</Text>
                </View>
              )}
              onError={(e) => {
                setErrorMsg('WebView error rendering PDF: ' + (e.nativeEvent.description || 'Unknown error'));
              }}
              style={styles.webView}
            />
          )}

          {/* 4. Image Viewer (PNG, JPG, WEBP, GIF, SVG) */}
          {!isLoading && !errorMsg && fileCategory === 'image' && (imageBase64 || activeUri) && (
            <WebView
              source={
                imageBase64
                  ? { html: getImageHtml(imageBase64, getImageMime(file?.originalName || ''), file?.title || '', isDark) }
                  : { uri: activeUri || '' }
              }
              originWhitelist={['*']}
              allowFileAccess={true}
              allowFileAccessFromFileURLs={true}
              allowUniversalAccessFromFileURLs={true}
              scalesPageToFit={true}
              nestedScrollEnabled={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={true}
              renderLoading={() => (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.loadingText}>Rendering image preview...</Text>
                </View>
              )}
              onError={(e) => {
                setErrorMsg('WebView error displaying image: ' + (e.nativeEvent.description || 'Unknown error'));
              }}
              style={styles.webView}
            />
          )}

          {/* 5. Office Documents / Other Formats */}
          {!isLoading && !errorMsg && fileCategory !== 'pdf' && fileCategory !== 'image' && (
            <View style={styles.docBox}>
              <View style={styles.docIconCircle}>
                <Ionicons name="document-text-outline" size={54} color={colors.text} />
              </View>
              <Text style={styles.docTitle}>{file?.title || file?.originalName}</Text>
              <Text style={styles.docSubtitle}>
                Format: {ext} • {formatBytes(file?.sizeBytes || 0)}
              </Text>
              <Text style={styles.docDescription}>
                This document can be opened and viewed with your preferred mobile app (Microsoft 365, Google Docs, Keynote, etc.).
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={onShareFile}
                activeOpacity={0.8}
              >
                <Ionicons name="open-outline" size={18} color={colors.primaryText} style={{ marginRight: 6 }} />
                <Text style={styles.primaryButtonText}>Open in Reader / Share</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Subtle Rotation / Zoom Hint Pill (Bottom-left) */}
        {!isLoading && !errorMsg && (
          <View style={styles.hintPill} pointerEvents="none">
            <Ionicons name="scan-outline" size={13} color={colors.textMuted} style={{ marginRight: 5 }} />
            <Text style={styles.hintPillText}>
              Pinch to zoom • Rotate for {isLandscape ? 'portrait' : 'landscape'}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
