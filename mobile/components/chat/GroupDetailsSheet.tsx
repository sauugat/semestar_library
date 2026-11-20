import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Typography';
import { ThemeGlassSheet, hexToRgba } from '@/components/chat/ThemeGlassSheet';
import type { GroupChatTheme } from '@/constants/groupChatThemes';
import type { ChatMessage } from '@/services/chat';
import { formatFileExtension, formatFileSubtitle } from '@/services/chat-state';
import { formatDate, safeParseDate } from '@/utils/date';

type SharedTab = 'photos' | 'files' | 'links';

export interface GroupDetailsSheetProps {
  visible: boolean;
  groupName: string;
  defaultGroupName: string;
  customPhotoUri?: string | null;
  cohortName: string;
  semesterLabel: string;
  isArchived?: boolean;
  groupTheme: GroupChatTheme;
  memberCount: number;
  messages: ChatMessage[];
  serverUrl: string;
  authHeaders?: Record<string, string>;
  onClose: () => void;
  onOpenMembers: () => void;
  onOpenSearch: () => void;
  onOpenPhoto: (image: { uri: string; name: string }) => void;
  onOpenFile: (message: ChatMessage) => void;
  onEditGroupPhoto: () => void;
  onResetGroupPhoto?: () => void;
  onSaveGroupName: (nextName: string) => void;
}

function isImageAttachment(filename?: string | null, mimeType?: string | null): boolean {
  const m = String(mimeType || '').toLowerCase();
  if (m.startsWith('image/') || m === 'image') return true;
  if (!filename) return false;
  return /\.(png|jpe?g|webp|gif|heic|heif|bmp|svg|avif)$/i.test(filename);
}

function getFileIcon(filename?: string | null, mimeType?: string | null): keyof typeof Ionicons.glyphMap {
  const ext = formatFileExtension(filename, mimeType).toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'document-text-outline';
    case 'doc':
    case 'docx':
    case 'txt':
    case 'rtf':
      return 'document-outline';
    case 'ppt':
    case 'pptx':
      return 'easel-outline';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'grid-outline';
    case 'zip':
    case 'rar':
    case '7z':
      return 'archive-outline';
    default:
      return 'attach-outline';
  }
}

function extractUrls(text?: string | null): { url: string; domain: string }[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<]+[^<.,:;"')\]\s]/gi);
  if (!matches) return [];
  const results: { url: string; domain: string }[] = [];
  for (const raw of matches) {
    try {
      const parsed = new URL(raw);
      results.push({ url: raw, domain: parsed.hostname.replace(/^www\./i, '') });
    } catch {
      // Ignore malformed URLs
    }
  }
  return results;
}

