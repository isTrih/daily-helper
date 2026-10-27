export const MAX_TOPIC_KEYWORDS = 6;
export const MAX_TOPIC_KEYWORD_LENGTH = 50;

export function normalizeTopicKeyword(value: string): string {
  return value.trim().replace(/^[#＃]+\s*/, "").trim();
}

export function normalizeTopicKeywords(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeTopicKeyword(value);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("zh-CN");
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}

export function matchesTopicKeyword(title: string | null, keyword: string): boolean {
  if (!title) return false;
  const normalized = normalizeTopicKeyword(keyword).toLocaleLowerCase("zh-CN");
  return normalized.length > 0 && title.toLocaleLowerCase("zh-CN").includes(normalized);
}
