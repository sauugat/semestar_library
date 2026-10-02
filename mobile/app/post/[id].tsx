import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  TextInput,
  Share,
  Alert,
  Modal,
  Keyboard,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { StickyComposer, KeyboardContentBoundary } from '@/components/ui/StickyComposer';
import { COMPOSER_GEOMETRY } from '@/constants/composerGeometry';
import { formatTimeAgo } from '@/utils/date';
import { queryClient } from '@/services/query-client';
import {
  getPostById,
  getComments,
  addComment,
  editComment,
  deleteComment,
  toggleCommentReaction,
  getCommentReplies,
  toggleLike,
  deletePost,
  Post,
  PostComment,
} from '@/services/posts';
import { PostMediaGallery } from '@/components/PostMediaGallery';
import { EditPostModal } from '@/components/EditPostModal';
import { CommentItem } from '@/components/CommentItem';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radii } = useTheme();
  const { user, serverUrl } = useAuth();

  const cachedInitialPost = React.useMemo(() => {
    if (!postId || isNaN(postId)) return null;
    const feed = queryClient.getQueryData<{ posts: Post[] }>(['campus-feed']);
    return feed?.posts?.find((p) => Number(p.id) === postId) || null;
  }, [postId]);

  const [post, setPost] = useState<Post | null>(cachedInitialPost);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(!cachedInitialPost);
  const [refreshing, setRefreshing] = useState(false);
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
  const [isLiking, setIsLiking] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Intercept Android Back button: close keyboard first before exiting screen
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBackPress = () => {
      if (Keyboard.isVisible?.()) {
        Keyboard.dismiss();
        return true;
      }
      return false;
    };
    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backSub.remove();
  }, []);

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

  const loadData = useCallback(async () => {
    if (!postId || isNaN(postId)) return;
    try {
      const [fetchedPost, fetchedComments] = await Promise.all([
        getPostById(postId).catch(() => null),
        getComments(postId).catch(() => []),
      ]);
      if (fetchedPost) {
        setPost(fetchedPost);
      }
      setComments(fetchedComments || []);
    } catch (err) {
      console.warn('Error loading post details:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [postId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleToggleLike = async () => {
    if (!post || isLiking) return;
    const previousLiked = post.liked_by_me;
    const previousCount = post.like_count;

    // Optimistic UI update
    setPost({
      ...post,
      liked_by_me: !previousLiked,
      like_count: previousLiked ? Math.max(0, previousCount - 1) : previousCount + 1,
    });
    setIsLiking(true);

    try {
      const result = await toggleLike(post.id, previousLiked);
      setPost((prev) =>
        prev
          ? {
              ...prev,
              liked_by_me: result.liked_by_me,
              like_count: result.like_count,
            }
          : null
      );
    } catch (err) {
      // Revert on error
      setPost((prev) =>
        prev
          ? {
              ...prev,
              liked_by_me: previousLiked,
              like_count: previousCount,
            }
          : null
      );
    } finally {
      setIsLiking(false);
    }
  };

  const handleShare = async () => {
    if (!post) return;
    try {
      await Share.share({
        message: `${post.name}: "${post.content}" — Shared via Semester Library`,
        title: `Post by ${post.name}`,
      });
    } catch (err) {
      // Ignored
    }
  };

  const handleReplyPress = (comment: PostComment) => {
    setEditingComment(null);
    setReplyingTo({
      commentId: comment.id,
      name: comment.name || 'User',
      studentId: comment.studentId || comment.userId,
    });
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleEditPress = (comment: PostComment) => {
    setReplyingTo(null);
    setEditingComment({
      id: comment.id,
      content: comment.content,
    });
    setCommentText(comment.content);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleCancelInputMode = () => {
    setReplyingTo(null);
    setEditingComment(null);
    setCommentText('');
  };

  const handleSubmitComment = async () => {
    if (!post || !commentText.trim() || submittingComment) return;
    const text = commentText.trim();
    setSubmittingComment(true);

    try {
      if (editingComment) {
        // Edit mode
        const res = await editComment(post.id, editingComment.id, text);
        setComments((prev) =>
          prev.map((root) => {
            if (root.id === editingComment.id) {
              return { ...root, ...res.comment };
            }
            if (root.replies && root.replies.length > 0) {
              return {
                ...root,
                replies: root.replies.map((reply) =>
                  reply.id === editingComment.id ? { ...reply, ...res.comment } : reply
                ),
              };
            }
            return root;
          })
        );
        setEditingComment(null);
        setCommentText('');
      } else if (replyingTo) {
        // Reply mode
        const res = await addComment(post.id, text, {
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
          setPost((prev) =>
            prev ? { ...prev, comment_count: res.comment_count ?? prev.comment_count + 1 } : null
          );
        }
      } else {
        // Root comment mode
        const res = await addComment(post.id, text);
        setCommentText('');
        if (res.comment) {
          setComments((prev) => [...prev, res.comment]);
          setPost((prev) =>
            prev ? { ...prev, comment_count: res.comment_count ?? prev.comment_count + 1 } : null
          );
          setTimeout(() => {
            scrollViewRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not post comment.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleToggleCommentReaction = async (comment: PostComment) => {
    if (!post) return;
    const previousReacted = Boolean(comment.reactedByMe);
    const previousCount = Number(comment.reactionCount || 0);
    const nextReacted = !previousReacted;
    const nextCount = previousReacted ? Math.max(0, previousCount - 1) : previousCount + 1;

    // Optimistic UI update
    setComments((prev) =>
      prev.map((root) => {
        if (root.id === comment.id) {
          return {
            ...root,
            reactedByMe: nextReacted,
            reactionCount: nextCount,
          };
        }
        if (root.replies && root.replies.length > 0) {
          return {
            ...root,
            replies: root.replies.map((reply) =>
              reply.id === comment.id
                ? { ...reply, reactedByMe: nextReacted, reactionCount: nextCount }
                : reply
            ),
          };
        }
        return root;
      })
    );

    try {
      const res = await toggleCommentReaction(post.id, comment.id);
      setComments((prev) =>
        prev.map((root) => {
          if (root.id === comment.id) {
            return {
              ...root,
              reactedByMe: res.reacted,
              reactionCount: res.reactionCount ?? res.reaction_count,
            };
          }
          if (root.replies && root.replies.length > 0) {
            return {
              ...root,
              replies: root.replies.map((reply) =>
                reply.id === comment.id
                  ? {
                      ...reply,
                      reactedByMe: res.reacted,
                      reactionCount: res.reactionCount ?? res.reaction_count,
                    }
                  : reply
              ),
            };
          }
          return root;
        })
      );
    } catch {
      // Revert optimistic update on failure
      setComments((prev) =>
        prev.map((root) => {
          if (root.id === comment.id) {
            return {
              ...root,
              reactedByMe: previousReacted,
              reactionCount: previousCount,
            };
          }
          if (root.replies && root.replies.length > 0) {
            return {
              ...root,
              replies: root.replies.map((reply) =>
                reply.id === comment.id
                  ? { ...reply, reactedByMe: previousReacted, reactionCount: previousCount }
                  : reply
              ),
            };
          }
          return root;
        })
      );
    }
  };

  const handleDeleteComment = (comment: PostComment) => {
    Alert.alert('Delete Comment', 'Are you sure you want to delete this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await deleteComment(postId, comment.id);
            setComments((prev) =>
              prev
                .map((root) => {
                  if (root.id === comment.id) {
                    const hasReplies = (root.replies || []).length > 0;
                    if (hasReplies) {
                      return {
                        ...root,
                        isDeleted: true,
                        content: '[Comment deleted]',
                        canDelete: false,
                        canEdit: false,
                      };
                    }
                    return null;
                  }
                  if (root.replies && root.replies.length > 0) {
                    const updatedReplies = root.replies.filter((r) => r.id !== comment.id);
                    return {
                      ...root,
                      replies: updatedReplies,
                      replyCount: updatedReplies.length,
                    };
                  }
                  return root;
                })
                .filter(Boolean) as PostComment[]
            );
            setPost((prev) =>
              prev ? { ...prev, comment_count: res.comment_count ?? Math.max(0, prev.comment_count - 1) } : null
            );
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Could not delete comment.');
          }
        },
      },
    ]);
  };

  const handleDeletePost = () => {
    Alert.alert('Delete Post', 'Are you sure you want to delete this post? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePost(postId);
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)');
            }
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Could not delete post.');
          }
        },
      },
    ]);
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="sm" color="muted" style={{ marginTop: 12 }}>
          Loading post…
        </Text>
      </View>
    );
  }

  if (!post) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background, padding: 24 }]}>
        <Ionicons name="document-text-outline" size={48} color={colors.textMuted} style={{ marginBottom: 12 }} />
        <Heading style={{ fontSize: 18, marginBottom: 6 }}>Post Not Found</Heading>
        <Caption color="muted" style={{ textAlign: 'center', marginBottom: 20 }}>
          This post may have been deleted or is no longer available.
        </Caption>
        <Button title="Back to Feed" variant="primary" onPress={handleBack} />
      </View>
    );
  }

  const authorAvatar = getFullUrl(post.avatarUrl);
  const postImage = getFullUrl(post.attachment_url);
  const isAdmin = post.role === 'admin';
  const isCR = post.role === 'cr';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardContentBoundary style={{ flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingHorizontal: spacing.md,
            paddingTop: spacing.md,
            paddingBottom: 24,
          },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* Main Post Card */}
        <Card variant="elevated" padding="md" style={styles.postCard}>
          {/* Author Header */}
          <View style={styles.authorRow}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/user/[id]', params: { id: post.studentId } })}
              style={styles.authorInfo}
            >
              <Avatar
                url={authorAvatar}
                name={post.name}
                size="md"
              />

              <View style={{ marginLeft: spacing.compact, flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text variant="md" weight="700" numberOfLines={1}>
                    {post.name}
                  </Text>
                  {(isAdmin || isCR) && (
                    <Badge
                      label={isAdmin ? 'Admin' : 'CR'}
                      variant={isAdmin ? 'official' : 'neutral'}
                      size="sm"
                      icon={isAdmin ? 'shield-checkmark' : 'ribbon'}
                    />
                  )}
                </View>
                <Caption color="muted">{formatTimeAgo(post.created_at || (post as any).createdAt || (post as any).timestamp)}</Caption>
              </View>
            </TouchableOpacity>

            {/* Post actions: Edit & Delete if author/admin */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {Boolean(
                post.canEdit ||
                (user?.studentId && (post.user_id === user.studentId || post.studentId === user.studentId)) ||
                (user?.role && user.role.toLowerCase() === 'admin')
              ) && (
                <TouchableOpacity
                  onPress={() => setShowEditModal(true)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ padding: 4 }}
                  accessibilityLabel="Edit post"
                >
                  <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {post.canDelete && (
                <TouchableOpacity
                  onPress={handleDeletePost}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ padding: 4 }}
                  accessibilityLabel="Delete post"
                >
                  <Ionicons name="trash-outline" size={18} color={colors.error || '#EF4444'} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Post Content Body */}
          <Text
            variant="md"
            style={[
              styles.postBody,
              { color: colors.text, marginTop: spacing.md, marginBottom: spacing.md },
            ]}
            selectable
          >
            {post.content}
          </Text>

          {/* Attached Images: responsive grid with swipeable fullscreen gallery */}
          {((Array.isArray(post.media) && post.media.length > 0) || post.attachment_url) && (
            <PostMediaGallery
              media={post.media}
              imageUrl={post.attachment_url}
              getFullUrl={getFullUrl}
              onDoubleTap={handleToggleLike}
            />
          )}

          {/* Engagement / Reaction Bar */}
          <View style={[styles.engagementBar, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleToggleLike}
              style={styles.engagementBtn}
            >
              <Ionicons
                name={post.liked_by_me ? 'heart' : 'heart-outline'}
                size={20}
                color={post.liked_by_me ? (colors.error || '#EF4444') : colors.textSecondary}
              />
              <Text
                variant="sm"
                weight={post.liked_by_me ? '700' : '500'}
                style={{
                  marginLeft: 6,
                  color: post.liked_by_me ? (colors.error || '#EF4444') : colors.textSecondary,
                }}
              >
                {post.like_count} {post.like_count === 1 ? 'Like' : 'Likes'}
              </Text>
            </TouchableOpacity>

            <View style={styles.engagementBtn}>
              <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
              <Text variant="sm" color="secondary" style={{ marginLeft: 6 }}>
                {post.comment_count} {post.comment_count === 1 ? 'Comment' : 'Comments'}
              </Text>
            </View>

            <TouchableOpacity activeOpacity={0.7} onPress={handleShare} style={styles.engagementBtn}>
              <Ionicons name="share-social-outline" size={19} color={colors.textSecondary} />
              <Text variant="sm" color="secondary" style={{ marginLeft: 6 }}>
                Share
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Comments Section Heading */}
        <View style={{ marginTop: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: 4 }}>
          <Text variant="sm" weight="700" color="secondary">
            COMMENTS ({comments.length})
          </Text>
        </View>

        {/* Comments List */}
        {comments.length === 0 ? (
          <View style={[styles.emptyCommentsBox, { backgroundColor: colors.surfaceSubtle }]}>
            <Ionicons name="chatbubbles-outline" size={24} color={colors.textMuted} style={{ marginBottom: 6 }} />
            <Caption color="muted">No comments yet. Start the conversation!</Caption>
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

      {/* Sticky Comment Composer */}
      <StickyComposer>
        {(replyingTo || editingComment) && (
          <View
            style={[
              styles.composerContextBar,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
              <Ionicons
                name={editingComment ? 'pencil' : 'arrow-undo'}
                size={14}
                color={colors.primary}
              />
              <Text variant="xs" weight="600" color="secondary" numberOfLines={1}>
                {editingComment
                  ? 'Editing your comment'
                  : `Replying to ${replyingTo?.name}`}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleCancelInputMode}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.cancelContextBtn}
            >
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.composerInnerRow}>
          <TextInput
            ref={inputRef}
            placeholder={
              editingComment
                ? 'Edit your comment…'
                : replyingTo
                ? `Reply to ${replyingTo.name}…`
                : 'Write a comment…'
            }
            placeholderTextColor={colors.textMuted}
            value={commentText}
            onChangeText={setCommentText}
            multiline
            maxLength={1000}
            style={[
              styles.textInput,
              {
                backgroundColor: colors.surfaceSubtle,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
          />
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleSubmitComment}
            disabled={!commentText.trim() || submittingComment}
            style={[
              styles.sendButton,
              {
                backgroundColor: commentText.trim() ? colors.primary : colors.surfaceSubtle,
                opacity: commentText.trim() ? 1 : 0.5,
              },
            ]}
          >
            {submittingComment ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Ionicons
                name={editingComment ? 'checkmark' : 'send'}
                size={18}
                color={commentText.trim() ? colors.primaryText || '#ffffff' : colors.textMuted}
              />
            )}
          </TouchableOpacity>
        </View>
      </StickyComposer>

      {/* Edit Post Modal */}
      <EditPostModal
        visible={showEditModal}
        post={post}
        getFullUrl={getFullUrl}
        onClose={() => setShowEditModal(false)}
        onPostUpdated={(updatedPost) => {
          setPost((prev) => (prev ? { ...prev, ...updatedPost } : updatedPost));
          queryClient.setQueryData(['campus-feed'], (old: any) =>
            old
              ? {
                  ...old,
                  posts: (old.posts || []).map((p: Post) =>
                    p.id === updatedPost.id ? { ...p, ...updatedPost } : p
                  ),
                }
              : old
          );
        }}
      />
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
    paddingBottom: 30,
  },
  postCard: {
    borderRadius: 16,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  authorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    marginLeft: 6,
  },
  postBody: {
    fontSize: 16,
    lineHeight: 24,
  },
  imageContainer: {
    height: 240,
    width: '100%',
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
  },
  attachedImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlayBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  engagementBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 4,
  },
  engagementBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  emptyCommentsBox: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 12,
    marginBottom: 20,
  },
  commentRow: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  composerContextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    width: '100%',
  },
  cancelContextBtn: {
    padding: 2,
  },
  composerInnerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
    gap: COMPOSER_GEOMETRY.innerHorizontalGap,
  },
  textInput: {
    flex: 1,
    minHeight: COMPOSER_GEOMETRY.minInputHeight,
    maxHeight: COMPOSER_GEOMETRY.maxInputHeight,
    borderRadius: COMPOSER_GEOMETRY.borderRadius,
    borderWidth: 1,
    paddingHorizontal: COMPOSER_GEOMETRY.inputPaddingHorizontal,
    paddingTop: COMPOSER_GEOMETRY.inputPaddingTop,
    paddingBottom: COMPOSER_GEOMETRY.inputPaddingBottom,
    fontSize: COMPOSER_GEOMETRY.fontSize,
    lineHeight: COMPOSER_GEOMETRY.lineHeight,
  },
  sendButton: {
    width: COMPOSER_GEOMETRY.minActionTouchTarget,
    height: COMPOSER_GEOMETRY.minActionTouchTarget,
    borderRadius: COMPOSER_GEOMETRY.minActionTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  imageModalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  fullModalImage: {
    width: '95%',
    height: '80%',
  },
});
