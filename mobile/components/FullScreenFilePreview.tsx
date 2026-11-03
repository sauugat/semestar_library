import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Platform,
  useWindowDimensions,
  Alert,
  Animated,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LibraryFile, getOfficePreviewUrl } from '@/services/library';
import { useTheme } from '@/constants/useTheme';
import { getBaseUrl, getAuthToken } from '@/services/api';

export interface FullScreenFilePreviewProps {
  visible: boolean;
  onClose: () => void;
  file: LibraryFile | null;
  localFileUri: string | null;
  fileUrl?: string | null;
  mimeType?: string | null;
  onDownloadFile: () => Promise<string | null>;
  onShareFile: () => Promise<void>;
  downloading?: boolean;
  downloadProgress?: number | null;
  downloadStatusText?: string;
  asScreen?: boolean;
}

function formatBytes(bytes: number | string): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function isPptxFile(filename?: string, mimeType?: string): boolean {
  const name = (filename || '').toLowerCase().trim();
  const mime = (mimeType || '').toLowerCase().trim();
  const hasPptExt = name.endsWith('.pptx') || name.endsWith('.ppt');
  const hasPptMime =
    mime.includes('presentation') ||
    mime.includes('powerpoint') ||
    mime.includes('vnd.openxmlformats-officedocument.presentationml') ||
    mime.includes('vnd.ms-powerpoint');
  return hasPptExt || hasPptMime;
}

export function isOfficeFile(filename?: string, mimeType?: string): boolean {
  const name = (filename || '').toLowerCase().trim();
  const mime = (mimeType || '').toLowerCase().trim();
  const hasOfficeExt =
    name.endsWith('.pptx') ||
    name.endsWith('.ppt') ||
    name.endsWith('.docx') ||
    name.endsWith('.doc') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.xls');
  const hasOfficeMime =
    mime.includes('officedocument') ||
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    mime.includes('presentation') ||
    mime.includes('powerpoint') ||
    mime.includes('spreadsheet') ||
    mime.includes('ms-excel');
  return hasOfficeExt || hasOfficeMime;
}

export type FilePreviewCategory = 'pdf' | 'image' | 'text' | 'office' | 'pptx' | 'other';

export function getFileCategory(filename: string, mimeType?: string): FilePreviewCategory {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf') || (mimeType && mimeType.includes('application/pdf'))) return 'pdf';
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.bmp') ||
    (mimeType && mimeType.startsWith('image/'))
  ) {
    return 'image';
  }
  if (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.log') ||
    (mimeType && (mimeType.includes('text/plain') || mimeType.includes('text/csv') || mimeType.includes('application/json')))
  ) {
    return 'text';
  }
  if (
    lower.endsWith('.pptx') ||
    lower.endsWith('.ppt') ||
    isPptxFile(filename, mimeType)
  ) {
    return 'pptx';
  }
  if (
    lower.endsWith('.docx') ||
    lower.endsWith('.doc') ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.html') ||
    isOfficeFile(filename, mimeType)
  ) {
    return 'office';
  }
  return 'other';
}

export function getOfficeDocMeta(filename: string): { label: string; icon: string; color: string; appHint: string } {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    return {
      label: 'Word Document',
      icon: 'document-text',
      color: '#2563EB',
      appHint: 'Microsoft 365, Google Docs, or WPS Office',
    };
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return {
      label: 'Excel Spreadsheet',
      icon: 'grid-outline',
      color: '#16A34A',
      appHint: 'Microsoft Excel, Google Sheets, or WPS Office',
    };
  }
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) {
    return {
      label: 'PowerPoint Presentation',
      icon: 'easel-outline',
      color: '#EA580C',
      appHint: 'Microsoft PowerPoint, Google Slides, or Keynote',
    };
  }
  return {
    label: 'Office Document',
    icon: 'document-text-outline',
    color: '#71717A',
    appHint: 'Microsoft 365, Google Docs, WPS Office, or your document viewer',
  };
}

function getImageMime(filename: string): string {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

// Injected JavaScript for WebView to detect scroll down, pinch-to-zoom, and single-tap toggle
const WEBVIEW_GESTURE_BRIDGE_JS = `
(function() {
  if (window.__slGestureBridgeInstalled) return;
  window.__slGestureBridgeInstalled = true;
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

  document.addEventListener('touchend', function(e) {
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
    ${WEBVIEW_GESTURE_BRIDGE_JS}
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
  <script>${WEBVIEW_GESTURE_BRIDGE_JS}</script>
</body>
</html>`;
}

