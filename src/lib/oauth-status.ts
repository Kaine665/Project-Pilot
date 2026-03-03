const ANSI_REGEX = /\x1B\[[0-9;]*m/g;

const NEGATIVE_PATTERNS = [
  /\bnot\s+logged\s+in\b/i,
  /\bnot\s+authenticated\b/i,
  /\blogged\s*out\b/i,
  /\bunauthenticated\b/i,
  /\bsign\s*in\s+required\b/i,
  /\brequires?\s+login\b/i,
];

const POSITIVE_PATTERNS = [
  /\blogged\s+in\b/i,
  /\bauthenticated\b/i,
];

export function sanitizeAuthText(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

export function parseAuthStatusText(raw: string): boolean {
  const text = sanitizeAuthText(raw).trim();
  if (!text) return false;

  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) return false;
  }

  for (const pattern of POSITIVE_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  return false;
}

