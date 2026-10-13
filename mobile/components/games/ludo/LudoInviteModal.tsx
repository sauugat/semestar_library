import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { SearchField } from '@/components/ui/SearchField';
import { Badge } from '@/components/ui/Badge';
import {
  searchLudoUsers,
  createLudoInvitation,
  LudoInvitationError,
  type LudoUserSearchResult,
} from '@/services/ludo-invitations';

export interface LudoInviteModalProps {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  currentUserId?: string | null;
  seatedUserIds: string[];
  openSeatCount: number;
}

export function LudoInviteModal({
  visible,
  onClose,
  roomId,
  currentUserId,
  seatedUserIds,
  openSeatCount,
}: LudoInviteModalProps) {
  const { colors, spacing, radii } = useTheme();

  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<LudoUserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const searchSequenceRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Reset state when modal is opened
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setIsSearching(false);
      setErrorMessage(null);
    }
  }, [visible]);

  // Debounced user search with request sequence guard
  useEffect(() => {
    if (!visible) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setErrorMessage(null);

    const currentSeq = ++searchSequenceRef.current;

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const users = await searchLudoUsers(trimmed);
        if (!isMountedRef.current || currentSeq !== searchSequenceRef.current) return;

        // Exclude current user and seated users
        const seatedSet = new Set(seatedUserIds);
        const filtered = users.filter(
          (u) => u.studentId !== currentUserId && !seatedSet.has(u.studentId)
        );
        setResults(filtered);
      } catch (err: any) {
        if (!isMountedRef.current || currentSeq !== searchSequenceRef.current) return;
        if (err?.code === 'RATE_LIMITED') {
          setErrorMessage("You're searching too quickly. Please wait a moment.");
        } else {
          setErrorMessage(err.message || 'Failed to search users.');
        }
        setResults([]);
      } finally {
        if (isMountedRef.current && currentSeq === searchSequenceRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, visible, currentUserId, seatedUserIds]);

  const handleInvite = async (user: LudoUserSearchResult) => {
    if (invitingId || invitedIds.has(user.studentId) || !isMountedRef.current) return;
    if (openSeatCount <= 0) {
      setErrorMessage('Room is full. Open a seat or remove a bot to invite players.');
      return;
    }

    setInvitingId(user.studentId);
    setErrorMessage(null);

    try {
      await createLudoInvitation(roomId, user.studentId);
      if (isMountedRef.current) {
        setInvitedIds((prev) => new Set(prev).add(user.studentId));
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      if (err instanceof LudoInvitationError) {
        if (err.code === 'RATE_LIMITED' || err.code === 'RATE_LIMIT_EXCEEDED') {
          setErrorMessage("You're sending invites too quickly. Try again in a moment.");
        } else if (err.code === 'ALREADY_IN_ROOM') {
          setErrorMessage('This player is already in the room.');
        } else if (err.code === 'CANNOT_INVITE_SELF') {
          setErrorMessage('You cannot invite yourself to a match.');
        } else if (err.code === 'ROOM_FULL') {
          setErrorMessage('Room is full.');
        } else {
          setErrorMessage(err.message || 'Failed to send invitation.');
        }
      } else {
        setErrorMessage('Failed to send invitation.');
      }
    } finally {
      if (isMountedRef.current) {
        setInvitingId(null);
      }
    }
  };

  const renderItem = ({ item }: { item: LudoUserSearchResult }) => {
    const isInvited = invitedIds.has(item.studentId);
    const isLoading = invitingId === item.studentId;

    return (
      <View
        style={[
          styles.userRow,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
          },
        ]}
      >
        {/* Avatar */}
        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
        ) : (
          <View
            style={[
              styles.avatarFallback,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="person" size={18} color={colors.primary} />
          </View>
        )}

        {/* User Info */}
        <View style={styles.userInfo}>
          <Text variant="md" weight="700" numberOfLines={1} style={{ color: colors.text }}>
            {item.name}
          </Text>
          <Caption numberOfLines={1} style={{ color: colors.textSecondary }}>
            @{item.username}
          </Caption>
        </View>

        {/* Action Button */}
        <View style={styles.actionCol}>
          {isInvited ? (
            <View
              style={[
                styles.invitedBadge,
                { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: '#10B981' },
              ]}
            >
              <Ionicons name="checkmark-circle" size={14} color="#10B981" />
              <Text style={styles.invitedText}>Invited</Text>
            </View>
          ) : isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <TouchableOpacity
              style={[
                styles.inviteButton,
                {
                  backgroundColor: colors.primary,
                  opacity: openSeatCount <= 0 ? 0.5 : 1,
                },
              ]}
              disabled={openSeatCount <= 0}
              onPress={() => handleInvite(item)}
              accessibilityRole="button"
              accessibilityLabel={`Invite ${item.name}`}
            >
              <Text style={styles.inviteButtonText}>Invite</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />

        <View
          style={[
            styles.modalContent,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Heading style={[styles.title, { color: colors.text }]}>Invite Player</Heading>
              <Caption style={{ color: colors.textSecondary }}>
                {openSeatCount > 0
                  ? `${openSeatCount} open seat${openSeatCount === 1 ? '' : 's'} available`
                  : 'Room is full'}
              </Caption>
            </View>
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.surfaceRaised }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close invite modal"
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Search field */}
          <View style={styles.searchContainer}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              onClear={() => setQuery('')}
              loading={isSearching}
              placeholder="Search username or name"
              pill={false}
              autoFocus
            />
          </View>

          {/* Error Message */}
          {errorMessage && (
            <View
              style={[
                styles.errorBanner,
                { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: colors.error },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
            </View>
          )}

          {/* List or Empty State */}
          <View style={styles.listContainer}>
            {query.trim().length < 2 ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={36} color={colors.textSecondary} />
                <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
                  Type at least 2 characters to search students
                </Text>
              </View>
            ) : isSearching && results.length === 0 ? (
              <View style={styles.emptyState}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.emptyStateText, { color: colors.textSecondary, marginTop: 10 }]}>
                  Searching students...
                </Text>
              </View>
            ) : results.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={36} color={colors.textSecondary} />
                <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
                  No students found matching &quot;{query}&quot;
                </Text>
              </View>
            ) : (
              <FlatList
                data={results}
                keyExtractor={(item) => item.studentId}
                renderItem={renderItem}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.listContent}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdropTouch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    marginBottom: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
  },
  listContainer: {
    minHeight: 180,
    maxHeight: 280,
  },
  listContent: {
    paddingVertical: 4,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
    marginLeft: 10,
  },
  actionCol: {
    marginLeft: 8,
  },
  inviteButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  inviteButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  invitedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  invitedText: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
});