export const GroupDetailsSheet = React.memo(function GroupDetailsSheet({
  visible,
  groupName,
  defaultGroupName,
  customPhotoUri,
  cohortName,
  semesterLabel,
  isArchived = false,
  groupTheme,
  memberCount,
  messages,
  serverUrl,
  authHeaders,
  onClose,
  onOpenMembers,
  onOpenSearch,
  onOpenPhoto,
  onOpenFile,
  onEditGroupPhoto,
  onResetGroupPhoto,
  onSaveGroupName,
}: GroupDetailsSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<SharedTab>('photos');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(groupName);

  useEffect(() => {
    if (visible) {
      setNameDraft(groupName);
      setEditingName(false);
    }
  }, [visible, groupName]);

  // Explicit pixel tile size so iOS ScrollView + flexWrap never collapses aspectRatio cells to 0 height
  const photoCellSize = useMemo(() => {
    const horizontalPadding = 36; // sheet paddingHorizontal: 18 * 2
    const totalGaps = 14; // 7px gap * 2
    return Math.max(72, Math.floor((windowWidth - horizontalPadding - totalGaps) / 3));
  }, [windowWidth]);

  const { sharedPhotos, sharedFiles, sharedLinks } = useMemo(() => {
    if (!visible) {
      return {
        sharedPhotos: [] as { id: string; uri: string; name: string; sender: string }[],
        sharedFiles: [] as ChatMessage[],
        sharedLinks: [] as { id: string; url: string; domain: string; sender: string; createdAt: string }[],
      };
    }

    const base = (serverUrl || '').replace(/\/+$/, '');
    const photos: { id: string; uri: string; name: string; sender: string }[] = [];
    const files: ChatMessage[] = [];
    const links: { id: string; url: string; domain: string; sender: string; createdAt: string }[] = [];
    const seenUrls = new Set<string>();

    for (const msg of messages) {
      if (msg.attachmentName) {
        if (isImageAttachment(msg.attachmentOriginalName || msg.attachmentName, msg.attachmentMimeType)) {
          const uri =
            msg.status === 'pending' && msg.localUri
              ? msg.localUri
              : `${base}/api/chat/attachment/${encodeURIComponent(msg.attachmentName)}${
                  msg.chatGroupId ? `?chatGroupId=${encodeURIComponent(msg.chatGroupId)}` : ''
                }`;
          photos.push({
            id: `${msg.id}:${msg.attachmentName}`,
            uri,
            name: msg.attachmentOriginalName || msg.attachmentName,
            sender: msg.name || 'Classmate',
          });
        } else {
          files.push(msg);
        }
      }

      if (msg.text) {
        const extracted = extractUrls(msg.text);
        for (const item of extracted) {
          if (seenUrls.has(item.url)) continue;
          seenUrls.add(item.url);
          links.push({
            id: `${msg.id}:${item.url}`,
            url: item.url,
            domain: item.domain,
            sender: msg.name || 'Classmate',
            createdAt: msg.createdAt,
          });
        }
      }
    }

    return { sharedPhotos: photos, sharedFiles: files, sharedLinks: links };
  }, [visible, messages, serverUrl]);

  if (!visible) return null;

  const accent = groupTheme.accentColor || '#E4E4E7';
  const bubbleTint = groupTheme.selfBubbleBg || '#52525B';
  const glassTopTint = hexToRgba(bubbleTint, 0.24);
  const glassMidTint = hexToRgba(accent, 0.08);
  const glassBorder = hexToRgba(accent, 0.26);
  const activeTabBg = hexToRgba(bubbleTint, 0.42);
  const activeTabBorder = hexToRgba(accent, 0.34);

  const handlePressPhotoEdit = () => {
    if (customPhotoUri && onResetGroupPhoto) {
      Alert.alert('Group Photo', 'Update or reset this group photo', [
        { text: 'Choose New Photo', onPress: onEditGroupPhoto },
        { text: 'Reset to Default', style: 'destructive', onPress: onResetGroupPhoto },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      onEditGroupPhoto();
    }
  };

  const handleSaveName = () => {
    const trimmed = nameDraft.trim();
    onSaveGroupName(trimmed || defaultGroupName);
    setEditingName(false);
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close group details"
        />

        {/* Frosted Translucent Glass Sheet with native wallpaper blur tinted to active planet theme */}
        <ThemeGlassSheet
          backgroundImage={groupTheme.backgroundImage}
          tintColor={bubbleTint}
          accentColor={accent}
          blurRadius={28}
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 22),
            },
          ]}
        >

          <View style={styles.handle} />

          {/* Header Bar */}
          <View style={styles.topBar}>
            <Text variant="xs" weight="700" style={styles.topBarLabel}>
              GROUP DETAILS
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={8}
              accessibilityLabel="Close group details"
            >
              <Ionicons name="close" size={18} color="#F4F4F5" />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            {/* Group Photo (editable), Name (editable) & Cohort Metadata */}
            <View style={styles.heroSection}>
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={handlePressPhotoEdit}
                accessibilityLabel="Edit group photo"
                style={styles.avatarTouchWrap}
              >
                <View style={[styles.avatarRing, { borderColor: accent }]}>
                  {customPhotoUri ? (
                    <Image
                      source={{ uri: customPhotoUri }}
                      style={styles.avatarImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : groupTheme.backgroundImage ? (
                    <Image
                      source={groupTheme.backgroundImage}
                      style={styles.avatarImage}
                      contentFit="cover"
                      cachePolicy="memory"
                    />
                  ) : (
                    <View style={[styles.avatarImage, styles.avatarFallback]}>
                      <Ionicons name="people" size={30} color="#F4F4F5" />
                    </View>
                  )}
                </View>

                {/* Camera Edit Badge */}
                <View style={[styles.cameraBadge, { backgroundColor: bubbleTint, borderColor: 'rgba(12,12,16,0.9)' }]}>
                  <Ionicons name="camera" size={13} color="#FFFFFF" />
                </View>
              </TouchableOpacity>

              {/* Group Name (view or inline edit mode) */}
              {editingName ? (
                <View style={styles.editNameWrap}>
                  <TextInput
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    placeholder={defaultGroupName}
                    placeholderTextColor="#71717A"
                    keyboardAppearance="dark"
                    maxLength={48}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleSaveName}
                    style={[styles.editNameInput, { borderColor: glassBorder }]}
                  />
                  <View style={styles.editNameActions}>
                    <TouchableOpacity
                      style={styles.editNameCancelBtn}
                      onPress={() => {
                        setNameDraft(groupName);
                        setEditingName(false);
                      }}
                    >
                      <Text variant="xs" weight="600" style={{ color: '#A1A1AA' }}>
                        Cancel
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editNameSaveBtn, { backgroundColor: bubbleTint }]}
                      onPress={handleSaveName}
                    >
                      <Text variant="xs" weight="700" style={{ color: '#FFFFFF' }}>
                        Save
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => {
                    setNameDraft(groupName);
                    setEditingName(true);
                  }}
                  style={styles.titleRow}
                  accessibilityLabel="Edit group name"
                >
                  <Text variant="lg" weight="700" style={styles.groupTitle} numberOfLines={1}>
                    {groupName}
                  </Text>
                  <View style={styles.editPencilPill}>
                    <Ionicons name="pencil" size={13} color="#E4E4E7" />
                  </View>
                </TouchableOpacity>
              )}

              {/* Cohort & Semester Pills (no online count) */}
              <View style={styles.metaPillsRow}>
                <View style={styles.metaPill}>
                  <View style={[styles.metaDot, { backgroundColor: accent }]} />
                  <Text variant="xs" weight="600" style={styles.metaPillText}>
                    {cohortName} Cohort
                  </Text>
                </View>

                <View style={styles.metaPill}>
                  <Text variant="xs" weight="600" style={styles.metaPillText}>
                    {isArchived ? 'Archived' : semesterLabel}
                  </Text>
                </View>
              </View>
            </View>

            {/* Glass Quick Action Tiles */}
            <View style={styles.quickGrid}>
              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => {
                  onClose();
                  onOpenMembers();
                }}
              >
                <Ionicons name="people-outline" size={20} color="#FFFFFF" />
                <Text variant="xs" weight="600" style={styles.quickTileLabel}>
                  Members ({memberCount})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickTile}
                activeOpacity={0.75}
                onPress={() => {
                  onClose();
                  onOpenSearch();
                }}
              >
                <Ionicons name="search-outline" size={20} color="#FFFFFF" />
                <Text variant="xs" weight="600" style={styles.quickTileLabel}>
                  Search
                </Text>
              </TouchableOpacity>
            </View>

            {/* Glass Segmented Tabs: Photos / Files / Links */}
            <View style={styles.tabsRow}>
              {(
                [
                  { key: 'photos' as const, label: `Photos (${sharedPhotos.length})`, icon: 'images-outline' as const },
                  { key: 'files' as const, label: `Files (${sharedFiles.length})`, icon: 'document-outline' as const },
                  { key: 'links' as const, label: `Links (${sharedLinks.length})`, icon: 'link-outline' as const },
                ]
              ).map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[
                      styles.tabBtn,
                      active && {
                        backgroundColor: activeTabBg,
                        borderColor: activeTabBorder,
                        borderWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                    activeOpacity={0.75}
                    onPress={() => setActiveTab(tab.key)}
                  >
                    <Ionicons
                      name={tab.icon}
                      size={14}
                      color={active ? '#FFFFFF' : '#A1A1AA'}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      variant="xs"
                      weight={active ? '700' : '500'}
                      style={{ color: active ? '#FFFFFF' : '#A1A1AA' }}
                      numberOfLines={1}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Shared Content Panel */}
            <View style={styles.sharedContainer}>
              {activeTab === 'photos' && (
                sharedPhotos.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="images-outline" size={26} color="#71717A" />
                    <Text variant="xs" style={styles.emptyText}>
                      No photos shared in loaded messages yet.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.photoGrid}>
                    {sharedPhotos.map((photo) => (
                      <TouchableOpacity
                        key={photo.id}
                        style={[
                          styles.photoCell,
                          { width: photoCellSize, height: photoCellSize },
                        ]}
                        activeOpacity={0.82}
                        onPress={() => {
                          onClose();
                          onOpenPhoto({ uri: photo.uri, name: photo.name });
                        }}
                      >
                        <Image
                          source={{
                            uri: photo.uri,
                            headers:
                              photo.uri.startsWith('http://') || photo.uri.startsWith('https://')
                                ? authHeaders
                                : undefined,
                            cacheKey: photo.uri,
                          }}
                          style={{ width: photoCellSize, height: photoCellSize }}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                          recyclingKey={photo.uri}
                          transition={150}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                )
              )}

              {activeTab === 'files' && (
                sharedFiles.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="document-outline" size={26} color="#71717A" />
                    <Text variant="xs" style={styles.emptyText}>
                      No files shared in loaded messages yet.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.listGroup}>
                    {sharedFiles.map((msg, idx) => {
                      const displayName = msg.attachmentOriginalName || msg.attachmentName || 'File';
                      const parsed = safeParseDate(msg.createdAt);
                      const dateStr = parsed ? formatDate(parsed, { month: 'short', day: 'numeric' }) : '';
                      return (
                        <TouchableOpacity
                          key={`${msg.id}:${idx}`}
                          style={[
                            styles.listRow,
                            idx === sharedFiles.length - 1 && { borderBottomWidth: 0 },
                          ]}
                          activeOpacity={0.75}
                          onPress={() => {
                            onClose();
                            onOpenFile(msg);
                          }}
                        >
                          <View style={[styles.listIconBox, { backgroundColor: hexToRgba(bubbleTint, 0.34) }]}>
                            <Ionicons
                              name={getFileIcon(displayName, msg.attachmentMimeType)}
                              size={18}
                              color="#F4F4F5"
                            />
                          </View>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text variant="sm" weight="600" style={{ color: '#F4F4F5' }} numberOfLines={1}>
                              {displayName}
                            </Text>
                            <Text variant="xs" style={{ color: '#A1A1AA', marginTop: 2 }} numberOfLines={1}>
                              {formatFileSubtitle(displayName, msg.attachmentSize, msg.attachmentMimeType)}
                              {msg.name ? ` · ${msg.name}` : ''}
                              {dateStr ? ` · ${dateStr}` : ''}
                            </Text>
                          </View>
                          <Ionicons name="open-outline" size={16} color="#A1A1AA" style={{ marginLeft: 8 }} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )
              )}

              {activeTab === 'links' && (
                sharedLinks.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="link-outline" size={26} color="#71717A" />
                    <Text variant="xs" style={styles.emptyText}>
                      No links shared in loaded messages yet.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.listGroup}>
                    {sharedLinks.map((link, idx) => (
                      <TouchableOpacity
                        key={link.id}
                        style={[
                          styles.listRow,
                          idx === sharedLinks.length - 1 && { borderBottomWidth: 0 },
                        ]}
                        activeOpacity={0.75}
                        onPress={() => {
                          Linking.openURL(link.url).catch(() => {});
                        }}
                      >
                        <View style={[styles.listIconBox, { backgroundColor: hexToRgba(bubbleTint, 0.34) }]}>
                          <Ionicons name="globe-outline" size={18} color="#F4F4F5" />
                        </View>
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text variant="sm" weight="600" style={{ color: '#F4F4F5' }} numberOfLines={1}>
                            {link.domain}
                          </Text>
                          <Text variant="xs" style={{ color: '#A1A1AA', marginTop: 2 }} numberOfLines={1}>
                            {link.url}
                          </Text>
                        </View>
                        <Ionicons name="open-outline" size={16} color="#A1A1AA" style={{ marginLeft: 8 }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )
              )}
            </View>
          </ScrollView>
        </ThemeGlassSheet>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.40)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '86%',
    backgroundColor: 'rgba(14, 14, 18, 0.78)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 10,
    overflow: 'hidden',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    alignSelf: 'center',
    marginBottom: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  topBarLabel: {
    color: 'rgba(255, 255, 255, 0.65)',
    letterSpacing: 0.9,
    fontSize: 11,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 14,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarTouchWrap: {
    position: 'relative',
  },
  avatarRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    padding: 3,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: 'rgba(24, 24, 28, 0.9)',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: -1,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  groupTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    flexShrink: 1,
  },
  editPencilPill: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editNameWrap: {
    width: '100%',
    marginTop: 12,
    gap: 8,
  },
  editNameInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  editNameActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  editNameCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  editNameSaveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 7,
    borderRadius: 999,
  },
  metaPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 9,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  metaDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  metaPillText: {
    color: '#F4F4F5',
    fontSize: 11.5,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickTile: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.13)',
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  quickTileLabel: {
    color: '#F4F4F5',
    fontSize: 12,
  },
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.11)',
    padding: 4,
    gap: 4,
    marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  sharedContainer: {
    minHeight: 150,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    gap: 8,
  },
  emptyText: {
    color: '#A1A1AA',
    textAlign: 'center',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  photoCell: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  listGroup: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  listIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
