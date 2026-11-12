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
import { WebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/constants/useTheme';

export interface PostMarkdownProps {
  content: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  maxPreviewLength?: number;
  onPressText?: () => void;
  style?: StyleProp<ViewStyle>;
  streaming?: boolean;
  onPressInternalLink?: (url: string) => void;
}

interface CodeBlock {
  lang: string;
  code: string;
}

export function stabilizeStreamingMarkdown(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = String(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  text = text
    .replace(/<kyana_actions>[\s\S]*$/i, '')
    .replace(/<referenced_records>[\s\S]*$/i, '');

  const fenceMatches = [...text.matchAll(/(^|\n)(`{3,}|~{3,})([\w+-]*)[ \t]*(?:\n|$)/g)];
  if (fenceMatches.length % 2 === 1) {
    const lastFence = fenceMatches[fenceMatches.length - 1];
    const fenceLang = (lastFence[3] || '').trim().toLowerCase();
    const structuredKinds = new Set([
      'study_session', 'learning_session', 'interactive_demo', 'logic_sim',
      'live_demo', 'diagram', 'flowchart', 'trace', 'roadmap', 'timeline',
      'pyq_card', 'checkpoint_question', 'chapter_summary', 'source_reference'
    ]);
    if (structuredKinds.has(fenceLang)) {
      text = text.slice(0, lastFence.index).trimEnd();
    } else {
      const fenceChars = lastFence[2] || '```';
      text = `${text}\n${fenceChars}`;
    }
  }

  const displayMathParts = text.split('$$');
  if (displayMathParts.length % 2 === 0) {
    text = `${text}\n$$`;
  }

  const lines = text.split('\n');
  if (lines.length >= 2) {
    const lastLine = lines[lines.length - 1].trim();
    const prevLine = lines[lines.length - 2].trim();
    if (
      prevLine.includes('|') &&
      /^\|?[\s:-]+(?:\|[\s:-]*)*$/.test(lastLine) &&
      lastLine.includes('-')
    ) {
      const headerCols = prevLine.replace(/^\||\|$/g, '').split('|').length;
      if (headerCols >= 1) {
        lines[lines.length - 1] = '| ' + Array(headerCols).fill('---').join(' | ') + ' |';
        text = lines.join('\n');
      }
    }
  }

  const updatedLines = text.split('\n');
  if (updatedLines.length > 0) {
    let tail = updatedLines[updatedLines.length - 1];
    const backticks = (tail.match(/`/g) || []).length;
    if (backticks % 2 === 1) {
      tail += '`';
    }
    const boldMarkers = (tail.match(/\*\*/g) || []).length;
    if (boldMarkers % 2 === 1) {
      tail += '**';
    }
    updatedLines[updatedLines.length - 1] = tail;
    text = updatedLines.join('\n');
  }

  return text;
}

export function formatMathExpression(expr: string): string {
  if (!expr) return '';
  return String(expr)
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1) / ($2)')
    .replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
    .replace(/\\sum_\{([^}]+)\}\^\{([^}]+)\}/g, '∑[$1→$2]')
    .replace(/\\int_\{([^}]+)\}\^\{([^}]+)\}/g, '∫[$1→$2]')
    .replace(/\\pm/g, '±')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\approx/g, '≈')
    .replace(/\\rightarrow|\\to/g, '→')
    .replace(/\\leftrightarrow/g, '↔')
    .replace(/\\Rightarrow/g, '⇒')
    .replace(/\\Leftarrow/g, '⇐')
    .replace(/\\iff/g, '⇔')
    .replace(/\\land/g, '∧')
    .replace(/\\lor/g, '∨')
    .replace(/\\lnot|\\neg/g, '¬')
    .replace(/\\oplus/g, '⊕')
    .replace(/\\overline\{([^}]+)\}/g, '$1̅')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\delta/g, 'δ')
    .replace(/\\theta/g, 'θ')
    .replace(/\\lambda/g, 'λ')
    .replace(/\\mu/g, 'μ')
    .replace(/\\sigma/g, 'σ')
    .replace(/\\pi/g, 'π')
    .replace(/\\infty/g, '∞')
    .replace(/\\begin\{aligned\}|\\end\{aligned\}/g, '')
    .replace(/&=/g, '=')
    .replace(/\\\\/g, '\n')
    .replace(/\\left|\\right/g, '')
    .trim();
}

/**
 * Robust Error Boundary to guarantee that malformed markdown or edge cases
 * NEVER crash the application. Falls back safely to plain text.
 */
class MarkdownErrorBoundary extends React.Component<
  { fallbackText: string; color?: string; onPress?: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err: any) {
    console.warn('PostMarkdown caught error in render:', err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={this.props.onPress}
          disabled={!this.props.onPress}
        >
          <Text style={[styles.paragraph, { color: this.props.color || '#FFFFFF' }]}>
            {this.props.fallbackText}
          </Text>
        </TouchableOpacity>
      );
    }
    return this.props.children;
  }
}

/**
 * Linear, non-recursive inline tokenizer that splits by markdown formatting.
 */
