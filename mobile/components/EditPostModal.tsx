import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  BackHandler,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Text } from '@/components/ui/Typography';
import { useTheme } from '@/constants/useTheme';
import {
  Post,
  PostMediaItem,
  updatePost,
  uploadPostAttachment,
  deletePostAttachment,
  UploadedAttachment,
  MAX_ATTACHMENT_BYTES_PER_FILE,
  formatAttachmentBytes,
} from '@/services/posts';

interface EditPostModalProps {
  visible: boolean;
  post: Post | null;
  onClose: () => void;
  onPostUpdated: (updatedPost: Post) => void;
  getFullUrl?: (path: string | null) => string | null;
}

interface ModalNewAttachment {
  id: string;
  uri: string;
  name: string;
  size?: number;
  type?: string;
  mediaType: 'image' | 'file';
  status: 'idle' | 'uploading' | 'uploaded' | 'error';
  progress: number;
  uploaded?: UploadedAttachment;
  error?: string;
}

function formatBytes(bytes?: number | string | null): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(name?: string | null): keyof typeof Ionicons.glyphMap {
  const ext = (name || '').split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'document-text';
  if (['doc', 'docx'].includes(ext || '')) return 'document';
  if (['ppt', 'pptx'].includes(ext || '')) return 'easel';
  if (['xls', 'xlsx'].includes(ext || '')) return 'grid';
  if (['zip', 'rar', '7z'].includes(ext || '')) return 'archive';
  return 'document-attach';
}

function getFileTypeLabel(name?: string | null): string {
  const ext = (name || '').split('.').pop()?.toUpperCase();
  return ext || 'FILE';
}

