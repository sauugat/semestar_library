import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Share,
  Alert,
  Modal,
  TextInput,
  type TextInputInstance,
  type ScrollViewInstance,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { StickyComposer, KeyboardContentBoundary } from '@/components/ui/StickyComposer';
import { queryClient } from '@/services/query-client';
import {
  getPostById,
  getComments,
  addComment,
  editComment,
  deleteComment,
  toggleCommentReaction,
  votePost,
  Post,
  PostComment,
} from '@/services/posts';
import { CommentItem } from '@/components/CommentItem';
import { CommentComposerBar } from '@/components/CommentComposerBar';
import { VoteButtons } from '@/components/PostCard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate } from '@/utils/date';

export default function NoticeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const noticeId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();
  const { user, serverUrl } = useAuth();
  const scrollViewRef = useRef<ScrollViewInstance>(null);
  const inputRef = useRef<TextInputInstance>(null);

  const cachedInitialNotice = React.useMemo(() => {
    if (!noticeId || isNaN(noticeId)) return null;
    const feed = queryClient.getQueryData<{ posts: Post[] }>(['campus-feed', user?.studentId]);
    return feed?.posts?.find((p) => Number(p.id) === noticeId) || null;
  }, [noticeId, user?.studentId]);

  const [notice, setNotice] = useState<Post | null>(cachedInitialNotice);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(!cachedInitialNotice);
  const [refreshing, setRefreshing] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{
    commentId: number;
    name: string;
    studentId?: string;
  } | null>(null);
  const [editingComment, setEditingComment] = useState<{
    id: number;
    content: string;
  } | null>(null);

  const getFullUrl = useCallback(
    (path?: string | null) => {
      if (!path) return null;
      if (path.startsWith('http://') || path.startsWith('https://')) return path;
      const base = (serverUrl || '').replace(/\/+$/, '');
      const clean = path.replace(/^\/+/, '');
      return `${base}/${clean}`;
    },
    [serverUrl]
  );

  const formatFullDate = (dateVal?: unknown) => {
    return formatDate(dateVal, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const loadNotice = useCallback(async () => {
    if (!noticeId || isNaN(noticeId)) return;
    try {
      const [data, fetchedComments] = await Promise.all([
        getPostById(noticeId).catch(() => null),
        getComments(noticeId).catch(() => []),
      ]);
      if (data) {
        setNotice(data);
      }
      setComments(fetchedComments || []);
    } catch (err) {
      console.warn('Could not load notice:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [noticeId]);

  useEffect(() => {
    loadNotice();
  }, [loadNotice]);

  const onRefresh = () => {
    setRefreshing(true);
    loadNotice();
  };

  const handleVote = async (direction: 'up' | 'down') => {
    if (!notice) return;
    const prevUp = Number(notice.up_count ?? notice.upCount ?? notice.like_count ?? 0);
    const prevDown = Number(notice.down_count ?? notice.downCount ?? 0);
    const prevVote = Number(notice.my_vote ?? notice.myVote ?? (notice.liked_by_me ? 1 : 0));
    const desiredVote = direction === 'down' ? -1 : 1;
    const nextVote = prevVote === desiredVote ? 0 : desiredVote;
    const nextUp = Math.max(0, prevUp + (nextVote === 1 ? 1 : 0) - (prevVote === 1 ? 1 : 0));
    const nextDown = Math.max(0, prevDown + (nextVote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0));

    setNotice({
      ...notice,
      up_count: nextUp,
      down_count: nextDown,
      my_vote: nextVote,
      upCount: nextUp,
      downCount: nextDown,
      myVote: nextVote,
      liked_by_me: nextVote === 1,
      like_count: nextUp,
    });

    try {
      const res = await votePost(notice.id, direction);
      const finalUp = Number(res.up_count ?? res.upCount ?? res.like_count ?? nextUp);
      const finalDown = Number(res.down_count ?? res.downCount ?? nextDown);
      const finalVote = Number(res.my_vote ?? res.myVote ?? nextVote);
      setNotice((prev) =>
        prev
          ? {
              ...prev,
              up_count: finalUp,
              down_count: finalDown,
              my_vote: finalVote,
              upCount: finalUp,
              downCount: finalDown,
              myVote: finalVote,
              liked_by_me: finalVote === 1,
              like_count: finalUp,
            }
          : null
      );
    } catch {
      setNotice((prev) =>
        prev
          ? {
              ...prev,
              up_count: prevUp,
              down_count: prevDown,
              my_vote: prevVote,
              upCount: prevUp,
              downCount: prevDown,
              myVote: prevVote,
              liked_by_me: prevVote === 1,
              like_count: prevUp,
            }
          : null
      );
    }
  };

  const handleShare = async () => {
    if (!notice) return;
    try {
      await Share.share({
        title: `Official Notice: ${notice.name}`,
        message: `[Official Notice from ${notice.name}]\n\n${notice.content}\n\n— Semester Library`,
      });
    } catch {}
  };

  const handleReplyPress = (comment: PostComment) => {
    setEditingComment(null);
    setReplyingTo({
      commentId: comment.id,
      name: comment.name || 'User',
      studentId: comment.studentId || comment.userId,
    });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleEditPress = (comment: PostComment) => {
    setReplyingTo(null);
    setEditingComment({ id: comment.id, content: comment.content });
    setCommentText(comment.content);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleCancelInputMode = () => {
    setReplyingTo(null);
    setEditingComment(null);
    setCommentText('');
  };

  const handleSubmitComment = async () => {
    if (!notice || !commentText.trim() || submittingComment) return;
    const text = commentText.trim();
    setSubmittingComment(true);

    try {
      if (editingComment) {
        const res = await editComment(notice.id, editingComment.id, text);
        setComments((prev) =>
          prev.map((root) => {
            if (root.id === editingComment.id) return { ...root, ...res.comment };
            if (root.replies && root.replies.length > 0) {
              return {
                ...root,
                replies: root.replies.map((r) => (r.id === editingComment.id ? { ...r, ...res.comment } : r)),
              };
            }
            return root;
          })
        );
        setEditingComment(null);
        setCommentText('');
      } else if (replyingTo) {
        const res = await addComment(notice.id, text, {
          parentCommentId: replyingTo.commentId,
          replyToUserId: replyingTo.studentId,
        });
        setCommentText('');
        setReplyingTo(null);
        if (res.comment) {
          const targetParentId = res.comment.parentCommentId;
          setComments((prev) =>
            prev.map((root) => {
              if (root.id === targetParentId) {
                const currentReplies = root.replies || [];
                return {
                  ...root,
                  replyCount: (root.replyCount || currentReplies.length) + 1,
                  replies: [...currentReplies, res.comment],
                };
              }
              return root;
            })
          );
          setNotice((prev) =>
            prev ? { ...prev, comment_count: res.comment_count ?? prev.comment_count + 1 } : null
          );
        }
      } else {
        const res = await addComment(notice.id, text);
        setCommentText('');
        if (res.comment) {
          setComments((prev) => [...prev, res.comment]);
          setNotice((prev) =>
            prev ? { ...prev, comment_count: res.comment_count ?? prev.comment_count + 1 } : null
          );
          setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not post comment.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleToggleCommentReaction = async (comment: PostComment) => {
    if (!notice) return;
    try {
      const res = await toggleCommentReaction(notice.id, comment.id);
      setComments((prev) =>
        prev.map((root) => {
          if (root.id === comment.id) {
            return { ...root, reactedByMe: res.reacted, reactionCount: res.reactionCount ?? res.reaction_count };
          }
          if (root.replies && root.replies.length > 0) {
            return {
              ...root,
              replies: root.replies.map((r) =>
                r.id === comment.id
                  ? { ...r, reactedByMe: res.reacted, reactionCount: res.reactionCount ?? res.reaction_count }
                  : r
              ),
            };
          }
          return root;
        })
      );
    } catch {}
  };

  const handleDeleteComment = (comment: PostComment) => {
    Alert.alert('Delete Comment', 'Are you sure you want to delete this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await deleteComment(noticeId, comment.id);
            setComments((prev) => prev.filter((c) => c.id !== comment.id));
            setNotice((prev) =>
              prev ? { ...prev, comment_count: res.comment_count ?? Math.max(0, prev.comment_count - 1) } : null
            );
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Could not delete comment.');
          }
        },
      },
    ]);
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/notices');
    }
  };

  const topHeader = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: Math.max(insets.top, 10),
        paddingBottom: 10,
        paddingHorizontal: 14,
        backgroundColor: colors.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <TouchableOpacity
        onPress={handleBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={{ paddingRight: 10, paddingVertical: 4 }}
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text variant="md" weight="700" style={{ color: colors.text }}>
        Notice Details
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {topHeader}
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="sm" color="muted" style={{ marginTop: 12 }}>
            Loading official notice…
          </Text>
        </View>
      </View>
    );
  }

  if (!notice) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {topHeader}
        <View style={[styles.centerContainer, { padding: 24 }]}>
          <Ionicons name="megaphone-outline" size={48} color={colors.textMuted} style={{ marginBottom: 12 }} />
          <Heading style={{ fontSize: 18, marginBottom: 6 }}>Notice Not Found</Heading>
          <Caption color="muted" style={{ textAlign: 'center', marginBottom: 20 }}>
            This notice may have expired or is no longer available.
          </Caption>
          <Button title="Back to Notices" variant="primary" onPress={handleBack} />
        </View>
      </View>
    );
  }

  const authorAvatar = getFullUrl(notice.avatarUrl);
  const noticeImage = getFullUrl(notice.attachment_url);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {topHeader}
      <KeyboardContentBoundary style={{ flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingHorizontal: spacing.md,
              paddingTop: spacing.md,
              paddingBottom: Math.max(insets.bottom + 24, 32),
            },
          ]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          keyboardShouldPersistTaps="handled"
        >
          {/* Notice Card */}
          <Card variant="elevated" padding="lg" style={styles.noticeCard}>
            {Boolean(notice.title && notice.title.trim()) && (
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: '800',
                  color: colors.text,
                  lineHeight: 32,
                  letterSpacing: -0.4,
                  marginBottom: spacing.normal,
                }}
                selectable
              >
                {notice.title}
              </Text>
            )}

            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                if (notice.studentId || notice.user_id) {
                  router.push({ pathname: '/user/[id]', params: { id: notice.studentId || notice.user_id } });
                }
              }}
              style={styles.headerRow}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Avatar url={authorAvatar} name={notice.name} size="md" />
                <View style={{ marginLeft: spacing.compact, flex: 1 }}>
                  <Text variant="md" weight="700" numberOfLines={1}>
                    {notice.name}
                  </Text>
                  <Caption color="muted">
                    {formatFullDate(notice.created_at || (notice as any).createdAt || (notice as any).timestamp)}
                  </Caption>
                </View>
              </View>
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <Text
              variant="md"
              style={[
                styles.noticeBody,
                {
                  color: colors.text,
                  marginTop: spacing.xs,
                  marginBottom: spacing.lg,
                },
              ]}
              selectable
            >
              {notice.content}
            </Text>

            {noticeImage ? (
              <View style={{ marginBottom: spacing.lg }}>
                <Text variant="xs" weight="700" color="secondary" style={{ marginBottom: 8 }}>
                  ATTACHED CIRCULAR / SCAN
                </Text>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setShowImageModal(true)}
                  style={[styles.imageWrap, { borderColor: colors.border, borderRadius: radii.md }]}
                >
                  <Image source={{ uri: noticeImage }} style={styles.noticeImg} contentFit="contain" />
                  <View style={styles.expandOverlay}>
                    <Ionicons name="expand" size={14} color="#ffffff" style={{ marginRight: 4 }} />
                    <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '600' }}>Tap for full view</Text>
                  </View>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Engagement Row: Reddit-style Up/Down votes, Comments count, Share */}
            <View style={[styles.actionsBar, { borderTopColor: colors.border }]}>
              <VoteButtons
                upCount={Number(notice.up_count ?? notice.upCount ?? notice.like_count ?? 0)}
                downCount={Number(notice.down_count ?? notice.downCount ?? 0)}
                myVote={Number(notice.my_vote ?? notice.myVote ?? (notice.liked_by_me ? 1 : 0))}
                colors={colors}
                onVote={(dir) => void handleVote(dir)}
              />

              <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 16 }}>
                <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
                <Text variant="sm" color="secondary" style={{ marginLeft: 6 }}>
                  {comments.length} {comments.length === 1 ? 'Comment' : 'Comments'}
                </Text>
              </View>

              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleShare}
                style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' }}
              >
                <Ionicons name="share-social-outline" size={18} color={colors.textSecondary} />
                <Text variant="sm" color="secondary" style={{ marginLeft: 6 }}>
                  Share
                </Text>
              </TouchableOpacity>
            </View>
          </Card>

          {/* Comments Section */}
          <View style={{ marginTop: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: 4 }}>
            <Text variant="sm" weight="700" color="secondary">
              COMMENTS ({comments.length})
            </Text>
          </View>

          {comments.length === 0 ? (
            <View style={[styles.emptyCommentsBox, { backgroundColor: colors.surfaceSubtle, borderRadius: radii.md }]}>
              <Ionicons name="chatbubbles-outline" size={24} color={colors.textMuted} style={{ marginBottom: 6 }} />
              <Caption color="muted">No comments yet. Start the discussion on this notice!</Caption>
            </View>
          ) : (
            comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onReply={handleReplyPress}
                onEdit={handleEditPress}
                onDelete={handleDeleteComment}
                onToggleReaction={handleToggleCommentReaction}
                getFullUrl={getFullUrl}
                currentUserId={user?.studentId || null}
                isAdmin={user?.role === 'admin'}
              />
            ))
          )}
        </ScrollView>
      </KeyboardContentBoundary>

      {/* Sticky Instagram-style Comment Composer */}
      <StickyComposer>
        <CommentComposerBar
          value={commentText}
          onChangeText={setCommentText}
          onSubmit={handleSubmitComment}
          submitting={submittingComment}
          inputRef={inputRef}
          userAvatarUrl={getFullUrl(user?.avatarUrl)}
          userName={user?.name || 'You'}
          replyingTo={replyingTo}
          editingComment={editingComment}
          onCancelMode={handleCancelInputMode}
          showQuickEmojis
        />
      </StickyComposer>

      {/* Full-Screen Image Modal */}
      {noticeImage && (
        <Modal
          visible={showImageModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowImageModal(false)}
        >
          <View style={styles.modalBg}>
            <TouchableOpacity onPress={() => setShowImageModal(false)} style={styles.modalClose}>
              <Ionicons name="close" size={28} color="#ffffff" />
            </TouchableOpacity>
            <Image source={{ uri: noticeImage }} style={styles.modalImg} contentFit="contain" />
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  noticeCard: {
    borderRadius: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  divider: {
    height: 1,
    marginVertical: 14,
  },
  noticeBody: {
    fontSize: 16,
    lineHeight: 25,
  },
  imageWrap: {
    height: 280,
    width: '100%',
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000000',
  },
  noticeImg: {
    width: '100%',
    height: '100%',
  },
  expandOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  actionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 14,
  },
  emptyCommentsBox: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerContextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  composerInnerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  modalImg: {
    width: '95%',
    height: '85%',
  },
});
