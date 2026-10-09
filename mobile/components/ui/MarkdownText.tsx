import React, { useState } from 'react';
import {
  View,
  Text as RNText,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';

export interface MarkdownTextProps {
  content: string;
  numberOfLines?: number;
  selectable?: boolean;
  onLinkPress?: (url: string) => void;
  style?: any;
}

interface InlineToken {
  type: 'text' | 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link';
  text: string;
  url?: string;
}

/**
 * Tokenize a line of text into inline formatting tokens
 */
function tokenizeInline(text: string): InlineToken[] {
  if (!text) return [];

  const tokens: InlineToken[] = [];
  // Regex pattern matching:
  // 1. `inline code`
  // 2. <u>underline</u>
  // 3. **bold** or __bold__
  // 4. *italic* or _italic_
  // 5. ~~strike~~
  // 6. [title](url)
  // 7. plain text
  const regex = /(`[^`]+`|<u>.*?<\/u>|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|\[[^\]]+\]\([^\s)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        text: text.slice(lastIndex, match.index),
      });
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
      tokens.push({
        type: 'code',
        text: matchedStr.slice(1, -1),
      });
    } else if (matchedStr.startsWith('<u>') && matchedStr.endsWith('</u>')) {
      tokens.push({
        type: 'underline',
        text: matchedStr.slice(3, -4),
      });
    } else if (
      (matchedStr.startsWith('**') && matchedStr.endsWith('**')) ||
      (matchedStr.startsWith('__') && matchedStr.endsWith('__'))
    ) {
      tokens.push({
        type: 'bold',
        text: matchedStr.slice(2, -2),
      });
    } else if (
      (matchedStr.startsWith('*') && matchedStr.endsWith('*')) ||
      (matchedStr.startsWith('_') && matchedStr.endsWith('_'))
    ) {
      tokens.push({
        type: 'italic',
        text: matchedStr.slice(1, -1),
      });
    } else if (matchedStr.startsWith('~~') && matchedStr.endsWith('~~')) {
      tokens.push({
        type: 'strike',
        text: matchedStr.slice(2, -2),
      });
    } else if (matchedStr.startsWith('[') && matchedStr.includes('](')) {
      const linkMatch = matchedStr.match(/^\[(.*?)\]\((.*?)\)$/);
      if (linkMatch) {
        tokens.push({
          type: 'link',
          text: linkMatch[1],
          url: linkMatch[2],
        });
      } else {
        tokens.push({ type: 'text', text: matchedStr });
      }
    } else {
      tokens.push({ type: 'text', text: matchedStr });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      text: text.slice(lastIndex),
    });
  }

  return tokens;
}

export function MarkdownText({
  content,
  numberOfLines,
  selectable = true,
  onLinkPress,
  style,
}: MarkdownTextProps) {
  const { colors, isDark } = useTheme();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!content || !content.trim()) {
    return null;
  }

  const handleLinkPress = (url: string) => {
    if (onLinkPress) {
      onLinkPress(url);
    } else {
      Linking.openURL(url).catch((err) =>
        console.warn('Cannot open url:', url, err)
      );
    }
  };

  const handleCopyCode = async (code: string, blockIndex: number) => {
    try {
      await Clipboard.setStringAsync(code);
      setCopiedIndex(blockIndex);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (e) {
      console.warn('Failed to copy code snippet:', e);
    }
  };

  const renderInlineTokens = (tokens: InlineToken[], baseKey: string) => {
    return tokens.map((token, idx) => {
      const key = `${baseKey}-token-${idx}`;
      switch (token.type) {
        case 'bold':
          return (
            <RNText key={key} style={{ fontWeight: '700', color: colors.text }}>
              {token.text}
            </RNText>
          );
        case 'italic':
          return (
            <RNText key={key} style={{ fontStyle: 'italic', color: colors.text }}>
              {token.text}
            </RNText>
          );
        case 'underline':
          return (
            <RNText
              key={key}
              style={{ textDecorationLine: 'underline', color: colors.text }}
            >
              {token.text}
            </RNText>
          );
        case 'strike':
          return (
            <RNText
              key={key}
              style={{
                textDecorationLine: 'line-through',
                color: colors.textMuted || '#888',
              }}
            >
              {token.text}
            </RNText>
          );
        case 'code':
          return (
            <RNText
              key={key}
              style={{
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
                color: colors.text,
                fontSize: 13,
              }}
            >
              {` ${token.text} `}
            </RNText>
          );
        case 'link':
          return (
            <RNText
              key={key}
              onPress={() => token.url && handleLinkPress(token.url)}
              style={{
                textDecorationLine: 'underline',
                color: colors.text,
                fontWeight: '600',
              }}
            >
              {token.text}
            </RNText>
          );
        default:
          return (
            <RNText key={key} style={{ color: colors.text }}>
              {token.text}
            </RNText>
          );
      }
    });
  };

  // If clamped with numberOfLines, render a single inline flow for clean truncation
  if (numberOfLines) {
    const flattenedText = content
      .replace(/```[\s\S]*?```/g, ' [Code Block] ')
      .replace(/[\r\n]+/g, ' ');
    const tokens = tokenizeInline(flattenedText);

    return (
      <RNText
        numberOfLines={numberOfLines}
        selectable={selectable}
        style={[
          {
            color: colors.text,
            fontSize: 14.5,
            lineHeight: 22,
          },
          style,
        ]}
      >
        {renderInlineTokens(tokens, 'clamped')}
      </RNText>
    );
  }

  // Full block rendering
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Extract fenced code blocks
  const codeBlocks: { lang: string; code: string }[] = [];
  const textWithoutCode = normalized.replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({
        lang: (lang || 'code').trim(),
        code: code.replace(/\n+$/, ''),
      });
      return `\n\x01BLOCK_CODE_${idx}\x02\n`;
    }
  );

  const lines = textWithoutCode.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code block placeholder
    const codeMatch = trimmed.match(/^\x01BLOCK_CODE_(\d+)\x02$/);
    if (codeMatch) {
      const blockIndex = Number(codeMatch[1]);
      const block = codeBlocks[blockIndex];
      if (block) {
        const isCopied = copiedIndex === blockIndex;
        elements.push(
          <View
            key={`code-block-${i}`}
            style={[
              styles.codeBlockWrapper,
              {
                backgroundColor: isDark ? '#141416' : '#f4f4f5',
                borderColor: isDark ? '#27272a' : '#e4e4e7',
              },
            ]}
          >
            <View
              style={[
                styles.codeHeader,
                {
                  borderBottomColor: isDark ? '#27272a' : '#e4e4e7',
                },
              ]}
            >
              <RNText
                style={[
                  styles.codeLang,
                  { color: isDark ? '#a1a1aa' : '#71717a' },
                ]}
              >
                {block.lang.toUpperCase()}
              </RNText>
              <TouchableOpacity
                onPress={() => handleCopyCode(block.code, blockIndex)}
                style={[
                  styles.copyBtn,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    borderColor: isDark ? '#383838' : '#d4d4d8',
                  },
                ]}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons
                  name={isCopied ? 'checkmark' : 'copy-outline'}
                  size={12}
                  color={colors.text}
                />
                <RNText
                  style={[
                    styles.copyBtnText,
                    { color: colors.text },
                  ]}
                >
                  {isCopied ? 'Copied' : 'Copy'}
                </RNText>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <RNText
                selectable={selectable}
                style={[
                  styles.codeContent,
                  {
                    color: isDark ? '#f4f4f5' : '#18181b',
                  },
                ]}
              >
                {block.code}
              </RNText>
            </ScrollView>
          </View>
        );
      }
      continue;
    }

    // Horizontal Divider
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(
        <View
          key={`divider-${i}`}
          style={[
            styles.divider,
            { backgroundColor: isDark ? '#27272a' : '#e4e4e7' },
          ]}
        />
      );
      continue;
    }

    // Headings
    const h1Match = line.match(/^#\s+(.*)$/);
    if (h1Match) {
      elements.push(
        <RNText
          key={`h1-${i}`}
          selectable={selectable}
          style={[styles.h1, { color: colors.text }]}
        >
          {renderInlineTokens(tokenizeInline(h1Match[1]), `h1-${i}`)}
        </RNText>
      );
      continue;
    }

    const h2Match = line.match(/^##\s+(.*)$/);
    if (h2Match) {
      elements.push(
        <RNText
          key={`h2-${i}`}
          selectable={selectable}
          style={[styles.h2, { color: colors.text }]}
        >
          {renderInlineTokens(tokenizeInline(h2Match[1]), `h2-${i}`)}
        </RNText>
      );
      continue;
    }

    const h3Match = line.match(/^###\s+(.*)$/);
    if (h3Match) {
      elements.push(
        <RNText
          key={`h3-${i}`}
          selectable={selectable}
          style={[styles.h3, { color: colors.text }]}
        >
          {renderInlineTokens(tokenizeInline(h3Match[1]), `h3-${i}`)}
        </RNText>
      );
      continue;
    }

    // Blockquote
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      elements.push(
        <View
          key={`quote-${i}`}
          style={[
            styles.blockquote,
            {
              borderLeftColor: isDark ? '#52525b' : '#a1a1aa',
              backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            },
          ]}
        >
          <RNText
            selectable={selectable}
            style={[
              styles.blockquoteText,
              { color: isDark ? '#a1a1aa' : '#52525b' },
            ]}
          >
            {renderInlineTokens(tokenizeInline(quoteMatch[1]), `quote-${i}`)}
          </RNText>
        </View>
      );
      continue;
    }

    // Bullet List
    const bulletMatch = line.match(/^[\*\-]\s+(.*)$/);
    if (bulletMatch) {
      elements.push(
        <View key={`bullet-${i}`} style={styles.listRow}>
          <RNText style={[styles.bulletDot, { color: colors.text }]}>•</RNText>
          <RNText
            selectable={selectable}
            style={[styles.listContent, { color: colors.text }]}
          >
            {renderInlineTokens(tokenizeInline(bulletMatch[1]), `bullet-${i}`)}
          </RNText>
        </View>
      );
      continue;
    }

    // Numbered List
    const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      elements.push(
        <View key={`num-${i}`} style={styles.listRow}>
          <RNText style={[styles.numPrefix, { color: colors.textMuted || '#888' }]}>
            {numMatch[1]}.
          </RNText>
          <RNText
            selectable={selectable}
            style={[styles.listContent, { color: colors.text }]}
          >
            {renderInlineTokens(tokenizeInline(numMatch[2]), `num-${i}`)}
          </RNText>
        </View>
      );
      continue;
    }

    // Empty line spacing
    if (!trimmed) {
      elements.push(<View key={`empty-${i}`} style={styles.emptySpacing} />);
      continue;
    }

    // Normal paragraph line
    elements.push(
      <RNText
        key={`p-${i}`}
        selectable={selectable}
        style={[
          styles.paragraph,
          {
            color: colors.text,
          },
        ]}
      >
        {renderInlineTokens(tokenizeInline(line), `p-${i}`)}
      </RNText>
    );
  }

  return <View style={style}>{elements}</View>;
}

const styles = StyleSheet.create({
  paragraph: {
    fontSize: 14.5,
    lineHeight: 22,
    marginBottom: 4,
  },
  h1: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 25,
    marginTop: 10,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  h2: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 23,
    marginTop: 8,
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  h3: {
    fontSize: 15.5,
    fontWeight: '600',
    lineHeight: 21,
    marginTop: 6,
    marginBottom: 4,
  },
  blockquote: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 5,
    marginVertical: 6,
    borderRadius: 4,
  },
  blockquoteText: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
    paddingLeft: 4,
  },
  bulletDot: {
    fontSize: 14,
    lineHeight: 22,
    marginRight: 8,
    fontWeight: '700',
  },
  numPrefix: {
    fontSize: 13.5,
    lineHeight: 22,
    marginRight: 6,
    fontWeight: '600',
  },
  listContent: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 22,
  },
  divider: {
    height: 1,
    marginVertical: 12,
    width: '100%',
  },
  emptySpacing: {
    height: 8,
  },
  codeBlockWrapper: {
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  codeLang: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  copyBtnText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  codeContent: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12.5,
    lineHeight: 18,
    padding: 10,
  },
});
