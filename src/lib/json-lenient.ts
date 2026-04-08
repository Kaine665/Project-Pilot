/**
 * 解析可能被代理/中间层污染的 JSON 响应体（如前缀 null、)]}'、或首段合法 JSON 后仍有字符）。
 */

export function parseLenientJson(text: string): unknown {
  let s = text.trim().replace(/^\uFEFF/, '');
  // Google XSSI 前缀
  if (s.startsWith(")]}'")) {
    const nl = s.indexOf('\n');
    s = (nl >= 0 ? s.slice(nl + 1) : '').trim();
  }
  try {
    return JSON.parse(s);
  } catch {
    if (/^\s*</.test(s)) {
      throw new Error(`Expected JSON but got HTML/markup (first 120 chars): ${s.slice(0, 120)}`);
    }
    const i = s.indexOf('{');
    const j = s.indexOf('[');
    const start = i >= 0 && (j < 0 || i < j) ? i : j >= 0 ? j : -1;
    if (start >= 0) {
      return JSON.parse(s.slice(start));
    }
    throw new Error(`Invalid JSON (first 160 chars): ${s.slice(0, 160)}`);
  }
}
