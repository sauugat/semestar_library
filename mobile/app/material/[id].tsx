import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { WebView } from 'react-native-webview';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getFileById, LibraryFile } from '@/services/library';
import { getBaseUrl, getAuthToken } from '@/services/api';

function formatBytes(bytes: number | string): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getMimeType(filename: string): string {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

function getUTI(filename: string): string | undefined {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'com.adobe.pdf';
  if (lower.endsWith('.pptx')) return 'org.openxmlformats.presentationml.presentation';
  if (lower.endsWith('.docx')) return 'org.openxmlformats.wordprocessingml.document';
  if (lower.endsWith('.zip')) return 'public.zip-archive';
  return undefined;
}

function getPdfJsHtml(base64Data: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 10px;
      background-color: #0F172A;
      display: flex;
      flex-direction: column;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #status {
      color: #94A3B8;
      font-size: 13px;
      margin: 16px 0;
      text-align: center;
    }
    #container {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    canvas {
      width: 100% !important;
      height: auto !important;
      background: white;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
  </style>
</head>
<body>
  <div id="status">Loading document pages...</div>
  <div id="container"></div>
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
        for (let num = 1; num <= pdf.numPages; num++) {
          const page = await pdf.getPage(num);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        }
      }).catch(function(err) {
        document.getElementById('status').innerText = 'Could not render PDF: ' + err.message;
      });
    } catch(e) {
      document.getElementById('status').innerText = 'Unable to decode PDF: ' + e.message;
    }
  </script>
