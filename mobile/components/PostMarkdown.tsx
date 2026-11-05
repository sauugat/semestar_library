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

export interface PostMarkdownProps {
  content: string;
  streaming?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  maxPreviewLength?: number;
  onPressText?: () => void;
  onPressInternalLink?: (url: string) => void;
  style?: StyleProp<ViewStyle>;
}

interface CodeBlock {
  lang: string;
  code: string;
}

/**
 * Stabilizes incomplete Markdown tokens during live streaming so mobile bubbles
 * never flicker or render raw unclosed fences/delimiters mid-stream.
 */
export function stabilizeStreamingMarkdown(rawMarkdown: string): string {
  if (!rawMarkdown) return '';
  let text = String(rawMarkdown).replace(/\r\n/g, '\n');

  // 1. Check for unclosed fenced code block (``` or ~~~)
  const lines = text.split('\n');
  let inFence = false;
  let fenceMarker = '```';
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!inFence) {
      const openMatch = trimmed.match(/^(`{3,}|~{3,})/);
      if (openMatch) {
        inFence = true;
        fenceMarker = openMatch[1].slice(0, 3);
      }
    } else if (trimmed.startsWith(fenceMarker) && /^(`{3,}|~{3,})\s*$/.test(trimmed)) {
      inFence = false;
    }
  }
  if (inFence) {
    return `${text}\n${fenceMarker}`;
  }

  // 2. Check for unclosed display math block ($$ or \[)
  const doubleDollarMatches = text.match(/\$\$/g);
  if (doubleDollarMatches && doubleDollarMatches.length % 2 === 1) {
    return `${text}\n$$`;
  }
  const openBracketMath = (text.match(/\\\[/g) || []).length;
  const closeBracketMath = (text.match(/\\\]/g) || []).length;
  if (openBracketMath > closeBracketMath) {
    return `${text}\n\\]`;
  }
  const openParenMath = (text.match(/\\\(/g) || []).length;
  const closeParenMath = (text.match(/\\\)/g) || []).length;
  if (openParenMath > closeParenMath) {
    text = `${text}\\)`;
  }

  // 3. Stabilize trailing partial table delimiter line
  if (lines.length >= 2) {
    const lastLine = lines[lines.length - 1];
    const prevLine = lines[lines.length - 2];
    if (prevLine.includes('|') && /^\s*\|?[\s|:-]*$/.test(lastLine) && lastLine.includes('|')) {
      const colCount = prevLine.trim().replace(/^\||\|$/g, '').split('|').length;
      if (colCount >= 2 && !/^\s*\|?(\s*:?-{1,}:?\s*\|)+\s*:?-{1,}:?\s*\|?\s*$/.test(lastLine)) {
        lines[lines.length - 1] = `| ${Array(colCount).fill('---').join(' | ')} |`;
        text = lines.join('\n');
      }
    }
  }

  // 4. Close unclosed inline formatting on the final active line
  const finalLines = text.split('\n');
  let lastLine = finalLines[finalLines.length - 1];
  const backticks = (lastLine.match(/`/g) || []).length;
  if (backticks % 2 === 1) {
    lastLine += '`';
  } else {
    const boldMarkers = (lastLine.match(/\*\*/g) || []).length;
    if (boldMarkers % 2 === 1) {
      lastLine += '**';
    }
    const strikeMarkers = (lastLine.match(/~~/g) || []).length;
    if (strikeMarkers % 2 === 1) {
      lastLine += '~~';
    }
  }
  finalLines[finalLines.length - 1] = lastLine;
  return finalLines.join('\n');
}

const GREEK_AND_MATH_SYMBOLS: Record<string, string> = {
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\theta': 'θ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\pi': 'π',
  '\\sigma': 'σ',
  '\\tau': 'τ',
  '\\phi': 'φ',
  '\\omega': 'ω',
  '\\Delta': 'Δ',
  '\\Sigma': 'Σ',
  '\\Omega': 'Ω',
  '\\Pi': 'Π',
  '\\Theta': 'Θ',
  '\\infty': '∞',
  '\\sum': '∑',
  '\\prod': '∏',
  '\\int': '∫',
  '\\partial': '∂',
  '\\nabla': '∇',
  '\\pm': '±',
  '\\mp': '∓',
  '\\times': '×',
  '\\div': '÷',
  '\\cdot': '·',
  '\\leq': '≤',
  '\\le': '≤',
  '\\geq': '≥',
  '\\ge': '≥',
  '\\neq': '≠',
  '\\ne': '≠',
  '\\approx': '≈',
  '\\equiv': '≡',
  '\\rightarrow': '→',
  '\\to': '→',
  '\\leftarrow': '←',
  '\\Rightarrow': '⇒',
  '\\iff': '⇔',
  '\\in': '∈',
  '\\notin': '∉',
  '\\subset': '⊂',
  '\\subseteq': '⊆',
  '\\cup': '∪',
  '\\cap': '∩',
  '\\forall': '∀',
  '\\exists': '∃',
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  n: 'ₙ',
  o: 'ₒ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
};

