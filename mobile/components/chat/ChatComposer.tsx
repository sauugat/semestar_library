import React, { useState, useRef, useCallback } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Text } from "@/components/ui/Typography";
import { COMPOSER_GEOMETRY } from "@/constants/composerGeometry";
import { ChatMember, ChatMessage, sendChatTyping } from "@/services/chat";
import { ChatSendButton } from "./ChatSendButton";
import { MentionSuggestions } from "./MentionSuggestions";

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
    file: { uri: string; name: string; mimeType: string; isImage?: boolean } | null;
    replyTo: ChatMessage | null;
    mentions?: string[];
  }) => void;
  inputRef: React.RefObject<TextInput | null>;
  paddingBottom?: number;
  userAvailable: boolean;
  members?: ChatMember[];
  serverUrl?: string;
  currentUserId?: string;
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
}: ChatComposerProps) {
  const [inputText, setInputText] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const selectedMentionsRef = useRef<Map<string, string>>(new Map());
  const lastTypingSentRef = useRef<number>(0);

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
    checkMentionTrigger(text, text.length);

    const now = Date.now();
    if (text.trim() && now - lastTypingSentRef.current > 2500) {
      lastTypingSentRef.current = now;
      void sendChatTyping();
    }
  }, [checkMentionTrigger]);

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
    setMentionQuery(null);

    setTimeout(() => {
      inputRef.current?.setNativeProps?.({
        selection: { start: newCursor, end: newCursor },
      });
    }, 50);
  }, [inputText, selection, inputRef]);

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
    onCancelReply,
    onSendMessage,
  ]);

  const hasContent = Boolean(inputText.trim() || selectedAttachment);

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

      {/* Message Composer Bar */}
      <View
        style={[
          styles.composerContainer,
          paddingBottom > 0 && { paddingBottom },
        ]}
      >
        {/* Attach '+' button */}
        <TouchableOpacity
          style={styles.actionTouchArea}
          onPress={onOpenAttachModal}
          activeOpacity={0.7}
          accessibilityLabel="Add attachment"
        >
          <View style={styles.actionIconCircle}>
            <Ionicons name="add" size={22} color="#f5f5f5" />
          </View>
        </TouchableOpacity>

        {/* Pill-shaped text input */}
        <TextInput
          ref={inputRef}
          accessibilityLabel="Message your class"
          keyboardAppearance="dark"
          style={[
            styles.pillTextInput,
            inputFocused && { borderColor: "#52525b" },
          ]}
          placeholder="Message…"
          placeholderTextColor="#71717a"
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

        {/* Send button when content exists, otherwise camera button */}
        {hasContent ? (
          <ChatSendButton
            disabled={!hasContent || !userAvailable}
            onPress={handleSend}
          />
        ) : (
          <TouchableOpacity
            style={styles.actionTouchArea}
            onPress={onPickCamera}
            disabled={!userAvailable}
            activeOpacity={0.7}
            accessibilityLabel="Share photo"
          >
            <View style={styles.actionIconCircle}>
              <Ionicons name="camera-outline" size={20} color="#f5f5f5" />
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    width: "100%",
  },
  composerContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: COMPOSER_GEOMETRY.innerHorizontalGap,
  },
  pillTextInput: {
    flex: 1,
    backgroundColor: "#1c1c1e",
    borderRadius: COMPOSER_GEOMETRY.borderRadius,
    borderWidth: 1,
    borderColor: "#27272a",
    paddingHorizontal: COMPOSER_GEOMETRY.inputPaddingHorizontal,
    paddingTop: COMPOSER_GEOMETRY.inputPaddingTop,
    paddingBottom: COMPOSER_GEOMETRY.inputPaddingBottom,
    color: "#f5f5f5",
    fontSize: COMPOSER_GEOMETRY.fontSize,
    lineHeight: COMPOSER_GEOMETRY.lineHeight,
    minHeight: COMPOSER_GEOMETRY.minInputHeight,
    maxHeight: COMPOSER_GEOMETRY.maxInputHeight,
  },
  actionTouchArea: {
    width: COMPOSER_GEOMETRY.minActionTouchTarget,
    height: COMPOSER_GEOMETRY.minActionTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  actionIconCircle: {
    width: COMPOSER_GEOMETRY.actionButtonSize,
    height: COMPOSER_GEOMETRY.actionButtonSize,
    borderRadius: COMPOSER_GEOMETRY.actionButtonRadius,
    backgroundColor: "#1c1c1e",
    alignItems: "center",
    justifyContent: "center",
  },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#18181b",
    borderLeftWidth: 3,
    borderLeftColor: "#f5f5f5",
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginHorizontal: 8,
    marginTop: 6,
    marginBottom: 2,
    borderRadius: 8,
    gap: 8,
  },
  replyBannerSender: {
    fontSize: 10,
    fontWeight: "700",
    color: "#a1a1aa",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  replyBannerPreview: {
    fontSize: 12,
    color: "#f5f5f5",
    marginTop: 1,
  },
  attachmentPreviewBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#18181b",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 8,
    marginTop: 6,
    marginBottom: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#27272a",
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
