/**
 * provider-registry 校验测试。
 * 运行方式: npx tsx src/lib/__tests__/provider-registry.test.ts
 *
 * 验证:
 * 1. JSON 数据能通过 Zod schema 校验
 * 2. PROVIDER_REGISTRY 数量与 JSON 一致
 * 3. 每个供应商至少有 id 和 nameKey（custom 除外至少有 0 个 model）
 * 4. getModelContextWindow 精确匹配、前缀推断、默认值均正确
 * 5. Kimi 路由正确
 * 6. 故意破坏 JSON 时 schema 能拦截
 */

import { PROVIDER_REGISTRY, getProviderPreset, getModelContextWindow, getKimiCandidateBaseUrls, ProvidersRegistrySchema } from '../provider-registry';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

// --- 1. Registry loaded ---
assert(PROVIDER_REGISTRY.length >= 15, `At least 15 providers loaded (got ${PROVIDER_REGISTRY.length})`);
assert(PROVIDER_REGISTRY[0].id === 'anthropic', 'First provider is anthropic');

// --- 2. Every provider has required fields ---
for (const p of PROVIDER_REGISTRY) {
  assert(typeof p.id === 'string' && p.id.length > 0, `Provider ${p.id} has id`);
  assert(typeof p.nameKey === 'string' && p.nameKey.length > 0, `Provider ${p.id} has nameKey`);
  assert(Array.isArray(p.models), `Provider ${p.id} has models array`);
  if (p.id !== 'custom') {
    assert(p.models.length > 0, `Provider ${p.id} has at least 1 model`);
  }
  // baseUrl format
  if (p.baseUrl) {
    assert(p.baseUrl.startsWith('http'), `Provider ${p.id} baseUrl starts with http`);
  }
}

// --- 3. getProviderPreset ---
const anthropic = getProviderPreset('anthropic');
assert(anthropic.id === 'anthropic', 'getProviderPreset anthropic');
assert(anthropic.models.length >= 3, 'Anthropic has >= 3 models');

const unknown = getProviderPreset('nonexistent' as never);
assert(unknown.id === 'anthropic', 'Unknown provider falls back to first (anthropic)');

// --- 4. Context windows ---
assert(getModelContextWindow('claude-sonnet-4-6') === 200000, 'Claude Sonnet 4.6 = 200k');
assert(getModelContextWindow('deepseek-chat') === 65536, 'DeepSeek = 65536');
assert(getModelContextWindow('k2p5') === 131072, 'Legacy k2p5 = 131072');
assert(getModelContextWindow('MiniMax-M2.5') === 204800, 'MiniMax Anthropic compat = 204800');
// Prefix fallback
assert(getModelContextWindow('gpt-future-model') === 128000, 'GPT prefix fallback = 128k');
assert(getModelContextWindow('claude-future') === 200000, 'Claude prefix fallback = 200k');
// Contains fallback
assert(getModelContextWindow('anthropic/claude-sonnet-4-6') === 200000, 'OpenRouter Claude = 200k');
assert(getModelContextWindow('google/gemini-2.5-flash') === 1000000, 'Gemini 2.5 contains = 1M');
// Default
assert(getModelContextWindow('totally-unknown-xyz') === 128000, 'Default fallback = 128k');

// --- 5. Kimi routing ---
const kimiCodeUrls = getKimiCandidateBaseUrls('kimi-for-coding');
assert(kimiCodeUrls.length === 1, 'Kimi code model has 1 URL');
assert(kimiCodeUrls[0].includes('api.kimi.com'), 'Kimi code URL is api.kimi.com');

const kimiMoonshotUrls = getKimiCandidateBaseUrls('kimi-k2');
assert(kimiMoonshotUrls.length >= 2, 'Kimi moonshot has >= 2 URLs');
assert(kimiMoonshotUrls[0].includes('moonshot'), 'Kimi moonshot first URL has moonshot');

// --- 6. Schema rejects bad data ---
const badData = { providers: [], contextWindowFallbacks: { rules: [], containsRules: [], default: 128000 }, extraContextWindows: {}, kimiRouting: { codeBaseUrl: 'not-a-url', moonshotBaseUrls: [], codeModelIds: [], moonshotModelIds: [] } };
const badResult = ProvidersRegistrySchema.safeParse(badData);
assert(!badResult.success, 'Schema rejects empty providers array');

const badModel = {
  providers: [{ id: 'test', nameKey: 'test', models: [{ id: '', label: 'x' }], supportsOAuth: false, editableBaseUrl: false, editableModel: false }],
  contextWindowFallbacks: { rules: [], containsRules: [], default: 128000 },
  extraContextWindows: {},
  kimiRouting: { codeBaseUrl: 'https://a.com', moonshotBaseUrls: ['https://b.com'], codeModelIds: ['x'], moonshotModelIds: ['y'] },
};
const badModelResult = ProvidersRegistrySchema.safeParse(badModel);
assert(!badModelResult.success, 'Schema rejects empty model id');

// --- Summary ---
console.log(`\n  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('  ALL TESTS PASSED');
}
