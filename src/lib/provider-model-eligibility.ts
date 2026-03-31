import type { ProviderCredential, ProviderId } from '@/types';
import { providerSupportsOAuthUi } from '@/lib/ai-auth-ui';

export type ProviderCredentialEligibility = Pick<ProviderCredential, 'apiKey' | 'authMode'>;

/**
 * 模型列表 / 供应商选择：仅当用户已为该供应商配置可用凭据时视为「可用」。
 * - 非空 API Key（含服务端掩码后的占位串，如 ••••）
 * - 或该供应商在 providerCredentials 中为 OAuth
 * - 或 OpenAI 在开启 OAuth 开关后可通过 OAuth 使用（无 Key 也可选模型）
 */
export function providerHasCredentialForModelList(
  providerId: ProviderId,
  providerApiKeys: Partial<Record<ProviderId, string>> | undefined,
  opts: {
    openaiOAuthEnabled: boolean;
    supportsOAuth: boolean;
    providerCredentials?: Partial<Record<ProviderId, ProviderCredentialEligibility>>;
  },
): boolean {
  const k = (providerApiKeys?.[providerId] ?? '').trim();
  if (k.length > 0) return true;

  const cred = opts.providerCredentials?.[providerId];
  if ((cred?.apiKey ?? '').trim().length > 0) return true;
  if (cred?.authMode === 'oauth') return true;

  return providerSupportsOAuthUi(
    { openaiOAuthEnabled: opts.openaiOAuthEnabled },
    providerId,
    opts.supportsOAuth,
  );
}