/**
 * Formats TeX / LaTeX math expressions into clean, readable mathematical notation
 * for native mobile rendering without external WebViews.
 */
export function formatMathExpression(tex: string): string {
  if (!tex) return '';
  let out = String(tex)
    .trim()
    .replace(/^\$\$|\$\$$/g, '')
    .replace(/^\\\[|\\\]$/g, '')
    .replace(/^\\\(|\\\)$/g, '')
    .replace(/^\$|\$$/g, '')
    .trim();

  // Remove \begin{aligned} / \end{aligned} / alignment markers
  out = out
    .replace(/\\begin\{[^}]+\}/g, '')
    .replace(/\\end\{[^}]+\}/g, '')
    .replace(/\\\\/g, '\n')
    .replace(/&=/g, '=')
    .replace(/&/g, ' ');

  // \text{...}, \mathrm{...}, \mathbf{...}
  out = out.replace(/\\(?:text|mathrm|mathbf|mathit)\{([^{}]*)\}/g, '$1');

  // \frac{a}{b} -> (a)/(b) or a/b
  for (let pass = 0; pass < 3; pass++) {
    out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, num, den) => {
      const cleanNum = num.trim();
      const cleanDen = den.trim();
      const left = cleanNum.length > 2 ? `(${cleanNum})` : cleanNum;
      const right = cleanDen.length > 2 ? `(${cleanDen})` : cleanDen;
      return `${left}/${right}`;
    });
  }

  // \sqrt{x} -> √(x)
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, (_, inner) =>
    inner.trim().length > 1 ? `√(${inner.trim()})` : `√${inner.trim()}`
  );

  // Replace Greek & math operators
  for (const [cmd, sym] of Object.entries(GREEK_AND_MATH_SYMBOLS)) {
    const escaped = cmd.replace(/\\/g, '\\\\');
    out = out.replace(new RegExp(`${escaped}(?![a-zA-Z])`, 'g'), sym);
  }

  // Superscripts ^{...} or ^x
  out = out.replace(/\^\{([^{}]+)\}/g, (_, exp) => {
    const chars = exp.split('');
    if (chars.every((c: string) => SUPERSCRIPT_MAP[c])) {
      return chars.map((c: string) => SUPERSCRIPT_MAP[c]).join('');
    }
    return `^(${exp})`;
  });
  out = out.replace(/\^([0-9ni+-])/g, (_, ch) => SUPERSCRIPT_MAP[ch] || `^${ch}`);

  // Subscripts _{...} or _x
  out = out.replace(/_\{([^{}]+)\}/g, (_, sub) => {
    const chars = sub.split('');
    if (chars.every((c: string) => SUBSCRIPT_MAP[c])) {
      return chars.map((c: string) => SUBSCRIPT_MAP[c]).join('');
    }
    return `_(${sub})`;
  });
  out = out.replace(/_([0-9aeijknorstuvx+-])/g, (_, ch) => SUBSCRIPT_MAP[ch] || `_${ch}`);

  // Clean remaining braces and spacing commands
  out = out
    .replace(/\\(?:left|right|quad|qquad|,|;|!)/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return out;
}

