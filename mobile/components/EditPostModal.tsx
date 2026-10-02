import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '@/components/ui/Typography';
import { useTheme } from '@/constants/useTheme';
import { Post, updatePost } from '@/services/posts';

interface EditPostModalProps {
  visible: boolean;
  post: Post | null;
  onClose: () => void;
  onPostUpdated: (updatedPost: Post) => void;
  getFullUrl?: (path: string | null) => string | null;
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
  const [newImages, setNewImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (post && visible) {
      setContent(post.content || '');
      setErrorMessage(null);
      setNewImages([]);

      if (Array.isArray(post.media) && post.media.length > 0) {
        setExistingImages(post.media.map((m) => m.url));
      } else if (post.attachment_url) {
        setExistingImages([post.attachment_url]);
      } else {
        setExistingImages([]);
      }
    }
  }, [post, visible]);

  const handlePickMoreImages = async () => {
    try {
      const currentTotal = existingImages.length + newImages.length;
      if (currentTotal >= 10) {
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
        selectionLimit: 10 - currentTotal,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setNewImages((prev) => {
          const existingUris = new Set(prev.map((a) => a.uri));
          const toAdd = result.assets.filter((a) => !existingUris.has(a.uri));
          return [...prev, ...toAdd];
        });
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not select images.');
    }
  };

  const handleRemoveExistingImage = (indexToRemove: number) => {
    setExistingImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleRemoveNewImage = (indexToRemove: number) => {
    setNewImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
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

  const totalImagesCount = existingImages.length + newImages.length;
  const hasValidContent = content.trim().length > 0 || totalImagesCount > 0;

  const handleSave = async () => {
    if (!post) return;
    if (!content.trim() && totalImagesCount === 0) {
      setErrorMessage('Post must contain either text or at least one photo.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const updated = await updatePost(post.id, {
        content: content.trim(),
        keepMediaUrls: existingImages,
        newImages: newImages.map((asset) => ({
          uri: asset.uri,
          name: asset.fileName || `post_edit_${Date.now()}.jpg`,
          type: asset.mimeType || 'image/jpeg',
          size: asset.fileSize,
        })),
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
      onRequestClose={() => {
        if (!saving) onClose();
      }}
    >
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: Math.max(insets.top, 16) }]}>
        {/* Header Bar */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
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
            disabled={saving || !hasValidContent}
            style={[
              styles.saveBtn,
              {
                backgroundColor: hasValidContent ? colors.primary : colors.surfaceSubtle,
                opacity: hasValidContent && !saving ? 1 : 0.6,
              },
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text variant="sm" weight="700" style={{ color: '#ffffff' }}>
                Save
              </Text>
            )}
          </TouchableOpacity>
        </View>

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
                    styles.addPhotoBtn,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.surfaceRaised,
                      borderRadius: radii.full,
                    },
                  ]}
                >
                  <Ionicons name="image-outline" size={14} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text variant="xs" weight="700" style={{ color: colors.primary }}>
                    + Add photos
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {totalImagesCount === 0 ? (
              <View
                style={[
                  styles.emptyPhotosBox,
                  {
                    borderColor: colors.border,
                    borderRadius: radii.md,
                    backgroundColor: colors.surfaceRaised,
                  },
                ]}
              >
                <Ionicons name="images-outline" size={32} color={colors.textMuted} style={{ marginBottom: 6 }} />
                <Text variant="sm" color="muted">
                  No photos attached
                </Text>
                <TouchableOpacity
                  onPress={handlePickMoreImages}
                  style={{ marginTop: 8 }}
                >
                  <Text variant="sm" weight="700" style={{ color: colors.primary }}>
                    Add photos now
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
                      style={styles.removePhotoBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={22} color="#EF4444" />
                    </TouchableOpacity>

                    {/* Order Controls */}
                    <View style={styles.reorderBar}>
                      {idx > 0 && (
                        <TouchableOpacity
                          onPress={() => handleMoveExistingLeft(idx)}
                          style={styles.reorderBtn}
                        >
                          <Ionicons name="chevron-back" size={14} color="#ffffff" />
                        </TouchableOpacity>
                      )}
                      <Text style={styles.reorderIndexText}>{idx + 1}</Text>
                      {idx < existingImages.length - 1 && (
                        <TouchableOpacity
                          onPress={() => handleMoveExistingRight(idx)}
                          style={styles.reorderBtn}
                        >
                          <Ionicons name="chevron-forward" size={14} color="#ffffff" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}

                {/* Newly Added Photos List */}
                {newImages.map((asset, idx) => (
                  <View
                    key={`new-${asset.uri}-${idx}`}
                    style={[
                      styles.photoThumbnailContainer,
                      {
                        borderRadius: radii.md,
                        borderColor: colors.primary,
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
                    <View style={[styles.newBadge, { backgroundColor: colors.primary }]}>
                      <Text style={styles.newBadgeText}>NEW</Text>
                    </View>

                    {/* Remove Button */}
                    <TouchableOpacity
                      onPress={() => handleRemoveNewImage(idx)}
                      disabled={saving}
                      style={styles.removePhotoBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={22} color="#EF4444" />
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
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
  },
  emptyPhotosBox: {
    padding: 24,
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
  removePhotoBtn: {
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
});
