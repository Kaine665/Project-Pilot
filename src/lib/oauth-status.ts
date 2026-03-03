const ANSI_REGEX = /\x1B\[[0-9;]*m/g;

const NEGATIVE_PATTERNS = [
  /\bnot\s+logged\s+in\b/i,
  /\bnot\s+authenticated\b/i,
  /\blogged\s*out\b/i,
  /\bunauthenticated\b/i,
  /\bsign\s*in\s+required\b/i,
  /\bauthentication\s+required\b/i,
  /\brequires?\s+login\b/i,
  /\bauthenticated\s*[:=]\s*false\b/i,
  /\blogged[_\s-]*in\s*[:=]\s*false\b/i,
];

const POSITIVE_PATTERNS = [
  /\blogged\s+in\s+using\b/i,
  /\blogged\s+in\b/i,
  /\bauthenticated\s*[:=]\s*true\b/i,
  /\blogged[_\s-]*in\s*[:=]\s*true\b/i,
];

export type AuthState = 'authenticated' | 'not_authenticated' | 'unknown';

export function sanitizeAuthText(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

function getObjectBoolean(
  obj: Record<string, unknown>,
  key: 'authenticated' | 'loggedIn',
): boolean | null {
  const value = obj[key];
  return typeof value === 'boolean' ? value : null;
}

function parseJsonAuthState(text: string): AuthState {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return 'unknown';
    const obj = parsed as Record<string, unknown>;

    const authenticated = getObjectBoolean(obj, 'authenticated');
    if (authenticated !== null) {
      return authenticated ? 'authenticated' : 'not_authenticated';
    }

    const loggedIn = getObjectBoolean(obj, 'loggedIn');
    if (loggedIn !== null) {
      return loggedIn ? 'authenticated' : 'not_authenticated';
    }
  } catch {
    // ignore json parsing errors
  }

  return 'unknown';
}

export function parseAuthState(raw: string): AuthState {
  const text = sanitizeAuthText(raw).trim();
  if (!text) return 'unknown';

  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) return 'not_authenticated';
  }

  for (const pattern of POSITIVE_PATTERNS) {
    if (pattern.test(text)) return 'authenticated';
  }

  return parseJsonAuthState(text);
}

export function parseAuthStatusText(raw: string): boolean {
  return parseAuthState(raw) === 'authenticated';
}

