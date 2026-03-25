const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

const MOJIBAKE_PATTERNS = [
  /�/g,
  /Ã./g,
  /Â./g,
  /â./g,
  /å./g,
  /ä./g,
  /æ./g,
  /ç./g,
  /è./g,
  /é./g,
  /ï¼/g,
  /ï½/g,
  /ðŸ/g,
];

function latin1ToUtf8(value: string): string {
  const bytes = Uint8Array.from(Array.from(value), (char) => char.charCodeAt(0) & 0xff);
  return UTF8_DECODER.decode(bytes);
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function getMojibakeScore(value: string): number {
  return MOJIBAKE_PATTERNS.reduce((total, pattern) => total + countMatches(value, pattern), 0);
}

function getReadableScore(value: string): number {
  const mojibakeScore = getMojibakeScore(value);
  const cjkCount = countMatches(value, /[\u3400-\u9fff]/g);
  const emojiCount = countMatches(value, /\p{Extended_Pictographic}/gu);
  const replacementCount = countMatches(value, /�/g);
  return cjkCount * 4 + emojiCount * 2 - mojibakeScore * 5 - replacementCount * 6;
}

export function repairTextIfNeeded(value?: string): string | undefined {
  if (!value) return value;

  const candidates = [value];
  let current = value;
  for (let i = 0; i < 2; i += 1) {
    const next = latin1ToUtf8(current);
    if (!next || next === current) break;
    candidates.push(next);
    current = next;
  }

  let best = value;
  let bestScore = getReadableScore(value);
  for (const candidate of candidates.slice(1)) {
    const score = getReadableScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function looksLikeCorruptedText(value?: string): boolean {
  if (!value) return false;
  return repairTextIfNeeded(value) !== value;
}
