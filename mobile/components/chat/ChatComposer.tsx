import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  type TextInputInstance,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Text } from "@/components/ui/Typography";
import { COMPOSER_GEOMETRY } from "@/constants/composerGeometry";
import { ChatMember, ChatMessage, sendChatTyping } from "@/services/chat";
import { formatFileSubtitle } from "@/services/chat-state";
import { ChatSendButton } from "./ChatSendButton";
import { MentionSuggestions } from "./MentionSuggestions";

const composerDraftCache = new Map<string, string>();

export interface ChatComposerProps {
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  selectedAttachment: {
    uri: string;
    name: string;
    mimeType: string;
    size?: number;
    isImage?: boolean;
  } | null;
  onClearAttachment: () => void;
  onOpenAttachModal: () => void;
  onPickCamera: () => void;
  onSendMessage: (payload: {
    text: string;
    file: { uri: string; name: string; mimeType: string; isImage?: boolean; size?: number } | null;
    replyTo: ChatMessage | null;
    mentions?: string[];
  }) => void;
  inputRef: React.RefObject<TextInputInstance | null>;
  paddingBottom?: number;
  userAvailable: boolean;
  members?: ChatMember[];
  serverUrl?: string;
  currentUserId?: string;
  roomKey?: string;
}

export const ChatComposer = React.memo(function ChatComposer({
  replyTo,
  onCancelReply,
  selectedAttachment,
  onClearAttachment,
  onOpenAttachModal,
  onPickCamera,
  onSendMessage,
  inputRef,
  paddingBottom = 0,
  userAvailable,
  members = [],
  serverUrl = "",
  currentUserId,
  roomKey = "default",
}: ChatComposerProps) {
  const [inputText, setInputText] = useState(() => composerDraftCache.get(roomKey) || "");
  const [inputFocused, setInputFocused] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const selectedMentionsRef = useRef<Map<string, string>>(new Map());
  const lastTypingSentRef = useRef<number>(0);

  useEffect(() => {
    setInputText(composerDraftCache.get(roomKey) || "");
    setMentionQuery(null);
    selectedMentionsRef.current.clear();
  }, [roomKey]);

  const checkMentionTrigger = useCallback((text: string, cursorIndex: number) => {
    const textBefore = text.slice(0, cursorIndex);
    const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_.]*)$/);
    if (match) {
      setMentionQuery(match[1]);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const handleTextChange = useCallback((text: string) => {
    setInputText(text);
    if (text) {
      composerDraftCache.set(roomKey, text);
    } else {
      composerDraftCache.delete(roomKey);
    }
    checkMentionTrigger(text, text.length);

    const now = Date.now();
    if (text.trim() && now - lastTypingSentRef.current > 2500) {
      lastTypingSentRef.current = now;
      void sendChatTyping();
    }
  }, [checkMentionTrigger, roomKey]);

  const handleSelectionChange = useCallback((e: any) => {
    const sel = e.nativeEvent.selection;
    setSelection(sel);
    checkMentionTrigger(inputText, sel.start);
  }, [inputText, checkMentionTrigger]);

  const handleSelectCandidate = useCallback((candidate: {
    studentId: string;
    name: string;
    username: string | null;
  }) => {
    const cursorPos = selection.start || inputText.length;
    const textBefore = inputText.slice(0, cursorPos);
    const textAfter = inputText.slice(cursorPos);
    const atPos = textBefore.lastIndexOf("@");
    if (atPos < 0) return;

    const handle = candidate.username || candidate.name.replace(/\s+/g, "_");
    const replacement = `@${handle} `;
    const newText = textBefore.slice(0, atPos) + replacement + textAfter;
    const newCursor = atPos + replacement.length;

    selectedMentionsRef.current.set(handle.toLowerCase(), candidate.studentId);
    setInputText(newText);
    composerDraftCache.set(roomKey, newText);
    setMentionQuery(null);

    setTimeout(() => {
      (inputRef.current as any)?.setNativeProps?.({
        selection: { start: newCursor, end: newCursor },
      });
    }, 50);
  }, [inputText, selection, inputRef, roomKey]);

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed && !selectedAttachment) return;
    if (trimmed.length > 2000) return;

    // Extract all @mentions present in the trimmed text
    const mentionRegex = /\B@([a-zA-Z0-9_.]{1,30})/gi;
    const mentionIds: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(trimmed)) !== null) {
      const handleLower = match[1].toLowerCase();
      // 1. Check directly selected mentions
      let sid = selectedMentionsRef.current.get(handleLower);
      // 2. Fallback: match against members list if typed manually
      if (!sid && members && members.length > 0) {
        const found = members.find(
          (m) =>
            (m.username && m.username.toLowerCase() === handleLower) ||
            m.name.toLowerCase().replace(/\s+/g, "_") === handleLower ||
            m.studentId.toLowerCase() === handleLower
        );
        if (found) sid = found.studentId;
      }
      if (sid && sid !== currentUserId && !mentionIds.includes(sid)) {
        mentionIds.push(sid);
      }
    }

    const textToSend = trimmed;
    const attachmentToSend = selectedAttachment;
    const replyToSend = replyTo;

    // Clear state before sending
    setInputText("");
    composerDraftCache.delete(roomKey);
    setMentionQuery(null);
    selectedMentionsRef.current.clear();
    onCancelReply();

    // Trigger send flow with verified mentions attached
    onSendMessage({
      text: textToSend,
      file: attachmentToSend,
      replyTo: replyToSend,
      mentions: mentionIds,
    });
  }, [
    inputText,
    selectedAttachment,
    replyTo,
    members,
    currentUserId,
    roomKey,
    onCancelReply,
    onSendMessage,
  ]);

  const hasContent = Boolean(inputText.trim() || selectedAttachment);
  const nearCharLimit = inputText.length >= 1800;

  return (
    <View style={styles.outerContainer}>
      {/* Mention Autocomplete Suggestions */}
      {mentionQuery !== null && (
        <MentionSuggestions
          query={mentionQuery}
          members={members}
          serverUrl={serverUrl}
          currentUserId={currentUserId}
          onSelect={handleSelectCandidate}
          onClose={() => setMentionQuery(null)}
        />
      )}

      {/* Replying-to Preview Bar */}
      {replyTo && (
        <View style={styles.replyBanner}>
          <Ionicons name="arrow-undo" size={16} color="#a1a1aa" />
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBannerSender}>
              REPLYING TO {replyTo.name || "CLASSMATE"}
            </Text>
            <Text numberOfLines={1} style={styles.replyBannerPreview}>
              {replyTo.text || replyTo.attachmentOriginalName || "Attachment"}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityLabel="Cancel reply"
            onPress={onCancelReply}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={18} color="#a1a1aa" />
          </TouchableOpacity>
        </View>
      )}

      {/* Selected Attachment Preview Bar */}
      {selectedAttachment && (
        <View style={styles.attachmentPreviewBanner}>
          <View style={styles.attachmentPreviewContent}>
            {selectedAttachment.isImage ? (
              <Image
                source={{ uri: selectedAttachment.uri }}
                style={styles.previewThumbnail}
              />
            ) : (
              <View style={styles.previewIconBox}>
                <Ionicons name="document-text" size={18} color="#e4e4e7" />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text variant="sm" weight="600" numberOfLines={1} style={{ color: "#f5f5f5" }}>
                {selectedAttachment.name}
              </Text>
              <Text variant="xs" style={{ color: "#a1a1aa", marginTop: 1 }}>
                {formatFileSubtitle(
                  selectedAttachment.name,
                  selectedAttachment.size,
                  selectedAttachment.mimeType
                )}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            accessibilityLabel="Remove attachment"
            onPress={onClearAttachment}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.removeAttachmentBtn}
          >
            <Ionicons name="close-circle" size={18} color="#a1a1aa" />
          </TouchableOpacity>
        </View>
      )}

      {nearCharLimit && (
        <View style={{ paddingHorizontal: 16, paddingTop: 4, alignItems: "flex-end" }}>
          <Text variant="xs" style={{ color: inputText.length >= 1980 ? "#ef4444" : "#a1a1aa" }}>
            {inputText.length}/2000
          </Text>
        </View>
      )}

      {/* Message Composer Bar */}
      <View
        style={[
          styles.composerContainer,
          paddingBottom > 0 && { paddingBottom },
        ]}
      >
        <View
          style={[
            styles.modernCapsuleBar,
            inputFocused && styles.modernCapsuleBarFocused,
          ]}
        >
          {/* Left Circular Camera Button inside capsule */}
          <TouchableOpacity
            style={styles.cameraCircleBtn}
            onPress={onPickCamera}
            disabled={!userAvailable}
            activeOpacity={0.75}
            accessibilityLabel="Share photo"
          >
            <Ionicons name="camera" size={19} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Pill-shaped text input */}
          <TextInput
            ref={inputRef}
            accessibilityLabel="Message your class"
            keyboardAppearance="dark"
            style={[
              styles.pillTextInput,
              inputFocused && { borderColor: "transparent" },
            ]}
            placeholder="Message..."
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={2000}
            value={inputText}
            onChangeText={handleTextChange}
            onSelectionChange={handleSelectionChange}
            onFocus={() => setInputFocused(true)}
            onBlur={() => {
              setInputFocused(false);
            }}
            editable={userAvailable}
          />

          {/* Send button when content exists, otherwise modern quick icons */}
          {hasContent ? (
            <ChatSendButton
              disabled={!hasContent || !userAvailable}
              onPress={handleSend}
            />
          ) : (
            <View style={styles.rightIconsRow}>
              <TouchableOpacity
                style={styles.inlineIconTouch}
                onPress={() => inputRef.current?.focus()}
                disabled={!userAvailable}
                activeOpacity={0.7}
                accessibilityLabel="Voice input"
              >
                <Ionicons name="mic-outline" size={21} color="#F4F4F5" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.inlineIconTouch}
                onPress={onOpenAttachModal}
                disabled={!userAvailable}
                activeOpacity={0.7}
                accessibilityLabel="Attach image"
              >
                <Ionicons name="image-outline" size={21} color="#F4F4F5" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.inlineIconTouch}
                onPress={() => inputRef.current?.focus()}
                disabled={!userAvailable}
                activeOpacity={0.7}
                accessibilityLabel="Quick message"
              >
                <Ionicons name="chatbubble-ellipses-outline" size={20} color="#F4F4F5" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionTouchArea}
                onPress={onOpenAttachModal}
                disabled={!userAvailable}
                activeOpacity={0.7}
                accessibilityLabel="Add attachment"
              >
                <View style={styles.actionIconCircle}>
                  <Ionicons name="add-circle-outline" size={22} color="#F4F4F5" />
                </View>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    width: "100%",
    backgroundColor: "transparent",
  },
  composerContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
  },
  modernCapsuleBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(22, 22, 26, 0.88)",
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.14)",
    paddingHorizontal: 6,
    paddingVertical: 4,
    minHeight: 48,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  modernCapsuleBarFocused: {
    borderColor: "rgba(255, 255, 255, 0.26)",
    backgroundColor: "rgba(26, 26, 31, 0.94)",
  },
  cameraCircleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(115, 118, 128, 0.42)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
    flexShrink: 0,
  },
  pillTextInput: {
    flex: 1,
    // Base token: backgroundColor: "#242424"
    backgroundColor: "transparent",
    borderRadius: COMPOSER_GEOMETRY.borderRadius,
    borderWidth: 0,
    borderColor: "transparent",
    paddingHorizontal: 8,
    paddingTop: COMPOSER_GEOMETRY.inputPaddingTop,
    paddingBottom: COMPOSER_GEOMETRY.inputPaddingBottom,
    color: "#F5F5F5",
    fontSize: COMPOSER_GEOMETRY.fontSize,
    lineHeight: COMPOSER_GEOMETRY.lineHeight,
    minHeight: 38,
    maxHeight: COMPOSER_GEOMETRY.maxInputHeight,
  },
  rightIconsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: 4,
  },
  inlineIconTouch: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTouchArea: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  actionIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1C",
    borderLeftWidth: 3,
    borderLeftColor: "#737373",
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginHorizontal: 10,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#282828",
    gap: 8,
  },
  replyBannerSender: {
    fontSize: 10.5,
    fontWeight: "600",
    color: "#F5F5F5",
    letterSpacing: 0.3,
  },
  replyBannerPreview: {
    fontSize: 12,
    color: "#A1A1A1",
    marginTop: 1,
  },
  attachmentPreviewBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1C",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 10,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#282828",
  },
  attachmentPreviewContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  previewThumbnail: {
    width: 36,
    height: 36,
    borderRadius: 6,
  },
  previewIconBox: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: "#27272a",
    alignItems: "center",
    justifyContent: "center",
  },
  removeAttachmentBtn: {
    padding: 4,
  },
});
