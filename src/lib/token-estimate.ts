/**
 * 按字符类型估算 token 数。
 *
 * CJK（中日韩）字符平均约 1.5 chars/token，
 * ASCII/拉丁字符平均约 4 chars/token。
 * 逐字符分类后分别计算，比统一除以 3.5 准确得多。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cjkChars = 0;
  let otherChars = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK Unified Ideographs: U+4E00–U+9FFF
    // CJK Ext A: U+3400–U+4DBF
    // CJK Compatibility: U+F900–U+FAFF
    // Hangul: U+AC00–U+D7AF
    // Katakana: U+30A0–U+30FF
    // Hiragana: U+3040–U+309F
    // Fullwidth punctuation/symbols: U+FF00–U+FFEF
    // CJK Symbols and Punctuation: U+3000–U+303F
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0x30A0 && code <= 0x30FF) ||
      (code >= 0x3040 && code <= 0x309F) ||
      (code >= 0xFF00 && code <= 0xFFEF) ||
      (code >= 0x3000 && code <= 0x303F)
    ) {
      cjkChars++;
    } else {
      otherChars++;
    }
  }

  // CJK: ~1.5 chars/token; ASCII/Latin: ~4 chars/token
  const cjkTokens = cjkChars / 1.5;
  const otherTokens = otherChars / 4;

  return Math.ceil(cjkTokens + otherTokens);
}