const CODE_KEYWORDS = new Set([
  'abstract', 'and', 'as', 'async', 'await', 'begin', 'boolean', 'break', 'byte', 'case', 'catch',
  'char', 'class', 'const', 'continue', 'create', 'def', 'default', 'delete', 'do', 'double',
  'drop', 'echo', 'elif', 'else', 'elseif', 'end', 'endforeach', 'endif', 'enum', 'except',
  'export', 'extends', 'false', 'final', 'finally', 'float', 'fn', 'for', 'foreach', 'from',
  'fun', 'function', 'global', 'goto', 'group', 'having', 'if', 'implements', 'import', 'in',
  'include', 'include_once', 'insert', 'instanceof', 'int', 'interface', 'into', 'is', 'join',
  'lambda', 'let', 'limit', 'long', 'match', 'namespace', 'native', 'new', 'nil', 'nonlocal',
  'not', 'null', 'or', 'order', 'package', 'pass', 'private', 'protected', 'public', 'raise',
  'readonly', 'require', 'require_once', 'return', 'select', 'self', 'set', 'short', 'sizeof',
  'static', 'struct', 'super', 'switch', 'synchronized', 'table', 'then', 'this', 'throw',
  'throws', 'trait', 'true', 'try', 'type', 'typedef', 'typeof', 'union', 'unsigned', 'update',
  'use', 'using', 'val', 'values', 'var', 'virtual', 'void', 'volatile', 'where', 'while',
  'with', 'yield', 'TRUE', 'FALSE', 'NULL', 'None', 'True', 'False', 'SELECT', 'FROM', 'WHERE',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'JOIN', 'LEFT',
  'RIGHT', 'INNER', 'ORDER', 'BY', 'GROUP', 'LIMIT', 'HAVING', 'AS', 'ON', 'AND', 'OR', 'NOT',
]);

/**
 * Lightweight syntax highlighter for mobile fenced code blocks (JS/TS, Python, PHP, C/C++, Java, SQL, etc.)
 * that preserves exact literal code characters while coloring tokens cleanly.
 */
