import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
  StyleProp,
  ViewStyle,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/constants/useTheme';

interface PostMarkdownProps {
  content: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  maxPreviewLength?: number;
  style?: StyleProp<ViewStyle>;
}

interface CodeBlock {
  lang: string;
  code: string;
}

export function PostMarkdown({
  content,
  isExpanded = true,
  onToggleExpand,
  maxPreviewLength,
  style,
}: PostMarkdownProps) {
  const { colors, isDark } = useTheme();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!content || !content.trim()) return null;

  const shouldTruncate = Boolean(
    maxPreviewLength &&
    !isExpanded &&
    content.length > maxPreviewLength
  );

  const displayContent = shouldTruncate
    ? content.slice(0, maxPreviewLength).trim()
    : content;

  // Extract fenced code blocks first
  const codeBlocks: CodeBlock[] = [];
  const normalized = displayContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const textWithoutCode = normalized.replace(
    /```([a-zA-Z0-9_#-]*)[ \t]*\n([\s\S]*?)```/g,
    (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({
        lang: (lang || 'code').trim().toUpperCase(),
        code: code.replace(/\n+$/, ''),
      });
      return `\x01CODE_BLOCK_${idx}\x02`;
    }
  );

  const lines = textWithoutCode.split('\n');
  const renderedElements: React.ReactNode[] = [];

  function isTableDelimiter(str: string): boolean {
    if (!str || !str.includes('|')) return false;
    const cells = str.trim().replace(/^\||\|$/g, '').split('|');
    if (cells.length === 0) return false;
    return cells.every((c) => /^\s*:?-{1,}:?\s*$/.test(c));
  }

  function handleCopyCode(code: string, index: number) {
    Clipboard.setStringAsync(code);
    setCopiedIndex(index);
    setTimeout(() => {
      setCopiedIndex((cur) => (cur === index ? null : cur));
    }, 2000);
  }

  // Parse inline Markdown tokens
  function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
    if (!text) return [];

    // Tokenize text into segments
    // Patterns: `code`, **bold**, *italic*, <u>underline</u>, ~~strike~~, [title](url), URLs
    const tokens: React.ReactNode[] = [];
    let remaining = text;
    let tokenIndex = 0;

    // Combined inline regex pattern
    const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|<u>.*?<\/u>|~~[^~]+~~|\[[^\]]+\]\(https?:\/\/[^\s\)]+\)|https?:\/\/[^\s<)]+)/;

    while (remaining.length > 0) {
      const match = remaining.match(inlineRegex);
      if (!match || match.index === undefined) {
        tokens.push(
          <Text key={`${keyPrefix}-t-${tokenIndex++}`} style={{ color: colors.text }}>
            {remaining}
          </Text>
        );
        break;
      }

      if (match.index > 0) {
        tokens.push(
          <Text key={`${keyPrefix}-t-${tokenIndex++}`} style={{ color: colors.text }}>
            {remaining.slice(0, match.index)}
          </Text>
        );
      }

      const matchText = match[0];
      remaining = remaining.slice(match.index + matchText.length);

      // Inline Code: `code`
      if (matchText.startsWith('`') && matchText.endsWith('`')) {
        const codeContent = matchText.slice(1, -1);
        tokens.push(
          <Text
            key={`${keyPrefix}-code-${tokenIndex++}`}
            style={[
              styles.inlineCode,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
          >
            {codeContent}
          </Text>
        );
      }
      // Bold: **text**
      else if (matchText.startsWith('**') && matchText.endsWith('**')) {
        tokens.push(
          <Text key={`${keyPrefix}-b-${tokenIndex++}`} style={{ fontWeight: '700', color: colors.text }}>
            {renderInline(matchText.slice(2, -2), `${keyPrefix}-b-${tokenIndex}`)}
          </Text>
        );
      }
      // Italic: *text*
      else if (matchText.startsWith('*') && matchText.endsWith('*')) {
        tokens.push(
          <Text key={`${keyPrefix}-i-${tokenIndex++}`} style={{ fontStyle: 'italic', color: colors.text }}>
            {renderInline(matchText.slice(1, -1), `${keyPrefix}-i-${tokenIndex}`)}
          </Text>
        );
      }
      // Underline: <u>text</u>
      else if (matchText.startsWith('<u>') && matchText.endsWith('</u>')) {
        tokens.push(
          <Text key={`${keyPrefix}-u-${tokenIndex++}`} style={{ textDecorationLine: 'underline', color: colors.text }}>
            {renderInline(matchText.slice(3, -4), `${keyPrefix}-u-${tokenIndex}`)}
          </Text>
        );
      }
      // Strikethrough: ~~text~~
      else if (matchText.startsWith('~~') && matchText.endsWith('~~')) {
        tokens.push(
          <Text key={`${keyPrefix}-s-${tokenIndex++}`} style={{ textDecorationLine: 'line-through', color: colors.textSecondary }}>
            {renderInline(matchText.slice(2, -2), `${keyPrefix}-s-${tokenIndex}`)}
          </Text>
        );
      }
      // Link: [title](url)
      else if (matchText.startsWith('[') && matchText.includes('](')) {
        const linkMatch = matchText.match(/^\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)$/);
        if (linkMatch) {
          const [, title, url] = linkMatch;
          tokens.push(
            <Text
              key={`${keyPrefix}-link-${tokenIndex++}`}
              style={[styles.link, { color: colors.text }]}
              onPress={() => Linking.openURL(url)}
            >
              {title}
            </Text>
          );
        } else {
          tokens.push(<Text key={`${keyPrefix}-t-${tokenIndex++}`}>{matchText}</Text>);
        }
      }
      // Direct URL
      else if (/^https?:\/\//.test(matchText)) {
        tokens.push(
          <Text
            key={`${keyPrefix}-url-${tokenIndex++}`}
            style={[styles.link, { color: colors.text }]}
            onPress={() => Linking.openURL(matchText)}
          >
            {matchText}
          </Text>
        );
      }
    }

    return tokens;
  }

  let paraBuffer: string[] = [];
  function flushParagraph(key: string) {
    if (paraBuffer.length > 0) {
      const fullPara = paraBuffer.join('\n');
      renderedElements.push(
        <Text key={key} style={[styles.paragraph, { color: colors.text }]}>
          {renderInline(fullPara, key)}
        </Text>
      );
      paraBuffer = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Code Block placeholder
    const codeMatch = trimmed.match(/^\x01CODE_BLOCK_(\d+)\x02$/);
    if (codeMatch) {
      flushParagraph(`p-before-code-${i}`);
      const blockIndex = Number(codeMatch[1]);
      const block = codeBlocks[blockIndex];
      if (block) {
        const isCopied = copiedIndex === blockIndex;
        renderedElements.push(
          <View
            key={`code-block-${i}`}
            style={[
              styles.codeBlockContainer,
              {
                backgroundColor: isDark ? '#141416' : '#f4f4f5',
                borderColor: colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.codeHeader,
                {
                  borderBottomColor: colors.border,
                  backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                },
              ]}
            >
              <Text style={[styles.codeLang, { color: colors.textSecondary }]}>
                {block.lang}
              </Text>
              <TouchableOpacity
                onPress={() => handleCopyCode(block.code, blockIndex)}
                style={[
                  styles.copyBtn,
                  {
                    borderColor: colors.border,
                    backgroundColor: isCopied ? colors.surfaceRaised : 'transparent',
                  },
                ]}
                activeOpacity={0.7}
              >
                <Text style={[styles.copyBtnText, { color: colors.text }]}>
                  {isCopied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ padding: 10 }}
            >
              <Text
                style={[
                  styles.codeText,
                  {
                    color: isDark ? '#f4f4f5' : '#18181b',
                  },
                ]}
                selectable
              >
                {block.code}
              </Text>
            </ScrollView>
          </View>
        );
      }
      continue;
    }

    // 2. Horizontal divider
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph(`p-before-hr-${i}`);
      renderedElements.push(
        <View key={`hr-${i}`} style={[styles.divider, { backgroundColor: colors.border }]} />
      );
      continue;
    }

    // 3. Markdown Table
    if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      flushParagraph(`p-before-table-${i}`);

      const headerCells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const alignCells = lines[i + 1].trim().replace(/^\||\|$/g, '').split('|');
      const alignments = alignCells.map((c) => {
        const t = c.trim();
        if (t.startsWith(':') && t.endsWith(':')) return 'center';
        if (t.endsWith(':')) return 'right';
        return 'left';
      });

      const dataRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length) {
        const dLine = lines[j].trim();
        if (!dLine || !dLine.includes('|') || isTableDelimiter(dLine)) break;
        const rowCells = dLine.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        dataRows.push(rowCells);
        j++;
      }
      i = j - 1; // Advance loop

      renderedElements.push(
        <View
          key={`table-${i}`}
          style={[
            styles.tableWrapper,
            {
              borderColor: colors.border,
              backgroundColor: isDark ? '#141416' : '#ffffff',
            },
          ]}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {/* Header Row */}
              <View
                style={[
                  styles.tableRow,
                  styles.tableHeaderRow,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#f4f4f5',
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                {headerCells.map((cellText, colIdx) => (
                  <View
                    key={`th-${colIdx}`}
                    style={[
                      styles.tableCell,
                      colIdx < headerCells.length - 1 && { borderRightColor: colors.border, borderRightWidth: 1 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tableHeaderText,
                        {
                          color: colors.text,
                          textAlign: (alignments[colIdx] || 'left') as any,
                        },
                      ]}
                    >
                      {cellText}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Data Rows */}
              {dataRows.map((rowCells, rIdx) => (
                <View
                  key={`tr-${rIdx}`}
                  style={[
                    styles.tableRow,
                    rIdx < dataRows.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 },
                  ]}
                >
                  {headerCells.map((_, colIdx) => (
                    <View
                      key={`td-${colIdx}`}
                      style={[
                        styles.tableCell,
                        colIdx < headerCells.length - 1 && { borderRightColor: colors.border, borderRightWidth: 1 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.tableCellText,
                          {
                            color: colors.text,
                            textAlign: (alignments[colIdx] || 'left') as any,
                          },
                        ]}
                      >
                        {rowCells[colIdx] || ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      );
      continue;
    }

    // 4. Headings: #, ##, ###
    const hMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (hMatch) {
      flushParagraph(`p-before-h-${i}`);
      const level = hMatch[1].length;
      const headingStyle = level === 1 ? styles.h1 : level === 2 ? styles.h2 : styles.h3;
      renderedElements.push(
        <Text key={`h-${i}`} style={[headingStyle, { color: colors.text }]}>
          {renderInline(hMatch[2], `h-${i}`)}
        </Text>
      );
      continue;
    }

    // 5. Blockquote: > text
    const qMatch = line.match(/^>\s?(.*)$/);
    if (qMatch) {
      flushParagraph(`p-before-q-${i}`);
      renderedElements.push(
        <View
          key={`quote-${i}`}
          style={[
            styles.blockquote,
            {
              borderLeftColor: colors.borderStrong || colors.border,
              backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
            },
          ]}
        >
          <Text style={[styles.blockquoteText, { color: colors.textSecondary }]}>
            {renderInline(qMatch[1], `q-${i}`)}
          </Text>
        </View>
      );
      continue;
    }

    // 6. List items: - or * or 1.
    const listMatch = line.match(/^([\*\-]|(\d+\.))\s+(.*)$/);
    if (listMatch) {
      flushParagraph(`p-before-li-${i}`);
      const bullet = listMatch[1].includes('.') ? listMatch[1] : '•';
      renderedElements.push(
        <View key={`li-${i}`} style={styles.listItemRow}>
          <Text style={[styles.listBullet, { color: colors.textSecondary }]}>{bullet}</Text>
          <Text style={[styles.listContent, { color: colors.text }]}>
            {renderInline(listMatch[3], `li-${i}`)}
          </Text>
        </View>
      );
      continue;
    }

    // 7. Empty line ends current paragraph
    if (!trimmed) {
      flushParagraph(`p-${i}`);
      continue;
    }

    // 8. Regular text lines in paragraph
    paraBuffer.push(line);
  }

  flushParagraph('p-last');

  return (
    <View style={[styles.container, style]}>
      {renderedElements}

      {shouldTruncate && onToggleExpand && (
        <TouchableOpacity
          onPress={onToggleExpand}
          activeOpacity={0.7}
          style={styles.expandBtn}
          accessibilityLabel="Read more"
        >
          <Text style={[styles.expandBtnText, { color: colors.textSecondary }]}>
            Read more
          </Text>
        </TouchableOpacity>
      )}

      {!shouldTruncate && maxPreviewLength && isExpanded && onToggleExpand && content.length > maxPreviewLength && (
        <TouchableOpacity
          onPress={onToggleExpand}
          activeOpacity={0.7}
          style={styles.expandBtn}
          accessibilityLabel="Show less"
        >
          <Text style={[styles.expandBtnText, { color: colors.textSecondary }]}>
            Show less
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  h1: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    marginTop: 8,
    marginBottom: 4,
  },
  h2: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 6,
    marginBottom: 3,
  },
  h3: {
    fontSize: 14.5,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 5,
    marginBottom: 2,
  },
  inlineCode: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12.5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  link: {
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
  codeBlockContainer: {
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  codeLang: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  copyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  copyBtnText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  codeText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12.5,
    lineHeight: 18,
  },
  tableWrapper: {
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
  },
  tableCell: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 90,
  },
  tableHeaderText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  tableCellText: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  blockquote: {
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginVertical: 6,
    borderRadius: 2,
  },
  blockquoteText: {
    fontSize: 13.5,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  listItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 2,
    paddingLeft: 4,
  },
  listBullet: {
    width: 18,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  listContent: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    marginVertical: 8,
    width: '100%',
  },
  expandBtn: {
    marginTop: 4,
    marginBottom: 4,
    alignSelf: 'flex-start',
  },
  expandBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
});