function renderInlineTokens(
  text: string,
  keyPrefix: string,
  textColor: string,
  isDark: boolean,
  borderColor: string,
  onPressText?: () => void,
  onPressInternalLink?: (url: string) => void
): React.ReactNode[] {
  if (!text) return [];

  const normalized = text
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');

  // Split with capturing group to keep matched tokens in parts array
  const parts = normalized.split(
    /(`[^`]+`|\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|\*[^*]+\*|<u>.*?<\/u>|~~[^~]+~~|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<)]+)/g
  );

  return parts
    .map((part, idx) => {
      if (!part) return null;
      const key = `${keyPrefix}-${idx}`;

      // 1. Inline code: `code`
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        return (
          <Text
            key={key}
            style={[
              styles.inlineCode,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                borderColor: borderColor,
                color: textColor,
              },
            ]}
          >
            {part.slice(1, -1)}
          </Text>
        );
      }

      // 1b. Inline or block math: $...$ or $$...$$
      if (part.startsWith('$') && part.endsWith('$') && part.length >= 3) {
        const rawExpr = part.startsWith('$$') ? part.slice(2, -2) : part.slice(1, -1);
        return (
          <Text
            key={key}
            style={[
              styles.inlineCode,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                borderColor: borderColor,
                color: textColor,
              },
            ]}
          >
            {formatMathExpression(rawExpr)}
          </Text>
        );
      }

      // 2. Bold: **text**
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return (
          <Text
            key={key}
            style={{ fontWeight: '700', color: textColor }}
            onPress={onPressText}
          >
            {part.slice(2, -2)}
          </Text>
        );
      }

      // 3. Italic: *text*
      if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
        return (
          <Text
            key={key}
            style={{ fontStyle: 'italic', color: textColor }}
            onPress={onPressText}
          >
            {part.slice(1, -1)}
          </Text>
        );
      }

      // 4. Underline: <u>text</u>
      if (part.startsWith('<u>') && part.endsWith('</u>') && part.length >= 7) {
        return (
          <Text
            key={key}
            style={{ textDecorationLine: 'underline', color: textColor }}
            onPress={onPressText}
          >
            {part.slice(3, -4)}
          </Text>
        );
      }

      // 5. Strikethrough: ~~text~~
      if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 4) {
        return (
          <Text
            key={key}
            style={{ textDecorationLine: 'line-through', color: textColor }}
            onPress={onPressText}
          >
            {part.slice(2, -2)}
          </Text>
        );
      }

      // 6. Link: [title](url)
      if (part.startsWith('[') && part.includes('](')) {
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (linkMatch) {
          const [, title, url] = linkMatch;
          return (
            <Text
              key={key}
              style={[styles.link, { color: textColor }]}
              onPress={() => {
                if (/^https?:\/\//i.test(url)) {
                  Linking.openURL(url).catch(() => {});
                } else if (onPressInternalLink) {
                  onPressInternalLink(url);
                }
              }}
            >
              {title}
            </Text>
          );
        }
      }

      // 7. Direct URL: https://...
      if (/^https?:\/\//.test(part)) {
        return (
          <Text
            key={key}
            style={[styles.link, { color: textColor }]}
            onPress={() => {
              Linking.openURL(part).catch(() => {});
            }}
          >
            {part}
          </Text>
        );
      }

      // 8. Plain text segment
      return (
        <Text key={key} style={{ color: textColor }} onPress={onPressText}>
          {part}
        </Text>
      );
    })
    .filter(Boolean);
}

const MOBILE_KEYWORDS = new Set([
  'public', 'private', 'protected', 'class', 'interface', 'static', 'void', 'int',
  'float', 'double', 'char', 'boolean', 'bool', 'long', 'short', 'String', 'new',
  'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'try', 'catch', 'finally', 'throw', 'import', 'package', 'def', 'elif', 'const',
  'let', 'var', 'function', 'async', 'await', 'select', 'where', 'from', 'null',
  'true', 'false', 'True', 'False', 'None', 'self', 'this', 'echo', 'foreach'
]);

function generateSampleHtmlForCssMobile(cssText: string): string {
  const classMatches = [...cssText.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  const idMatches = [...cssText.matchAll(/#([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  const tagMatches = [...cssText.matchAll(/\b(h[1-6]|p|button|span|a|ul|li|div)\b/g)].map((m) => m[1]);

  const parts: string[] = [];
  if (classMatches.length) {
    for (const cls of new Set(classMatches)) {
      parts.push(`<p class="${cls}">Paragraph styled with class="<strong>.${cls}</strong>"</p>`);
    }
  }
  if (idMatches.length) {
    for (const id of new Set(idMatches)) {
      parts.push(`<h2 id="${id}">Heading styled with id="<strong>#${id}</strong>"</h2>`);
    }
  }
  if (!parts.length && tagMatches.length) {
    for (const tag of new Set(tagMatches)) {
      parts.push(`<${tag}>Sample &lt;${tag}&gt; element</${tag}>`);
    }
  }
  if (!parts.length) {
    parts.push('<p>CSS applied to live preview canvas</p>');
  }
  return parts.join('\n');
}

function renderHighlightedCode(code: string, rawLang: string, isWrapped: boolean): React.ReactNode {
  const l = (rawLang || '').toLowerCase();
  const isHtml = l === 'html' || l === 'xml' || l === 'markup';
  const isCss = l === 'css';

  const lines = code.split('\n');

  return (
    <Text style={[styles.codeText, isWrapped && { flexWrap: 'wrap' }]}>
      {lines.map((lineText, lineIdx) => {
        const lineKey = `cl-${lineIdx}`;
        const tokens: React.ReactNode[] = [];

        let rest = lineText;
        let tokIdx = 0;

        while (rest.length > 0) {
          const curKey = `${lineKey}-t-${tokIdx++}`;

          // Comment
          if (rest.startsWith('//') || (rest.startsWith('#') && !isCss)) {
            tokens.push(
              <Text key={curKey} style={{ color: '#71717a', fontStyle: 'italic' }}>
                {rest}
              </Text>
            );
            break;
          }

          // PHP Directive
          if (rest.startsWith('<?php') || rest.startsWith('?>')) {
            const tag = rest.startsWith('<?php') ? '<?php' : '?>';
            tokens.push(
              <Text key={curKey} style={{ color: '#c084fc', fontWeight: '700' }}>
                {tag}
              </Text>
            );
            rest = rest.slice(tag.length);
            continue;
          }

          // PHP / Shell Variables ($var)
          if (rest.startsWith('$') && /^[a-zA-Z_]\w*/.test(rest.slice(1))) {
            const varMatch = rest.match(/^\$[a-zA-Z_]\w*/);
            if (varMatch) {
              tokens.push(
                <Text key={curKey} style={{ color: '#93c5fd' }}>
                  {varMatch[0]}
                </Text>
              );
              rest = rest.slice(varMatch[0].length);
              continue;
            }
          }

          // String
          const strMatch = rest.match(/^("[^"]*"|'[^']*'|`[^`]*`)/);
          if (strMatch) {
            tokens.push(
              <Text key={curKey} style={{ color: '#4ade80' }}>
                {strMatch[0]}
              </Text>
            );
            rest = rest.slice(strMatch[0].length);
            continue;
          }

          // HTML Tag
          if (isHtml && rest.startsWith('<')) {
            const tagMatch = rest.match(/^<\/?([a-zA-Z][\w:-]*)/);
            if (tagMatch) {
              const slash = tagMatch[0].startsWith('</') ? '/' : '';
              tokens.push(
                <Text key={curKey} style={{ color: '#94a3b8' }}>
                  {'<' + slash}
                </Text>
              );
              tokens.push(
                <Text key={`${curKey}-name`} style={{ color: '#38bdf8', fontWeight: '600' }}>
                  {tagMatch[1]}
                </Text>
              );
              rest = rest.slice(tagMatch[0].length);
              continue;
            }
          }

          // HTML attribute (e.g. class=)
          if (isHtml) {
            const attrMatch = rest.match(/^([a-zA-Z_:][\w:.-]*)\s*=/);
            if (attrMatch) {
              tokens.push(
                <Text key={curKey} style={{ color: '#facc15' }}>
                  {attrMatch[1]}
                </Text>
              );
              tokens.push(
                <Text key={`${curKey}-eq`} style={{ color: '#94a3b8' }}>
                  {'='}
                </Text>
              );
              rest = rest.slice(attrMatch[0].length);
              continue;
            }
          }

          // CSS Selectors (.class, #id)
          if (isCss && (rest.startsWith('.') || rest.startsWith('#'))) {
            const selMatch = rest.match(/^[.#][a-zA-Z0-9_-]+/);
            if (selMatch) {
              tokens.push(
                <Text key={curKey} style={{ color: '#facc15', fontWeight: '600' }}>
                  {selMatch[0]}
                </Text>
              );
              rest = rest.slice(selMatch[0].length);
              continue;
            }
          }

          // CSS property before :
          if (isCss) {
            const propMatch = rest.match(/^([a-zA-Z-][\w-]*)\s*:/);
            if (propMatch) {
              tokens.push(
                <Text key={curKey} style={{ color: '#7dd3fc' }}>
                  {propMatch[1]}
                </Text>
              );
              tokens.push(
                <Text key={`${curKey}-col`} style={{ color: '#94a3b8' }}>
                  {':'}
                </Text>
              );
              rest = rest.slice(propMatch[0].length);
              continue;
            }
          }

          // Numbers
          const numMatch = rest.match(/^\b\d+(\.\d+)?(px|rem|em|%)?\b/);
          if (numMatch) {
            tokens.push(
              <Text key={curKey} style={{ color: '#f87171' }}>
                {numMatch[0]}
              </Text>
            );
            rest = rest.slice(numMatch[0].length);
            continue;
          }

          // Words / Identifiers
          const wordMatch = rest.match(/^[a-zA-Z_]\w*/);
          if (wordMatch) {
            const word = wordMatch[0];
            if (MOBILE_KEYWORDS.has(word)) {
              tokens.push(
                <Text key={curKey} style={{ color: '#c084fc', fontWeight: '600' }}>
                  {word}
                </Text>
              );
            } else if (isCss && /^(red|green|blue|white|black|none|block|flex|bold|center)\b/i.test(word)) {
              tokens.push(
                <Text key={curKey} style={{ color: '#ce9178' }}>
                  {word}
                </Text>
              );
            } else {
              tokens.push(
                <Text key={curKey} style={{ color: '#e6edf3' }}>
                  {word}
                </Text>
              );
            }
            rest = rest.slice(word.length);
            continue;
          }

          // Punctuation & operators
          tokens.push(
            <Text key={curKey} style={{ color: '#94a3b8' }}>
              {rest[0]}
            </Text>
          );
          rest = rest.slice(1);
        }

        return (
          <Text key={lineKey}>
            {tokens}
            {lineIdx < lines.length - 1 ? '\n' : ''}
          </Text>
        );
      })}
    </Text>
  );
}