function renderHighlightedCode(code: string, isDark: boolean): React.ReactNode[] {
  if (!code) return [];
  const tokenRegex = new RegExp(
    [
      '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|#[^\\n]*|--[^\\n]*)', // 1: comment
      '("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)', // 2: string
      '(<\\?php|<\\?=|\\?>)', // 3: php tag
      '(\\$[a-zA-Z_][a-zA-Z0-9_]*)', // 4: php/shell variable
      '\\b(\\d+(?:\\.\\d+)?)\\b', // 5: number
      '\\b([a-zA-Z_][a-zA-Z0-9_]*)\\b(?=\\s*\\()', // 6: function call
      '\\b([a-zA-Z_][a-zA-Z0-9_]*)\\b', // 7: identifier / keyword
    ].join('|'),
    'g'
  );

  const palette = isDark
    ? {
        default: '#f4f4f5',
        comment: '#71717a',
        string: '#86efac',
        keyword: '#93c5fd',
        variable: '#f9a8d4',
        number: '#fcd34d',
        func: '#c4b5fd',
      }
    : {
        default: '#18181b',
        comment: '#71717a',
        string: '#15803d',
        keyword: '#1d4ed8',
        variable: '#be185d',
        number: '#b45309',
        func: '#6d28d9',
      };

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIdx = 0;

  while ((match = tokenRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Text key={`c-plain-${tokenIdx++}`} style={{ color: palette.default }}>
          {code.slice(lastIndex, match.index)}
        </Text>
      );
    }

    const full = match[0];
    let tokenColor = palette.default;
    let tokenWeight: '400' | '600' = '400';

    if (match[1]) {
      tokenColor = palette.comment;
    } else if (match[2]) {
      tokenColor = palette.string;
    } else if (match[3]) {
      tokenColor = palette.keyword;
      tokenWeight = '600';
    } else if (match[4]) {
      tokenColor = palette.variable;
    } else if (match[5]) {
      tokenColor = palette.number;
    } else if (match[6]) {
      tokenColor = CODE_KEYWORDS.has(match[6]) ? palette.keyword : palette.func;
      if (CODE_KEYWORDS.has(match[6])) tokenWeight = '600';
    } else if (match[7]) {
      if (CODE_KEYWORDS.has(match[7])) {
        tokenColor = palette.keyword;
        tokenWeight = '600';
      }
    }

    nodes.push(
      <Text
        key={`c-tok-${tokenIdx++}`}
        style={{
          color: tokenColor,
          fontWeight: tokenWeight,
        }}
      >
        {full}
      </Text>
    );

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < code.length) {
    nodes.push(
      <Text key={`c-tail-${tokenIdx}`} style={{ color: palette.default }}>
        {code.slice(lastIndex)}
      </Text>
    );
  }

  return nodes;
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

  // Split with capturing group to keep matched tokens in parts array
  const parts = text.split(
    /(`[^`]+`|\\\([\s\S]+?\\\)|\$(?!\s)[^$\n]+?(?<!\s)\$|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|(?<![a-zA-Z0-9])_[^_\n]+_(?![a-zA-Z0-9])|<u>.*?<\/u>|~~[^~]+~~|\[[^\]]+\]\((?:https?:\/\/|\/)[^\s\)]+\)|https?:\/\/[^\s<)]+)/g
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

      // 2. Inline math: \(...\) or $...$
      if (
        (part.startsWith('\\(') && part.endsWith('\\)') && part.length >= 4) ||
        (part.startsWith('$') && part.endsWith('$') && !part.startsWith('$$') && part.length >= 3)
      ) {
        return (
          <Text
            key={key}
            style={[
              styles.inlineMath,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                color: textColor,
              },
            ]}
          >
            {formatMathExpression(part)}
          </Text>
        );
      }

      // 3. Bold + Italic: ***text***
      if (part.startsWith('***') && part.endsWith('***') && part.length >= 6) {
        return (
          <Text
            key={key}
            style={{ fontWeight: '700', fontStyle: 'italic', color: textColor }}
            onPress={onPressText}
          >
            {part.slice(3, -3)}
          </Text>
        );
      }

      // 4. Bold: **text** or __text__
      if (
        (part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
        (part.startsWith('__') && part.endsWith('__') && part.length >= 4)
      ) {
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

      // 5. Italic: *text* or _text_
      if (
        (part.startsWith('*') && part.endsWith('*') && part.length >= 2) ||
        (part.startsWith('_') && part.endsWith('_') && part.length >= 2)
      ) {
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

      // 6. Underline: <u>text</u>
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

      // 7. Strikethrough: ~~text~~
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

      // 8. Link: [title](url) — external https:// or internal /route
      if (part.startsWith('[') && part.includes('](')) {
        const linkMatch = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s\)]+)\)$/);
        if (linkMatch) {
          const [, title, url] = linkMatch;
          return (
            <Text
              key={key}
              style={[styles.link, { color: textColor }]}
              onPress={() => {
                if (url.startsWith('/') && onPressInternalLink) {
                  onPressInternalLink(url);
                  return;
                }
                Linking.openURL(url).catch(() => {});
              }}
            >
              {title}
            </Text>
          );
        }
      }

      // 9. Direct URL: https://...
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

      // 10. Plain text segment
      return (
        <Text key={key} style={{ color: textColor }} onPress={onPressText}>
          {part}
        </Text>
      );
    })
    .filter(Boolean);
}

function PostMarkdownInternal({
  content,
  streaming = false,
  isExpanded = true,
  onToggleExpand,
  maxPreviewLength,
  onPressText,
  onPressInternalLink,
  style,
}: PostMarkdownProps) {
  const { colors, isDark } = useTheme();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!content || typeof content !== 'string' || !content.trim()) return null;

  const isTruncated = Boolean(
    maxPreviewLength &&
    !isExpanded &&
    content.length > maxPreviewLength
  );

  const rawDisplayContent = isTruncated
    ? content.slice(0, maxPreviewLength).trim()
    : content;

  // Always stabilize incomplete code fences / math blocks during streaming or when an unclosed fence exists
  const hasUnclosedFence = ((rawDisplayContent.match(/```/g) || []).length % 2) === 1;
  const displayContent = (streaming || hasUnclosedFence)
    ? stabilizeStreamingMarkdown(rawDisplayContent)
    : rawDisplayContent;

  // 1. Extract fenced code blocks first
  const codeBlocks: CodeBlock[] = [];
  const normalized = displayContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const textWithoutCode = normalized.replace(
    /```([a-zA-Z0-9_+#-]*)[ \t]*\n?([\s\S]*?)```/g,
    (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({
        lang: (lang || 'CODE').trim().toUpperCase(),
        code: (code || '').replace(/\n+$/, ''),
      });
      return `\n\x01CODE_BLOCK_${idx}\x02\n`;
    }
  );

  // 2. Extract multiline / display math blocks ($$...$$ and \[...\])
  const mathBlocks: string[] = [];
  const textWithoutCodeAndMath = textWithoutCode
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
      const idx = mathBlocks.length;
      mathBlocks.push(expr || '');
      return `\n\x01MATH_BLOCK_${idx}\x02\n`;
    })
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expr) => {
      const idx = mathBlocks.length;
      mathBlocks.push(expr || '');
      return `\n\x01MATH_BLOCK_${idx}\x02\n`;
    });

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
          {renderInlineTokens(
            fullPara,
            key,
            colors.text,
            isDark,
            colors.border,
            onPressText,
            onPressInternalLink
          )}
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
                accessibilityLabel="Copy code"
              >
                <Text style={[styles.copyBtnText, { color: colors.text }]}>
                  {isCopied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              nestedScrollEnabled={true}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ padding: 12 }}
            >
              <Text
                style={[
                  styles.codeText,
                  {
                    color: isDark ? '#f4f4f5' : '#18181b',
                  },
                ]}
              >
                {renderHighlightedCode(block.code, isDark)}
              </Text>
            </ScrollView>
          </View>
        );
      }
      continue;
    }

    // 1b. Display Math Block placeholder
    const mathMatch = trimmed.match(/^\x01MATH_BLOCK_(\d+)\x02$/);
    if (mathMatch) {
      flushParagraph(`p-before-math-${i}`);
      const mathIndex = Number(mathMatch[1]);
      const rawExpr = mathBlocks[mathIndex] || '';
      const formattedMath = formatMathExpression(rawExpr);
      renderedElements.push(
        <View
          key={`math-block-${i}`}
          style={[
            styles.mathBlockContainer,
            {
              backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
              borderColor: colors.border,
            },
          ]}
        >
          <ScrollView
            horizontal
            nestedScrollEnabled={true}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mathBlockScrollContent}
          >
            <Text style={[styles.mathBlockText, { color: colors.text }]}>
              {formattedMath}
            </Text>
          </ScrollView>
        </View>
      );
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
                      {renderInlineTokens(
                        cellText,
                        `th-${i}-${colIdx}`,
                        colors.text,
                        isDark,
                        colors.border,
                        onPressText,
                        onPressInternalLink
                      )}
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
                        {renderInlineTokens(
                          rowCells[colIdx] || '',
                          `td-${i}-${rIdx}-${colIdx}`,
                          colors.text,
                          isDark,
                          colors.border,
                          onPressText,
                          onPressInternalLink
                        )}
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

    // 4. Headings: #, ##, ###, ####
    const hMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (hMatch) {
      flushParagraph(`p-before-h-${i}`);
      const level = hMatch[1].length;
      const headingStyle =
        level === 1
          ? styles.h1
          : level === 2
          ? styles.h2
          : level === 3
          ? styles.h3
          : styles.h4;
      renderedElements.push(
        <Text key={`h-${i}`} style={[headingStyle, { color: colors.text }]} onPress={onPressText}>
          {renderInlineTokens(
            hMatch[2],
            `h-${i}`,
            colors.text,
            isDark,
            colors.border,
            onPressText,
            onPressInternalLink
          )}
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
            {renderInlineTokens(
              qMatch[1],
              `q-${i}`,
              colors.textSecondary,
              isDark,
              colors.border,
              onPressText,
              onPressInternalLink
            )}
          </Text>
        </View>
      );
      continue;
    }

    // 6. List items (including nested lists via leading spaces): - or * or + or 1.
    const listMatch = line.match(/^(\s*)([\*\-\+]|(\d+\.))\s+(.*)$/);
    if (listMatch) {
      flushParagraph(`p-before-li-${i}`);
      const indentSpaces = (listMatch[1] || '').replace(/\t/g, '  ').length;
      const depth = Math.min(Math.floor(indentSpaces / 2), 4);
      const isOrdered = listMatch[2].includes('.');
      const unorderedGlyphs = ['•', '◦', '▪', '▫'];
      const bullet = isOrdered ? listMatch[2] : unorderedGlyphs[depth % unorderedGlyphs.length];
      renderedElements.push(
        <View
          key={`li-${i}`}
          style={[
            styles.listItemRow,
            { paddingLeft: 4 + depth * 14 },
          ]}
        >
          <Text style={[styles.listBullet, { color: colors.textSecondary }]}>{bullet}</Text>
          <Text style={[styles.listContent, { color: colors.text }]} onPress={onPressText}>
            {renderInlineTokens(
              listMatch[4],
              `li-${i}`,
              colors.text,
              isDark,
              colors.border,
              onPressText,
              onPressInternalLink
            )}
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
    fontSize: 14.5,
    lineHeight: 22.5,
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
  h4: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 3,
  },
  inlineCode: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12.5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  inlineMath: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  link: {
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  codeBlockContainer: {
    marginVertical: 8,
    borderRadius: 10,
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
    lineHeight: 19,
  },
  mathBlockContainer: {
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  mathBlockScrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mathBlockText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 13.5,
    lineHeight: 20,
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
    minWidth: 96,
  },
  tableHeaderText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  tableCellText: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  blockquote: {
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginVertical: 6,
    borderRadius: 2,
  },
  blockquoteText: {
    fontSize: 13.5,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  listItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 2.5,
    paddingLeft: 4,
  },
  listBullet: {
    width: 22,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  listContent: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 21.5,
  },
  divider: {
    height: 1,
    marginVertical: 10,
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
