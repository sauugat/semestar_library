import React from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Text as RNText,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';

export interface RichTextToolbarProps {
  value: string;
  onChangeText: (text: string) => void;
  selection?: { start: number; end: number };
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  isPreviewing?: boolean;
  onTogglePreview?: () => void;
}

type FormatAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'number'
  | 'quote'
  | 'code-inline'
  | 'code-block'
  | 'link'
  | 'divider';

export function RichTextToolbar({
  value,
  onChangeText,
  selection,
  onSelectionChange,
  isPreviewing,
  onTogglePreview,
}: RichTextToolbarProps) {
  const { colors, isDark } = useTheme();

  const applyFormat = (action: FormatAction) => {
    const start = selection?.start ?? value.length;
    const end = selection?.end ?? value.length;
    const selectedText = value.substring(start, end);

    let replacement = '';
    let newCursorPos = start;

    switch (action) {
      case 'bold':
        replacement = `**${selectedText || 'bold'}**`;
        newCursorPos = selectedText ? start + replacement.length : start + 2;
        break;
      case 'italic':
        replacement = `*${selectedText || 'italic'}*`;
        newCursorPos = selectedText ? start + replacement.length : start + 1;
        break;
      case 'underline':
        replacement = `<u>${selectedText || 'underline'}</u>`;
        newCursorPos = selectedText ? start + replacement.length : start + 3;
        break;
      case 'strike':
        replacement = `~~${selectedText || 'strike'}~~`;
        newCursorPos = selectedText ? start + replacement.length : start + 2;
        break;
      case 'h1':
        replacement = `\n# ${selectedText || 'Heading 1'}\n`;
        newCursorPos = start + replacement.length;
        break;
      case 'h2':
        replacement = `\n## ${selectedText || 'Heading 2'}\n`;
        newCursorPos = start + replacement.length;
        break;
      case 'h3':
        replacement = `\n### ${selectedText || 'Heading 3'}\n`;
        newCursorPos = start + replacement.length;
        break;
      case 'bullet': {
        const lines = selectedText ? selectedText.split('\n') : ['Item'];
        replacement = '\n' + lines.map((l) => `- ${l.replace(/^[-*]\s*/, '')}`).join('\n') + '\n';
        newCursorPos = start + replacement.length;
        break;
      }
      case 'number': {
        const lines = selectedText ? selectedText.split('\n') : ['Item'];
        replacement = '\n' + lines.map((l, i) => `${i + 1}. ${l.replace(/^\d+\.\s*/, '')}`).join('\n') + '\n';
        newCursorPos = start + replacement.length;
        break;
      }
      case 'quote': {
        const lines = selectedText ? selectedText.split('\n') : ['Quote'];
        replacement = '\n' + lines.map((l) => `> ${l.replace(/^>\s*/, '')}`).join('\n') + '\n';
        newCursorPos = start + replacement.length;
        break;
      }
      case 'code-inline':
        replacement = `\`${selectedText || 'code'}\``;
        newCursorPos = selectedText ? start + replacement.length : start + 1;
        break;
      case 'code-block':
        replacement = `\n\`\`\`javascript\n${selectedText || '// code'}\n\`\`\`\n`;
        newCursorPos = start + replacement.length;
        break;
      case 'link':
        if (selectedText.startsWith('http')) {
          replacement = `[link](${selectedText})`;
        } else {
          replacement = `[${selectedText || 'link'}](https://)`;
        }
        newCursorPos = start + replacement.length;
        break;
      case 'divider':
        replacement = `\n\n---\n\n`;
        newCursorPos = start + replacement.length;
        break;
      default:
        return;
    }

    const nextValue = value.substring(0, start) + replacement + value.substring(end);
    onChangeText(nextValue);

    if (onSelectionChange) {
      onSelectionChange({ start: newCursorPos, end: newCursorPos });
    }
  };

  const renderToolBtn = (
    label: string,
    action: FormatAction,
    isBold = false,
    isItalic = false,
    isUnderline = false
  ) => {
    return (
      <TouchableOpacity
        key={action}
        activeOpacity={0.7}
        onPress={() => applyFormat(action)}
        style={[
          styles.toolBtn,
          {
            backgroundColor: isDark ? '#1c1c1f' : '#f0f0f2',
            borderColor: isDark ? '#2c2c30' : '#e0e0e3',
          },
        ]}
        hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      >
        <RNText
          style={[
            styles.toolBtnText,
            { color: colors.text },
            isBold && { fontWeight: '700' },
            isItalic && { fontStyle: 'italic' },
            isUnderline && { textDecorationLine: 'underline' },
          ]}
        >
          {label}
        </RNText>
      </TouchableOpacity>
    );
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#141416' : '#f8f8fa',
          borderBottomColor: isDark ? '#27272a' : '#e5e5ea',
        },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always"
      >
        {/* Basic formatting */}
        {renderToolBtn('B', 'bold', true)}
        {renderToolBtn('I', 'italic', false, true)}
        {renderToolBtn('U', 'underline', false, false, true)}
        {renderToolBtn('S', 'strike')}

        <View style={[styles.sep, { backgroundColor: isDark ? '#2c2c30' : '#e0e0e3' }]} />

        {/* Headings */}
        {renderToolBtn('H1', 'h1', true)}
        {renderToolBtn('H2', 'h2', true)}
        {renderToolBtn('H3', 'h3', true)}

        <View style={[styles.sep, { backgroundColor: isDark ? '#2c2c30' : '#e0e0e3' }]} />

        {/* Lists & Quotes */}
        {renderToolBtn('• List', 'bullet')}
        {renderToolBtn('1. List', 'number')}
        {renderToolBtn('Quote', 'quote')}

        <View style={[styles.sep, { backgroundColor: isDark ? '#2c2c30' : '#e0e0e3' }]} />

        {/* Code & Extras */}
        {renderToolBtn('<> Code', 'code-inline')}
        {renderToolBtn('{ } Block', 'code-block')}
        {renderToolBtn('Link', 'link')}
        {renderToolBtn('---', 'divider')}

        {/* Preview Mode Toggle */}
        {onTogglePreview && (
          <>
            <View style={[styles.sep, { backgroundColor: isDark ? '#2c2c30' : '#e0e0e3' }]} />
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onTogglePreview}
              style={[
                styles.previewBtn,
                isPreviewing
                  ? { backgroundColor: colors.text, borderColor: colors.text }
                  : {
                      backgroundColor: isDark ? '#1c1c1f' : '#f0f0f2',
                      borderColor: isDark ? '#2c2c30' : '#e0e0e3',
                    },
              ]}
            >
              <Ionicons
                name={isPreviewing ? 'create-outline' : 'eye-outline'}
                size={13}
                color={isPreviewing ? (isDark ? '#000000' : '#ffffff') : colors.text}
                style={{ marginRight: 4 }}
              />
              <RNText
                style={[
                  styles.toolBtnText,
                  {
                    color: isPreviewing ? (isDark ? '#000000' : '#ffffff') : colors.text,
                    fontWeight: '600',
                  },
                ]}
              >
                {isPreviewing ? 'Edit' : 'Preview'}
              </RNText>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 5,
    borderBottomWidth: 1,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  toolBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnText: {
    fontSize: 12,
    fontWeight: '500',
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  sep: {
    width: 1,
    height: 16,
    marginHorizontal: 3,
  },
});
