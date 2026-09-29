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

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [comments, setComments] = useState<FileComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [serverBaseUrl, setServerBaseUrl] = useState('');

  useEffect(() => {
    getBaseUrl().then(setServerBaseUrl).catch(() => {});
  }, []);

  const fetchComments = useCallback(async () => {
    if (!id) return;
    setLoadingComments(true);
    try {
      const data = await getFileComments(Number(id));
      if (Array.isArray(data)) setComments(data);
    } catch {
      // Graceful fallback
    } finally {
      setLoadingComments(false);
    }
  }, [id]);

  useEffect(() => {
    if (file) {
      setLiked(Boolean(file.liked));
      setLikeCount(Number(file.likeCount || 0));
      fetchComments();
    }
  }, [file, fetchComments]);

  const handleToggleLike = async () => {
    if (!file) return;
    const prevLiked = liked;
    const prevCount = likeCount;
    setLiked(!prevLiked);
    setLikeCount(prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1);

    try {
      const res = await toggleFileLike(file.id);
      setLiked(Boolean(res.liked));
      setLikeCount(Number(res.likeCount || 0));
    } catch {
      setLiked(prevLiked);
      setLikeCount(prevCount);
    }
  };

  const handleCopyLink = async () => {
    if (!file) return;
    try {
      const base = serverBaseUrl || (await getBaseUrl());
      const link = `${base}/api/files/${file.id}/view`;
      await Clipboard.setStringAsync(link);
      Alert.alert('Link Copied', 'Material link has been copied to your clipboard.');
    } catch {
      Alert.alert('Error', 'Could not copy link.');
    }
  };

  const handlePostComment = async () => {
    if (!file || !commentInput.trim() || postingComment) return;
    const text = commentInput.trim();
    setPostingComment(true);
    try {
      const res = await addFileComment(file.id, text);
      setCommentInput('');
      if (res.comment) {
        setComments((prev) => [...prev, res.comment!]);
      } else {
        await fetchComments();
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not post comment.');
    } finally {
      setPostingComment(false);
    }
  };

  const handleDeleteComment = (commentId: number) => {
    if (!file) return;
    Alert.alert('Delete Comment', 'Are you sure you want to delete this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFileComment(file.id, commentId);
            setComments((prev) => prev.filter((c) => c.id !== commentId));
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Could not delete comment.');
          }
        },
      },
    ]);
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
            Original: {file.originalName}
          </Caption>

          {/* Clickable Uploader Profile Card */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              if (file.uploadedBy) {
                router.push({
                  pathname: '/user/[id]',
                  params: { id: file.uploadedBy },
                });
              }
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.surfaceRaised,
              padding: spacing.sm,
              borderRadius: radii.md,
              marginTop: spacing.sm,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: radii.full,
                backgroundColor: colors.surfaceSubtle,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                marginRight: spacing.sm,
              }}
            >
              {file.uploaderAvatar ? (
                <Image
                  source={{
                    uri: file.uploaderAvatar.startsWith('http')
                      ? file.uploaderAvatar
                      : `${serverBaseUrl}${file.uploaderAvatar.startsWith('/') ? '' : '/'}${file.uploaderAvatar}`,
                  }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              ) : (
                <Text variant="sm" weight="700" color="primary">
                  {(file.uploaderName || 'S').charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text variant="sm" weight="700">
                  {file.uploaderName || 'Student'}
                </Text>
                {file.uploaderRole && file.uploaderRole !== 'student' && (
                  <View
                    style={{
                      backgroundColor: colors.surfaceSubtle,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: radii.sm,
                    }}
                  >
                    <Text variant="xs" weight="700" color="accent">
                      {file.uploaderRole.toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <Caption color="muted">
                Tap to view profile & student uploads
              </Caption>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Quick Action Strip (Like & Copy Link) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.md }}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleToggleLike}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: liked ? '#FEE2E2' : colors.surfaceSubtle,
                borderColor: liked ? '#FCA5A5' : colors.border,
                borderWidth: 1,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 3,
                borderRadius: radii.full,
              }}
            >
              <Ionicons
                name={liked ? 'heart' : 'heart-outline'}
                size={17}
                color={liked ? '#EF4444' : colors.textMuted}
              />
              <Text
                variant="xs"
                weight="700"
                style={{ marginLeft: 6, color: liked ? '#EF4444' : colors.textSecondary }}
              >
                {likeCount} {likeCount === 1 ? 'Like' : 'Likes'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleCopyLink}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.surfaceSubtle,
                borderColor: colors.border,
                borderWidth: 1,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 3,
                borderRadius: radii.full,
              }}
            >
              <Ionicons name="link-outline" size={17} color={colors.textMuted} />
              <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 6 }}>
                Copy Link
              </Text>
            </TouchableOpacity>
          </View>

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

        {/* Comments & Discussion Section */}
        <Subheading style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
          Class Discussion ({comments.length})
        </Subheading>

        {/* Comment Composer */}
        <Card
          variant="flat"
          padding="md"
          style={{
            marginBottom: spacing.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceRaised,
          }}
        >
          <TextInput
            placeholder="Ask a question or thank the contributor..."
            placeholderTextColor={colors.textMuted}
            value={commentInput}
            onChangeText={setCommentInput}
            multiline
            style={{
              color: colors.text,
              fontSize: 14,
              minHeight: 52,
              textAlignVertical: 'top',
              paddingTop: 0,
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xs }}>
            <Button
              title="Post Comment"
              variant="primary"
              size="sm"
              loading={postingComment}
              disabled={!commentInput.trim() || postingComment}
              onPress={handlePostComment}
            />
          </View>
        </Card>

        {/* Comments List */}
        {loadingComments ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.md }} />
        ) : comments.length === 0 ? (
          <Card variant="flat" padding="md" style={{ alignItems: 'center', borderColor: colors.border }}>
            <Caption color="muted">No comments yet. Start the conversation!</Caption>
          </Card>
        ) : (
          comments.map((c) => (
            <Card
              key={c.id}
              variant="flat"
              padding="md"
              style={{
                marginBottom: spacing.xs,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surfaceRaised,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    if (c.studentId) {
                      router.push({
                        pathname: '/user/[id]',
                        params: { id: c.studentId },
                      });
                    }
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: colors.surfaceSubtle,
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      marginRight: 8,
                    }}
                  >
                    {c.avatarUrl ? (
                      <Image
                        source={{
                          uri: c.avatarUrl.startsWith('http')
                            ? c.avatarUrl
                            : `${serverBaseUrl}${c.avatarUrl.startsWith('/') ? '' : '/'}${c.avatarUrl}`,
                        }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                      />
                    ) : (
                      <Text variant="xs" weight="700" color="primary">
                        {(c.name || c.commenterName || 'S').charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <Text variant="xs" weight="700">
                    {c.name || c.commenterName || 'Classmate'}
                  </Text>
                  {c.role && c.role !== 'student' && (
                    <View
                      style={{
                        backgroundColor: colors.surfaceSubtle,
                        paddingHorizontal: 4,
                        paddingVertical: 1,
                        borderRadius: 4,
                        marginLeft: 6,
                      }}
                    >
                      <Text variant="xs" weight="700" color="accent" style={{ fontSize: 9 }}>
                        {c.role.toUpperCase()}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                {c.canDelete && (
                  <TouchableOpacity
                    onPress={() => handleDeleteComment(c.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={14} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>

              <Text variant="sm" style={{ marginTop: 6, lineHeight: 20 }}>
                {c.content || c.commentText}
              </Text>
              <Caption color="muted" style={{ marginTop: 4, fontSize: 10 }}>
                {new Date(c.createdAt).toLocaleDateString()}
              </Caption>
            </Card>
          ))
        )}
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
