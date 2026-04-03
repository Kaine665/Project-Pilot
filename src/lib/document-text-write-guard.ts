/**
 * 文档型 / 提示词型 UTF-8 文本写入前审查。
 *
 * 在落盘前拦截：替换字符 U+FFFD、未成对代理项、以及 text-repair-server 识别的常见乱码模式，
 * 避免把已损坏的文本写进 global.md、Agent 提示词、文档库、Skill 等。
 *
 * 用法：在写入 Markdown/长说明的正文前调用 assertDocumentTextWritable(content)；
 * HTTP 层捕获 DocumentTextEncodingError 并返回 422。
 */

import { looksLikeCorruptedStoredText } from '@/lib/text-repair-server';

export const DOCUMENT_TEXT_ENCODING_CODE = 'DOCUMENT_TEXT_ENCODING' as const;

export class DocumentTextEncodingError extends Error {
  readonly code = DOCUMENT_TEXT_ENCODING_CODE;

  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = 'DocumentTextEncodingError';
  }
}

export function isDocumentTextEncodingError(e: unknown): e is DocumentTextEncodingError {
  return e instanceof DocumentTextEncodingError;
}

/** 将写入类错误转为 API 响应体（非此类错误返回 null）。 */
export function documentTextWriteErrorResponse(err: unknown): { status: 422; body: Record<string, unknown> } | null {
  if (!isDocumentTextEncodingError(err)) return null;
  return {
    status: 422,
    body: {
      error: err.message,
      code: err.code,
      issues: err.issues,
    },
  };
}

const REPLACEMENT = '\uFFFD';
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu;

/**
 * 审查一段即将以 UTF-8 写入磁盘的说明/文档类文本。
 * 空字符串视为合法（例如清空某块内容）。
 */
export function reviewDocumentTextForWrite(content: string): { ok: true } | { ok: false; issues: string[] } {
  if (content.length === 0) return { ok: true };

  const issues: string[] = [];

  if (content.includes(REPLACEMENT)) {
    issues.push('文本包含 Unicode 替换字符（U+FFFD），通常表示编码在转换过程中已损坏。');
  }

  const surrogateHits = content.match(UNPAIRED_SURROGATE);
  if (surrogateHits && surrogateHits.length > 0) {
    issues.push('文本包含未成对的 UTF-16 代理项，不适合以 UTF-8 安全持久化。');
  }

  if (looksLikeCorruptedStoredText(content)) {
    issues.push(
      '文本疑似乱码或错误解码（例如 UTF-8 与 Latin-1/GBK 混用）。请使用 UTF-8（建议无 BOM）重新粘贴或编辑后再保存。',
    );
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true };
}

export function assertDocumentTextWritable(content: string): void {
  const r = reviewDocumentTextForWrite(content);
  if (!r.ok) {
    throw new DocumentTextEncodingError(r.issues.join(' '), r.issues);
  }
}
