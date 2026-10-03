import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Typography';
import { useTheme } from '@/constants/useTheme';
import { PostMediaItem } from '@/services/posts';

interface PostFileAttachmentsProps {
  files?: (PostMediaItem | { url: string; file_name?: string | null; file_size?: number | null; mime_type?: string | null })[];
  onOpenFile?: (file: PostMediaItem | { url: string; file_name?: string | null; file_size?: number | null; mime_type?: string | null }) => void;
}

function formatBytes(bytes?: number | string | null): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(name?: string | null): keyof typeof Ionicons.glyphMap {
  const ext = (name || '').split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'document-text';
  if (['doc', 'docx'].includes(ext || '')) return 'document';
  if (['ppt', 'pptx'].includes(ext || '')) return 'easel';
  if (['xls', 'xlsx'].includes(ext || '')) return 'grid';
  if (['zip', 'rar', '7z'].includes(ext || '')) return 'archive';
  return 'document-attach';
}

function getFileTypeLabel(name?: string | null): string {
  const ext = (name || '').split('.').pop()?.toUpperCase();
  return ext || 'FILE';
}

export function PostFileAttachments({ files, onOpenFile }: PostFileAttachmentsProps) {
  const { colors, radii, spacing } = useTheme();

  if (!Array.isArray(files) || files.length === 0) return null;

  return (
    <View style={styles.container}>
      {files.map((file, idx) => {
        const displayName = file.file_name || file.url.split('/').pop() || `Attachment ${idx + 1}`;
        const typeLabel = getFileTypeLabel(displayName);
        const sizeLabel = formatBytes(file.file_size);

        return (
          <TouchableOpacity
            key={`post-file-${file.url}-${idx}`}
            activeOpacity={0.8}
            onPress={() => onOpenFile?.(file)}
            style={[
              styles.fileCard,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                borderRadius: radii.md,
              },
            ]}
            accessibilityLabel={`Open attached file: ${displayName}`}
          >
            <View style={[styles.fileIconBox, { backgroundColor: colors.surface }]}>
              <Ionicons name={getFileIcon(displayName)} size={22} color={colors.text} />
            </View>

            <View style={styles.fileDetails}>
              <Text variant="sm" weight="600" numberOfLines={1} style={{ color: colors.text }}>
                {displayName}
              </Text>
              <View style={styles.metaRow}>
                <View style={[styles.typeBadge, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.typeBadgeText, { color: colors.textSecondary }]}>
                    {typeLabel}
                  </Text>
                </View>
                {Boolean(sizeLabel) && (
                  <Text variant="xs" color="muted" style={{ marginLeft: 6 }}>
                    {sizeLabel}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.openIconBox}>
              <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 8,
    gap: 6,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
  },
  fileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  fileDetails: {
    flex: 1,
    marginRight: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  typeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  openIconBox: {
    padding: 4,
  },
});
