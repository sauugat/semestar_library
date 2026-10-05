import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { Avatar } from '@/components/ui/Avatar';
import { formatTimeAgo, safeParseDate } from '@/utils/date';
import {
  InAppNotification,
  fetchInAppNotifications,
  markNotificationSeen,
  markNotificationRead,
  markNotificationUnread,
  markAllNotificationsRead,
  hideInAppNotification,
  navigateToNotificationTarget,
  syncAppBadge,
} from '@/services/notifications';

type TabKey = 'all' | 'unread' | 'mentions';

interface NotificationSection {
  title: string;
  data: InAppNotification[];
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Action sheet state
  const [selectedItem, setSelectedItem] = useState<InAppNotification | null>(null);
  const [actionModalVisible, setActionModalVisible] = useState(false);

  const loadNotifications = useCallback(
    (tab: TabKey) => fetchInAppNotifications({ tab, limit: 30 })
      .then(data => {
        setNotifications(data.notifications);
        setNextCursor(data.nextCursor);

        // Mark incoming notifications as seen to clear badge
        void markNotificationSeen();
        void syncAppBadge(0);
      }).catch(err => {
        if (__DEV__) console.warn('[NotificationsScreen] Load error:', err);
      }).finally(() => {
        setLoading(false);
        setRefreshing(false);
      }),
    []
  );

