import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
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
import { PostMarkdown } from '@/components/PostMarkdown';

export interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onLike?: (postId: number, direction?: 'up' | 'down') => void;
  onVote?: (postId: number, direction: 'up' | 'down') => void;
  onDoubleTapLike?: (postId: number) => void;
  onShare?: (post: Post) => void;
  onOpenDetail?: (post: Post) => void;
  onOpenComments?: (post: Post) => void;
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

export function VoteButtons({
  upCount,
  downCount,
  myVote,
  colors,
  onVote,
}: {
  upCount: number;
  downCount: number;
  myVote: number;
  colors: any;
  onVote: (direction: 'up' | 'down') => void;
}) {
  const upScale = useRef(new Animated.Value(1)).current;
  const downScale = useRef(new Animated.Value(1)).current;

  const isUp = myVote === 1;
  const isDown = myVote === -1;

  const handleUp = () => {
    Animated.sequence([
      Animated.timing(upScale, { toValue: 1.35, duration: 100, useNativeDriver: true }),
      Animated.spring(upScale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    onVote('up');
  };

  const handleDown = () => {
    Animated.sequence([
      Animated.timing(downScale, { toValue: 1.35, duration: 100, useNativeDriver: true }),
      Animated.spring(downScale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    onVote('down');
  };

  return (
    <View
      style={[
        styles.votePill,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.border,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.voteHalfBtn}
        onPress={handleUp}
        accessibilityLabel="Upvote post"
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 4 }}
      >
        <Animated.View style={{ transform: [{ scale: upScale }] }}>
          <Ionicons
            name={isUp ? 'arrow-up' : 'arrow-up-outline'}
            size={16}
            color={isUp ? '#FF4500' : colors.textMuted}
          />
        </Animated.View>
        <Text
          variant="xs"
          weight={isUp ? '700' : '600'}
          style={{
            marginLeft: 4,
            color: isUp ? '#FF4500' : colors.textSecondary,
          }}
        >
          {upCount}
        </Text>
      </TouchableOpacity>

      <View style={[styles.voteDivider, { backgroundColor: colors.border }]} />

      <TouchableOpacity
        style={styles.voteHalfBtn}
        onPress={handleDown}
        accessibilityLabel="Downvote post"
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}
      >
        <Animated.View style={{ transform: [{ scale: downScale }] }}>
          <Ionicons
            name={isDown ? 'arrow-down' : 'arrow-down-outline'}
            size={16}
            color={isDown ? '#6366F1' : colors.textMuted}
          />
        </Animated.View>
        <Text
          variant="xs"
          weight={isDown ? '700' : '600'}
          style={{
            marginLeft: 4,
            color: isDown ? '#6366F1' : colors.textSecondary,
          }}
        >
          {downCount}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export function PostCard({
  post,
  currentUserId,
  onLike,
  onVote,
  onDoubleTapLike,
  onShare,
  onOpenDetail,
  onOpenComments,
  onOpenMenu,
  onOpenFile,
  getFullImageUrl,
  showCommentsPreview = true,
}: PostCardProps) {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const badge = getTypeBadgeProps(post.type, post.is_official, colors);
  const authorStudentId = post.studentId || post.user_id;
  const rawAvatar =
    post.avatarUrl ||
    (post as any).avatarurl ||
    (post as any).avatar_url ||
    (post as any).authorAvatar ||
    (post as any).uploaderAvatar ||
    null;
  const avatarUrl = getFullImageUrl(rawAvatar) || rawAvatar;

  const upCount = Number(post.up_count ?? post.upCount ?? post.like_count ?? 0);
  const downCount = Number(post.down_count ?? post.downCount ?? 0);
  const myVote = Number(post.my_vote ?? post.myVote ?? (post.liked_by_me ? 1 : 0));

  const defaultOpenDetail = () => {
    if (onOpenDetail) {
      onOpenDetail(post);
    } else if (post.type === 'notice') {
      router.push(`/notice/${post.id}` as any);
    } else {
      router.push(`/post/${post.id}` as any);
    }
  };

  const handlePressComments = () => {
    if (onOpenComments) {
      onOpenComments(post);
    } else {
      defaultOpenDetail();
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

  const handleVoteDirection = (direction: 'up' | 'down') => {
    if (onVote) {
      onVote(post.id, direction);
    } else if (onLike) {
      onLike(post.id, direction);
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
          <TouchableOpacity activeOpacity={0.8} onPress={handleAuthorPress}>
            <Avatar
              url={avatarUrl}
              studentId={authorStudentId}
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
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category and Audience Monochrome Tags (omits General) */}
      {(() => {
        const cat = (post.category_label || post.category || '').trim();
        const isGeneral = !cat || cat.toLowerCase() === 'general';
        const isStudentsOnly = post.visibility === 'students_only' || post.audience === 'students_only';

        if (isGeneral && !isStudentsOnly) {
          return null;
        }

        return (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={defaultOpenDetail}
            style={styles.postTagsRow}
          >
            {!isGeneral && (
              <View style={[styles.monochromeBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                <Text variant="xs" weight="700" style={{ color: colors.textSecondary, fontSize: 10, textTransform: 'uppercase' }}>
                  {post.category_label || (post.category ? post.category.toUpperCase() : '')}
                </Text>
              </View>
            )}
            {isStudentsOnly && (
              <View style={[styles.monochromeBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong || colors.border }]}>
                <Text variant="xs" weight="700" style={{ color: colors.text, fontSize: 10, textTransform: 'uppercase' }}>
                  STUDENTS ONLY
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })()}

      {/* Post Title (for Notice, Announcement, News, Complaints, Feedback, Assignment) */}
      {Boolean(post.title && post.title.trim()) && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={defaultOpenDetail}
          style={{ marginTop: spacing.xs, marginBottom: 2 }}
        >
          <Text variant="sm" weight="700" style={{ color: colors.text, fontSize: 15 }}>
            {post.title}
          </Text>
        </TouchableOpacity>
      )}

      {/* Post Text Content */}
      {Boolean(post.content && post.content.trim()) && (
        <View style={{ marginTop: spacing.sm }}>
          <PostMarkdown
            content={post.content}
            isExpanded={expanded}
            onToggleExpand={() => setExpanded(!expanded)}
            maxPreviewLength={240}
            onPressText={defaultOpenDetail}
          />
        </View>
      )}

      {/* Attached Images: Multi-photo gallery */}
      {((Array.isArray(post.media) && post.media.some((m) => (m.media_type || 'image') === 'image')) || post.attachment_url) && (
        <PostMediaGallery
          media={post.media ? post.media.filter((m) => (m.media_type || 'image') === 'image') : null}
          imageUrl={post.attachment_url}
          getFullUrl={getFullImageUrl}
          onDoubleTap={() => onDoubleTapLike ? onDoubleTapLike(post.id) : (myVote !== 1 && handleVoteDirection('up'))}
          postDetails={{ name: post.name, caption: post.content, uploadedAt: new Date(post.created_at).toLocaleString(), liked: myVote === 1, likes: upCount, comments: post.comment_count || 0 }}
          onLike={() => handleVoteDirection('up')}
          onComments={handlePressComments}
        />
      )}

      {/* Attached Documents & Files */}
      {Array.isArray(post.media) && post.media.some((m) => m.media_type === 'file') && (
        <PostFileAttachments
          files={post.media.filter((m) => m.media_type === 'file')}
          onOpenFile={(file) => onOpenFile && onOpenFile(file)}
        />
      )}

      {/* Post Engagement Actions: Modern Reddit-style Upvote/Downvote + Comments + Share */}
      <View style={styles.postActionRow}>
        {(onLike || onVote) && (
          <VoteButtons
            upCount={upCount}
            downCount={downCount}
            myVote={myVote}
            colors={colors}
            onVote={handleVoteDirection}
          />
        )}

        {/* Comment Count Button */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handlePressComments}
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
    marginTop: 14,
    gap: 14,
  },
  votePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  voteHalfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  voteDivider: {
    width: 1,
    height: 14,
    marginHorizontal: 2,
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
    marginTop: 6,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  monochromeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
});
