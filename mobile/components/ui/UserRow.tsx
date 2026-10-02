import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Avatar } from './Avatar';
import { Text, Caption } from './Typography';

export interface UserRowProps {
  id: string;
  name: string;
  avatarUrl?: string | null;
  studentId?: string;
  program?: string;
  sharedFilesCount?: number;
  isFollowing?: boolean;
  isFollowLoading?: boolean;
  onPress?: () => void;
  onToggleFollow?: () => void;
  showFollowButton?: boolean;
}

/**
 * Standardized, enterprise-grade UserRow component adhering strictly to
 * mobile QA requirements:
 * - 42dp avatar
 * - 68dp min-height
 * - Fixed 80dp follow button with 36dp visual height & 44dp hitSlop touch target
 * - Safe truncation with ellipsis for long names and student IDs
 * - Vertically centered controls with consistent spacing
 */
export function UserRow({
  id,
  name,
  avatarUrl,
  studentId,
  program,
  sharedFilesCount,
  isFollowing = false,
  isFollowLoading = false,
  onPress,
  onToggleFollow,
  showFollowButton = true,
}: UserRowProps) {
  const { colors, spacing, radii } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.card,
          marginBottom: spacing.sm,
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={styles.touchArea}
      >
        <Avatar
          size="md"
          url={avatarUrl}
          name={name}
        />

        <View style={styles.infoCol}>
          <Text
            variant="sm"
            weight="700"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: colors.text }}
          >
            {name}
          </Text>

          <Caption
            color="muted"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ marginTop: 2 }}
          >
            {studentId ? `@${studentId}` : ''}
            {studentId && program ? ' · ' : ''}
            {program || ''}
          </Caption>

          {sharedFilesCount !== undefined && (
            <Caption
              color="secondary"
              numberOfLines={1}
              style={{ marginTop: 2, fontSize: 11 }}
            >
              {sharedFilesCount} {sharedFilesCount === 1 ? 'shared file' : 'shared files'}
            </Caption>
          )}
        </View>
      </TouchableOpacity>

      {showFollowButton && onToggleFollow && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onToggleFollow}
          disabled={isFollowLoading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[
            styles.followButton,
            {
              backgroundColor: isFollowing ? colors.surfaceSubtle : colors.text,
              borderColor: isFollowing ? colors.border : colors.text,
            },
          ]}
        >
          {isFollowLoading ? (
            <ActivityIndicator
              size="small"
              color={isFollowing ? colors.text : colors.background}
            />
          ) : (
            <View style={styles.followBtnContent}>
              {isFollowing && (
                <Ionicons
                  name="checkmark"
                  size={13}
                  color={colors.text}
                  style={{ marginRight: 3 }}
                />
              )}
              <Text
                variant="xs"
                weight="700"
                style={[
                  styles.followBtnText,
                  {
                    color: isFollowing ? colors.text : colors.background,
                  },
                ]}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  touchArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  infoCol: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'center',
  },
  followButton: {
    width: 80,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  followBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnText: {
    fontSize: 12,
  },
});
