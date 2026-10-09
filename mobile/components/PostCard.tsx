import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Caption } from '@/components/ui/Typography';
import { Avatar } from '@/components/ui/Avatar';
import { PostMediaGallery } from '@/components/PostMediaGallery';
import { PostFileAttachments } from '@/components/PostFileAttachments';
import { Post } from '@/services/posts';
import { formatTimeAgo } from '@/utils/date';
import { FullScreenImageViewer } from '@/components/FullScreenImageViewer';

export interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onLike?: (postId: number) => void;
  onDoubleTapLike?: (postId: number) => void;
  onShare?: (post: Post) => void;
  onOpenDetail?: (post: Post) => void;
  onOpenMenu?: (post: Post) => void;
  onOpenFile?: (file: any) => void;
  getFullImageUrl: (url?: any) => string | null;
  showCommentsPreview?: boolean;
}

function getTypeBadgeProps(type: string, isOfficial: boolean | undefined, colors: any) {
  if (type === 'assignment') {
    return {
      label: 'ASSIGNMENT',
      bgColor: colors.surfaceRaised,
      borderColor: colors.border,
      textColor: colors.textSecondary,
      icon: 'document-text-outline' as const,
    };
  }
  return null;
}

function AnimatedLikeButton({
  liked,
  count,
  colors,
  onPress,
}: {
  liked: boolean;
  count: number;
  colors: any;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    if (!liked) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.45,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1.0,
          friction: 4,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.85,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1.0,
          duration: 80,
          useNativeDriver: true,
        }),
      ]).start();
    }
    onPress();
  };

  return (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={handlePress}
      accessibilityLabel={liked ? 'Unlike post' : 'Like post'}
      activeOpacity={0.7}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={18}
          color={liked ? '#EF4444' : colors.textMuted}
        />
      </Animated.View>
      <Text
        variant="xs"
        weight={liked ? '700' : '600'}
        style={{
          marginLeft: 5,
          color: liked ? '#EF4444' : colors.textSecondary,
        }}
      >
        {count}
      </Text>
    </TouchableOpacity>
  );
}

