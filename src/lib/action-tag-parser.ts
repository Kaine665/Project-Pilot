/**
 * Action tag parser — extracts action tags from AI response text for UI rendering.
 *
 * This is a **client-safe** module (no fs/node imports).
 * Used by FormattedText to detect action tags and render them as ActionCard components.
 */

// ── Action tag types ──

export type ActionTagType =
  | 'save-doc'
  | 'save-checkpoint'
  | 'await-sub-agents'
  | 'session-title';

export interface ParsedActionTag {
  /** Which action type */
  type: ActionTagType;
  /** Full matched text (including <tag>...</tag>) */
  raw: string;
  /** Start index in the source text */
  start: number;
  /** End index in the source text */
  end: number;
  /** Parsed attributes */
  attrs: Record<string, string>;
  /** Body content (between open and close tag), empty for self-closing */
  body: string;
  /** Human-readable title for the card */
  title: string;
  /** Human-readable subtitle/description */
  subtitle: string;
  /** Whether this tag has substantial body content worth previewing */
  hasPreviewContent: boolean;
}

// ── Tag definitions ──

interface TagDef {
  type: ActionTagType;
  /** Regex to match this tag. Must have named groups or capture groups. */
  regex: RegExp;
  /** Extract ParsedActionTag from a match */
  extract: (match: RegExpExecArray, start: number) => ParsedActionTag;
}

const TAG_DEFS: TagDef[] = [
  {
    type: 'save-doc',
    regex: /<save-doc\s+project="([^"]+)"\s+title="([^"]+)"\s+description="([^"]+)">([\s\S]*?)<\/save-doc>/g,
    extract: (m, start) => ({
      type: 'save-doc',
      raw: m[0],
      start,
      end: start + m[0].length,
      attrs: { project: m[1], title: m[2], description: m[3] },
      body: m[4]?.trim() ?? '',
      title: m[2],
      subtitle: m[3],
      hasPreviewContent: true,
    }),
  },
  {
    type: 'save-checkpoint',
    regex: /<save-checkpoint>([\s\S]*?)<\/save-checkpoint>/g,
    extract: (m, start) => {
      const body = m[1]?.trim() ?? '';
      // Extract first heading content as title
      const titleMatch = body.match(/^## (.+)/m);
      return {
        type: 'save-checkpoint',
        raw: m[0],
        start,
        end: start + m[0].length,
        attrs: {},
        body,
        title: '会话检查点',
        subtitle: titleMatch?.[1]?.trim() ?? '保存工作进度',
        hasPreviewContent: true,
      };
    },
  },
  {
    type: 'await-sub-agents',
    // Self-closing form
    regex: /<await-sub-agents\s+session-ids="([^"]+)"\s*(?:\/>|>([\s\S]*?)<\/await-sub-agents>)/g,
    extract: (m, start) => ({
      type: 'await-sub-agents',
      raw: m[0],
      start,
      end: start + m[0].length,
      attrs: { sessionIds: m[1] },
      body: m[2]?.trim() ?? '',
      title: '等待子任务',
      subtitle: `等待 ${m[1].split(',').length} 个子 Agent`,
      hasPreviewContent: false,
    }),
  },
  {
    type: 'session-title',
    regex: /<session-title>([\s\S]*?)<\/session-title>/g,
    extract: (m, start) => ({
      type: 'session-title',
      raw: m[0],
      start,
      end: start + m[0].length,
      attrs: {},
      body: m[1]?.trim() ?? '',
      title: m[1]?.trim() ?? '',
      subtitle: '',
      hasPreviewContent: false,
    }),
  },
];

// ── Streaming detection: find unclosed opening tags ──

interface StreamingTag {
  type: ActionTagType;
  /** The partial opening tag text found */
  raw: string;
  start: number;
}

/**
 * Detect unclosed (still streaming) action tags.
 * Returns at most one — the last unclosed opening tag.
 */
export function detectStreamingTag(text: string): StreamingTag | null {
  // Match opening tags that are NOT closed
  const openingPatterns: Array<{ type: ActionTagType; regex: RegExp }> = [
    { type: 'save-doc', regex: /<save-doc\s+project="[^"]*"\s+title="[^"]*"\s+description="[^"]*">(?![\s\S]*<\/save-doc>)/g },
    { type: 'save-checkpoint', regex: /<save-checkpoint>(?![\s\S]*<\/save-checkpoint>)/g },
    { type: 'await-sub-agents', regex: /<await-sub-agents\s+session-ids="[^"]*"\s*>(?![\s\S]*<\/await-sub-agents>)/g },
  ];

  let lastMatch: StreamingTag | null = null;

  for (const { type, regex } of openingPatterns) {
    let m;
    while ((m = regex.exec(text)) !== null) {
      lastMatch = { type, raw: m[0], start: m.index };
    }
  }

  return lastMatch;
}

// ── Main parse function ──

export interface TextSegment {
  type: 'text';
  content: string;
}

