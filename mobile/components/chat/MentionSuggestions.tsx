import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Text } from "@/components/ui/Typography";
import {
  ChatMember,
  MentionCandidate,
  searchMentionCandidates,
} from "@/services/chat";

export interface MentionSuggestionsProps {
  query: string;
  members: ChatMember[];
  serverUrl: string;
  currentUserId?: string;
  onSelect: (candidate: {
    studentId: string;
    name: string;
    username: string | null;
    avatarUrl: string | null;
  }) => void;
  onClose: () => void;
}

export const MentionSuggestions = React.memo(function MentionSuggestions({
  query,
  members,
  serverUrl,
  currentUserId,
  onSelect,
  onClose,
}: MentionSuggestionsProps) {
  const [remoteCandidates, setRemoteCandidates] = useState<MentionCandidate[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced server search for candidates not in initial members list
  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      setRemoteCandidates([]);
      setLoadingRemote(false);
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      setLoadingRemote(true);
      try {
        const results = await searchMentionCandidates(trimmed);
        if (cancelled) return;
        setRemoteCandidates(results.filter((c) => c.studentId !== currentUserId));
      } catch {
        // Fall back to local members
      } finally {
        if (!cancelled) setLoadingRemote(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, currentUserId]);

  // Combine local group members with remote candidates, deduplicated by studentId
  const candidateList = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<
      string,
      { studentId: string; name: string; username: string | null; avatarUrl: string | null }
    >();

    // 1. Filter local members
    members.forEach((m) => {
      if (m.studentId === currentUserId) return;
      if (
        !q ||
        m.name.toLowerCase().includes(q) ||
        (m.username && m.username.toLowerCase().includes(q))
      ) {
        map.set(m.studentId, {
          studentId: m.studentId,
          name: m.name,
          username: m.username || null,
          avatarUrl: m.avatarUrl || null,
        });
      }
    });

    // 2. Merge remote candidates
    remoteCandidates.forEach((c) => {
      if (c.studentId === currentUserId) return;
      if (!map.has(c.studentId)) {
        map.set(c.studentId, {
          studentId: c.studentId,
          name: c.name,
          username: c.username || null,
          avatarUrl: c.avatarUrl || null,
        });
      }
    });

    return Array.from(map.values()).slice(0, 10);
  }, [members, remoteCandidates, query, currentUserId]);

  if (candidateList.length === 0 && !loadingRemote) {
    return null;
  }

  const getFullAvatarUrl = (avatarUrl: string | null) => {
    if (!avatarUrl) return null;
    if (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")) {
      return avatarUrl;
    }
    const base = (serverUrl || "").replace(/\/+$/, "");
    const path = avatarUrl.replace(/^\/+/, "");
    return `${base}/${path}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>MENTION STUDENT</Text>
        {loadingRemote && (
          <ActivityIndicator size="small" color="#a1a1aa" style={{ marginLeft: 6 }} />
        )}
      </View>
      <ScrollView
        style={styles.scrollView}
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {candidateList.map((item, index) => {
          const avatarUri = getFullAvatarUrl(item.avatarUrl);
          const isLast = index === candidateList.length - 1;
          return (
            <TouchableOpacity
              key={item.studentId}
              style={[styles.row, !isLast && styles.rowBorder]}
              activeOpacity={0.65}
              onPress={() => onSelect(item)}
            >
              {avatarUri ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={styles.avatar}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.fallbackInitial}>
                    {(item.name || "S").charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.textContainer}>
                <Text style={styles.nameText} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.username && (
                  <Text style={styles.usernameText} numberOfLines={1}>
                    @{item.username}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    marginHorizontal: 8,
    marginBottom: 8,
    maxHeight: 180,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#27272a",
  },
  headerText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#71717a",
    letterSpacing: 0.8,
  },
  scrollView: {
    maxHeight: 146,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#27272a",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#27272a",
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#27272a",
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackInitial: {
    fontSize: 13,
    fontWeight: "700",
    color: "#f5f5f5",
  },
  textContainer: {
    marginLeft: 10,
    flex: 1,
  },
  nameText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#f5f5f5",
  },
  usernameText: {
    fontSize: 11,
    color: "#a1a1aa",
    marginTop: 1,
  },
});
