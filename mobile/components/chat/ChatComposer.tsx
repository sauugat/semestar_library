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
import { ChatMessage, sendChatTyping } from "@/services/chat";
import { ChatSendButton } from "./ChatSendButton";

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
  }) => void;
  inputRef: React.RefObject<TextInput | null>;
  paddingBottom: number;
  userAvailable: boolean;
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
  paddingBottom,
  userAvailable,
}: ChatComposerProps) {
  const [inputText, setInputText] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const lastTypingSentRef = useRef<number>(0);

  const handleTextChange = useCallback((text: string) => {
    setInputText(text);
    const now = Date.now();
    if (text.trim() && now - lastTypingSentRef.current > 2500) {
      lastTypingSentRef.current = now;
      void sendChatTyping();
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed && !selectedAttachment) return;
    if (trimmed.length > 2000) return;

    const textToSend = trimmed;
    const attachmentToSend = selectedAttachment;
    const replyToSend = replyTo;

    // Clear input immediately before network call (Requirement 1)
    setInputText("");
    onClearAttachment();
    onCancelReply();

    // Trigger optimistic send flow
    onSendMessage({
      text: textToSend,
      file: attachmentToSend,
      replyTo: replyToSend,
    });
  }, [inputText, selectedAttachment, replyTo, onClearAttachment, onCancelReply, onSendMessage]);

  const hasContent = Boolean(inputText.trim() || selectedAttachment);

  return (
    <View style={styles.outerContainer}>
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
          {
            paddingBottom,
          },
        ]}
      >
        {/* Attach '+' button */}
        <TouchableOpacity
          style={styles.attachButtonCircle}
          onPress={onOpenAttachModal}
          activeOpacity={0.7}
          accessibilityLabel="Add attachment"
        >
          <Ionicons name="add" size={22} color="#f5f5f5" />
        </TouchableOpacity>

        {/* Pill-shaped text input */}
        <TextInput
          ref={inputRef}
          accessibilityLabel="Message your class"
          keyboardAppearance="dark"
          style={[
            styles.pillTextInput,
            inputFocused && { borderColor: "#48484a" },
          ]}
          placeholder="Message…"
          placeholderTextColor="#71717a"
          multiline
          maxLength={2000}
          value={inputText}
          onChangeText={handleTextChange}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
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
            style={styles.cameraButtonCircle}
            onPress={onPickCamera}
            disabled={!userAvailable}
            activeOpacity={0.7}
            accessibilityLabel="Share photo"
          >
            <Ionicons name="camera-outline" size={20} color="#f5f5f5" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    backgroundColor: "#0d0d0e",
    borderTopWidth: 1,
    borderTopColor: "#1c1c1e",
  },
  composerContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 8,
    paddingTop: 8,
    backgroundColor: "#0d0d0e",
    gap: 8,
  },
  pillTextInput: {
    flex: 1,
    backgroundColor: "#1c1c1e",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#27272a",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    color: "#f5f5f5",
    fontSize: 15,
    maxHeight: 120,
    minHeight: 38,
  },
  attachButtonCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1c1c1e",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraButtonCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
