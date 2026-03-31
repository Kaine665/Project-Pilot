import type { ProviderId } from '@/types';
import type { AggregateLiveModelItem } from '@/lib/aggregate-models-live';

/** 复合选项值分隔符（避免与常见 model id 冲突） */
export const AGGREGATE_MODEL_KEY_SEP = '\u001e';

export function compositeKeyForAggregateItem(item: AggregateLiveModelItem): string {
  return `${item.providerId}${AGGREGATE_MODEL_KEY_SEP}${item.value}`;
}

export function parseAggregateCompositeKey(key: string): { providerId: ProviderId; modelId: string } | null {
  const i = key.indexOf(AGGREGATE_MODEL_KEY_SEP);
  if (i <= 0) return null;
  return {
    providerId: key.slice(0, i) as ProviderId,
    modelId: key.slice(i + AGGREGATE_MODEL_KEY_SEP.length),
  };
}

/** 统一模型下拉的 value/label（label 带供应商短名，便于区分同名模型） */
export function modelSelectOptionsFromAggregate(
  items: AggregateLiveModelItem[],
  providerLabel: (id: ProviderId) => string,
): { value: string; label: string }[] {
  return items.map((it) => ({
    value: compositeKeyForAggregateItem(it),
    label: `${it.label} · ${providerLabel(it.providerId)}`,
  }));
}