export function PostCard({
  post,
  currentUserId,
  onLike,
  onDoubleTapLike,
  onShare,
  onOpenDetail,
  onOpenMenu,
  onOpenFile,
  getFullImageUrl,
  showCommentsPreview = true,
}: PostCardProps) {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [avatarViewerVisible, setAvatarViewerVisible] = useState(false);

  const badge = getTypeBadgeProps(post.type, post.is_official, colors);
  const authorStudentId = post.studentId || post.user_id;
  const avatarUrl = getFullImageUrl(post.avatarUrl) || post.avatarUrl;

  const defaultOpenDetail = () => {
    if (onOpenDetail) {
      onOpenDetail(post);
    } else if (post.type === 'notice') {
      router.push(`/notice/${post.id}` as any);
    } else {
      router.push(`/post/${post.id}` as any);
    }
  };

  const handleAvatarPress = () => {
    if (avatarUrl) {
      setAvatarViewerVisible(true);
    } else if (authorStudentId) {
      router.push({
        pathname: '/user/[id]',
        params: { id: authorStudentId },
      });
    }
  };

  const handleAuthorPress = () => {
    if (authorStudentId) {
      router.push({
        pathname: '/user/[id]',
        params: { id: authorStudentId },
      });
    }
  };

  return (
    <View
      style={[
        styles.postItem,
        {
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
        },
      ]}
    >
      {/* Post Author & Header */}
      <View style={styles.postAuthorRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <TouchableOpacity activeOpacity={0.8} onPress={handleAvatarPress}>
            <Avatar
              url={avatarUrl}
              name={post.name}
              size="md"
            />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleAuthorPress}
            style={{ flex: 1, marginLeft: spacing.compact }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text variant="sm" weight="700" numberOfLines={1}>
                {post.name || 'Student'}
              </Text>
              {post.role && post.role !== 'student' && (
                <View
                  style={[
                    styles.rolePill,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: radii.sm,
                    },
                  ]}
                >
                  <Text variant="xs" weight="700" color="secondary" style={{ fontSize: 9 }}>
                    {post.role.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <Caption color="muted">
              {formatTimeAgo(post.created_at)}
              {(post.edited_at || post.edited) ? ' • Edited' : ''}
            </Caption>
          </TouchableOpacity>
        </View>

        {/* Right Header: Badge + Options Menu */}
        <View style={styles.authorRightActions}>
          {badge && (
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor: badge.bgColor,
                  borderColor: badge.borderColor,
                  borderRadius: radii.full,
                },
              ]}
            >
              <Ionicons name={badge.icon} size={11} color={badge.textColor} style={{ marginRight: 3 }} />
              <Text
                variant="xs"
                weight="700"
                style={{ color: badge.textColor, fontSize: 10 }}
              >
                {badge.label}
              </Text>
            </View>
          )}

          {onOpenMenu && (
            <TouchableOpacity
              onPress={() => onOpenMenu(post)}
              style={styles.optionsMenuBtn}
              accessibilityLabel="Post options"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.optionsMenuIcon, { color: colors.textSecondary }]}>
                {'\u22EE'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category, Audience, and Target Semester Monochrome Tags */}
      <View style={styles.postTagsRow}>
        <View style={[styles.monochromeBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          <Text variant="xs" weight="700" style={{ color: colors.textSecondary, fontSize: 10, textTransform: 'uppercase' }}>
            {post.category_label || (post.category ? post.category.toUpperCase() : 'GENERAL')}
          </Text>
        </View>
        {(post.visibility === 'students_only' || post.audience === 'students_only') && (
          <View style={[styles.monochromeBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong || colors.border }]}>
            <Text variant="xs" weight="700" style={{ color: colors.text, fontSize: 10, textTransform: 'uppercase' }}>
              STUDENTS ONLY
            </Text>
          </View>
        )}
        <View style={[styles.monochromeBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          <Text variant="xs" weight="600" style={{ color: colors.textMuted, fontSize: 10 }}>
            {post.semester_display || (post.allSemesters || post.target_all_semesters === 1 || !post.targetSemesters?.length ? 'All Semesters' : `Semester ${post.targetSemesters.join(', ')}`)}
          </Text>
        </View>
      </View>

      {/* Post Title (if present and NOT a General post) */}
      {post.category !== 'general' && Boolean(post.title && post.title.trim()) && (
        <TouchableOpacity activeOpacity={0.8} onPress={defaultOpenDetail} style={{ marginTop: 4 }}>
          <Text variant="sm" weight="700" style={{ color: colors.text, lineHeight: 20 }}>
            {post.title}
          </Text>
        </TouchableOpacity>
      )}

      {/* Post Text Content */}
      {Boolean(post.content && post.content.trim()) && (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={defaultOpenDetail}
          style={{ marginTop: spacing.sm }}
        >
          <Text
            variant="sm"
            style={[styles.postContent, { color: colors.text, lineHeight: 22 }]}
          >
            {(post.content || '').length > 240 && !expanded
              ? `${(post.content || '').slice(0, 240).trim()}... `
              : post.content}
            {(post.content || '').length > 240 && (
              <Text
                variant="sm"
                weight="700"
                color="secondary"
                onPress={() => setExpanded(!expanded)}
                suppressHighlighting
              >
                {expanded ? '  See less' : '  See more'}
              </Text>
            )}
          </Text>
        </TouchableOpacity>
      )}

      {/* Attached Images: Multi-photo gallery */}
      {((Array.isArray(post.media) && post.media.some((m) => (m.media_type || 'image') === 'image')) || post.attachment_url) && (
        <PostMediaGallery
          media={post.media ? post.media.filter((m) => (m.media_type || 'image') === 'image') : null}
          imageUrl={post.attachment_url}
          getFullUrl={getFullImageUrl}
          onDoubleTap={() => onDoubleTapLike ? onDoubleTapLike(post.id) : !post.liked_by_me && onLike?.(post.id)}
          postDetails={{ name: post.name, caption: post.content, uploadedAt: new Date(post.created_at).toLocaleString(), liked: Boolean(post.liked_by_me), likes: post.like_count || 0, comments: post.comment_count || 0 }}
          onLike={() => onLike?.(post.id)}
          onComments={defaultOpenDetail}
        />
      )}

      {/* Attached Documents & Files */}
      {Array.isArray(post.media) && post.media.some((m) => m.media_type === 'file') && (
        <PostFileAttachments
          files={post.media.filter((m) => m.media_type === 'file')}
          onOpenFile={(file) => onOpenFile && onOpenFile(file)}
        />
      )}

      {/* Post Engagement Actions */}
      <View style={styles.postActionRow}>
        {onLike && (
          <AnimatedLikeButton
            liked={Boolean(post.liked_by_me)}
            count={post.like_count || 0}
            colors={colors}
            onPress={() => onLike(post.id)}
          />
        )}

        {/* Comment Count Button */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={defaultOpenDetail}
          accessibilityLabel="View comments on post"
          activeOpacity={0.7}
        >
          <Ionicons name="chatbubble-outline" size={17} color={colors.textMuted} />
          <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 5 }}>
            {post.comment_count || 0}
          </Text>
        </TouchableOpacity>

        {/* Share Button */}
        {onShare && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => onShare(post)}
            accessibilityLabel="Share post"
            activeOpacity={0.7}
          >
            <Ionicons name="share-outline" size={17} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Assignment Submissions indicator */}
        {post.type === 'assignment' && (
          <View style={styles.actionButton}>
            <Ionicons name="document-text-outline" size={17} color={colors.textMuted} />
            <Text variant="xs" weight="600" color="secondary" style={{ marginLeft: 5 }}>
              {post.submission_count || 0} submissions
            </Text>
          </View>
        )}
      </View>

      {/* Comments Preview */}
      {showCommentsPreview && (post.comment_count || 0) > 0 && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={defaultOpenDetail}
          style={{
            marginTop: spacing.compact,
            paddingTop: spacing.tight,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.borderSubtle,
          }}
        >
          <Text variant="xs" color="muted">
            View all {post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Full-Screen Avatar Viewer Modal */}
      {Boolean(avatarUrl) && (
        <FullScreenImageViewer
          visible={avatarViewerVisible}
          imageUri={avatarUrl}
          imageTitle={post.name || 'Profile Picture'}
          onClose={() => setAvatarViewerVisible(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  postItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  postAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rolePill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  authorRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  optionsMenuBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  optionsMenuIcon: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  postContent: {
    fontSize: 14,
  },
  postActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  postTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  monochromeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
});
