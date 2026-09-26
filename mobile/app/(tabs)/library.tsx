import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  getSubjects,
  getFiles,
  LibrarySubject,
  LibraryFile,
} from '@/services/library';

const SEMESTER_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Sem 2', value: 'Semester II' },
  { label: 'Sem 1', value: 'Semester I' },
  { label: 'Sem 3', value: 'Semester III' },
  { label: 'Sem 4', value: 'Semester IV' },
];

function formatFileSize(bytes: number | string): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileType(filename: string): 'pdf' | 'pptx' | 'docx' | 'zip' | 'file' {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'pptx';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docx';
  if (lower.endsWith('.zip') || lower.endsWith('.rar')) return 'zip';
  return 'file';
}

export default function LibraryScreen() {
  const { colors, spacing, radii } = useTheme();

  const [selectedSemester, setSelectedSemester] = useState('all');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [subjects, setSubjects] = useState<LibrarySubject[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // 1. Fetch subjects
      const fetchedSubjects = await getSubjects().catch(() => []);
      setSubjects(fetchedSubjects);

      // 2. Fetch files for the selected semester & subject
      const filterParams: any = {};
      if (selectedSemester !== 'all') {
        filterParams.semester = selectedSemester;
      }
      if (selectedSubject) {
        filterParams.subject = selectedSubject;
      }
      if (searchQuery.trim()) {
        filterParams.search = searchQuery.trim();
      }

      const fetchedFiles = await getFiles(filterParams);
      setFiles(fetchedFiles);
    } catch (err: any) {
      setError(err.message || 'Unable to connect to the library server.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedSemester, selectedSubject, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectSemester = (sem: string) => {
    setSelectedSemester(sem);
    setSelectedSubject(null); // Reset subject filter when switching semester
  };

  const handleToggleSubject = (sub: string) => {
    if (selectedSubject === sub) {
      setSelectedSubject(null);
    } else {
      setSelectedSubject(sub);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { padding: spacing.md, backgroundColor: colors.background },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => loadData(true)}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* Search Input */}
      <View
        style={[
          styles.searchBox,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            marginBottom: spacing.md,
          },
        ]}
      >
        <Ionicons name="search-outline" size={18} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
        <TextInput
          placeholder="Filter files by title or topic..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={[styles.searchInput, { color: colors.text }]}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Semester Filter Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.pillContainer, { marginBottom: spacing.md }]}
      >
        {SEMESTER_OPTIONS.map((opt) => {
          const isSelected = selectedSemester === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => handleSelectSemester(opt.value)}
              style={[
                styles.pill,
                {
                  backgroundColor: isSelected ? colors.primary : colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                  borderRadius: radii.full,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs + 3,
                  marginRight: spacing.xs + 2,
                },
              ]}
            >
              <Text
                variant="sm"
                weight="700"
                style={{ color: isSelected ? '#FFFFFF' : colors.textSecondary }}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Active Filter Chips */}
      {selectedSubject && (
        <View style={[styles.filterBar, { marginBottom: spacing.md }]}>
          <Caption color="muted">Filtered by Subject:</Caption>
          <TouchableOpacity
            onPress={() => setSelectedSubject(null)}
            style={[
              styles.chip,
              {
                backgroundColor: colors.primaryLight,
                borderColor: colors.primary,
                borderRadius: radii.full,
                paddingHorizontal: spacing.sm + 2,
                paddingVertical: spacing.xs,
                marginLeft: spacing.xs,
              },
            ]}
          >
            <Text variant="xs" color="accent" weight="700">
              {selectedSubject} ✕
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Loading State */}
      {loading && !refreshing && (
        <View style={styles.stateCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="sm" color="secondary" style={{ marginTop: spacing.md }}>
            Loading library files from server...
          </Text>
        </View>
      )}

      {/* Error State */}
      {!loading && error && (
        <Card variant="elevated" padding="lg" style={styles.stateCenter}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.error} style={{ marginBottom: spacing.sm }} />
          <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
            Connection Failed
          </Heading>
          <Text variant="sm" color="secondary" style={{ textAlign: 'center', marginBottom: spacing.md }}>
            {error}
          </Text>
          <Button
            title="Retry Connection"
            variant="primary"
            size="md"
            onPress={() => loadData()}
            leftIcon={<Ionicons name="refresh" size={16} color="#FFFFFF" />}
          />
        </Card>
      )}

      {/* Empty State */}
      {!loading && !error && files.length === 0 && (
        <Card variant="flat" padding="lg" style={styles.stateCenter}>
          <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} style={{ marginBottom: spacing.sm }} />
          <Heading style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
            No Materials Found
          </Heading>
          <Text variant="sm" color="secondary" style={{ textAlign: 'center', marginBottom: spacing.md }}>
            {selectedSemester !== 'all' || selectedSubject || searchQuery
              ? 'No materials matched your active filter or search query.'
              : 'There are no materials in the library yet.'}
          </Text>
          {(selectedSemester !== 'all' || selectedSubject || searchQuery) && (
            <Button
              title="Clear Filters"
              variant="outline"
              size="sm"
              onPress={() => {
                setSelectedSemester('all');
                setSelectedSubject(null);
                setSearchQuery('');
              }}
            />
          )}
        </Card>
      )}

      {/* Real Materials List */}
      {!loading && !error && files.length > 0 && (
        <>
          <View style={[styles.listHeader, { marginBottom: spacing.sm }]}>
            <Subheading>
              Materials ({files.length})
            </Subheading>
            <Caption color="muted">
              {selectedSemester === 'all' ? 'All Semesters' : selectedSemester}
            </Caption>
          </View>

          {files.map((file) => {
            const ext = getFileType(file.originalName);
            const badgeBg = ext === 'pdf' ? '#FEE2E2' : ext === 'pptx' ? '#FEF3C7' : ext === 'docx' ? '#DBEAFE' : '#E0E7FF';
            const badgeColor = ext === 'pdf' ? '#DC2626' : ext === 'pptx' ? '#D97706' : ext === 'docx' ? '#2563EB' : '#4F46E5';

            return (
              <Card
                key={file.id}
                variant="elevated"
                padding="md"
                onPress={() => router.push(`/material/${file.id}` as any)}
                style={{ marginBottom: spacing.sm }}
              >
                <View style={styles.fileRow}>
                  <View
                    style={[
                      styles.typeBadge,
                      {
                        backgroundColor: badgeBg,
                        borderRadius: radii.md,
                        marginRight: spacing.md,
                      },
                    ]}
                  >
                    <Text variant="xs" weight="800" style={{ color: badgeColor }}>
                      {ext.toUpperCase()}
                    </Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text weight="700" variant="sm" numberOfLines={1}>
                      {file.title || file.originalName}
                    </Text>
                    <Caption color="muted" numberOfLines={1}>
                      {file.subject} • {file.chapter || 'General'} • {formatFileSize(file.sizeBytes)}
                    </Caption>
                    <Caption color="secondary" style={{ marginTop: 2 }}>
                      By {file.uploaderName} • {new Date(file.uploadedAt).toLocaleDateString()}
                    </Caption>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </View>
              </Card>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 36,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  pillContainer: {
    flexDirection: 'row',
  },
  pill: {
    borderWidth: 1,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
  },
  stateCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
