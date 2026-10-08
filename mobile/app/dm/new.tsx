import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
  Keyboard,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import { searchDmUsers, createOrGetDmConversation, type DmParticipant } from '@/services/dm';

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function NewDmScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DmParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const users = await searchDmUsers(q, 30);
      setResults(users);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void doSearch(text);
    }, 300);
  };

  const handleSelectUser = async (targetUser: DmParticipant) => {
    if (starting) return;
    setStarting(true);
    Keyboard.dismiss();
    try {
      const { conversation } = await createOrGetDmConversation(targetUser.studentId);
      router.replace({
        pathname: '/dm/[id]',
        params: {
          id: conversation.id,
          peerName: targetUser.name,
          peerRole: targetUser.role,
          peerAvatar: targetUser.avatarUrl || '',
        },
      });
    } catch (err: any) {
      alert(err.message || 'Could not start conversation');
      setStarting(false);
    }
  };

  const renderItem = ({ item }: { item: DmParticipant }) => {
    const role = (item.role || 'student').toLowerCase();
    return (
      <Pressable
        style={({ pressed }) => [
          styles.userRow,
          {
            backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
            borderBottomColor: colors.borderSubtle,
          },
        ]}
        onPress={() => handleSelectUser(item)}
      >
        <View style={[styles.avatar, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          {item.avatarUrl ? (
            <Image source={{ uri: item.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <Text variant="sm" weight="700" style={{ color: colors.text }}>
              {getInitials(item.name)}
            </Text>
          )}
        </View>

        <View style={styles.userInfo}>
          <View style={styles.nameRow}>
            <Text variant="md" weight="600" numberOfLines={1} style={{ color: colors.text }}>
              {item.name}
            </Text>
            {role !== 'student' ? (
              <View style={[styles.roleBadge, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                <Text variant="xs" weight="700" style={styles.roleBadgeText}>
                  {role.toUpperCase()}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.metaRow}>
            {item.username ? (
              <Text variant="xs" style={{ color: colors.textSecondary }}>
                @{item.username}
              </Text>
            ) : null}
            {item.department ? (
              <Text variant="xs" style={{ color: colors.textMuted }}>
                {item.username ? ' • ' : ''}{item.department}
              </Text>
            ) : null}
          </View>
        </View>

        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: 'New Message',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />

      {/* Search Input Bar */}
      <View style={[styles.searchBarContainer, { backgroundColor: colors.surface, borderBottomColor: colors.borderSubtle }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Search students, teachers, admins..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={handleQueryChange}
            style={[styles.searchInput, { color: colors.text }]}
            autoFocus
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query ? (
            <TouchableOpacity onPress={() => handleQueryChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Body Content */}
      {starting ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text variant="sm" color="secondary" style={{ marginTop: 10 }}>
            Opening conversation...
          </Text>
        </View>
      ) : loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text variant="sm" color="secondary" style={{ marginTop: 10 }}>
            Searching users...
          </Text>
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.textMuted} />
          <Text variant="md" color="secondary" style={{ marginTop: 10 }}>
            {error}
          </Text>
        </View>
      ) : query && results.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="person-outline" size={40} color={colors.textMuted} />
          <Text variant="md" weight="600" style={{ marginTop: 12, color: colors.text }}>
            No users found
          </Text>
          <Text variant="sm" color="secondary" style={{ marginTop: 4 }}>
            No verified members match "{query}"
          </Text>
        </View>
      ) : !query ? (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={40} color={colors.textMuted} />
          <Text variant="md" weight="600" style={{ marginTop: 12, color: colors.text }}>
            Find people to message
          </Text>
          <Text variant="sm" color="secondary" align="center" style={{ marginTop: 6, marginHorizontal: 40, lineHeight: 20 }}>
            Search by full name or username to privately message classmates, CRs, teachers, and admins.
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.studentId}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  avatarImage: {
    width: 44,
    height: 44,
  },
  userInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  roleBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 9,
    letterSpacing: 0.3,
    color: '#a3a3a3',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginTop: -40,
  },
});