export interface ActionSegment {
  type: 'action';
  tag: ParsedActionTag;
}

export interface StreamingActionSegment {
  type: 'streaming-action';
  tagType: ActionTagType;
  /** Text before the unclosed tag body (the partial content) */
  partialBody: string;
}

export type FormattedSegment = TextSegment | ActionSegment | StreamingActionSegment;

/**
 * Parse text into segments: plain text interspersed with action tags.
 * Session-title tags are silently stripped (no card shown).
 *
 * @param text - The raw AI response text
 * @param isStreaming - Whether the text is still being streamed
 */
export function parseActionTags(text: string, isStreaming = false): FormattedSegment[] {
  // First, collect all completed action tags with their positions
  const allTags: ParsedActionTag[] = [];

  for (const def of TAG_DEFS) {
    const regex = new RegExp(def.regex.source, def.regex.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      allTags.push(def.extract(match, match.index));
    }
  }

  // Sort by start position
  allTags.sort((a, b) => a.start - b.start);

  // Check for streaming (unclosed) tag
  const streamingTag = isStreaming ? detectStreamingTag(text) : null;

  // Build segments
  const segments: FormattedSegment[] = [];
  let cursor = 0;

  for (const tag of allTags) {
    // Add text before this tag
    if (tag.start > cursor) {
      const before = text.slice(cursor, tag.start).trim();
      if (before) {
        segments.push({ type: 'text', content: before });
      }
    }

    // session-title is silently stripped — don't create a card
    if (tag.type !== 'session-title') {
      segments.push({ type: 'action', tag });
    }

    cursor = tag.end;
  }

  // Handle remaining text after last completed tag
  if (streamingTag && streamingTag.start >= cursor) {
    // Text between last completed tag and the streaming tag opening
    const beforeStreaming = text.slice(cursor, streamingTag.start).trim();
    if (beforeStreaming) {
      segments.push({ type: 'text', content: beforeStreaming });
    }

    // The partial body content after the opening tag
    const partialBody = text.slice(streamingTag.start + streamingTag.raw.length).trim();
    segments.push({
      type: 'streaming-action',
      tagType: streamingTag.type,
      partialBody,
    });
  } else {
    // Remaining text
    const remaining = text.slice(cursor).trim();
    if (remaining) {
      segments.push({ type: 'text', content: remaining });
    }
  }

  return segments;
}

/**
 * Check if text contains any action tags (quick check, no full parse).
 */
export function hasActionTags(text: string): boolean {
  return TAG_DEFS.some((def) => {
    const regex = new RegExp(def.regex.source, def.regex.flags);
    return regex.test(text);
  });
}

// ── Color config per action type ──

export interface ActionColorConfig {
  /** Tailwind border-left color */
  border: string;
  /** Tailwind bg color for the card */
  bg: string;
  /** Tailwind bg color for hover */
  bgHover: string;
  /** Icon text color */
  iconColor: string;
  /** Badge text color */
  badgeText: string;
  /** Badge bg color */
  badgeBg: string;
  /** Label for the action type */
  label: string;
  /** Label for accepted state */
  acceptedLabel: string;
}

export const ACTION_COLORS: Record<ActionTagType, ActionColorConfig> = {
  'save-doc': {
    border: 'border-l-blue-500',
    bg: 'bg-blue-50/80 dark:bg-blue-950/20',
    bgHover: 'hover:bg-blue-50 dark:hover:bg-blue-950/30',
    iconColor: 'text-blue-500',
    badgeText: 'text-blue-600 dark:text-blue-400',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/30',
    label: '设计文档',
    acceptedLabel: '已保存',
  },
  'save-checkpoint': {
    border: 'border-l-purple-500',
    bg: 'bg-purple-50/80 dark:bg-purple-950/20',
    bgHover: 'hover:bg-purple-50 dark:hover:bg-purple-950/30',
    iconColor: 'text-purple-500',
    badgeText: 'text-purple-600 dark:text-purple-400',
    badgeBg: 'bg-purple-100 dark:bg-purple-900/30',
    label: '检查点',
    acceptedLabel: '已保存',
  },
  'await-sub-agents': {
    border: 'border-l-indigo-500',
    bg: 'bg-indigo-50/80 dark:bg-indigo-950/20',
    bgHover: 'hover:bg-indigo-50 dark:hover:bg-indigo-950/30',
    iconColor: 'text-indigo-500',
    badgeText: 'text-indigo-600 dark:text-indigo-400',
    badgeBg: 'bg-indigo-100 dark:bg-indigo-900/30',
    label: '等待子任务',
    acceptedLabel: '等待中',
  },
  'session-title': {
    border: 'border-l-zinc-300',
    bg: 'bg-zinc-50 dark:bg-zinc-900',
    bgHover: '',
    iconColor: 'text-zinc-400',
    badgeText: 'text-zinc-500',
    badgeBg: 'bg-zinc-100 dark:bg-zinc-800',
    label: '会话标题',
    acceptedLabel: '',
  },
};