const renderHighlightedCodeMobile = renderHighlightedCode;

function PostMarkdownInternal({
  content,
  isExpanded = true,
  onToggleExpand,
  maxPreviewLength,
  onPressText,
  style,
  streaming = false,
  onPressInternalLink,
}: PostMarkdownProps) {
  const { colors, isDark } = useTheme();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [wrappedBlocks, setWrappedBlocks] = useState<Record<number, boolean>>({});
  const [previewBlocks, setPreviewBlocks] = useState<Record<number, boolean>>({});
  const [simState, setSimState] = useState<Record<number, { gateIdx: number; a: number; b: number }>>({});

  if (!content || typeof content !== 'string' || !content.trim()) return null;

  const isTruncated = Boolean(
    maxPreviewLength &&
    !isExpanded &&
    content.length > maxPreviewLength
  );

  const rawDisplayContent = isTruncated
    ? content.slice(0, maxPreviewLength).trim()
    : content;

  const displayContent = streaming
    ? stabilizeStreamingMarkdown(rawDisplayContent)
    : rawDisplayContent;

  // Extract fenced code blocks first
  const codeBlocks: CodeBlock[] = [];
  const normalized = displayContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const textWithoutCode = normalized.replace(
    /```([a-zA-Z0-9_#+-]*)[ \t]*\n([\s\S]*?)```/g,
    (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({
        lang: (lang || 'CODE').trim().toUpperCase(),
        code: (code || '').replace(/\n+$/, ''),
      });
      return `\x01CODE_BLOCK_${idx}\x02`;
    }
  );

  // Extract display math blocks ($$...$$)
  const mathBlocks: string[] = [];
  const textWithoutCodeAndMath = textWithoutCode.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_, expr) => {
      const idx = mathBlocks.length;
      mathBlocks.push(String(expr || '').trim());
      return `\n\x01MATH_BLOCK_${idx}\x02\n`;
    }
  );

  const lines = textWithoutCodeAndMath.split('\n');
  const renderedElements: React.ReactNode[] = [];

  function isTableDelimiter(str: string): boolean {
    if (!str || !str.includes('|')) return false;
    const cells = str.trim().replace(/^\||\|$/g, '').split('|');
    if (cells.length === 0) return false;
    return cells.every((c) => /^\s*:?-{1,}:?\s*$/.test(c));
  }

  async function handleCopyCode(code: string, index: number) {
    try {
      await Clipboard.setStringAsync(code);
      setCopiedIndex(index);
      setTimeout(() => {
        setCopiedIndex((cur) => (cur === index ? null : cur));
      }, 2000);
    } catch {
      // Ignore clipboard write failure
    }
  }

  let paraBuffer: string[] = [];
  function flushParagraph(key: string) {
    if (paraBuffer.length > 0) {
      const fullPara = paraBuffer.join('\n');
      renderedElements.push(
        <Text key={key} style={[styles.paragraph, { color: colors.text }]} onPress={onPressText}>
          {renderInlineTokens(fullPara, key, colors.text, isDark, colors.border, onPressText, onPressInternalLink)}
        </Text>
      );
      paraBuffer = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 0. Display Math Block placeholder
    const mathMatch = trimmed.match(/^\x01MATH_BLOCK_(\d+)\x02$/);
    if (mathMatch) {
      flushParagraph(`p-before-math-${i}`);
      const mIdx = Number(mathMatch[1]);
      const expr = mathBlocks[mIdx] || '';
      renderedElements.push(
        <View
          key={`math-block-${i}`}
          style={{
            marginVertical: 8,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
          }}
        >
          <Text
            style={{
              fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
              fontSize: 13.5,
              lineHeight: 20,
              color: colors.text,
              textAlign: 'center',
            }}
          >
            {formatMathExpression(expr)}
          </Text>
        </View>
      );
      continue;
    }

    // 1. Code Block placeholder
    const codeMatch = trimmed.match(/^\x01CODE_BLOCK_(\d+)\x02$/);
    if (codeMatch) {
      flushParagraph(`p-before-code-${i}`);
      const blockIndex = Number(codeMatch[1]);
      const block = codeBlocks[blockIndex];
      if (block) {
        const isCopied = copiedIndex === blockIndex;
        const isWrapped = Boolean(wrappedBlocks[blockIndex]);
        const isPreviewOpen = Boolean(previewBlocks[blockIndex]);
        const langLower = block.lang.toLowerCase();

        // Structured component handling (roadmap, timeline, diagram, flowchart, trace, study_session, pyq_card, logic_sim, interactive_demo, checkpoint_question, chapter_summary, source_reference)
        const isStructuredKind = /^(study_session|learning_session|pyq_card|logic_sim|interactive_demo|live_demo|roadmap|timeline|diagram|flowchart|trace|checkpoint_question|chapter_summary|source_reference)$/.test(langLower);
        if (isStructuredKind) {
          if (block.code.trim().startsWith('{') && block.code.length <= 32768) {
            try {
              const parsedVisual = JSON.parse(block.code.trim());
              if (langLower === 'logic_sim' || langLower === 'interactive_demo') {
                const gates = Array.isArray(parsedVisual?.gates) && parsedVisual.gates.length > 0
                  ? parsedVisual.gates
                  : [
                      {
                        gate: 'AND',
                        symbol: 'A · B',
                        inputs: ['A', 'B'],
                        description: 'Outputs 1 only when all inputs are 1.',
                        truthTable: [
                          { A: 0, B: 0, Y: 0 },
                          { A: 0, B: 1, Y: 0 },
                          { A: 1, B: 0, Y: 0 },
                          { A: 1, B: 1, Y: 1 },
                        ],
                      },
                    ];
                const curSim = simState[blockIndex] || { gateIdx: 0, a: 0, b: 0 };
                const activeGate = gates[curSim.gateIdx] || gates[0];
                const singleInput = Array.isArray(activeGate.inputs) && activeGate.inputs.length === 1;
                const truthRows = Array.isArray(activeGate.truthTable) ? activeGate.truthTable : [];
                const matchedRow = truthRows.find(
                  (r: any) => Number(r.A) === curSim.a && (singleInput || Number(r.B) === curSim.b)
                ) || { Y: 0 };

                renderedElements.push(
                  <View
                    key={`logic-sim-${i}`}
                    style={[
                      styles.codeBlockContainer,
                      {
                        backgroundColor: isDark ? '#141416' : '#f8fafc',
                        borderColor: colors.border,
                        padding: 12,
                      },
                    ]}
                  >
                    <Text style={[styles.codeLang, { color: colors.textSecondary, marginBottom: 4 }]}>
                      {String(parsedVisual.title || 'INTERACTIVE LOGIC GATE SIMULATOR').toUpperCase()}
                    </Text>
                    {Boolean(activeGate.description) && (
                      <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 8 }}>
                        {String(activeGate.description)}
                      </Text>
                    )}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {gates.map((g: any, gIdx: number) => {
                        const isAct = gIdx === curSim.gateIdx;
                        return (
                          <TouchableOpacity
                            key={`gate-tab-${gIdx}`}
                            onPress={() =>
                              setSimState((prev) => ({
                                ...prev,
                                [blockIndex]: { ...curSim, gateIdx: gIdx },
                              }))
                            }
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 4,
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: colors.border,
                              backgroundColor: isAct ? colors.text : 'transparent',
                            }}
                          >
                            <Text style={{ fontSize: 11.5, fontWeight: '700', color: isAct ? colors.background : colors.text }}>
                              {String(g.gate || 'GATE')}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() =>
                            setSimState((prev) => ({
                              ...prev,
                              [blockIndex]: { ...curSim, a: curSim.a === 1 ? 0 : 1 },
                            }))
                          }
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}
                        >
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                            Input A: {curSim.a}
                          </Text>
                        </TouchableOpacity>
                        {!singleInput && (
                          <TouchableOpacity
                            onPress={() =>
                              setSimState((prev) => ({
                                ...prev,
                                [blockIndex]: { ...curSim, b: curSim.b === 1 ? 0 : 1 },
                              }))
                            }
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: colors.border,
                            }}
                          >
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                              Input B: {curSim.b}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) }}>
                          Y = {String(activeGate.symbol || activeGate.gate)}
                        </Text>
                        <View
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 8,
                            backgroundColor: Number(matchedRow.Y) === 1 ? colors.text : 'transparent',
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}
                        >
                          <Text
                            style={{
                              fontWeight: '800',
                              fontSize: 12.5,
                              color: Number(matchedRow.Y) === 1 ? colors.background : colors.text,
                            }}
                          >
                            Output Y = {Number(matchedRow.Y) || 0}
                          </Text>
                        </View>
                      </View>
                    </View>
                    {truthRows.length > 0 && (
                      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' }}>
                        <View style={{ flexDirection: 'row', backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', borderBottomWidth: 1, borderBottomColor: colors.border }}>
                          <Text style={{ flex: 1, textAlign: 'center', paddingVertical: 5, fontSize: 11.5, fontWeight: '700', color: colors.text }}>Input A</Text>
                          {!singleInput && (
                            <Text style={{ flex: 1, textAlign: 'center', paddingVertical: 5, fontSize: 11.5, fontWeight: '700', color: colors.text }}>Input B</Text>
                          )}
                          <Text style={{ flex: 1, textAlign: 'center', paddingVertical: 5, fontSize: 11.5, fontWeight: '700', color: colors.text }}>Output Y</Text>
                        </View>
                        {truthRows.map((row: any, rIdx: number) => {
                          const isCurrentRow = Number(row.A) === curSim.a && (singleInput || Number(row.B) === curSim.b);
                          return (
                            <View
                              key={`tt-row-${rIdx}`}
                              style={{
                                flexDirection: 'row',
                                backgroundColor: isCurrentRow ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)') : 'transparent',
                                borderBottomWidth: rIdx < truthRows.length - 1 ? 1 : 0,
                                borderBottomColor: colors.border,
                              }}
                            >
                              <Text style={{ flex: 1, textAlign: 'center', paddingVertical: 5, fontSize: 12, fontWeight: isCurrentRow ? '700' : '400', color: colors.text }}>{row.A}</Text>
                              {!singleInput && (
                                <Text style={{ flex: 1, textAlign: 'center', paddingVertical: 5, fontSize: 12, fontWeight: isCurrentRow ? '700' : '400', color: colors.text }}>{row.B}</Text>
                              )}
                              <Text style={{ flex: 1, textAlign: 'center', paddingVertical: 5, fontSize: 12, fontWeight: '700', color: colors.text }}>{row.Y}</Text>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
                continue;
              }

              if (langLower === 'live_demo' || (parsedVisual?.demoType === 'web_live_preview' && Array.isArray(parsedVisual?.variants))) {
                const variants = Array.isArray(parsedVisual?.variants) ? parsedVisual.variants : [];
                if (variants.length > 0) {
                  const curVarIdx = (simState[blockIndex]?.gateIdx || 0) < variants.length ? (simState[blockIndex]?.gateIdx || 0) : 0;
                  const activeVariant = variants[curVarIdx] || variants[0];
                  const demoDoc = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box;}body{margin:0;padding:12px;font-family:-apple-system,BlinkMacSystemFont,Roboto,sans-serif;background:#fff;color:#111827;}${String(activeVariant.css || '')}</style></head><body>${String(parsedVisual.html || '')}</body></html>`;
                  renderedElements.push(
                    <View
                      key={`live-demo-${i}`}
                      style={[
                        styles.codeBlockContainer,
                        {
                          backgroundColor: isDark ? '#141416' : '#f8fafc',
                          borderColor: colors.border,
                          padding: 12,
                        },
                      ]}
                    >
                      <Text style={[styles.codeLang, { color: colors.textSecondary, marginBottom: 4 }]}>
                        {String(parsedVisual.title || 'INTERACTIVE LIVE DEMO').toUpperCase()}
                      </Text>
                      {Boolean(parsedVisual.subtitle) && (
                        <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 8 }}>
                          {String(parsedVisual.subtitle)}
                        </Text>
                      )}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        {variants.map((v: any, vIdx: number) => {
                          const isAct = vIdx === curVarIdx;
                          return (
                            <TouchableOpacity
                              key={`demo-var-${vIdx}`}
                              onPress={() =>
                                setSimState((prev) => ({
                                  ...prev,
                                  [blockIndex]: { ...(prev[blockIndex] || { a: 0, b: 0 }), gateIdx: vIdx },
                                }))
                              }
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 4,
                                borderRadius: 999,
                                borderWidth: 1,
                                borderColor: colors.border,
                                backgroundColor: isAct ? colors.text : 'transparent',
                              }}
                            >
                              <Text style={{ fontSize: 11.5, fontWeight: '700', color: isAct ? colors.background : colors.text }}>
                                {String(v.label || `Style ${vIdx + 1}`)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <WebView
                        originWhitelist={['*']}
                        source={{ html: demoDoc }}
                        style={styles.codePreviewWebView}
                        scrollEnabled={true}
                      />
                      {Boolean(parsedVisual.caption) && (
                        <Text style={{ fontSize: 11.5, color: colors.textSecondary, marginTop: 6 }}>
                          {String(parsedVisual.caption)}
                        </Text>
                      )}
                    </View>
                  );
                  continue;
                }
              }

              const rawItems = Array.isArray(parsedVisual?.steps)
                ? parsedVisual.steps
                : Array.isArray(parsedVisual?.nodes)
                  ? parsedVisual.nodes
                  : Array.isArray(parsedVisual?.checklist)
                    ? parsedVisual.checklist
                    : [];
              const items = rawItems.filter((it: any) => it && typeof it === 'object' && !Array.isArray(it));
              if (items.length > 0) {
                renderedElements.push(
                  <View
                    key={`visual-block-${i}`}
                    style={[
                      styles.codeBlockContainer,
                      {
                        backgroundColor: isDark ? '#18181b' : '#f8fafc',
                        borderColor: colors.border,
                        padding: 12,
                        maxWidth: '100%',
                      },
                    ]}
                  >
                    <Text style={[styles.codeLang, { color: colors.textSecondary, marginBottom: 8 }]}>
                      {String(parsedVisual.title || parsedVisual.unit || block.lang).slice(0, 140).toUpperCase()}
                    </Text>
                    {items.slice(0, 12).map((item: any, idx: number) => (
                      <View
                        key={`vb-item-${idx}`}
                        style={{
                          paddingVertical: 6,
                          borderBottomWidth: idx < Math.min(items.length, 12) - 1 ? 1 : 0,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flexShrink: 1 }}>
                          {item.phase ? `${String(item.phase).slice(0, 60)}: ` : ''}{String(item.title || item.label || `Step ${idx + 1}`).slice(0, 160)}
                        </Text>
                        {Boolean(item.detail || item.content || item.description) && (
                          <Text style={{ color: colors.textSecondary, fontSize: 12.5, marginTop: 2, flexShrink: 1 }}>
                            {String(item.detail || item.content || item.description).slice(0, 320)}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                );
                continue;
              }
            } catch {
              // Suppress malformed structured blocks so broken JSON never leaks to students
              continue;
            }
          }
          // Suppress invalid structured block
          continue;
        }

        const isWeb = /^(html|xml|svg|css|javascript|js)$/.test(langLower);

        let companionCss = '';
        let companionHtml = '';
        codeBlocks.forEach((otherBlock, idx) => {
          if (idx === blockIndex) return;
          const ol = otherBlock.lang.toLowerCase();
          if (ol === 'css') companionCss += '\n' + otherBlock.code;
          else if (ol === 'html' || ol === 'xml') companionHtml += '\n' + otherBlock.code;
        });

        let finalHtml = '';
        if (langLower === 'html' || langLower === 'xml' || langLower === 'svg') {
          finalHtml = block.code;
        } else if (langLower === 'css') {
          if (companionHtml.trim()) {
            finalHtml = companionHtml;
            companionCss = block.code + '\n' + companionCss;
          } else {
            finalHtml = generateSampleHtmlForCssMobile(block.code);
            companionCss = block.code;
          }
        } else {
          finalHtml = block.code;
        }

        const previewDoc = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box;}body{margin:0;padding:12px;font-family:-apple-system,BlinkMacSystemFont,Roboto,sans-serif;font-size:14px;line-height:1.45;color:#111827;background-color:#ffffff;} ${companionCss}</style></head><body>${finalHtml}</body></html>`;

        renderedElements.push(
          <View
            key={`code-block-${i}`}
            style={[
              styles.codeBlockContainer,
              {
                backgroundColor: '#212124',
                borderColor: 'rgba(255,255,255,0.08)',
              },
            ]}
          >
            <View
              style={[
                styles.codeHeader,
                {
                  borderBottomColor: 'rgba(255,255,255,0.07)',
                  backgroundColor: 'rgba(255,255,255,0.035)',
                },
              ]}
            >
              <View style={styles.codeLangWrap}>
                <Text style={styles.codeLangIconText}>{'</>'}</Text>
                <Text style={[styles.codeLang, { color: '#9ca3af' }]}>
                  {block.lang}
                </Text>
              </View>
              <View style={styles.codeActions}>
                <TouchableOpacity
                  onPress={() =>
                    setWrappedBlocks((prev) => ({
                      ...prev,
                      [blockIndex]: !prev[blockIndex],
                    }))
                  }
                  style={[
                    styles.codeActionBtn,
                    {
                      borderColor: isWrapped ? '#38bdf8' : 'rgba(255,255,255,0.12)',
                      backgroundColor: isWrapped ? 'rgba(56,189,248,0.12)' : 'transparent',
                    },
                  ]}
                  activeOpacity={0.7}
                  accessibilityLabel="Toggle line wrap"
                >
                  <Text
                    style={[
                      styles.codeActionBtnText,
                      { color: isWrapped ? '#38bdf8' : '#a1a1aa' },
                    ]}
                  >
                    {isWrapped ? 'Unwrap' : 'Wrap'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleCopyCode(block.code, blockIndex)}
                  style={[
                    styles.codeActionBtn,
                    {
                      borderColor: isCopied ? '#22c55e' : 'rgba(255,255,255,0.12)',
                      backgroundColor: isCopied ? 'rgba(34,197,94,0.12)' : 'transparent',
                    },
                  ]}
                  activeOpacity={0.7}
                  accessibilityLabel="Copy code"
                >
                  <Text
                    style={[
                      styles.codeActionBtnText,
                      { color: isCopied ? '#22c55e' : '#a1a1aa' },
                    ]}
                  >
                    {isCopied ? '✓ Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>

                {isWeb && (
                  <TouchableOpacity
                    onPress={() =>
                      setPreviewBlocks((prev) => ({
                        ...prev,
                        [blockIndex]: !prev[blockIndex],
                      }))
                    }
                    style={[
                      styles.codeActionBtn,
                      {
                        borderColor: isPreviewOpen ? '#38bdf8' : 'rgba(255,255,255,0.12)',
                        backgroundColor: isPreviewOpen ? 'rgba(56,189,248,0.15)' : 'transparent',
                      },
                    ]}
                    activeOpacity={0.7}
                    accessibilityLabel="Preview output"
                  >
                    <Text
                      style={[
                        styles.codeActionBtnText,
                        { color: isPreviewOpen ? '#38bdf8' : '#a1a1aa' },
                      ]}
                    >
                      {isPreviewOpen ? 'Hide' : '▶'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {isWrapped ? (
              <View style={{ padding: 12 }}>
                {renderHighlightedCodeMobile(block.code, block.lang, true)}
              </View>
            ) : (
              <ScrollView
                horizontal
                nestedScrollEnabled={true}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ padding: 12 }}
              >
                {renderHighlightedCodeMobile(block.code, block.lang, false)}
              </ScrollView>
            )}

            {isPreviewOpen && (
              <View style={styles.codePreviewContainer}>
                <View style={styles.codePreviewBar}>
                  <View style={styles.codePreviewTitleRow}>
                    <View style={styles.codePreviewDot} />
                    <Text style={styles.codePreviewTitle}>Live Output Preview</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      setPreviewBlocks((prev) => ({
                        ...prev,
                        [blockIndex]: false,
                      }))
                    }
                  >
                    <Text style={styles.codePreviewCloseText}>✕ Close</Text>
                  </TouchableOpacity>
                </View>
                <WebView
                  originWhitelist={['*']}
                  source={{ html: previewDoc }}
                  style={styles.codePreviewWebView}
                  scrollEnabled={true}
                />
              </View>
            )}
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
      i = j - 1;

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
          <ScrollView
            horizontal
            nestedScrollEnabled={true}
            showsHorizontalScrollIndicator={false}
          >
            <View>
              {/* Header Row */}
              <View
                style={[
                  styles.tableRow,
                  styles.tableHeaderRow,
                  {
                    borderBottomColor: colors.border,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
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
                      {renderInlineTokens(cellText, `th-in-${colIdx}`, colors.text, isDark, colors.border, onPressText, onPressInternalLink)}
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
                        {renderInlineTokens(rowCells[colIdx] || '', `td-in-${rIdx}-${colIdx}`, colors.text, isDark, colors.border, onPressText, onPressInternalLink)}
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
    const hMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (hMatch) {
      flushParagraph(`p-before-h-${i}`);
      const level = hMatch[1].length;
      const headingStyle = level === 1 ? styles.h1 : level === 2 ? styles.h2 : styles.h3;
      renderedElements.push(
        <Text key={`h-${i}`} style={[headingStyle, { color: colors.text }]} onPress={onPressText}>
          {renderInlineTokens(hMatch[2], `h-${i}`, colors.text, isDark, colors.border, onPressText, onPressInternalLink)}
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
          <Text style={[styles.blockquoteText, { color: colors.textSecondary }]} onPress={onPressText}>
            {renderInlineTokens(qMatch[1], `q-${i}`, colors.textSecondary, isDark, colors.border, onPressText, onPressInternalLink)}
          </Text>
        </View>
      );
      continue;
    }

    // 6. Nested / Standard List items: - or * or 1.
    const listMatch = line.match(/^(\s*)([\*\-•]|(\d+\.))\s+(.*)$/);
    if (listMatch) {
      flushParagraph(`p-before-li-${i}`);
      const indentSpaces = (listMatch[1] || '').replace(/\t/g, '  ').length;
      const depth = Math.min(3, Math.floor(indentSpaces / 2));
      const unorderedGlyphs = ['•', '◦', '▪', '▫'];
      const bullet = listMatch[2].includes('.') ? listMatch[2] : unorderedGlyphs[depth] || '•';
      renderedElements.push(
        <View key={`li-${i}`} style={[styles.listItemRow, { paddingLeft: 4 + depth * 14 }]}>
          <Text style={[styles.listBullet, { color: colors.textSecondary }]}>{bullet}</Text>
          <Text style={[styles.listContent, { color: colors.text }]} onPress={onPressText}>
            {renderInlineTokens(listMatch[4], `li-${i}`, colors.text, isDark, colors.border, onPressText, onPressInternalLink)}
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

      {isTruncated && onToggleExpand && (
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

      {!isTruncated && maxPreviewLength && isExpanded && onToggleExpand && content.length > maxPreviewLength && (
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

export function PostMarkdown(props: PostMarkdownProps) {
  const { colors } = useTheme();
  return (
    <MarkdownErrorBoundary
      fallbackText={props.content}
      color={colors.text}
      onPress={props.onPressText}
    >
      <PostMarkdownInternal {...props} />
    </MarkdownErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 10,
  },
  h1: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    marginTop: 14,
    marginBottom: 6,
  },
  h2: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 12,
    marginBottom: 5,
  },
  h3: {
    fontSize: 14.5,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 4,
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
    fontWeight: '600',
  },
  codeBlockContainer: {
    marginVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  codeLangWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codeLangIconText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 11,
    fontWeight: '700',
    color: '#71717a',
  },
  codeLang: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  codeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codeActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  codeActionBtnText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  codeText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12.5,
    lineHeight: 18.5,
    color: '#e6edf3',
  },
  codePreviewContainer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#ffffff',
  },
  codePreviewBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  codePreviewTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  codePreviewDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#22c55e',
  },
  codePreviewTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  codePreviewCloseText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  codePreviewWebView: {
    width: '100%',
    height: 130,
    backgroundColor: '#ffffff',
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
