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

export interface ParsedAttendanceSubject {
  name: string;
  code: string;
  pct: number;
  isLow: boolean;
  classes: number;
  present: number;
  absent: number;
}

export interface ParsedUnrecordedSubject {
  name: string;
  code: string;
}

export interface ParsedAttendanceData {
  hasOverview: boolean;
  hasRecords: boolean;
  semester: number | null;
  overallPct: number | null;
  isLow: boolean;
  attendedLabel: string;
  present: number;
  absent: number;
  totalClasses: number;
  recordedSubjects: number;
  totalSubjects: number;
  recordedItems: ParsedAttendanceSubject[];
  unrecordedItems: ParsedUnrecordedSubject[];
}

/**
 * Parses a structured ```attendance block (including partial streaming blocks)
 * into overview metrics, recorded subject horizontal bar chart items, and unrecorded subjects.
 */
export function parseAttendanceBlock(rawBlock: string): ParsedAttendanceData {
  const lines = String(rawBlock || '').replace(/\r\n/g, '\n').split('\n');
  const data: ParsedAttendanceData = {
    hasOverview: false,
    hasRecords: false,
    semester: null,
    overallPct: null,
    isLow: false,
    attendedLabel: '0 / 0',
    present: 0,
    absent: 0,
    totalClasses: 0,
    recordedSubjects: 0,
    totalSubjects: 0,
    recordedItems: [],
    unrecordedItems: [],
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^Overview:/i.test(line)) {
      data.hasOverview = true;
      const parts = line
        .replace(/^Overview:\s*/i, '')
        .split('|')
        .map((p) => p.trim());
      const first = parts[0] || '';
      if (/No records/i.test(first)) {
        data.hasRecords = false;
        data.overallPct = null;
        data.isLow = false;
      } else {
        const pctMatch = first.match(/(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          data.hasRecords = true;
          data.overallPct = Number(pctMatch[1]);
          data.isLow = data.overallPct < 50 || /Low Attendance/i.test(first);
        }
      }
      for (const part of parts.slice(1)) {
        const attMatch = part.match(/^(\d+)\s*\/\s*(\d+)\s+classes/i);
        if (attMatch) {
          data.present = Number(attMatch[1]);
          data.totalClasses = Number(attMatch[2]);
          data.attendedLabel = `${attMatch[1]} / ${attMatch[2]}`;
          continue;
        }
        const presMatch = part.match(/^Present:\s*(\d+)/i);
        if (presMatch) {
          data.present = Number(presMatch[1]);
          continue;
        }
        const absMatch = part.match(/^Absent:\s*(\d+)/i);
        if (absMatch) {
          data.absent = Number(absMatch[1]);
          continue;
        }
        const subjMatch = part.match(/^(\d+)\s+of\s+(\d+)\s+subjects/i);
        if (subjMatch) {
          data.recordedSubjects = Number(subjMatch[1]);
          data.totalSubjects = Number(subjMatch[2]);
          continue;
        }
        const semMatch = part.match(/^Semester\s+(\d+)/i);
        if (semMatch) {
          data.semester = Number(semMatch[1]);
        }
      }
      continue;
    }

    const itemMatch = line.match(/^[-•*]\s+\*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?:\s*(.+)$/);
    if (itemMatch) {
      const name = itemMatch[1].trim();
      const code = (itemMatch[2] || '').trim();
      const rest = itemMatch[3].trim();
      if (/\*\*No records\*\*|^No records$/i.test(rest)) {
        data.unrecordedItems.push({ name, code });
      } else {
        const pctMatch = rest.match(/\*\*(\d+(?:\.\d+)?)%\*\*|(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          const pct = Number(pctMatch[1] ?? pctMatch[2]);
          const isLow = pct < 50 || /Low Attendance/i.test(rest);
          const classesMatch =
            rest.match(/(\d+)\s+recorded\s+class/i) ||
            rest.match(/out\s+of\s+(\d+)\s+class/i);
          const presMatch =
            rest.match(/Present:\s*(\d+)/i) || rest.match(/(\d+)\s+present/i);
          const absMatch =
            rest.match(/Absent:\s*(\d+)/i) ||
            rest.match(/(\d+)\s+(?:missed\/)?absent/i);
          const present = presMatch ? Number(presMatch[1]) : 0;
          const absent = absMatch ? Number(absMatch[1]) : 0;
          const classes = classesMatch ? Number(classesMatch[1]) : present + absent;
          data.recordedItems.push({
            name,
            code,
            pct,
            isLow,
            classes,
            present,
            absent,
          });
        }
      }
    }
  }

  if (!data.hasOverview && (data.recordedItems.length > 0 || data.unrecordedItems.length > 0)) {
    const totalPres = data.recordedItems.reduce((acc, r) => acc + r.present, 0);
    const totalAbs = data.recordedItems.reduce((acc, r) => acc + r.absent, 0);
    const totalCls = data.recordedItems.reduce((acc, r) => acc + r.classes, 0);
    data.present = totalPres;
    data.absent = totalAbs;
    data.totalClasses = totalCls;
    data.attendedLabel = `${totalPres} / ${totalCls}`;
    data.recordedSubjects = data.recordedItems.length;
    data.totalSubjects = data.recordedItems.length + data.unrecordedItems.length;
    if (totalCls > 0) {
      data.hasRecords = true;
      data.overallPct = Math.round((totalPres / totalCls) * 10000) / 100;
      data.isLow = data.overallPct < 50;
    }
  }

  return data;
}

/**
 * Stabilizes incomplete Markdown tokens during live streaming so mobile bubbles
 * never flicker or render raw unclosed fences/delimiters mid-stream.
 */
export function stabilizeStreamingMarkdown(rawMarkdown: string): string {
  if (!rawMarkdown) return '';
  let text = String(rawMarkdown).replace(/\r\n/g, '\n');

  // 1. Check for unclosed fenced code block (``` or ~~~), respecting fence length for nested fences
  const lines = text.split('\n');
  let openFence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!openFence) {
      const openMatch = trimmed.match(/^(`{3,}|~{3,})([\w+#.-]*)[ \t]*$/);
      if (openMatch) {
        openFence = openMatch[1];
      }
    } else {
      const closeRe = new RegExp(`^${openFence[0]}{${openFence.length},}[ \\t]*$`);
      if (closeRe.test(trimmed)) {
        openFence = null;
      }
    }
  }
  if (openFence) {
    return `${text}\n${openFence}`;
  }

  // Mask closed code blocks before checking math or inline delimiters
  const codeHolders: string[] = [];
  let masked = text.replace(
    /(^|\n)(`{3,}|~{3,})([\w+#.-]*)[ \t]*\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g,
    (match, prefix) => {
      const idx = codeHolders.length;
      codeHolders.push(match);
      return `${prefix || ''}___MOBILE_CODE_MASK_${idx}___`;
    }
  );

  // 2. Check for unclosed display math block ($$ or \[) outside code blocks
  const doubleDollarMatches = masked.match(/\$\$/g);
  if (doubleDollarMatches && doubleDollarMatches.length % 2 === 1) {
    masked = `${masked}\n$$`;
  }
  const openBracketMath = (masked.match(/\\\[/g) || []).length;
  const closeBracketMath = (masked.match(/\\\]/g) || []).length;
  if (openBracketMath > closeBracketMath) {
    masked = `${masked}\n\\]`;
  }
  const openParenMath = (masked.match(/\\\(/g) || []).length;
  const closeParenMath = (masked.match(/\\\)/g) || []).length;
  if (openParenMath > closeParenMath) {
    masked = `${masked}\\)`;
  }

  // 3. Stabilize trailing partial table delimiter line
  const maskedLines = masked.split('\n');
  if (maskedLines.length >= 2) {
    const lastLine = maskedLines[maskedLines.length - 1];
    const prevLine = maskedLines[maskedLines.length - 2];
    if (prevLine.includes('|') && /^\s*\|?[\s|:-]*$/.test(lastLine) && lastLine.includes('|')) {
      const colCount = prevLine.trim().replace(/^\||\|$/g, '').split('|').length;
      if (colCount >= 2 && !/^\s*\|?(\s*:?-{1,}:?\s*\|)+\s*:?-{1,}:?\s*\|?\s*$/.test(lastLine)) {
        maskedLines[maskedLines.length - 1] = `| ${Array(colCount).fill('---').join(' | ')} |`;
        masked = maskedLines.join('\n');
      }
    }
  }

  // 4. Close unclosed inline formatting on the final active line
  const finalLines = masked.split('\n');
  let lastLine = finalLines[finalLines.length - 1];
  if (!/___MOBILE_CODE_MASK_\d+___/.test(lastLine)) {
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
  }

  let restored = finalLines.join('\n');
  for (let i = 0; i < codeHolders.length; i++) {
    restored = restored.split(`___MOBILE_CODE_MASK_${i}___`).join(codeHolders[i]);
  }
  return restored;
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
 * for native mobile rendering, evaluating inner braced commands before outer fractions.
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

  // Format matrix environments (\begin{pmatrix}, \begin{bmatrix}, \begin{matrix}) with [ row ] brackets
  out = out.replace(
    /\\begin\{(?:p|b|v|V)?matrix\}([\s\S]*?)\\end\{(?:p|b|v|V)?matrix\}/g,
    (_, body) => {
      const rows = String(body)
        .trim()
        .split(/\\\\/)
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => `[ ${r.split('&').map((c) => c.trim()).join('  ')} ]`);
      return rows.join('\n');
    }
  );

  // Remove other alignment environments
  out = out
    .replace(/\\begin\{[^}]+\}/g, '')
    .replace(/\\end\{[^}]+\}/g, '')
    .replace(/\\\\/g, '\n')
    .replace(/&=/g, '=')
    .replace(/&/g, ' ');

  // Replace Greek & math operators first so inner braces have clean symbols
  for (const [cmd, sym] of Object.entries(GREEK_AND_MATH_SYMBOLS)) {
    const escaped = cmd.replace(/\\/g, '\\\\');
    out = out.replace(new RegExp(`${escaped}(?![a-zA-Z])`, 'g'), sym);
  }

  // Inside-out resolution loop for \text{...}, ^{...}, _{...}, \sqrt{...}, and \frac{...}{...}
  for (let pass = 0; pass < 5; pass++) {
    out = out.replace(/\\(?:text|mathrm|mathbf|mathit)\{([^{}]*)\}/g, '$1');

    out = out.replace(/\^\{([^{}]+)\}/g, (_, exp) => {
      const chars = exp.split('');
      if (chars.every((c: string) => SUPERSCRIPT_MAP[c])) {
        return chars.map((c: string) => SUPERSCRIPT_MAP[c]).join('');
      }
      return `^(${exp})`;
    });

    out = out.replace(/_\{([^{}]+)\}/g, (_, sub) => {
      const chars = sub.split('');
      if (chars.every((c: string) => SUBSCRIPT_MAP[c])) {
        return chars.map((c: string) => SUBSCRIPT_MAP[c]).join('');
      }
      return `_(${sub})`;
    });

    out = out.replace(/\\sqrt\{([^{}]+)\}/g, (_, inner) =>
      inner.trim().length > 1 ? `√(${inner.trim()})` : `√${inner.trim()}`
    );

    out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, num, den) => {
      const cleanNum = num.trim();
      const cleanDen = den.trim();
      const left = cleanNum.length > 2 ? `(${cleanNum})` : cleanNum;
      const right = cleanDen.length > 2 ? `(${cleanDen})` : cleanDen;
      return `${left}/${right}`;
    });
  }

  out = out.replace(/\^([0-9ni+-])/g, (_, ch) => SUPERSCRIPT_MAP[ch] || `^${ch}`);
  out = out.replace(/_([0-9aeijknorstuvx+-])/g, (_, ch) => SUBSCRIPT_MAP[ch] || `_${ch}`);

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
 * Renders the monochromatic Kyana Attendance Overview + Horizontal Subject Bar Chart + Other Subjects
 * component in React Native. Red (#ef4444) is strictly reserved for attendance below 50%.
 */
function renderAttendanceCard(
  rawBlock: string,
  keyPrefix: string,
  colors: any,
  isDark: boolean
): React.ReactNode {
  const data = parseAttendanceBlock(rawBlock);
  if (!data.hasOverview && data.recordedItems.length === 0 && data.unrecordedItems.length === 0) {
    return null;
  }

  const cardBg = isDark ? '#0e0f13' : '#f8f9fa';
  const raisedBg = isDark ? '#181920' : '#ffffff';
  const trackBg = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const normalFill = isDark ? '#8e8e93' : '#3f3f46';
  const lowRed = '#ef4444';
  const pillText = !data.hasRecords
    ? 'No records'
    : data.isLow
    ? 'Low Attendance'
    : 'Recorded data';
  const overallPctDisplay =
    data.hasRecords && data.overallPct !== null ? `${data.overallPct}%` : 'No records';
  const overallBarWidth =
    data.hasRecords && data.overallPct !== null
      ? Math.min(100, Math.max(data.overallPct === 0 ? 2 : 0, data.overallPct))
      : 0;
  const scopeHint =
    data.totalSubjects > 1 &&
    data.recordedSubjects > 0 &&
    data.recordedSubjects < data.totalSubjects
      ? ` · ${data.recordedSubjects} of ${data.totalSubjects} subjects`
      : '';

  return (
    <View
      key={keyPrefix}
      style={[
        styles.attCard,
        {
          backgroundColor: cardBg,
          borderColor: colors.border,
        },
      ]}
      accessibilityLabel="Attendance overview and subject-wise breakdown"
    >
      {/* Header Row */}
      <View style={styles.attHeaderRow}>
        <Text style={[styles.attSectionTitle, { color: colors.text }]}>
          Attendance overview
        </Text>
        <View
          style={[
            styles.attStatusPill,
            {
              backgroundColor:
                data.hasRecords && data.isLow
                  ? 'rgba(239,68,68,0.12)'
                  : raisedBg,
              borderColor:
                data.hasRecords && data.isLow
                  ? 'rgba(239,68,68,0.32)'
                  : colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.attStatusPillText,
              {
                color:
                  data.hasRecords && data.isLow ? lowRed : colors.textSecondary,
              },
            ]}
          >
            {pillText}
          </Text>
        </View>
      </View>

      {/* Hero Stats Row */}
      <View style={styles.attHeroRow}>
        <View style={styles.attHeroLeft}>
          <View style={styles.attHeroPctRow}>
            <Text
              style={[
                styles.attHeroPct,
                !data.hasRecords && styles.attHeroNoRecord,
                {
                  color: !data.hasRecords
                    ? colors.textSecondary
                    : data.isLow
                    ? lowRed
                    : colors.text,
                },
              ]}
            >
              {overallPctDisplay}
            </Text>
            {data.hasRecords && data.isLow && (
              <View style={styles.attLowBadge}>
                <Text style={styles.attLowBadgeText}>Low Attendance</Text>
              </View>
            )}
          </View>
          <Text style={[styles.attHeroSub, { color: colors.textSecondary }]}>
            {`Overall attendance${scopeHint}`}
          </Text>
        </View>

        <View style={styles.attHeroRight}>
          <Text style={[styles.attHeroRatio, { color: colors.text }]}>
            {data.hasRecords ? data.attendedLabel : '0 / 0'}
          </Text>
          <Text style={[styles.attHeroSub, { color: colors.textSecondary }]}>
            Classes attended
          </Text>
        </View>
      </View>

      {/* Overall Progress Bar + Present/Absent Stat Boxes */}
      {data.hasRecords && (
        <>
          <View style={[styles.attBarTrack, { backgroundColor: trackBg }]}>
            <View
              style={[
                styles.attBarFill,
                {
                  width: `${overallBarWidth}%` as any,
                  backgroundColor: data.isLow ? lowRed : normalFill,
                },
              ]}
            />
          </View>

          <View style={styles.attStatGrid}>
            <View
              style={[
                styles.attStatBox,
                { backgroundColor: raisedBg, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.attStatNum, { color: colors.text }]}>
                {data.present}
              </Text>
              <Text style={[styles.attStatLabel, { color: colors.textSecondary }]}>
                Present
              </Text>
            </View>
            <View
              style={[
                styles.attStatBox,
                { backgroundColor: raisedBg, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.attStatNum, { color: colors.text }]}>
                {data.absent}
              </Text>
              <Text style={[styles.attStatLabel, { color: colors.textSecondary }]}>
                Absent
              </Text>
            </View>
          </View>
        </>
      )}

      {/* Subject-wise Horizontal Bar Chart (Recorded Subjects Only) */}
      {data.recordedItems.length > 0 && (
        <>
          <View style={[styles.attDivider, { backgroundColor: colors.border }]} />
          <Text style={[styles.attSubSectionHeading, { color: colors.text }]}>
            Subject-wise attendance
          </Text>
          <View style={styles.attSubjectsList}>
            {data.recordedItems.map((item, idx) => {
              const barW = Math.min(
                100,
                Math.max(item.pct === 0 ? 2 : 0, item.pct)
              );
              const metaLabel = [
                item.code,
                `${item.classes} recorded ${item.classes === 1 ? 'class' : 'classes'}`,
              ]
                .filter(Boolean)
                .join(' · ');

              return (
                <View key={`att-rec-${idx}`} style={styles.attSubjItem}>
                  <View style={styles.attSubjTopRow}>
                    <View style={styles.attSubjInfo}>
                      <Text style={[styles.attSubjName, { color: colors.text }]}>
                        {item.name}
                      </Text>
                      <Text
                        style={[styles.attSubjMeta, { color: colors.textSecondary }]}
                      >
                        {metaLabel}
                      </Text>
                    </View>
                    <View style={styles.attSubjPctCol}>
                      <Text
                        style={[
                          styles.attSubjPct,
                          { color: item.isLow ? lowRed : colors.text },
                        ]}
                      >
                        {`${item.pct}%`}
                      </Text>
                      {item.isLow && (
                        <View style={styles.attLowBadge}>
                          <Text style={styles.attLowBadgeText}>Low Attendance</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View style={[styles.attBarTrack, { backgroundColor: trackBg }]}>
                    <View
                      style={[
                        styles.attBarFill,
                        {
                          width: `${barW}%` as any,
                          backgroundColor: item.isLow ? lowRed : normalFill,
                        },
                      ]}
                    />
                  </View>

                  <View style={styles.attSubjCountsRow}>
                    <Text
                      style={[
                        styles.attSubjCountText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {`Present: ${item.present}`}
                    </Text>
                    <Text
                      style={[
                        styles.attSubjCountText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {`Absent: ${item.absent}`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* Other Subjects (Zero Recorded Classes — Never Plotted as 0% Bars) */}
      {data.unrecordedItems.length > 0 && (
        <>
          <View style={[styles.attDivider, { backgroundColor: colors.border }]} />
          <Text style={[styles.attSubSectionHeading, { color: colors.text }]}>
            {data.recordedItems.length > 0 ? 'Other subjects' : 'Subjects'}
          </Text>
          <View style={styles.attOtherList}>
            {data.unrecordedItems.map((u, idx) => (
              <View key={`att-unrec-${idx}`} style={styles.attOtherRow}>
                <Text style={[styles.attOtherName, { color: colors.text }]}>
                  {u.name}
                </Text>
                <View
                  style={[
                    styles.attNoRecordPill,
                    { backgroundColor: raisedBg, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.attNoRecordPillText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    No records
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
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

  // Split with capturing group to keep matched tokens in parts array (rejecting protocol-relative // links)
  const parts = text.split(
    /(`[^`]+`|\\\([\s\S]+?\\\)|\$(?!\s)[^$\n]+?(?<!\s)\$|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|(?<![a-zA-Z0-9])_[^_\n]+_(?![a-zA-Z0-9])|<u>.*?<\/u>|~~[^~]+~~|\[[^\]]+\]\((?:https?:\/\/|\/(?!\/))[^\s\)]+\)|https?:\/\/[^\s<)]+)/g
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

      // 8. Link: [title](url) — external https:// or internal /route (excluding //)
      if (part.startsWith('[') && part.includes('](')) {
        const linkMatch = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/(?!\/))[^\s\)]+)\)$/);
        if (linkMatch) {
          const [, title, url] = linkMatch;
          return (
            <Text
              key={key}
              style={[styles.link, { color: textColor }]}
              onPress={() => {
                if (url.startsWith('/') && !url.startsWith('//') && onPressInternalLink) {
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

  // 1. Extract fenced code blocks (supporting nested backtick fence lengths)
  const codeBlocks: CodeBlock[] = [];
  const normalized = displayContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const textWithoutCode = normalized.replace(
    /(^|\n)(`{3,}|~{3,})([a-zA-Z0-9_+#-]*)[ \t]*\n?([\s\S]*?)\2[ \t]*(?=\n|$)/g,
    (_, prefix, _fence, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({
        lang: (lang || 'CODE').trim().toUpperCase(),
        code: (code || '').replace(/\n+$/, ''),
      });
      return `${prefix || ''}\n\x01CODE_BLOCK_${idx}\x02\n`;
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

    // 1. Code Block or Attendance Visual Block placeholder
    const codeMatch = trimmed.match(/^\x01CODE_BLOCK_(\d+)\x02$/);
    if (codeMatch) {
      flushParagraph(`p-before-code-${i}`);
      const blockIndex = Number(codeMatch[1]);
      const block = codeBlocks[blockIndex];
      if (block) {
        if (block.lang === 'ATTENDANCE') {
          const attNode = renderAttendanceCard(
            block.code,
            `att-card-${i}`,
            colors,
            isDark
          );
          if (attNode) {
            renderedElements.push(attNode);
            continue;
          }
        }
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
  attCard: {
    marginVertical: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  attHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  attSectionTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  attStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  attStatusPillText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  attHeroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  attHeroLeft: {
    flex: 1,
    marginRight: 12,
  },
  attHeroPctRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  attHeroPct: {
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
  },
  attHeroNoRecord: {
    fontSize: 20,
    lineHeight: 26,
  },
  attHeroRight: {
    alignItems: 'flex-end',
  },
  attHeroRatio: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  attHeroSub: {
    fontSize: 12.5,
    marginTop: 2,
  },
  attLowBadge: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.28)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  attLowBadgeText: {
    color: '#ef4444',
    fontSize: 10.5,
    fontWeight: '600',
  },
  attBarTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    marginVertical: 8,
  },
  attBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  attStatGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  attStatBox: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  attStatNum: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 24,
  },
  attStatLabel: {
    fontSize: 12.5,
    marginTop: 2,
  },
  attDivider: {
    height: 1,
    width: '100%',
    marginVertical: 14,
  },
  attSubSectionHeading: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  attSubjectsList: {
    gap: 14,
  },
  attSubjItem: {
    width: '100%',
  },
  attSubjTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  attSubjInfo: {
    flex: 1,
  },
  attSubjName: {
    fontSize: 14.5,
    fontWeight: '600',
    lineHeight: 20,
  },
  attSubjMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  attSubjPctCol: {
    alignItems: 'flex-end',
    gap: 3,
  },
  attSubjPct: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 21,
  },
  attSubjCountsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 1,
  },
  attSubjCountText: {
    fontSize: 12,
  },
  attOtherList: {
    gap: 10,
  },
  attOtherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  attOtherName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  attNoRecordPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  attNoRecordPillText: {
    fontSize: 11.5,
    fontWeight: '500',
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
