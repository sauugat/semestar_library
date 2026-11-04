import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
import { getFileById, LibraryFile } from '@/services/library';
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
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

function getUTI(filename: string): string | undefined {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'com.adobe.pdf';
  if (lower.endsWith('.pptx')) return 'org.openxmlformats.presentationml.presentation';
  if (lower.endsWith('.ppt')) return 'com.microsoft.powerpoint.ppt';
  if (lower.endsWith('.docx')) return 'org.openxmlformats.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'com.microsoft.word.doc';
  if (lower.endsWith('.xlsx')) return 'org.openxmlformats.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'com.microsoft.excel.xls';
  if (lower.endsWith('.txt')) return 'public.plain-text';
  if (lower.endsWith('.md')) return 'net.daringfireball.markdown';
  if (lower.endsWith('.csv')) return 'public.comma-separated-values-text';
  if (lower.endsWith('.json')) return 'public.json';
  if (lower.endsWith('.zip')) return 'public.zip-archive';
  return undefined;
}

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadStatusText, setDownloadStatusText] = useState<string>('');
  const [localFileUri, setLocalFileUri] = useState<string | null>(null);

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

  if (loading && !file) {
    return (
      <View style={[styles.centerScreen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={colors.text} />
        <Text variant="sm" color="secondary" style={{ marginTop: 12 }}>
          Opening file…
        </Text>
      </View>
    );
  }

  if (queryError || !file) {
    return (
      <View style={[styles.centerScreen, { backgroundColor: colors.background, paddingTop: insets.top, paddingHorizontal: 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.closeCornerBtn, { top: insets.top + 12, backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
        <Ionicons name="alert-circle-outline" size={44} color={colors.textMuted} style={{ marginBottom: 12 }} />
        <Heading style={{ textAlign: 'center', marginBottom: 6 }}>Unable to Open File</Heading>
        <Text variant="sm" color="secondary" style={{ textAlign: 'center', marginBottom: 18 }}>
          {(queryError as any)?.message || 'This file could not be loaded right now.'}
        </Text>
        <Button title="Try Again" variant="primary" size="sm" onPress={() => void refetch()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <FullScreenFilePreview
        visible={true}
        asScreen={true}
        onClose={() => router.back()}
        file={file}
        localFileUri={localFileUri}
        onDownloadFile={downloadFile}
        onShareFile={handleShareFile}
        downloading={downloading}
        downloadProgress={downloadProgress}
        downloadStatusText={downloadStatusText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centerScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeCornerBtn: {
    position: 'absolute',
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