</body>
</html>`;
}

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams();
  const { colors, spacing, radii } = useTheme();

  const [file, setFile] = useState<LibraryFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // In-app authenticated download states
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadStatusText, setDownloadStatusText] = useState<string>('');
  const [localFileUri, setLocalFileUri] = useState<string | null>(null);

  // In-app PDF preview states
  const [showPreview, setShowPreview] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [preparingPreview, setPreparingPreview] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchDetail() {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getFileById(id as string);
        if (isMounted) {
          if (data) {
            setFile(data);
            // Check if file is already cached locally
            const cleanFilename = `${data.id}_${(data.originalName || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const destinationUri = `${FileSystem.documentDirectory}${cleanFilename}`;
            try {
              const info = await FileSystem.getInfoAsync(destinationUri);
              if (info.exists) {
                setLocalFileUri(info.uri);
              }
            } catch {
              // Ignore cache check errors
            }
          } else {
            setError(`Material #${id} could not be found on the server.`);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Error loading material details.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [id]);

  // Core download function using Bearer token and expo-file-system
  const downloadFile = async (): Promise<string | null> => {
    if (!file) return null;
    setDownloading(true);
    setDownloadProgress(0);
    setDownloadStatusText('Connecting to server...');

    try {
      const baseUrl = await getBaseUrl();
      const token = await getAuthToken();

      if (!token) {
        throw new Error('Authentication token not found. Please log in again.');
      }

      const downloadUrl = `${baseUrl}/api/files/${file.id}/download`;
      const cleanFilename = `${file.id}_${(file.originalName || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const destinationUri = `${FileSystem.documentDirectory}${cleanFilename}`;

      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl,
        destinationUri,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        (progress) => {
          const expected = progress.totalBytesExpectedToWrite;
          const written = progress.totalBytesWritten;
          if (expected > 0) {
            const percent = Math.min(Math.max(Math.round((written / expected) * 100), 0), 100);
            setDownloadProgress(percent);
            setDownloadStatusText(`Downloading: ${percent}% (${formatBytes(written)} / ${formatBytes(expected)})`);
          } else {
            setDownloadStatusText(`Downloading: ${formatBytes(written)}`);
          }
        }
      );

      const result = await downloadResumable.downloadAsync();

      if (!result || result.status !== 200) {
        if (result?.uri) {
          await FileSystem.deleteAsync(result.uri, { idempotent: true });
        }
        throw new Error(`Download failed with status HTTP ${result?.status || 'error'}`);
      }

      setLocalFileUri(result.uri);
      setDownloadProgress(100);
      setDownloadStatusText('Download complete!');
      return result.uri;
    } catch (err: any) {
      Alert.alert('Download Failed', err.message || 'An error occurred while downloading the file.');
      setDownloadStatusText('');
      setDownloadProgress(null);
      return null;
    } finally {
      setDownloading(false);
    }
  };

  // Previews PDF inline on the material detail screen
  const handlePreviewPdf = async () => {
    if (showPreview) {
      setShowPreview(false);
      return;
    }

    let uri = localFileUri;
    if (!uri) {
      uri = await downloadFile();
      if (!uri) return;
    }

    if (Platform.OS === 'android' && !pdfBase64) {
      setPreparingPreview(true);
      try {
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setPdfBase64(b64);
      } catch (e: any) {
        console.warn('Failed reading base64 for Android PDF viewer:', e);
      } finally {
        setPreparingPreview(false);
      }
    }

    setShowPreview(true);
  };

  // Triggers native share sheet for saving to Files or opening in other apps
  const handleShareFile = async () => {
    if (!file) return;

    let uri = localFileUri;
    if (!uri) {
      uri = await downloadFile();
      if (!uri) return;
    }

    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: getMimeType(file.originalName),
          dialogTitle: `Save or open ${file.originalName}`,
          UTI: getUTI(file.originalName),
        });
      } else {
        Alert.alert('File Saved', `Material is saved locally at ${uri}`);
      }
    } catch (err: any) {
      Alert.alert('Sharing Error', err.message || 'Could not open system share dialog.');
    }
  };

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="sm" color="secondary" style={{ marginTop: spacing.md }}>
          Loading material #{id}...
        </Text>
      </View>
    );
  }

  if (error || !file) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background, padding: spacing.lg }]}>
        <Ionicons name="alert-circle-outline" size={54} color={colors.error} style={{ marginBottom: spacing.sm }} />
        <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
          Material Not Found
        </Heading>
        <Text variant="sm" color="secondary" style={{ textAlign: 'center', marginBottom: spacing.lg }}>
          {error || 'The requested material does not exist or has been removed.'}
        </Text>
        <Button
          title="Back to Library"
          variant="primary"
          onPress={() => router.back()}
        />
      </View>
    );
  }

  const isPdf = file.originalName.toLowerCase().endsWith('.pdf');
  const ext = (file.originalName.split('.').pop() || 'file').toUpperCase();

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { padding: spacing.md, backgroundColor: colors.background },
      ]}
    >
      {/* File Header Card */}
      <Card variant="elevated" padding="lg" style={{ marginBottom: spacing.md }}>
        <View
          style={[
            styles.typeIcon,
            {
              backgroundColor: colors.primaryLight,
              borderRadius: radii.md,
              marginBottom: spacing.md,
            },
          ]}
        >
          <Ionicons
            name={isPdf ? 'document-text' : 'file-tray-full'}
            size={32}
            color={colors.primary}
          />
        </View>

        <Heading style={{ marginBottom: spacing.xs }}>
          {file.title || file.originalName}
        </Heading>
        <Caption color="muted">
          Original: {file.originalName} • Uploaded by {file.uploaderName}
        </Caption>

        {/* Badges */}
        <View style={[styles.badgeRow, { marginTop: spacing.md }]}>
          <View style={[styles.pill, { backgroundColor: colors.surfaceSubtle, borderRadius: radii.full }]}>
            <Text variant="xs" color="accent" weight="700">
              {ext} • {formatBytes(file.sizeBytes)}
            </Text>
          </View>
          {file.semester && (
            <View style={[styles.pill, { backgroundColor: colors.surfaceSubtle, borderRadius: radii.full }]}>
              <Text variant="xs" color="secondary" weight="600">
                {file.semester}
              </Text>
            </View>
          )}
          {file.chapter && (
            <View style={[styles.pill, { backgroundColor: colors.surfaceSubtle, borderRadius: radii.full }]}>
              <Text variant="xs" color="secondary" weight="600">
                Chapter: {file.chapter}
              </Text>
            </View>
          )}
          {localFileUri && (
            <View style={[styles.pill, { backgroundColor: '#DCFCE7', borderRadius: radii.full }]}>
              <Text variant="xs" color="success" weight="700">
                ✓ SAVED LOCALLY
              </Text>
            </View>
          )}
        </View>
      </Card>

      {/* Download Status & Progress Bar */}
      {downloadStatusText.length > 0 && (
        <Card variant="flat" padding="md" style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
            {downloading && (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.sm }} />
            )}
            <Text variant="sm" weight="600" color={localFileUri ? 'success' : 'primary'}>
              {downloadStatusText}
            </Text>
          </View>
          {downloadProgress !== null && (
            <View style={[styles.progressBarContainer, { backgroundColor: colors.border, borderRadius: radii.full }]}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${downloadProgress}%`,
                    borderRadius: radii.full,
                  },
                ]}
              />
            </View>
          )}
        </Card>
      )}

      {/* In-App PDF Preview Container */}
      {isPdf && showPreview && localFileUri && (
        <Card variant="elevated" padding="sm" style={[styles.previewCard, { borderColor: colors.primary }]}>
          <View style={styles.previewHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="eye-outline" size={18} color={colors.primary} />
              <Text variant="sm" weight="700" color="primary">
                In-App PDF Preview
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowPreview(false)}
              style={styles.closePreviewButton}
              accessibilityLabel="Close PDF preview"
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {preparingPreview ? (
            <View style={styles.previewLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text variant="xs" color="secondary" style={{ marginTop: 8 }}>
                Preparing document preview...
              </Text>
            </View>
          ) : (
            <View style={styles.webViewContainer}>
              <WebView
                source={
                  Platform.OS === 'ios'
                    ? { uri: localFileUri }
                    : { html: getPdfJsHtml(pdfBase64 || '') }
                }
                originWhitelist={['*']}
                allowFileAccess={true}
                allowFileAccessFromFileURLs={true}
                allowUniversalAccessFromFileURLs={true}
                scalesPageToFit={true}
                nestedScrollEnabled={true}
                startInLoadingState={true}
                renderLoading={() => (
                  <View style={styles.previewLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text variant="xs" color="secondary" style={{ marginTop: 8 }}>
                      Rendering PDF viewer...
                    </Text>
                  </View>
                )}
                style={styles.webView}
              />
            </View>
          )}

          <View style={styles.previewFooter}>
            <Caption color="muted">
              Pinch or scroll to navigate pages inside the preview
            </Caption>
            <TouchableOpacity onPress={handleShareFile} style={styles.previewShareLink}>
              <Ionicons name="share-outline" size={16} color={colors.primary} />
              <Text variant="xs" weight="700" color="primary">
                Save / Share
              </Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {/* Action Buttons Section */}
      <View style={{ marginBottom: spacing.md }}>
        {isPdf ? (
          <>
            {/* Primary Action for PDF: In-App Preview */}
            <Button
              title={
                downloading
                  ? 'Downloading Material...'
                  : showPreview
                  ? 'Hide In-App Preview'
                  : localFileUri
                  ? 'View PDF Preview'
                  : 'Download & Preview PDF'
              }
              variant="primary"
              size="lg"
              loading={downloading && !showPreview}
              onPress={handlePreviewPdf}
              leftIcon={
                <Ionicons
                  name={showPreview ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color="#FFFFFF"
                />
              }
              style={{ marginBottom: spacing.sm }}
            />

            {/* Secondary Action for PDF: Native Share / Save Sheet */}
            <Button
              title={localFileUri ? 'Save to Files / Share' : 'Download & Save to Files'}
              variant="secondary"
              size="md"
              loading={downloading && showPreview}
              onPress={handleShareFile}
              leftIcon={<Ionicons name="share-outline" size={18} color={colors.text} />}
              style={{ marginBottom: spacing.sm }}
            />
          </>
        ) : (
          <>
            {/* Non-PDF files: Download and open via system share-sheet */}
            <Button
              title={
                downloading
                  ? 'Downloading File...'
                  : localFileUri
                  ? 'Open / Share Saved File'
                  : 'Download Material'
              }
              variant="primary"
              size="lg"
              loading={downloading}
              onPress={handleShareFile}
              leftIcon={
                <Ionicons
                  name={localFileUri ? 'share-outline' : 'download-outline'}
                  size={20}
                  color="#FFFFFF"
                />
              }
              style={{ marginBottom: spacing.xs }}
            />
            <Caption color="muted" style={{ textAlign: 'center', marginBottom: spacing.sm }}>
              In-app preview is available for PDF files. Non-PDF files can be opened and viewed via the share sheet.
            </Caption>
          </>
        )}

        <Button
          title="Back to Library"
          variant="secondary"
          size="md"
          onPress={() => router.back()}
        />
      </View>

      {/* Metadata Card */}
      <Subheading style={{ marginBottom: spacing.sm }}>Material Information</Subheading>
      <Card variant="elevated" padding="md">
        <View style={styles.metaRow}>
          <Text variant="sm" color="secondary">Subject:</Text>
          <Text variant="sm" weight="600">{file.subject}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text variant="sm" color="secondary">File Type:</Text>
          <Text variant="sm" weight="600">{ext} ({getMimeType(file.originalName)})</Text>
        </View>
        <View style={styles.metaRow}>
          <Text variant="sm" color="secondary">Uploaded Date:</Text>
          <Text variant="sm" weight="600">{new Date(file.uploadedAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text variant="sm" color="secondary">Uploader Role:</Text>
          <Text variant="xs" weight="700" color="accent">{file.uploaderRole.toUpperCase()}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text variant="sm" color="secondary">Likes / Comments:</Text>
          <Text variant="sm" weight="600">❤️ {file.likeCount} • 💬 {file.commentCount}</Text>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 36,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeIcon: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  progressBarContainer: {
    height: 6,
    width: '100%',
    overflow: 'hidden',
    marginTop: 4,
  },
  progressBarFill: {
    height: '100%',
  },
  previewCard: {
    marginBottom: 16,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CBD5E1',
  },
  closePreviewButton: {
    padding: 4,
  },
  previewLoading: {
    height: 480,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webViewContainer: {
    height: 480,
    width: '100%',
    backgroundColor: '#0F172A',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  previewFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#CBD5E1',
  },
  previewShareLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
