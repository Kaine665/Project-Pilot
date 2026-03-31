import type { ProviderId } from '@/types';
import type { ProviderPreset } from '@/lib/provider-registry';

/** 内置聚合商（多模型网关），仅 OpenRouter */
const AGGREGATE_BUILT_IN_IDS = new Set<string>(['openrouter']);

/** 内置「通用自定义 Base URL」模板（registry 中 id 为 custom） */
export const BUILT_IN_CUSTOM_GATEWAY_ID = 'custom' as const;

export function isAggregateBuiltInProviderId(id: ProviderId): boolean {
  return AGGREGATE_BUILT_IN_IDS.has(id);
}

/** 用户添加的 custom-* 线路 */
export function isUserCustomProviderId(id: ProviderId): boolean {
  return id.startsWith('custom-');
}

/** 是否属于「自定义」区块展示（用户自定义 + 内置 custom 模板） */
export function isCustomSectionProvider(id: ProviderId): boolean {
  return id === BUILT_IN_CUSTOM_GATEWAY_ID || isUserCustomProviderId(id);
}

/**
 * 将内置 registry 预设分为：原厂直连、聚合商、内置自定义网关模板。
 */
export function partitionBuiltInProviders(presets: ProviderPreset[]): {
  oem: ProviderPreset[];
  aggregate: ProviderPreset[];
  builtInCustom: ProviderPreset | null;
} {
  const oem: ProviderPreset[] = [];
  const aggregate: ProviderPreset[] = [];
  let builtInCustom: ProviderPreset | null = null;
  for (const p of presets) {
    if (p.id === BUILT_IN_CUSTOM_GATEWAY_ID) {
      builtInCustom = p;
    } else if (AGGREGATE_BUILT_IN_IDS.has(p.id)) {
      aggregate.push(p);
    } else {
      oem.push(p);
    }
  }
  return { oem, aggregate, builtInCustom };
}