export function FullScreenFilePreview({
  visible,
  onClose,
  file,
  localFileUri,
  fileUrl,
  mimeType,
  onDownloadFile,
  onShareFile,
  downloading = false,
  downloadProgress = null,
  downloadStatusText = '',
  asScreen = false,
}: FullScreenFilePreviewProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [preparing, setPreparing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [officeHtml, setOfficeHtml] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);
  const [activeUri, setActiveUri] = useState<string | null>(localFileUri);

  // PPTX specific states
  const [resolvedFileUrl, setResolvedFileUrl] = useState<string | null>(fileUrl || null);
  const [pptxLoadError, setPptxLoadError] = useState<string | null>(null);
  const [pptxLoading, setPptxLoading] = useState<boolean>(true);
  const [downloadingPptx, setDownloadingPptx] = useState<boolean>(false);

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

  // Start 3-second auto-hide timer once file is open and ready
  const isLoading = downloading || preparing;
  useEffect(() => {
    if (visible && !isLoading && !errorMsg) {
      scheduleAutoHide();
    }
    return () => clearAutoHideTimer();
  }, [visible, isLoading, errorMsg, scheduleAutoHide, clearAutoHideTimer]);

  // Immediately hide header when user rotates device (orientation change)
  useEffect(() => {
    if (prevLandscapeRef.current !== isLandscape) {
      prevLandscapeRef.current = isLandscape;
      hideChrome();
    }
  }, [isLandscape, hideChrome]);

  // Sync activeUri with incoming localFileUri
  useEffect(() => {
    if (localFileUri) {
      setActiveUri(localFileUri);
    }
  }, [localFileUri]);

  // Screen orientation unlock on enter, lock to portrait on exit/unmount
  useEffect(() => {
    if (visible) {
      ScreenOrientation.unlockAsync().catch(() => {});
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [visible]);

  const fileCategory = useMemo(() => {
    return file
      ? getFileCategory(
          file.originalName,
          (file as any).mimeType || (file as any).contentType || mimeType || undefined
        )
      : 'other';
  }, [file, mimeType]);

  useEffect(() => {
    if (fileUrl) {
      setResolvedFileUrl(fileUrl);
    }
  }, [fileUrl]);

  const officeEmbedUrl = useMemo(() => {
    if (!resolvedFileUrl) return null;
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(resolvedFileUrl)}`;
  }, [resolvedFileUrl]);

  const handleDownloadPptx = async () => {
    try {
      setDownloadingPptx(true);
      const uri = await onDownloadFile();
      if (uri) {
        setActiveUri(uri);
        Alert.alert(
          'File Downloaded',
          'The presentation file has been downloaded successfully.',
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Open / Share', onPress: onShareFile },
          ]
        );
      }
    } catch (err: any) {
      Alert.alert('Download Failed', err?.message || 'Could not download the presentation.');
    } finally {
      setDownloadingPptx(false);
    }
  };

  const handleRetryPptx = async () => {
    if (!file?.id) return;
    setPptxLoadError(null);
    setPptxLoading(true);
    try {
      const freshUrl = await getOfficePreviewUrl(file.id);
      setResolvedFileUrl(freshUrl);
    } catch (err: any) {
      setPptxLoading(false);
      setPptxLoadError('The presentation preview could not be loaded. Please try again or download the file.');
    }
  };

  const preparePreview = useCallback(async () => {
    if (!file) return;
    setErrorMsg(null);
    setPptxLoadError(null);
    setPreparing(true);

    try {
      const cat = getFileCategory(
        file.originalName,
        (file as any).mimeType || (file as any).contentType || mimeType || undefined
      );

      if (cat === 'pptx' || cat === 'office') {
        let targetUrl = fileUrl || file.fileUrl || null;
        if (!targetUrl && file.id) {
          try {
            targetUrl = await getOfficePreviewUrl(file.id);
          } catch {}
        }
        setResolvedFileUrl(targetUrl);
        setPptxLoading(true);

        if (file.id) {
          try {
            const baseUrl = await getBaseUrl();
            const token = await getAuthToken();
            const viewUrl = `${baseUrl}/api/files/${file.id}/view`;
            const res = await fetch(viewUrl, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (res.ok) {
              const contentType = res.headers.get('content-type') || '';
              if (contentType.includes('text/html')) {
                let html = await res.text();
                const themeCss = `
                  <style>
                    :root {
                      ${isDark ? `
                        --bg: #0a0a0a !important;
                        --card-bg: #171717 !important;
                        --text: #f5f5f5 !important;
                        --text-muted: #a1a1aa !important;
                        --border: rgba(255, 255, 255, 0.12) !important;
                        --shadow-sm: none !important;
                        --shadow-md: none !important;
                      ` : ''}
                    }
                    .preview-navbar { display: none !important; }
                    body {
                      ${isDark ? 'background: #0a0a0a !important; color: #f5f5f5 !important;' : ''}
                      padding: 16px 12px 60px !important;
                    }
                    ${isDark ? `
                      .slide-card { background: #171717 !important; border: 1px solid rgba(255,255,255,0.12) !important; color: #f5f5f5 !important; }
                      .slide-card-header { border-bottom: 1px solid rgba(255,255,255,0.08) !important; background: rgba(255,255,255,0.03) !important; }
                      .slide-badge { background: #262626 !important; color: #fb923c !important; }
                      .slide-card-body { color: #e4e4e7 !important; }
                      .slide-card-body p { color: #e4e4e7 !important; }
                      .empty-slide-note { color: #a1a1aa !important; }
                      .docx-content { color: #f5f5f5 !important; }
                      .docx-content p { color: #e4e4e7 !important; }
                      .docx-content h1, .docx-content h2, .docx-content h3 { color: #f5f5f5 !important; }
                    ` : ''}
                  </style>
                `;
                if (html.includes('</head>')) {
                  html = html.replace('</head>', `${themeCss}</head>`);
                } else {
                  html = `${themeCss}${html}`;
                }
                setOfficeHtml(html);
              }
            }
          } catch {}
        }
        if (!activeUri && !localFileUri) {
          onDownloadFile().then((uri) => {
            if (uri) setActiveUri(uri);
          }).catch(() => {});
        }
        return;
      }

      let targetUri = activeUri || localFileUri;
      if (!targetUri) {
        targetUri = await onDownloadFile();
        if (!targetUri) {
          throw new Error('Could not download file from server.');
        }
        setActiveUri(targetUri);
      }

      if (cat === 'pdf') {
        const b64 = await FileSystem.readAsStringAsync(targetUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setPdfBase64(b64);
      } else if (cat === 'image') {
        const b64 = await FileSystem.readAsStringAsync(targetUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setImageBase64(b64);
      } else if (cat === 'text') {
        const txt = await FileSystem.readAsStringAsync(targetUri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        setTextContent(txt);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not load this file. Please check your connection and try again.');
    } finally {
      setPreparing(false);
    }
  }, [file, activeUri, localFileUri, onDownloadFile, isDark, fileUrl, mimeType]);

  useEffect(() => {
    if (visible && file) {
      preparePreview();
    } else if (!visible) {
      setPdfBase64(null);
      setImageBase64(null);
      setTextContent(null);
      setOfficeHtml(null);
      setCopiedText(false);
      setErrorMsg(null);
      setPptxLoadError(null);
      setPptxLoading(true);
      setDownloadingPptx(false);
    }
  }, [visible, file, preparePreview]);

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

  const handleClose = () => {
    clearAutoHideTimer();
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    onClose();
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

  const textScrollLastY = useRef(0);
  const handleTextScroll = useCallback(
    (e: any) => {
      const y = e?.nativeEvent?.contentOffset?.y ?? 0;
      if (y > textScrollLastY.current + 8) {
        hideChrome();
      }
      textScrollLastY.current = y;
    },
    [hideChrome]
  );

  const topPad = Math.max(insets.top, isLandscape ? 12 : Platform.OS === 'ios' ? 44 : 24);
  const headerTranslateY = chromeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-(topPad + 64), 0],
  });

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        header: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: topPad,
          paddingBottom: 10,
          paddingHorizontal: 16,
          backgroundColor: isDark ? 'rgba(10, 10, 10, 0.94)' : 'rgba(255, 255, 255, 0.94)',
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          zIndex: 30,
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
          color: colors.textMuted,
          fontSize: 11,
          marginTop: 2,
        },
        headerActions: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        viewerBody: {
          flex: 1,
          backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
        },
        webViewWrap: {
          flex: 1,
        },
        webView: {
          flex: 1,
          backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
        },
        centerBox: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          zIndex: 5,
        },
        loadingText: {
          color: colors.text,
          fontSize: 14,
          fontFamily: 'PlusJakartaSans_600SemiBold',
          marginTop: 14,
          textAlign: 'center',
        },
        loadingSubtext: {
          color: colors.textMuted,
          fontSize: 12,
          marginTop: 6,
          textAlign: 'center',
        },
        progressTrack: {
          width: 200,
          height: 5,
          backgroundColor: colors.surfaceRaised,
          borderRadius: 3,
          overflow: 'hidden',
          marginTop: 12,
        },
        progressBar: {
          height: '100%',
          backgroundColor: colors.primary,
        },
        errorBox: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 28,
        },
        errorIconCircle: {
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: isDark ? 'rgba(248, 113, 113, 0.1)' : 'rgba(220, 38, 38, 0.08)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        },
        errorTitle: {
          color: colors.text,
          fontSize: 18,
          fontFamily: 'PlusJakartaSans_700Bold',
          marginBottom: 6,
          textAlign: 'center',
        },
        errorMessage: {
          color: colors.textMuted,
          fontSize: 13,
          lineHeight: 19,
          textAlign: 'center',
          marginBottom: 20,
        },
        errorActions: {
          flexDirection: 'row',
          gap: 10,
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
        textContainer: {
          flex: 1,
          backgroundColor: isDark ? '#111111' : '#f8fafc',
        },
        textActionBar: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 10,
          backgroundColor: isDark ? '#18181b' : '#f1f5f9',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        textMeta: {
          color: colors.textSecondary,
          fontSize: 12,
          fontFamily: 'PlusJakartaSans_600SemiBold',
          flex: 1,
          marginRight: 10,
        },
        copyBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: colors.surfaceRaised,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: colors.border,
        },
        copyBtnText: {
          fontSize: 12,
          color: colors.text,
          fontFamily: 'PlusJakartaSans_600SemiBold',
        },
        textScroll: {
          flex: 1,
        },
        textContentContainer: {
          padding: 16,
          paddingBottom: 40,
        },
        codeText: {
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
          fontSize: 13,
          lineHeight: 20,
          color: colors.text,
        },
        officeBadge: {
          paddingHorizontal: 12,
          paddingVertical: 4,
          borderRadius: 12,
          marginBottom: 12,
        },
        officeBadgeText: {
          color: '#FFFFFF',
          fontSize: 12,
          fontFamily: 'PlusJakartaSans_700Bold',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
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
          zIndex: 25,
        },
        hintPillText: {
          color: colors.textMuted,
          fontSize: 11,
          fontWeight: '500',
        },
      }),
    [colors, isDark, topPad]
  );

  if (!visible) return null;

  const ext = (file?.originalName.split('.').pop() || 'FILE').toUpperCase();

  const content = (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Auto-Hiding Floating Top Header (Hides after 3s, or on scroll down / zoom / rotate) */}
      <Animated.View
        pointerEvents={chromeVisible ? 'auto' : 'none'}
        style={[
          styles.header,
          {
            opacity: chromeAnim,
            transform: [{ translateY: headerTranslateY }],
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleClose}
          style={styles.circleBtn}
          accessibilityLabel="Close file preview"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {file?.title || file?.originalName || 'Note Preview'}
          </Text>
          <Text numberOfLines={1} style={styles.headerSubtitle}>
            {ext} • {formatBytes(file?.sizeBytes || 0)}
          </Text>
        </View>

        <View style={styles.headerActions}>
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

          <TouchableOpacity
            onPress={onShareFile}
            style={styles.circleBtn}
            accessibilityLabel="Share or save note"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="share-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Content Viewer Body */}
      <View style={styles.viewerBody}>
        {isLoading && (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>
              {downloadStatusText || (preparing ? 'Preparing preview...' : 'Loading note...')}
            </Text>
            {downloadProgress !== null && downloadProgress > 0 && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressBar, { width: `${downloadProgress}%` }]} />
              </View>
            )}
          </View>
        )}

        {!isLoading && errorMsg && (
          <View style={styles.errorBox}>
            <View style={styles.errorIconCircle}>
              <Ionicons name="alert-circle-outline" size={48} color={isDark ? '#f87171' : '#dc2626'} />
            </View>
            <Text style={styles.errorTitle}>Couldn't load this file</Text>
            <Text style={styles.errorMessage}>{errorMsg}</Text>
            <View style={styles.errorActions}>
              <TouchableOpacity style={styles.primaryButton} onPress={preparePreview} activeOpacity={0.8}>
                <Ionicons name="refresh-outline" size={18} color={colors.primaryText} style={{ marginRight: 6 }} />
                <Text style={styles.primaryButtonText}>Try Again</Text>
              </TouchableOpacity>

              {activeUri && (
                <TouchableOpacity style={styles.secondaryButton} onPress={onShareFile} activeOpacity={0.8}>
                  <Ionicons name="share-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                  <Text style={styles.secondaryButtonText}>Open in External App</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Office Documents & Presentations Viewer */}
        {!isLoading && !errorMsg && (fileCategory === 'pptx' || fileCategory === 'office') && (() => {
          const officeMeta = getOfficeDocMeta(file?.originalName || '');
          const showFallbackCard = (
            <View style={styles.docBox}>
              <View style={[styles.docIconCircle, { borderColor: officeMeta.color + '40', backgroundColor: officeMeta.color + '15' }]}>
                <Ionicons name={officeMeta.icon as any} size={48} color={officeMeta.color} />
              </View>
              <View style={[styles.officeBadge, { backgroundColor: officeMeta.color }]}>
                <Text style={styles.officeBadgeText}>{officeMeta.label}</Text>
              </View>
              <Text style={styles.docTitle}>{file?.title || file?.originalName}</Text>
              <Text style={styles.docSubtitle}>
                {ext} • {formatBytes(file?.sizeBytes || 0)}
              </Text>
              {pptxLoadError ? (
                <Text style={[styles.docDescription, { color: isDark ? '#f87171' : '#dc2626' }]}>
                  {pptxLoadError}
                </Text>
              ) : (
                <Text style={styles.docDescription}>
                  {`Ready to view in your device's document reader (${officeMeta.appHint}).`}
                </Text>
              )}
              <View style={{ width: '100%', maxWidth: 280, gap: 10 }}>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: officeMeta.color }]}
                  onPress={onShareFile}
                  activeOpacity={0.8}
                >
                  <Ionicons name="open-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={[styles.primaryButtonText, { color: '#FFFFFF' }]}>Open in Document Reader</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={handleDownloadPptx}
                  disabled={downloadingPptx || downloading}
                  activeOpacity={0.8}
                >
                  {downloadingPptx || downloading ? (
                    <ActivityIndicator size="small" color={colors.text} style={{ marginRight: 6 }} />
                  ) : (
                    <Ionicons name="download-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                  )}
                  <Text style={styles.secondaryButtonText}>
                    {downloadingPptx || downloading ? 'Downloading...' : 'Download File'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryButton} onPress={handleRetryPptx} activeOpacity={0.8}>
                  <Ionicons name="refresh-outline" size={18} color={colors.text} style={{ marginRight: 6 }} />
                  <Text style={styles.secondaryButtonText}>Try Online Preview Again</Text>
                </TouchableOpacity>
              </View>
            </View>
          );

          if (pptxLoadError) {
            if (officeHtml) {
              return (
                <WebView
                  source={{ html: officeHtml }}
                  originWhitelist={['*']}
                  scalesPageToFit={true}
                  nestedScrollEnabled={true}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                  injectedJavaScript={WEBVIEW_GESTURE_BRIDGE_JS}
                  onMessage={handleWebViewMessage}
                  startInLoadingState={true}
                  renderLoading={() => (
                    <View style={styles.centerBox}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.loadingText}>Loading document content...</Text>
                    </View>
                  )}
                  onError={() => setOfficeHtml(null)}
                  style={styles.webView}
                />
              );
            }
            return showFallbackCard;
          }

          if (officeEmbedUrl) {
            return (
              <View style={styles.webViewWrap}>
                <WebView
                  key={officeEmbedUrl}
                  source={{ uri: officeEmbedUrl }}
                  originWhitelist={['*']}
                  scalesPageToFit={true}
                  nestedScrollEnabled={true}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                  injectedJavaScript={WEBVIEW_GESTURE_BRIDGE_JS}
                  onMessage={handleWebViewMessage}
                  startInLoadingState={true}
                  renderLoading={() => (
                    <View style={styles.centerBox}>
                      <ActivityIndicator size="large" color={colors.primary} />
                      <Text style={styles.loadingText}>Loading {officeMeta.label}...</Text>
                      <Text style={styles.loadingSubtext}>Connecting to Microsoft Office viewer</Text>
                    </View>
                  )}
                  onLoadStart={() => setPptxLoading(true)}
                  onLoadEnd={() => setPptxLoading(false)}
                  onError={() => {
                    setPptxLoading(false);
                    setPptxLoadError('The online preview could not be loaded. Please open in your external reader or download.');
                  }}
                  onHttpError={(e) => {
                    if (e.nativeEvent.statusCode >= 400) {
                      setPptxLoading(false);
                      setPptxLoadError('The online preview could not be loaded. Please open in your external reader or download.');
                    }
                  }}
                  style={styles.webView}
                />
              </View>
            );
          }

          if (officeHtml) {
            return (
              <WebView
                source={{ html: officeHtml }}
                originWhitelist={['*']}
                scalesPageToFit={true}
                nestedScrollEnabled={true}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                injectedJavaScript={WEBVIEW_GESTURE_BRIDGE_JS}
                onMessage={handleWebViewMessage}
                startInLoadingState={true}
                renderLoading={() => (
                  <View style={styles.centerBox}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.loadingText}>Loading document content...</Text>
                  </View>
                )}
                onError={() => setOfficeHtml(null)}
                style={styles.webView}
              />
            );
          }

          return showFallbackCard;
        })()}

        {/* PDF Viewer (Uses PDF.js HTML with gesture bridge on both iOS & Android so scroll/zoom/tap auto-hide works reliably) */}
        {!isLoading && !errorMsg && fileCategory === 'pdf' && (pdfBase64 || activeUri) && (
          <WebView
            source={
              pdfBase64
                ? { html: getPdfJsHtml(pdfBase64, file?.title || '', isDark) }
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
            injectedJavaScript={WEBVIEW_GESTURE_BRIDGE_JS}
            onMessage={handleWebViewMessage}
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

        {/* Image Viewer */}
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
            injectedJavaScript={WEBVIEW_GESTURE_BRIDGE_JS}
            onMessage={handleWebViewMessage}
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

        {/* In-App Text Viewer */}
        {!isLoading && !errorMsg && fileCategory === 'text' && (
          <View style={styles.textContainer}>
            <ScrollView
              style={styles.textScroll}
              contentContainerStyle={[styles.textContentContainer, { paddingTop: topPad + 60 }]}
              onScroll={handleTextScroll}
              scrollEventThrottle={16}
            >
              <TouchableOpacity activeOpacity={1} onPress={toggleChrome}>
                <Text selectable style={styles.codeText}>
                  {textContent || 'Empty document.'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}

        {/* Other / Unsupported Formats */}
        {!isLoading && !errorMsg && fileCategory === 'other' && (
          <View style={styles.docBox}>
            <View style={styles.docIconCircle}>
              <Ionicons name="document-outline" size={54} color={colors.text} />
            </View>
            <Text style={styles.docTitle}>{file?.title || file?.originalName}</Text>
            <Text style={styles.docSubtitle}>
              Format: {ext} • {formatBytes(file?.sizeBytes || 0)}
            </Text>
            <Text style={styles.docDescription}>
              This file format cannot be rendered directly in the app. You can export or open it with an external viewer.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={onShareFile} activeOpacity={0.8}>
              <Ionicons name="open-outline" size={18} color={colors.primaryText} style={{ marginRight: 6 }} />
              <Text style={styles.primaryButtonText}>Open in External App</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Subtle Rotation / Zoom Hint Pill (Auto-hides with header) */}
      {!isLoading && !errorMsg && (
        <Animated.View
          style={[styles.hintPill, { opacity: chromeAnim }]}
          pointerEvents="none"
        >
          <Ionicons name="scan-outline" size={13} color={colors.textMuted} style={{ marginRight: 5 }} />
          <Text style={styles.hintPillText}>
            Pinch to zoom • Rotate for {isLandscape ? 'portrait' : 'landscape'}
          </Text>
        </Animated.View>
      )}
    </View>
  );

  if (asScreen) {
    return content;
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={handleClose}
    >
      {content}
    </Modal>
  );
}