export function EditPostModal({
  visible,
  post,
  onClose,
  onPostUpdated,
  getFullUrl,
}: EditPostModalProps) {
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const resolveUrl = useCallback(
    (path?: string | null): string => {
      if (!path) return '';
      if (getFullUrl) return getFullUrl(path) || path;
      return path;
    },
    [getFullUrl]
  );

  const [content, setContent] = useState('');
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [existingFiles, setExistingFiles] = useState<PostMediaItem[]>([]);
  const [newAttachments, setNewAttachments] = useState<ModalNewAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const newImages = useMemo(() => newAttachments.filter((a) => a.mediaType === 'image'), [newAttachments]);
  const newFiles = useMemo(() => newAttachments.filter((a) => a.mediaType === 'file'), [newAttachments]);

  // Upload an item independently with progress tracking
  const uploadItem = useCallback(async (item: {
    id: string;
    uri: string;
    name: string;
    size?: number;
    type?: string;
    mediaType: 'image' | 'file';
  }) => {
    setNewAttachments((prev) =>
      prev.map((a) => (a.id === item.id ? { ...a, status: 'uploading', progress: 0, error: undefined } : a))
    );

    try {
      const res = await uploadPostAttachment(
        {
          uri: item.uri,
          name: item.name,
          type: item.type || (item.mediaType === 'image' ? 'image/jpeg' : 'application/octet-stream'),
          size: item.size,
        },
        (pct) => {
          setNewAttachments((prev) =>
            prev.map((a) => (a.id === item.id ? { ...a, progress: pct } : a))
          );
        }
      );

      setNewAttachments((prev) =>
        prev.map((a) =>
          a.id === item.id ? { ...a, status: 'uploaded', progress: 100, uploaded: res } : a
        )
      );
    } catch (err: any) {
      setNewAttachments((prev) =>
        prev.map((a) =>
          a.id === item.id ? { ...a, status: 'error', error: err.message || 'Upload failed' } : a
        )
      );
    }
  }, []);

  // Initialize modal state when post or visibility changes
  useEffect(() => {
    if (post && visible) {
      setContent(post.content || '');
      setErrorMessage(null);
      setNewAttachments([]);

      if (Array.isArray(post.media) && post.media.length > 0) {
        const imgs = post.media
          .filter((m) => (m.media_type || 'image') === 'image')
          .map((m) => m.url);
        const docs = post.media.filter((m) => m.media_type === 'file');
        setExistingImages(imgs);
        setExistingFiles(docs);
      } else if (post.attachment_url) {
        setExistingImages([post.attachment_url]);
        setExistingFiles([]);
      } else {
        setExistingImages([]);
        setExistingFiles([]);
      }
    }
  }, [post, visible]);

  // Initial state calculation for dirty checking
  const initialContent = useMemo(() => (post?.content || '').trim(), [post]);
  const initialImages = useMemo(() => {
    if (Array.isArray(post?.media) && post.media.length > 0) {
      return post.media
        .filter((m) => (m.media_type || 'image') === 'image')
        .map((m) => m.url);
    }
    return post?.attachment_url ? [post.attachment_url] : [];
  }, [post]);
  const initialFiles = useMemo(() => {
    if (Array.isArray(post?.media) && post.media.length > 0) {
      return post.media.filter((m) => m.media_type === 'file').map((m) => m.url);
    }
    return [];
  }, [post]);

  const isDirty = useMemo(() => {
    if (content.trim() !== initialContent) return true;
    if (newAttachments.length > 0) return true;
    if (JSON.stringify(existingImages) !== JSON.stringify(initialImages)) return true;
    if (JSON.stringify(existingFiles.map((f) => f.url)) !== JSON.stringify(initialFiles)) return true;
    return false;
  }, [content, initialContent, newAttachments, existingImages, initialImages, existingFiles, initialFiles]);

  const totalImagesCount = existingImages.length + newImages.length;
  const totalFilesCount = existingFiles.length + newFiles.length;
  const totalAttachmentsCount = totalImagesCount + totalFilesCount;
  const hasValidContent = content.trim().length > 0 || totalAttachmentsCount > 0;

  const isUploading = newAttachments.some((a) => a.status === 'uploading' || a.status === 'idle');
  const hasFailed = newAttachments.some((a) => a.status === 'error');

  // Handle request close with dirty check confirmation and safe cleanup of unsaved uploads
  const handleRequestClose = useCallback(() => {
    if (saving) return;
    if (isDirty) {
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes that will be lost.',
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              // Safely clean up any newly uploaded unattached blobs
              newAttachments.forEach((a) => {
                if (a.uploaded?.filename) {
                  void deletePostAttachment(a.uploaded.filename);
                }
              });
              onClose();
            },
          },
        ]
      );
    } else {
      onClose();
    }
  }, [saving, isDirty, newAttachments, onClose]);

  // Android back button handler
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, handleRequestClose]);

  // Pick more images
  const handlePickMoreImages = async () => {
    try {
      const remainingSlots = 10 - totalImagesCount;
      if (remainingSlots <= 0) {
        Alert.alert('Limit Reached', 'You can have up to 10 images per post.');
        return;
      }

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo Access Required',
          'Please allow access to your photos to add images to your post.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        quality: 0.7,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const existingUris = new Set(newAttachments.map((a) => a.uri));
        const oversized = result.assets.filter((a) => a.fileSize && a.fileSize > MAX_ATTACHMENT_BYTES_PER_FILE);
        if (oversized.length > 0) {
          Alert.alert(
            'Photo Too Large',
            'Photos must be 4 MB or smaller each. For larger study materials, upload them to the Library.'
          );
        }

        const validAssets = result.assets.filter(
          (a) => !existingUris.has(a.uri) && (!a.fileSize || a.fileSize <= MAX_ATTACHMENT_BYTES_PER_FILE)
        );

        const newItems: ModalNewAttachment[] = validAssets.slice(0, remainingSlots).map((a, idx) => ({
          id: `edit_img_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          uri: a.uri,
          name: a.fileName || `edit_photo_${Date.now()}_${idx}.jpg`,
          size: a.fileSize,
          type: a.mimeType || 'image/jpeg',
          mediaType: 'image' as const,
          status: 'idle' as const,
          progress: 0,
        }));

        if (newItems.length > 0) {
          setNewAttachments((prev) => [...prev, ...newItems]);
          newItems.forEach((item) => void uploadItem(item));
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not select images.');
    }
  };

  // Pick more files / documents
  const handlePickMoreFiles = async () => {
    try {
      const remainingSlots = 5 - totalFilesCount;
      if (remainingSlots <= 0) {
        Alert.alert('Limit Reached', 'You can have up to 5 file attachments per post.');
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain',
          'application/zip',
          '*/*',
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const oversized = result.assets.filter((a) => a.size && a.size > MAX_ATTACHMENT_BYTES_PER_FILE);
        if (oversized.length > 0) {
          Alert.alert(
            'File Too Large',
            'Documents must be 4 MB or smaller each. For larger notes, slides, or books, please upload directly to the Semester Library.'
          );
        }

        const existingUris = new Set(newAttachments.map((a) => a.uri));
        const validAssets = result.assets.filter(
          (a) => !existingUris.has(a.uri) && (!a.size || a.size <= MAX_ATTACHMENT_BYTES_PER_FILE)
        );

        const newItems: ModalNewAttachment[] = validAssets.slice(0, remainingSlots).map((a, idx) => ({
          id: `edit_doc_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          uri: a.uri,
          name: a.name,
          size: a.size,
          type: a.mimeType || 'application/octet-stream',
          mediaType: 'file' as const,
          status: 'idle' as const,
          progress: 0,
        }));

        if (newItems.length > 0) {
          setNewAttachments((prev) => [...prev, ...newItems]);
          newItems.forEach((item) => void uploadItem(item));
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not select files.');
    }
  };

  const handleRemoveExistingImage = (indexToRemove: number) => {
    setExistingImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleRemoveNewAttachment = (idToRemove: string) => {
    const target = newAttachments.find((a) => a.id === idToRemove);
    if (target?.uploaded?.filename) {
      void deletePostAttachment(target.uploaded.filename);
    }
    setNewAttachments((prev) => prev.filter((a) => a.id !== idToRemove));
  };

  const handleRetryUpload = (idToRetry: string) => {
    const target = newAttachments.find((a) => a.id === idToRetry);
    if (target) {
      void uploadItem(target);
    }
  };

  const handleMoveExistingLeft = (index: number) => {
    if (index <= 0) return;
    setExistingImages((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleMoveExistingRight = (index: number) => {
    if (index >= existingImages.length - 1) return;
    setExistingImages((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleRemoveExistingFile = (indexToRemove: number) => {
    setExistingFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSave = async () => {
    if (!post) return;
    if (!content.trim() && totalAttachmentsCount === 0) {
      setErrorMessage('Post must contain either text or at least one photo or file.');
      return;
    }
    if (hasFailed) {
      setErrorMessage('Some attachments failed to upload. Please tap Retry on the failed files or remove them before saving.');
      return;
    }
    if (isUploading) {
      setErrorMessage('Attachments are still uploading. Please wait a moment.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const keepMediaUrls = [
        ...existingImages,
        ...existingFiles.map((f) => f.url),
      ];

      const uploadedList = newAttachments
        .map((a) => a.uploaded!)
        .filter(Boolean);

      const updated = await updatePost(post.id, {
        content: content.trim(),
        keepMediaUrls,
        newAttachments: uploadedList,
      });

      onPostUpdated(updated);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not update post. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible || !post) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleRequestClose}
    >
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: Math.max(insets.top, 16) }]}>
        {/* Header Bar */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={handleRequestClose}
            disabled={saving}
            style={styles.cancelBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text variant="sm" weight="600" color="secondary">
              Cancel
            </Text>
          </TouchableOpacity>

          <Text variant="md" weight="700">
            Edit Post
          </Text>

          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || !hasValidContent || !isDirty || isUploading || hasFailed}
            style={[
              styles.saveBtn,
              {
                backgroundColor: hasValidContent && isDirty && !isUploading && !hasFailed ? colors.primary : colors.surfaceSubtle,
                opacity: hasValidContent && isDirty && !isUploading && !hasFailed && !saving ? 1 : 0.5,
              },
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.primaryText} />
            ) : (
              <Text variant="sm" weight="700" style={{ color: hasValidContent && isDirty && !isUploading && !hasFailed ? colors.primaryText : colors.textMuted }}>
                Save
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Upload Status Banner — only show during upload or on error */}
        {newAttachments.length > 0 && (() => {
          if (isUploading) {
            return (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: spacing.md,
                  paddingVertical: 8,
                  backgroundColor: colors.surfaceSubtle,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 6 }} />
                <Text variant="xs" weight="600" style={{ color: colors.primary, flex: 1 }}>
                  Uploading…
                </Text>
              </View>
            );
          }
          if (hasFailed) {
            return (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: spacing.md,
                  paddingVertical: 8,
                  backgroundColor: '#FEF2F2',
                  borderBottomWidth: 1,
                  borderBottomColor: '#FCA5A5',
                }}
              >
                <Ionicons name="alert-circle" size={15} color="#DC2626" style={{ marginRight: 6 }} />
                <Text variant="xs" weight="600" style={{ color: '#DC2626', flex: 1 }}>
                  Some uploads failed. Tap Retry on failed files.
                </Text>
              </View>
            );
          }
          // All uploaded successfully — no banner, UI returns to normal
          return null;
        })()}

        {/* Error Banner */}
        {errorMessage && (
          <View style={[styles.errorBanner, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}>
            <Ionicons name="alert-circle" size={18} color="#DC2626" style={{ marginRight: 8 }} />
            <Text variant="xs" weight="600" style={{ color: '#DC2626', flex: 1 }}>
              {errorMessage}
            </Text>
          </View>
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Caption Input */}
          <Text variant="xs" weight="700" color="muted" style={{ marginBottom: 6, textTransform: 'uppercase' }}>
            Caption / Text
          </Text>
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder="What's on your mind?"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={5000}
            editable={!saving}
            style={[
              styles.textInput,
              {
                backgroundColor: colors.surfaceRaised,
                color: colors.text,
                borderColor: colors.border,
                borderRadius: radii.md,
              },
            ]}
          />

          {/* Photos Section */}
          <View style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text variant="xs" weight="700" color="muted" style={{ textTransform: 'uppercase' }}>
                Photos ({totalImagesCount} / 10)
              </Text>
              {totalImagesCount < 10 && (
                <TouchableOpacity
                  onPress={handlePickMoreImages}
                  disabled={saving}
                  style={[
                    styles.actionBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surfaceRaised,
                      borderRadius: radii.full,
                    },
                  ]}
                >
                  <Ionicons name="image-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
                  <Text variant="xs" weight="700" color="primary">
                    + Add photos
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {totalImagesCount === 0 ? (
              <View
                style={[
                  styles.emptyDashedBox,
                  {
                    borderColor: colors.border,
                    borderRadius: radii.md,
                    backgroundColor: colors.surfaceRaised,
                  },
                ]}
              >
                <Ionicons name="images-outline" size={28} color={colors.textMuted} style={{ marginBottom: 6 }} />
                <Text variant="xs" color="muted">
                  No photos attached
                </Text>
                <TouchableOpacity
                  onPress={handlePickMoreImages}
                  disabled={saving}
                  style={{ marginTop: 6 }}
                >
                  <Text variant="xs" weight="700" color="secondary">
                    Add photos
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.photosGrid}>
                {/* Existing Photos List */}
                {existingImages.map((imgUrl, idx) => (
                  <View
                    key={`existing-${imgUrl}-${idx}`}
                    style={[
                      styles.photoThumbnailContainer,
                      {
                        borderRadius: radii.md,
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceRaised,
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: resolveUrl(imgUrl) }}
                      style={styles.thumbnailImage}
                      contentFit="cover"
                    />

                    {/* Remove Button */}
                    <TouchableOpacity
                      onPress={() => handleRemoveExistingImage(idx)}
                      disabled={saving}
                      style={styles.removeBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Remove photo"
                    >
                      <Ionicons name="close-circle" size={22} color="#EF4444" />
                    </TouchableOpacity>

                    {/* Order Controls */}
                    <View style={styles.reorderBar}>
                      {idx > 0 && (
                        <TouchableOpacity
                          onPress={() => handleMoveExistingLeft(idx)}
                          disabled={saving}
                          style={styles.reorderBtn}
                        >
                          <Ionicons name="chevron-back" size={14} color="#ffffff" />
                        </TouchableOpacity>
                      )}
                      <Text style={styles.reorderIndexText}>{idx + 1}</Text>
                      {idx < existingImages.length - 1 && (
                        <TouchableOpacity
                          onPress={() => handleMoveExistingRight(idx)}
                          disabled={saving}
                          style={styles.reorderBtn}
                        >
                          <Ionicons name="chevron-forward" size={14} color="#ffffff" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}

                {/* Newly Added Photos List */}
                {newImages.map((asset) => (
                  <View
                    key={`new-${asset.id}`}
                    style={[
                      styles.photoThumbnailContainer,
                      {
                        borderRadius: radii.md,
                        borderColor: asset.status === 'error' ? '#EF4444' : colors.primary,
                        backgroundColor: colors.surfaceRaised,
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: asset.uri }}
                      style={styles.thumbnailImage}
                      contentFit="cover"
                    />

                    {/* "NEW" Badge */}
                    <View style={[styles.newBadge, { backgroundColor: asset.status === 'error' ? '#EF4444' : colors.primary }]}>
                      <Text style={styles.newBadgeText}>
                        {asset.status === 'uploaded' ? 'READY' : asset.status === 'error' ? 'FAILED' : 'NEW'}
                      </Text>
                    </View>

                    {/* Remove Button */}
                    <TouchableOpacity
                      onPress={() => handleRemoveNewAttachment(asset.id)}
                      disabled={saving}
                      style={styles.removeBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Remove new photo"
                    >
                      <Ionicons name="close-circle" size={22} color="#EF4444" />
                    </TouchableOpacity>

                    {/* Upload Progress Overlay */}
                    {asset.status === 'uploading' && (
                      <View style={styles.uploadProgressOverlay}>
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text style={styles.progressText}>{asset.progress}%</Text>
                      </View>
                    )}

                    {/* Error Overlay with Retry */}
                    {asset.status === 'error' && (
                      <View style={styles.uploadErrorOverlay}>
                        <Ionicons name="alert-circle" size={20} color="#FCA5A5" />
                        <TouchableOpacity
                          onPress={() => handleRetryUpload(asset.id)}
                          disabled={saving}
                          style={styles.miniRetryBtn}
                        >
                          <Ionicons name="refresh" size={11} color="#ffffff" style={{ marginRight: 2 }} />
                          <Text style={styles.miniRetryText}>Retry</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* File Attachments Section */}
          <View style={{ marginTop: spacing.xl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text variant="xs" weight="700" color="muted" style={{ textTransform: 'uppercase' }}>
                Files & Documents ({totalFilesCount} / 5)
              </Text>
              {totalFilesCount < 5 && (
                <TouchableOpacity
                  onPress={handlePickMoreFiles}
                  disabled={saving}
                  style={[
                    styles.actionBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surfaceRaised,
                      borderRadius: radii.full,
                    },
                  ]}
                >
                  <Ionicons name="attach-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
                  <Text variant="xs" weight="700" color="primary">
                    + Add files
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {totalFilesCount === 0 ? (
              <View
                style={[
                  styles.emptyDashedBox,
                  {
                    borderColor: colors.border,
                    borderRadius: radii.md,
                    backgroundColor: colors.surfaceRaised,
                  },
                ]}
              >
                <Ionicons name="document-text-outline" size={28} color={colors.textMuted} style={{ marginBottom: 6 }} />
                <Text variant="xs" color="muted">
                  No documents attached
                </Text>
                <TouchableOpacity
                  onPress={handlePickMoreFiles}
                  disabled={saving}
                  style={{ marginTop: 6 }}
                >
                  <Text variant="xs" weight="700" color="secondary">
                    Add files (PDF, Office, etc.)
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.filesList}>
                {/* Existing Files */}
                {existingFiles.map((file, idx) => (
                  <View
                    key={`existing-file-${file.url}-${idx}`}
                    style={[
                      styles.fileCard,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <View style={[styles.fileIconBox, { backgroundColor: colors.surface }]}>
                      <Ionicons name={getFileIcon(file.file_name || file.url)} size={22} color={colors.text} />
                    </View>
                    <View style={styles.fileDetails}>
                      <Text variant="sm" weight="600" numberOfLines={1} style={{ color: colors.text }}>
                        {file.file_name || file.url.split('/').pop() || 'Attached File'}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                        <View style={[styles.typeBadge, { backgroundColor: colors.surface }]}>
                          <Text style={[styles.typeBadgeText, { color: colors.textSecondary }]}>
                            {getFileTypeLabel(file.file_name || file.url)}
                          </Text>
                        </View>
                        {Boolean(file.file_size) && (
                          <Text variant="xs" color="muted" style={{ marginLeft: 6 }}>
                            {formatBytes(file.file_size)}
                          </Text>
                        )}
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemoveExistingFile(idx)}
                      disabled={saving}
                      style={styles.fileRemoveBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Remove file"
                    >
                      <Ionicons name="close-circle" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))}

                {/* Newly Added Files */}
                {newFiles.map((file) => (
                  <View
                    key={`new-file-${file.id}`}
                    style={[
                      styles.fileCard,
                      {
                        backgroundColor: colors.surfaceRaised,
                        borderColor: file.status === 'error' ? '#EF4444' : colors.primary,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <View style={[styles.fileIconBox, { backgroundColor: colors.surface }]}>
                      <Ionicons name={getFileIcon(file.name)} size={22} color={colors.primary} />
                    </View>
                    <View style={styles.fileDetails}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text variant="sm" weight="600" numberOfLines={1} style={{ color: colors.text, flex: 1 }}>
                          {file.name}
                        </Text>
                        <View style={[styles.newBadgeMini, { backgroundColor: file.status === 'error' ? '#EF4444' : colors.primary }]}>
                          <Text style={styles.newBadgeText}>
                            {file.status === 'uploaded' ? 'READY' : file.status === 'error' ? 'FAILED' : 'NEW'}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                        <View style={[styles.typeBadge, { backgroundColor: colors.surface }]}>
                          <Text style={[styles.typeBadgeText, { color: colors.textSecondary }]}>
                            {getFileTypeLabel(file.name)}
                          </Text>
                        </View>
                        {Boolean(file.size) && (
                          <Text variant="xs" color="muted" style={{ marginLeft: 6 }}>
                            {formatBytes(file.size)}
                          </Text>
                        )}
                        {file.status === 'uploading' && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                            <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.7 }] }} />
                            <Text variant="xs" style={{ color: colors.primary, marginLeft: 3 }}>
                              {file.progress}%
                            </Text>
                          </View>
                        )}
                        {file.status === 'uploaded' && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                            <Ionicons name="checkmark-circle" size={13} color="#16A34A" />
                            <Text variant="xs" style={{ color: '#16A34A', marginLeft: 2 }}>
                              Uploaded
                            </Text>
                          </View>
                        )}
                        {file.status === 'error' && (
                          <TouchableOpacity
                            onPress={() => handleRetryUpload(file.id)}
                            style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: '#EF4444', borderRadius: 4 }}
                          >
                            <Ionicons name="refresh" size={11} color="#ffffff" style={{ marginRight: 2 }} />
                            <Text style={{ fontSize: 10, color: '#ffffff', fontWeight: '700' }}>
                              Retry
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemoveNewAttachment(file.id)}
                      disabled={saving}
                      style={styles.fileRemoveBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Remove file"
                    >
                      <Ionicons name="close-circle" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  saveBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  textInput: {
    minHeight: 120,
    maxHeight: 220,
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
  },
  emptyDashedBox: {
    padding: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoThumbnailContainer: {
    width: '31%',
    aspectRatio: 1,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    zIndex: 10,
  },
  newBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 5,
  },
  newBadgeMini: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginLeft: 6,
  },
  newBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  reorderBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  reorderBtn: {
    padding: 2,
  },
  reorderIndexText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  filesList: {
    gap: 8,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
  },
  fileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  fileDetails: {
    flex: 1,
    marginRight: 8,
  },
  typeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  fileRemoveBtn: {
    padding: 4,
  },
  uploadProgressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
  },
  progressText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  uploadErrorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(185, 28, 28, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
    padding: 4,
  },
  miniRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  miniRetryText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
});
