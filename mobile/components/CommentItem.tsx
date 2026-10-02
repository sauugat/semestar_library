import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Caption } from '@/components/ui/Typography';
import { Avatar } from '@/components/ui/Avatar';
import { formatTimeAgo } from '@/utils/date';
import { PostComment } from '@/services/posts';

interface CommentItemProps {
  comment: PostComment;
  onReply: (comment: PostComment) => void;
  onEdit: (comment: PostComment) => void;
  onDelete: (comment: PostComment) => void;
  onToggleReaction: (comment: PostComment) => void;
  getFullUrl: (path?: any) => string | null;
  currentUserId?: string | null;
  isAdmin?: boolean;
}

export function CommentItem({
  comment,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  getFullUrl,
  currentUserId,
  isAdmin,
}: CommentItemProps) {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const [repliesExpanded, setRepliesExpanded] = useState(false);

  const isAuthor = Boolean(
    currentUserId && (comment.userId === currentUserId || comment.studentId === currentUserId)
  );
  const canDeleteComment = !comment.isDeleted && (comment.canDelete || isAuthor || isAdmin);
  const canEditComment = !comment.isDeleted && (comment.canEdit || isAuthor);

  const avatarUrl = getFullUrl(comment.avatarUrl);
  const isCommentAuthorAdmin = comment.role === 'admin';
  const isCR = comment.role === 'cr';

  const replies = comment.replies || [];
  const replyCount = comment.replyCount ?? replies.length;
  const hasReplies = replyCount > 0;

  const navigateToProfile = (studentId?: string | null) => {
    if (studentId) {
      router.push({ pathname: '/user/[id]', params: { id: studentId } });
    }
  };

  return (
    <View style={styles.container}>
      {/* Root Comment Container */}
      <View
        style={[
          styles.commentCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: comment.isDeleted ? 0.7 : 1,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={comment.isDeleted ? 1 : 0.7}
          onPress={() => !comment.isDeleted && navigateToProfile(comment.studentId)}
          disabled={Boolean(comment.isDeleted)}
        >
          <Avatar
            url={comment.isDeleted ? null : avatarUrl}
            name={comment.isDeleted ? '?' : comment.name}
            size="sm"
          />
        </TouchableOpacity>

        <View style={styles.commentContent}>
          {/* Header: Name, badges, time, options */}
          <View style={styles.commentHeader}>
            <TouchableOpacity
              activeOpacity={comment.isDeleted ? 1 : 0.7}
              onPress={() => !comment.isDeleted && navigateToProfile(comment.studentId)}
              disabled={Boolean(comment.isDeleted)}
              style={styles.nameRow}
            >
              <Text variant="sm" weight="700" numberOfLines={1}>
                {comment.isDeleted ? 'Deleted Comment' : comment.name}
              </Text>

              {!comment.isDeleted && isCommentAuthorAdmin && (
                <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}>
                  <Text variant="xs" weight="700" style={{ color: colors.primary, fontSize: 9 }}>
                    Admin
                  </Text>
                </View>
              )}

              {!comment.isDeleted && isCR && (
                <View style={[styles.badge, { backgroundColor: colors.surfaceRaised }]}>
                  <Text variant="xs" weight="700" style={{ color: colors.textSecondary, fontSize: 9 }}>
                    CR
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.rightHeaderActions}>
              <Caption color="muted" style={styles.timeText}>
                {formatTimeAgo(comment.createdAt)}
              </Caption>
              {comment.edited && !comment.isDeleted && (
                <Caption color="muted" style={styles.editedText}>
                  · edited
                </Caption>
              )}
            </View>
          </View>

          {/* Comment Body */}
          <Text
            variant="sm"
            style={[
              styles.commentBody,
              {
                color: comment.isDeleted ? colors.textMuted : colors.text,
                fontStyle: comment.isDeleted ? 'italic' : 'normal',
              },
            ]}
            selectable={!comment.isDeleted}
          >
            {comment.content}
          </Text>

          {/* Action Row: Like, Reply, Edit, Delete */}
          {!comment.isDeleted && (
            <View style={styles.actionRow}>
              {/* Like / Heart Reaction Button */}
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => onToggleReaction(comment)}
                style={styles.actionBtn}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              >
                <Ionicons
                  name={comment.reactedByMe ? 'heart' : 'heart-outline'}
                  size={15}
                  color={comment.reactedByMe ? (colors.error || '#EF4444') : colors.textSecondary}
                />
                {(comment.reactionCount ?? 0) > 0 && (
                  <Text
                    variant="xs"
                    weight={comment.reactedByMe ? '700' : '500'}
                    style={{
                      marginLeft: 4,
                      color: comment.reactedByMe ? (colors.error || '#EF4444') : colors.textSecondary,
                      fontSize: 12,
                    }}
                  >
                    {comment.reactionCount}
                  </Text>
                )}
              </TouchableOpacity>

              <Text variant="xs" color="muted" style={styles.bulletDot}>
                ·
              </Text>

              {/* Reply Button */}
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => onReply(comment)}
                style={styles.actionBtn}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              >
                <Text variant="xs" weight="600" color="secondary" style={{ fontSize: 12 }}>
                  Reply
                </Text>
              </TouchableOpacity>

              {/* Edit Button (author only) */}
              {canEditComment && (
                <>
                  <Text variant="xs" color="muted" style={styles.bulletDot}>
                    ·
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => onEdit(comment)}
                    style={styles.actionBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  >
                    <Ionicons name="pencil-outline" size={13} color={colors.textSecondary} />
                  </TouchableOpacity>
                </>
              )}

              {/* Delete Button (author or admin) */}
              {canDeleteComment && (
                <>
                  <Text variant="xs" color="muted" style={styles.bulletDot}>
                    ·
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => onDelete(comment)}
                    style={styles.actionBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  >
                    <Ionicons name="trash-outline" size={13} color={colors.error || '#EF4444'} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Expand / Collapse Replies Toggle */}
      {hasReplies && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setRepliesExpanded(!repliesExpanded)}
          style={[styles.threadToggleBtn, { marginLeft: 44 }]}
        >
          <View style={[styles.threadGuideLineHorizontal, { backgroundColor: colors.border }]} />
          <Ionicons
            name={repliesExpanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.primary}
            style={{ marginRight: 4 }}
          />
          <Text variant="xs" weight="700" color="primary">
            {repliesExpanded
              ? 'Hide replies'
              : `View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
          </Text>
        </TouchableOpacity>
      )}

      {/* Replies List (Flattened under Root Comment) */}
      {hasReplies && repliesExpanded && (
        <View style={styles.repliesListContainer}>
          {replies.map((reply) => {
            const replyAvatar = getFullUrl(reply.avatarUrl);
            const isReplyAuthor = Boolean(
              currentUserId && (reply.userId === currentUserId || reply.studentId === currentUserId)
            );
            const canDeleteReply = !reply.isDeleted && (reply.canDelete || isReplyAuthor || isAdmin);
            const canEditReply = !reply.isDeleted && (reply.canEdit || isReplyAuthor);
            const isReplyAdmin = reply.role === 'admin';

            return (
              <View key={reply.id} style={styles.replyRow}>
                {/* Visual Thread Guide Line */}
                <View style={[styles.threadGuideLineVertical, { backgroundColor: colors.border }]} />

                {/* Reply Bubble Card */}
                <View
                  style={[
                    styles.replyCard,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                      opacity: reply.isDeleted ? 0.7 : 1,
                    },
                  ]}
                >
                  <TouchableOpacity
                    activeOpacity={reply.isDeleted ? 1 : 0.7}
                    onPress={() => !reply.isDeleted && navigateToProfile(reply.studentId)}
                    disabled={Boolean(reply.isDeleted)}
                  >
                    <Avatar
                      url={reply.isDeleted ? null : replyAvatar}
                      name={reply.isDeleted ? '?' : reply.name}
                      size="xs"
                    />
                  </TouchableOpacity>

                  <View style={styles.commentContent}>
                    {/* Header */}
                    <View style={styles.commentHeader}>
                      <TouchableOpacity
                        activeOpacity={reply.isDeleted ? 1 : 0.7}
                        onPress={() => !reply.isDeleted && navigateToProfile(reply.studentId)}
                        disabled={Boolean(reply.isDeleted)}
                        style={styles.nameRow}
                      >
                        <Text variant="xs" weight="700" numberOfLines={1}>
                          {reply.isDeleted ? 'Deleted Reply' : reply.name}
                        </Text>
                        {!reply.isDeleted && isReplyAdmin && (
                          <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}>
                            <Text variant="xs" weight="700" style={{ color: colors.primary, fontSize: 8 }}>
                              Admin
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>

                      <View style={styles.rightHeaderActions}>
                        <Caption color="muted" style={styles.timeText}>
                          {formatTimeAgo(reply.createdAt)}
                        </Caption>
                        {reply.edited && !reply.isDeleted && (
                          <Caption color="muted" style={styles.editedText}>
                            · edited
                          </Caption>
                        )}
                      </View>
                    </View>

                    {/* Content with Reply-to Mention */}
                    <Text
                      variant="sm"
                      style={[
                        styles.commentBody,
                        {
                          color: reply.isDeleted ? colors.textMuted : colors.text,
                          fontStyle: reply.isDeleted ? 'italic' : 'normal',
                        },
                      ]}
                      selectable={!reply.isDeleted}
                    >
                      {!reply.isDeleted && reply.replyToUser?.name && (
                        <Text
                          variant="sm"
                          weight="700"
                          style={{ color: colors.primary }}
                          onPress={() => navigateToProfile(reply.replyToUser?.studentId)}
                        >
                          @{reply.replyToUser.name}{' '}
                        </Text>
                      )}
                      {reply.content}
                    </Text>

                    {/* Actions: Like, Reply, Edit, Delete */}
                    {!reply.isDeleted && (
                      <View style={styles.actionRow}>
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => onToggleReaction(reply)}
                          style={styles.actionBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        >
                          <Ionicons
                            name={reply.reactedByMe ? 'heart' : 'heart-outline'}
                            size={14}
                            color={reply.reactedByMe ? (colors.error || '#EF4444') : colors.textSecondary}
                          />
                          {(reply.reactionCount ?? 0) > 0 && (
                            <Text
                              variant="xs"
                              weight={reply.reactedByMe ? '700' : '500'}
                              style={{
                                marginLeft: 4,
                                color: reply.reactedByMe ? (colors.error || '#EF4444') : colors.textSecondary,
                                fontSize: 11,
                              }}
                            >
                              {reply.reactionCount}
                            </Text>
                          )}
                        </TouchableOpacity>

                        <Text variant="xs" color="muted" style={styles.bulletDot}>
                          ·
                        </Text>

                        {/* Reply to this reply */}
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => onReply(reply)}
                          style={styles.actionBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        >
                          <Text variant="xs" weight="600" color="secondary" style={{ fontSize: 11 }}>
                            Reply
                          </Text>
                        </TouchableOpacity>

                        {canEditReply && (
                          <>
                            <Text variant="xs" color="muted" style={styles.bulletDot}>
                              ·
                            </Text>
                            <TouchableOpacity
                              activeOpacity={0.7}
                              onPress={() => onEdit(reply)}
                              style={styles.actionBtn}
                              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                            >
                              <Ionicons name="pencil-outline" size={12} color={colors.textSecondary} />
                            </TouchableOpacity>
                          </>
                        )}

                        {canDeleteReply && (
                          <>
                            <Text variant="xs" color="muted" style={styles.bulletDot}>
                              ·
                            </Text>
                            <TouchableOpacity
                              activeOpacity={0.7}
                              onPress={() => onDelete(reply)}
                              style={styles.actionBtn}
                              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                            >
                              <Ionicons name="trash-outline" size={12} color={colors.error || '#EF4444'} />
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  commentCard: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  commentContent: {
    flex: 1,
    marginLeft: 10,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  rightHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    fontSize: 11,
  },
  editedText: {
    fontSize: 11,
  },
  commentBody: {
    lineHeight: 20,
    marginTop: 2,
    marginBottom: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  bulletDot: {
    marginHorizontal: 8,
    fontSize: 11,
  },
  threadToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingVertical: 4,
  },
  threadGuideLineHorizontal: {
    width: 16,
    height: 1.5,
    marginRight: 6,
  },
  repliesListContainer: {
    marginTop: 8,
    marginLeft: 22,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 8,
  },
  threadGuideLineVertical: {
    width: 2,
    marginRight: 10,
    borderRadius: 1,
  },
  replyCard: {
    flex: 1,
    flexDirection: 'row',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
});