  useEffect(() => {
    void loadNotifications(activeTab);
  }, [activeTab, loadNotifications]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadNotifications(activeTab);
  }, [activeTab, loadNotifications]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const data = await fetchInAppNotifications({
        tab: activeTab,
        cursor: nextCursor,
        limit: 25,
      });
      setNotifications((prev) => [...prev, ...data.notifications]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      if (__DEV__) console.warn('[NotificationsScreen] Load more error:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setNotifications((prev) =>
        prev.map((item) => ({ ...item, isRead: true, readAt: new Date().toISOString() }))
      );
      await markAllNotificationsRead();
      void syncAppBadge(0);
    } catch (err) {
      if (__DEV__) console.warn('[NotificationsScreen] Mark all read error:', err);
    }
  };

  const handleItemPress = async (item: InAppNotification) => {
    if (!item.isRead) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n))
      );
      void markNotificationRead(item.id);
    }
    navigateToNotificationTarget(item);
  };

  const handleToggleRead = async (item: InAppNotification) => {
    setActionModalVisible(false);
    const newRead = !item.isRead;
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === item.id ? { ...n, isRead: newRead, readAt: newRead ? new Date().toISOString() : null } : n
      )
    );
    if (newRead) {
      await markNotificationRead(item.id);
    } else {
      await markNotificationUnread(item.id);
    }
  };

  const handleHide = async (item: InAppNotification) => {
    setActionModalVisible(false);
    setNotifications((prev) => prev.filter((n) => n.id !== item.id));
    await hideInAppNotification(item.id);
  };

  // Group notifications into TODAY, YESTERDAY, EARLIER
  const sections: NotificationSection[] = useMemo(() => {
    if (!notifications || notifications.length === 0) return [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;

    const todayList: InAppNotification[] = [];
    const yesterdayList: InAppNotification[] = [];
    const earlierList: InAppNotification[] = [];

    notifications.forEach((item) => {
      const d = safeParseDate(item.createdAt);
      const time = d ? d.getTime() : 0;
      if (time >= todayStart) {
        todayList.push(item);
      } else if (time >= yesterdayStart) {
        yesterdayList.push(item);
      } else {
        earlierList.push(item);
      }
    });

    const res: NotificationSection[] = [];
    if (todayList.length > 0) res.push({ title: 'TODAY', data: todayList });
    if (yesterdayList.length > 0) res.push({ title: 'YESTERDAY', data: yesterdayList });
    if (earlierList.length > 0) res.push({ title: 'EARLIER', data: earlierList });

    return res;
  }, [notifications]);

  // Icon selector based on notification type
  const renderIcon = (item: InAppNotification) => {
    const isOfficial =
      item.type === 'official_notice' ||
      item.type === 'system' ||
      item.type === 'security' ||
      item.metadata?.isOfficial;

    if (item.actor?.avatarUrl) {
      return (
        <Avatar
          url={item.actor.avatarUrl}
          name={item.actor.name || 'User'}
          size="md"
        />
      );
    }

    if (isOfficial) {
      return (
        <View
          style={[
            styles.typeIconBadge,
            { backgroundColor: colors.text, borderColor: colors.border },
          ]}
        >
          <Ionicons name="shield-checkmark" size={18} color={colors.surface} />
        </View>
      );
    }

    let iconName: keyof typeof Ionicons.glyphMap = 'notifications-outline';
    if (item.type === 'post_reaction' || item.type === 'comment_reaction') {
      iconName = 'heart';
    } else if (item.type === 'post_comment' || item.type === 'comment_reply') {
      iconName = 'chatbubble-ellipses-outline';
    } else if (item.type === 'mention') {
      iconName = 'at-outline';
    } else if (item.type === 'chat_message') {
      iconName = 'chatbubbles-outline';
    } else if (item.type === 'material_uploaded') {
      iconName = 'document-text-outline';
    } else if (item.type === 'routine_updated') {
      iconName = 'calendar-outline';
    }

    return (
      <View
        style={[
          styles.typeIconBadge,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ]}
      >
        <Ionicons name={iconName} size={18} color={colors.text} />
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header Controls Bar */}
      <View
        style={[
          styles.topHeader,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
            paddingTop: Platform.OS === 'android' ? 12 : 8,
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <Heading style={{ fontSize: 22, fontWeight: '700' }}>Notifications</Heading>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
            onPress={handleMarkAllRead}
            accessibilityLabel="Mark all as read"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="checkmark-done" size={18} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
            onPress={() => router.push('/notification-settings' as any)}
            accessibilityLabel="Notification settings"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="settings-outline" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs Row */}
      <View
        style={[
          styles.tabsRow,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {(['all', 'unread', 'mentions'] as TabKey[]).map((tabKey) => {
          const isActive = activeTab === tabKey;
          const label =
            tabKey === 'all'
              ? 'All'
              : tabKey === 'unread'
              ? 'Unread'
              : 'Mentions';

          return (
            <TouchableOpacity
              key={tabKey}
              style={[
                styles.tabItem,
                isActive && {
                  borderBottomColor: colors.text,
                  borderBottomWidth: 2,
                },
              ]}
              onPress={() => {
                if (tabKey === activeTab) return;
                setLoading(true);
                setActiveTab(tabKey);
              }}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: isActive ? colors.text : colors.textMuted,
                    fontWeight: isActive ? '700' : '500',
                  },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Main List / Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View
            style={[
              styles.emptyIconCircle,
              { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name={
                activeTab === 'unread'
                  ? 'checkmark-circle-outline'
                  : activeTab === 'mentions'
                  ? 'at-outline'
                  : 'notifications-off-outline'
              }
              size={36}
              color={colors.textMuted}
            />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {activeTab === 'unread'
              ? 'No unread notifications'
              : activeTab === 'mentions'
              ? 'No mentions yet'
              : "You're all caught up"}
          </Text>
          <Caption color="muted" style={styles.emptySubtitle}>
            {activeTab === 'unread'
              ? "You've read all your updates and alerts."
              : activeTab === 'mentions'
              ? 'When classmates or teachers mention you, they will appear here.'
              : 'Class notes, notices, and updates will show up here.'}
          </Caption>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 16 }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
          renderSectionHeader={({ section: { title } }) => (
            <View
              style={[
                styles.sectionHeader,
                { backgroundColor: colors.background },
              ]}
            >
              <Text style={[styles.sectionHeaderText, { color: colors.textMuted }]}>
                {title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.notificationRow,
                {
                  backgroundColor: !item.isRead
                    ? colors.surfaceRaised
                    : colors.surface,
                  borderBottomColor: colors.border,
                },
              ]}
              activeOpacity={0.7}
              onPress={() => handleItemPress(item)}
              onLongPress={() => {
                setSelectedItem(item);
                setActionModalVisible(true);
              }}
            >
              {/* Unread Left Pill */}
              <View style={styles.unreadIndicatorSlot}>
                {!item.isRead && (
                  <View
                    style={[
                      styles.unreadDot,
                      { backgroundColor: colors.text },
                    ]}
                  />
                )}
              </View>

              {/* Avatar / Icon */}
              <View style={styles.avatarSlot}>{renderIcon(item)}</View>

              {/* Text Content */}
              <View style={styles.contentSlot}>
                <View style={styles.titleRow}>
                  <Text
                    style={[
                      styles.itemTitle,
                      {
                        color: colors.text,
                        fontWeight: !item.isRead ? '700' : '600',
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Caption color="muted" style={styles.timestampText}>
                    {formatTimeAgo(item.createdAt)}
                  </Caption>
                </View>

                {item.body ? (
                  <Text
                    style={[
                      styles.itemBody,
                      { color: !item.isRead ? colors.text : colors.textSecondary },
                    ]}
                    numberOfLines={2}
                  >
                    {item.body}
                  </Text>
                ) : null}
              </View>

              {/* Overflow action button */}
              <TouchableOpacity
                style={styles.moreActionBtn}
                onPress={() => {
                  setSelectedItem(item);
                  setActionModalVisible(true);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="More options"
              >
                <Ionicons name="ellipsis-horizontal" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Overflow Action Sheet Modal */}
      <Modal
        visible={actionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setActionModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setActionModalVisible(false)}
        >
          <View
            style={[
              styles.actionSheetContainer,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <View style={styles.sheetHandle} />

            {selectedItem && (
              <View style={styles.sheetHeader}>
                <Text
                  style={[styles.sheetTitle, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {selectedItem.title}
                </Text>
                {selectedItem.body ? (
                  <Caption color="muted" numberOfLines={1}>
                    {selectedItem.body}
                  </Caption>
                ) : null}
              </View>
            )}

            <View style={[styles.sheetDivider, { backgroundColor: colors.border }]} />

            {selectedItem && (
              <>
                <TouchableOpacity
                  style={styles.sheetOption}
                  onPress={() => handleToggleRead(selectedItem)}
                >
                  <Ionicons
                    name={selectedItem.isRead ? 'mail-unread-outline' : 'checkmark-done-outline'}
                    size={20}
                    color={colors.text}
                  />
                  <Text style={[styles.sheetOptionText, { color: colors.text }]}>
                    {selectedItem.isRead ? 'Mark as unread' : 'Mark as read'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.sheetOption}
                  onPress={() => handleHide(selectedItem)}
                >
                  <Ionicons name="eye-off-outline" size={20} color={colors.text} />
                  <Text style={[styles.sheetOptionText, { color: colors.text }]}>
                    Hide this notification
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.sheetOption}
                  onPress={() => {
                    setActionModalVisible(false);
                    router.push('/notification-settings' as any);
                  }}
                >
                  <Ionicons name="settings-outline" size={20} color={colors.text} />
                  <Text style={[styles.sheetOptionText, { color: colors.text }]}>
                    Notification settings
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <View style={[styles.sheetDivider, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={[styles.sheetOption, { justifyContent: 'center' }]}
              onPress={() => setActionModalVisible(false)}
            >
              <Text style={[styles.sheetCancelText, { color: colors.textMuted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {
    paddingVertical: 12,
    marginRight: 24,
  },
  tabLabel: {
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    textAlign: 'center',
    lineHeight: 18,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  unreadIndicatorSlot: {
    width: 12,
    paddingTop: 8,
    alignItems: 'center',
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  avatarSlot: {
    marginRight: 12,
  },
  typeIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  contentSlot: {
    flex: 1,
    marginRight: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  itemTitle: {
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  timestampText: {
    fontSize: 11,
  },
  itemBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  moreActionBtn: {
    padding: 6,
    alignSelf: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  actionSheetContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#888',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeader: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    gap: 12,
  },
  sheetOptionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  sheetCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
