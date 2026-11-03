import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import { Avatar } from '@/components/ui/Avatar';
import { safeParseDate } from '@/utils/date';
import { PostComment } from '@/services/posts';

interface CommentItemProps {
  comment: PostComment;
  onReply?: (comment: PostComment) => void;
  onEdit?: (comment: PostComment) => void;
  onDelete: (comment: PostComment) => void;
  onToggleReaction?: (comment: PostComment) => void;
  getFullUrl: (path?: any) => string | null;
  currentUserId?: string | null;
  isAdmin?: boolean;
  highlightCommentId?: number | null;
  onNavigateProfile?: (studentId: string) => void;
}

function formatCompactTime(dateVal: unknown): string {
  const date = safeParseDate(dateVal);
  if (!date) return 'now';
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return 'now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 52) return `${diffWeek}w`;
  return `${Math.floor(diffWeek / 52)}y`;
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
  highlightCommentId,
  onNavigateProfile,
}: CommentItemProps) {
  const router = useRouter();
  const { colors } = useTheme();

  const replies = comment.replies || [];
  const replyCount = comment.replyCount ?? replies.length;
  const hasReplies = replyCount > 0;

  // Auto-expand replies if the highlighted comment is one of the replies
  const containsHighlightedReply = Boolean(
    highlightCommentId && replies.some((r) => r.id === highlightCommentId)
  );
  const [repliesExpanded, setRepliesExpanded] = useState(containsHighlightedReply);

  React.useEffect(() => {
    if (containsHighlightedReply) {
      setRepliesExpanded(true);
    }
  }, [containsHighlightedReply]);

  const isHighlighted = highlightCommentId != null && comment.id === highlightCommentId;

  const isAuthor = Boolean(
    currentUserId && (comment.userId === currentUserId || comment.studentId === currentUserId)
  );
  const canDeleteComment = !comment.isDeleted && (comment.canDelete || isAuthor || isAdmin);
  const canEditComment = !comment.isDeleted && Boolean(onEdit) && (comment.canEdit || isAuthor);

  const avatarUrl = getFullUrl(comment.avatarUrl);
  const roleLower = (comment.role || '').toLowerCase();
  const roleBadgeLabel =
    roleLower === 'admin'
      ? 'Admin'
      : roleLower === 'teacher' || roleLower === 'faculty'
      ? 'Teacher'
      : roleLower === 'cr'
      ? 'CR'
      : null;

  const navigateToProfile = (studentId?: string | null) => {
    if (!studentId) return;
    if (onNavigateProfile) {
      onNavigateProfile(studentId);
      return;
    }
    router.push({ pathname: '/user/[id]', params: { id: studentId } });
  };

  return (
    <View style={styles.container}>
      {/* Flat Instagram-style Root Comment Row */}
      <View
        style={[
          styles.commentRow,
          isHighlighted && {
            backgroundColor: colors.surfaceRaised,
            borderRadius: 12,
          },
          comment.isDeleted && { opacity: 0.65 },
        ]}
      >
        <Avatar
          url={comment.isDeleted ? null : avatarUrl}
          name={comment.isDeleted ? '?' : comment.name}
          size="sm"
          onPress={!comment.isDeleted ? () => navigateToProfile(comment.studentId) : undefined}
        />

        <View style={styles.commentCenter}>
          {/* Top line: Username + compact relative time + role badge */}
          <View style={styles.headerLine}>
            <TouchableOpacity
              activeOpacity={comment.isDeleted ? 1 : 0.7}
              onPress={() => !comment.isDeleted && navigateToProfile(comment.studentId)}
              disabled={Boolean(comment.isDeleted)}
              style={styles.nameGroup}
            >
              <Text weight="700" numberOfLines={1} style={[styles.usernameText, { color: colors.text }]}>
                {comment.isDeleted ? 'Deleted Comment' : comment.name || 'Student'}
              </Text>

              {!comment.isDeleted && roleBadgeLabel && (
                <View style={[styles.roleBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                  <Text weight="700" style={{ color: colors.textSecondary, fontSize: 9 }}>
                    {roleBadgeLabel}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={[styles.timeText, { color: colors.textMuted }]}>
              {formatCompactTime(comment.createdAt || (comment as any).created_at)}
            </Text>

            {comment.edited && !comment.isDeleted && (
              <Text style={[styles.editedText, { color: colors.textMuted }]}>
                · edited
              </Text>
            )}
          </View>

          {/* Comment Text Body */}
          <Text
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

          {/* Sub-action links below comment: Reply, Edit, Delete */}
          {!comment.isDeleted && (
            <View style={styles.subActionRow}>
              {onReply && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => onReply(comment)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                >
                  <Text weight="600" style={[styles.subActionText, { color: colors.textMuted }]}>
                    Reply
                  </Text>
                </TouchableOpacity>
              )}

              {canEditComment && onEdit && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => onEdit(comment)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                >
                  <Text weight="600" style={[styles.subActionText, { color: colors.textMuted }]}>
                    Edit
                  </Text>
                </TouchableOpacity>
              )}

              {canDeleteComment && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => onDelete(comment)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                >
                  <Text weight="600" style={[styles.subActionText, { color: colors.error || '#EF4444' }]}>
                    Delete
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Right Heart Reaction Column (Heart icon on top, count stacked directly underneath) */}
        {!comment.isDeleted && onToggleReaction && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onToggleReaction(comment)}
            style={styles.likeColumn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={comment.reactedByMe ? 'heart' : 'heart-outline'}
              size={16}
              color={comment.reactedByMe ? '#FF2D55' : colors.textMuted}
            />
            {(comment.reactionCount ?? 0) > 0 && (
              <Text
                weight={comment.reactedByMe ? '700' : '500'}
                style={[
                  styles.likeCountText,
                  { color: comment.reactedByMe ? '#FF2D55' : colors.textMuted },
                ]}
              >
                {comment.reactionCount}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Expand / Collapse Replies Line ("— View N more replies") */}
      {hasReplies && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setRepliesExpanded(!repliesExpanded)}
          style={styles.threadToggleBtn}
        >
          <View style={[styles.threadGuideLineHorizontal, { backgroundColor: colors.borderStrong || colors.border }]} />
          <Text weight="600" style={[styles.viewRepliesText, { color: colors.textSecondary }]}>
            {repliesExpanded
              ? 'Hide replies'
              : `View ${replyCount} more ${replyCount === 1 ? 'reply' : 'replies'}`}
          </Text>
        </TouchableOpacity>
      )}

      {/* Indented Replies List */}
      {hasReplies && repliesExpanded && (
        <View style={styles.repliesListContainer}>
          {replies.map((reply) => {
            const replyAvatar = getFullUrl(reply.avatarUrl);
            const isReplyAuthor = Boolean(
              currentUserId && (reply.userId === currentUserId || reply.studentId === currentUserId)
            );
            const canDeleteReply = !reply.isDeleted && (reply.canDelete || isReplyAuthor || isAdmin);
            const canEditReply = !reply.isDeleted && Boolean(onEdit) && (reply.canEdit || isReplyAuthor);
            const replyRoleLower = (reply.role || '').toLowerCase();
            const replyBadge =
              replyRoleLower === 'admin'
                ? 'Admin'
                : replyRoleLower === 'teacher' || replyRoleLower === 'faculty'
                ? 'Teacher'
                : replyRoleLower === 'cr'
                ? 'CR'
                : null;
            const isReplyHighlighted = highlightCommentId != null && reply.id === highlightCommentId;

            return (
              <View
                key={reply.id}
                style={[
                  styles.replyRow,
                  isReplyHighlighted && {
                    backgroundColor: colors.surfaceRaised,
                    borderRadius: 10,
                  },
                  reply.isDeleted && { opacity: 0.65 },
                ]}
              >
                <Avatar
                  url={reply.isDeleted ? null : replyAvatar}
                  name={reply.isDeleted ? '?' : reply.name}
                  size="xs"
                  onPress={!reply.isDeleted ? () => navigateToProfile(reply.studentId) : undefined}
                />

                <View style={styles.replyCenter}>
                  <View style={styles.headerLine}>
                    <TouchableOpacity
                      activeOpacity={reply.isDeleted ? 1 : 0.7}
                      onPress={() => !reply.isDeleted && navigateToProfile(reply.studentId)}
                      disabled={Boolean(reply.isDeleted)}
                      style={styles.nameGroup}
                    >
                      <Text weight="700" numberOfLines={1} style={[styles.replyUsernameText, { color: colors.text }]}>
                        {reply.isDeleted ? 'Deleted Reply' : reply.name || 'Student'}
                      </Text>
                      {!reply.isDeleted && replyBadge && (
                        <View style={[styles.roleBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                          <Text weight="700" style={{ color: colors.textSecondary, fontSize: 8 }}>
                            {replyBadge}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    <Text style={[styles.timeText, { color: colors.textMuted }]}>
                      {formatCompactTime(reply.createdAt || (reply as any).created_at)}
                    </Text>

                    {reply.edited && !reply.isDeleted && (
                      <Text style={[styles.editedText, { color: colors.textMuted }]}>
                        · edited
                      </Text>
                    )}
                  </View>

                  <Text
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
                        weight="600"
                        style={{ color: colors.primary, fontSize: 13.5 }}
                        onPress={() => navigateToProfile(reply.replyToUser?.studentId)}
                      >
                        @{reply.replyToUser.name}{' '}
                      </Text>
                    )}
                    {reply.content}
                  </Text>

                  {!reply.isDeleted && (
                    <View style={styles.subActionRow}>
                      {onReply && (
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => onReply(reply)}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                        >
                          <Text weight="600" style={[styles.subActionText, { color: colors.textMuted }]}>
                            Reply
                          </Text>
                        </TouchableOpacity>
                      )}

                      {canEditReply && onEdit && (
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => onEdit(reply)}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                        >
                          <Text weight="600" style={[styles.subActionText, { color: colors.textMuted }]}>
                            Edit
                          </Text>
                        </TouchableOpacity>
                      )}

                      {canDeleteReply && (
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => onDelete(reply)}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                        >
                          <Text weight="600" style={[styles.subActionText, { color: colors.error || '#EF4444' }]}>
                            Delete
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>

                {!reply.isDeleted && onToggleReaction && (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => onToggleReaction(reply)}
                    style={styles.likeColumn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name={reply.reactedByMe ? 'heart' : 'heart-outline'}
                      size={14}
                      color={reply.reactedByMe ? '#FF2D55' : colors.textMuted}
                    />
                    {(reply.reactionCount ?? 0) > 0 && (
                      <Text
                        weight={reply.reactedByMe ? '700' : '500'}
                        style={[
                          styles.likeCountText,
                          { color: reply.reactedByMe ? '#FF2D55' : colors.textMuted },
                        ]}
                      >
                        {reply.reactionCount}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
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
    marginBottom: 14,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  commentCenter: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  nameGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  usernameText: {
    fontSize: 13,
    lineHeight: 17,
  },
  replyUsernameText: {
    fontSize: 12.5,
    lineHeight: 16,
  },
  roleBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  timeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  editedText: {
    fontSize: 11,
    lineHeight: 16,
  },
  commentBody: {
    fontSize: 14,
    lineHeight: 19,
    marginTop: 2,
  },
  subActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 5,
  },
  subActionText: {
    fontSize: 12,
    lineHeight: 16,
  },
  likeColumn: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
    minWidth: 28,
  },
  likeCountText: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  threadToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 48,
    marginTop: 6,
    paddingVertical: 3,
  },
  threadGuideLineHorizontal: {
    width: 24,
    height: 1,
    marginRight: 10,
  },
  viewRepliesText: {
    fontSize: 12,
  },
  repliesListContainer: {
    marginTop: 8,
    marginLeft: 48,
    gap: 10,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 2,
  },
  replyCenter: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
});
