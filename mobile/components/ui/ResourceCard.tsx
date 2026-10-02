import React from 'react';
import { View, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Caption } from './Typography';
import { Card } from './Card';
import { formatTimeAgo } from '@/utils/date';

export interface ResourceCardProps {
  id: string | number;
  title: string;
  originalName?: string;
  sizeBytes?: number | string;
  uploadedAt?: string;
  subject?: string | null;
  chapter?: string | null;
  liked?: boolean;
  likeCount?: number | string;
  canDelete?: boolean;
  onPress: () => void;
  onDelete?: () => void;
  style?: StyleProp<ViewStyle>;
}

function formatBytes(bytes?: number | string): string {
  const num = typeof bytes === 'string' ? parseFloat(bytes) : Number(bytes);
  if (!num || isNaN(num) || num <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return `${parseFloat((num / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIconName(filename: string): keyof typeof Ionicons.glyphMap {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'document-text-outline';
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'document-outline';
  if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) return 'easel-outline';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')) return 'image-outline';
  if (lower.endsWith('.zip') || lower.endsWith('.rar')) return 'archive-outline';
  return 'document-attach-outline';
}

/**
 * Enterprise Monochrome Resource Card for Semester Library (Black / White / Gray).
 * Adheres strictly to design system:
 * - Background: Charcoal (colors.surface)
 * - File Icon: White / light gray (#D1D1D6) on dark container (#1C1C1E)
 * - Title: White (#FFFFFF)
 * - Metadata: Gray (#A1A1AA)
 * - Tags/chips: Dark gray (#27272A) with light gray text (#D1D1D6)
 * - Likes: Gray icon (#71717A) + gray text (#A1A1AA)
 * - Visibility text: Muted gray (#71717A)
 * - Delete icon: Neutral gray (#71717A) in normal card state
 */
export function ResourceCard({
  id,
  title,
  originalName = '',
  sizeBytes,
  uploadedAt,
  subject,
  chapter,
  liked = false,
  likeCount = 0,
  canDelete = false,
  onPress,
  onDelete,
  style,
}: ResourceCardProps) {
  const { colors, spacing, radii } = useTheme();
  const iconName = getFileIconName(originalName || title);

  return (
    <Card
      variant="elevated"
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.lg,
          marginBottom: spacing.sm,
        },
        style,
      ]}
    >
      {/* Header: Icon, Title & Metadata, Delete Control */}
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: '#1C1C1E', borderColor: '#27272A', borderRadius: radii.md }]}>
          <Ionicons name={iconName} size={20} color="#D1D1D6" />
        </View>

        <View style={styles.titleColumn}>
          <Text variant="sm" weight="700" numberOfLines={1} style={{ color: '#FFFFFF' }}>
            {title || originalName}
          </Text>
          <Caption color="muted" numberOfLines={1} style={{ color: '#A1A1AA', marginTop: 2 }}>
            {formatBytes(sizeBytes)} &middot; {formatTimeAgo(uploadedAt)}
          </Caption>
        </View>

        {canDelete && onDelete && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            style={styles.deleteButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Delete resource"
          >
            <Ionicons name="trash-outline" size={17} color="#71717A" />
          </TouchableOpacity>
        )}
      </View>

      {/* Tags / Subject & Chapter Chips */}
      {(subject || chapter) && (
        <View style={styles.tagsRow}>
          {subject ? (
            <View style={[styles.tagChip, { backgroundColor: '#27272A', borderRadius: radii.sm }]}>
              <Text variant="xs" weight="500" style={{ color: '#D1D1D6' }}>
                {subject}
              </Text>
            </View>
          ) : null}
          {chapter ? (
            <View style={[styles.tagChip, { backgroundColor: '#27272A', borderRadius: radii.sm }]}>
              <Text variant="xs" weight="500" style={{ color: '#D1D1D6' }}>
                {chapter}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Footer: Likes & University Visibility */}
      <View style={[styles.footerRow, { borderTopColor: colors.border }]}>
        <View style={styles.likeRow}>
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={14}
            color={liked ? '#FFFFFF' : '#71717A'}
            style={{ marginRight: 4 }}
          />
          <Text variant="xs" style={{ color: '#A1A1AA' }}>
            {Number(likeCount) || 0} {Number(likeCount) === 1 ? 'like' : 'likes'}
          </Text>
        </View>
        <Caption color="muted" style={{ color: '#71717A' }}>
          Public to Gandaki University
        </Caption>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  titleColumn: {
    flex: 1,
    marginLeft: 12,
  },
  deleteButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  tagChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginTop: 12,
  },
  likeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
