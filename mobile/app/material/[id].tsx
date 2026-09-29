import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  getFileById,
  LibraryFile,
  getFileComments,
  addFileComment,
  deleteFileComment,
  toggleFileLike,
  FileComment,
} from '@/services/library';
import { getBaseUrl, getAuthToken } from '@/services/api';
import { FullScreenFilePreview } from '@/components/FullScreenFilePreview';

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
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
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

export default function MaterialDetailScreen() {
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const { colors, spacing, radii } = useTheme();

  // In-app authenticated download states
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadStatusText, setDownloadStatusText] = useState<string>('');
  const [localFileUri, setLocalFileUri] = useState<string | null>(null);

  // Full-screen note/file preview state
  const [showPreview, setShowPreview] = useState(false);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // Fetch material details with 10min React Query cache
  const {
    data: file = null,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useQuery<LibraryFile | null>({
    queryKey: ['material', id],
    queryFn: async () => {
      if (!id) return null;
      const data = await getFileById(id as string);
      if (!data) throw new Error(`Material #${id} could not be found on the server.`);
      return data;
    },
    staleTime: 10 * 60 * 1000,
    enabled: Boolean(id),
  });

  const error = queryError ? (queryError as any).message || 'Error loading material details.' : null;

  // Check if file is already cached locally whenever file data is resolved
  useEffect(() => {
    if (!file) return;
    const cleanFilename = `${file.id}_${(file.originalName || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const destinationUri = `${FileSystem.documentDirectory}${cleanFilename}`;
    FileSystem.getInfoAsync(destinationUri)
      .then((info) => {
        if (info.exists) {
          setLocalFileUri(info.uri);
        }
      })
      .catch(() => {});
  }, [file]);

  // Requirement 1: If requested with preview=1, open full-screen preview immediately once file is available
  useEffect(() => {
    if ((preview === '1' || preview === 'true') && file && !hasAutoOpened) {
      setHasAutoOpened(true);
      setShowPreview(true);
    }
  }, [preview, file, hasAutoOpened]);

  // Core download function using Bearer token and expo-file-system
  const downloadFile = useCallback(async (): Promise<string | null> => {
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
  }, [file]);

  // Open full-screen preview modal
  const handleOpenPreview = async () => {
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

  const category = getFileCategory(file.originalName);
  const isPreviewable = category === 'pdf' || category === 'image' || category === 'office';
  const ext = (file.originalName.split('.').pop() || 'file').toUpperCase();

  return (
    <>
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
              name={
                category === 'pdf'
                  ? 'document-text'
                  : category === 'image'
                  ? 'image'
                  : 'file-tray-full'
              }
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

        {/* Download Status & Progress Bar (when downloading in background) */}
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

        {/* Action Buttons Section */}
        <View style={{ marginBottom: spacing.md }}>
          {isPreviewable ? (
            <>
              {/* Primary Action: Full-Screen Preview */}
              <Button
                title={
                  downloading
                    ? 'Downloading Note...'
                    : localFileUri
                    ? 'Open Full-Screen Preview'
                    : 'Download & Open Preview'
                }
                variant="primary"
                size="lg"
                loading={downloading && !showPreview}
                onPress={handleOpenPreview}
                leftIcon={<Ionicons name="eye-outline" size={20} color="#FFFFFF" />}
                style={{ marginBottom: spacing.sm }}
              />

              {/* Secondary Action: Native Share / Save Sheet */}
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
                This file format can be opened and viewed via external reader applications.
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

      {/* Full-Screen Note/File Preview Modal with Orientation Unlock, Pinch-Zoom & Pan */}
      <FullScreenFilePreview
        visible={showPreview}
        onClose={() => setShowPreview(false)}
        file={file}
        localFileUri={localFileUri}
        onDownloadFile={downloadFile}
        onShareFile={handleShareFile}
        downloading={downloading}
        downloadProgress={downloadProgress}
        downloadStatusText={downloadStatusText}
      />
    </>
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
});
