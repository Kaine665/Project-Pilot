import iconv from 'iconv-lite';
import { repairTextIfNeeded } from '@/lib/text-repair';

const CORRUPTION_PATTERNS = [
  /�/g,
  /鈥/g,
  /€/g,
  /闇€/g,
  /閫/g,
  /鐗/g,
  /鍙/g,
  /鍒/g,
  /浣/g,
  /鐨/g,
  /绠/g,
  /璇/g,
  /鏁/g,
  /鍔/g,
  /鎴/g,
  /鍜/g,
  /鍥/g,
  /鏄/g,
  /娌/g,
  /鏂/g,
  /锛/g,
  /銆/g,
];
const COMMON_CJK_CHARS = '的一是在不了有人和这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处理世车'.split('');

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function getReadableScore(value: string): number {
  const corruption = CORRUPTION_PATTERNS.reduce((sum, pattern) => sum + countMatches(value, pattern), 0);
  const cjkCount = countMatches(value, /[\u3400-\u9fff]/g);
  const emojiCount = countMatches(value, /\p{Extended_Pictographic}/gu);
  const commonCharCount = COMMON_CJK_CHARS.reduce((sum, char) => sum + countMatches(value, new RegExp(char, 'g')), 0);
  return commonCharCount * 5 + cjkCount * 2 + emojiCount * 2 - corruption * 6;
}

function repairGbkMojibake(value: string): string {
  return iconv.decode(iconv.encode(value, 'gb18030'), 'utf8');
}

export function repairStoredTextIfNeeded(value?: string): string | undefined {
  if (!value) return value;

  const candidates = [
    value,
    repairTextIfNeeded(value) ?? value,
    repairGbkMojibake(value),
  ];

  let best = value;
  let bestScore = getReadableScore(value);

  for (const candidate of candidates) {
    const score = getReadableScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

export function looksLikeCorruptedStoredText(value?: string): boolean {
  if (!value) return false;
  return repairStoredTextIfNeeded(value) !== value;
}
