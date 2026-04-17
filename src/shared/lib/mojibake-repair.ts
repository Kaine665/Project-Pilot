import iconv from 'iconv-lite';

const MOJIBAKE_MARKERS = /[鎴浣鍜鐨鍙浠鏄璇鏈缁鍦闂鍔鏂闃寮鍥欏璁銆锛鈥€]/g;
const REPLACEMENT_CHAR = '\uFFFD';

function countMojibakeMarkers(value: string): number {
  return value.match(MOJIBAKE_MARKERS)?.length ?? 0;
}

export function looksLikeGbkUtf8Mojibake(value: string): boolean {
  if (!value) return false;
  return countMojibakeMarkers(value) >= 2;
}

export function repairMojibakeText(value: string): string {
  if (!looksLikeGbkUtf8Mojibake(value)) {
    return value;
  }

  try {
    const repaired = iconv.decode(iconv.encode(value, 'gbk'), 'utf8');

    if (!repaired || repaired.includes(REPLACEMENT_CHAR)) {
      return value;
    }

    if (countMojibakeMarkers(repaired) >= countMojibakeMarkers(value)) {
      return value;
    }

    return repaired;
  } catch {
    return value;
  }
}

export function repairMojibakeDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return repairMojibakeText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => repairMojibakeDeep(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, repairMojibakeDeep(entryValue)]),
  ) as T;
}
