import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Input as CodexInput } from '@openai/codex-sdk';
import type { ProviderId } from '@/types';
import type { ImageAttachment } from '@/lib/image-assets';

export type ProviderSerializedInput = string | AsyncIterable<SDKUserMessage> | CodexInput;

interface SerializeProviderInputOptions {
  provider: ProviderId;
  prompt: string;
  sessionId: string;
  images?: ImageAttachment[];
  imagePaths?: string[];
}

export function serializeProviderInput({
  provider,
  prompt,
  sessionId,
  images,
  imagePaths,
}: SerializeProviderInputOptions): ProviderSerializedInput {
  if (!images?.length) {
    return prompt;
  }

  if (provider === 'openai') {
    return serializeCodexInput(prompt, imagePaths);
  }

  return serializeClaudeInput(prompt, images, sessionId);
}

function serializeCodexInput(prompt: string, imagePaths?: string[]): CodexInput {
  if (!imagePaths?.length) {
    return prompt;
  }

  const input: CodexInput extends infer T ? T : never = [
    ...(prompt.trim() ? [{ type: 'text', text: prompt } as const] : []),
    ...imagePaths.map((path) => ({ type: 'local_image', path } as const)),
  ];

  return input;
}

function serializeClaudeInput(
  prompt: string,
  images: ImageAttachment[],
  sessionId: string,
): AsyncIterable<SDKUserMessage> {
  const content = [
    ...(prompt.trim() ? [{ type: 'text', text: prompt }] : []),
    ...images.map((image) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.data,
      },
    })),
  ];

  async function* stream(): AsyncIterable<SDKUserMessage> {
    yield {
      type: 'user',
      message: {
        role: 'user',
        content,
      } as SDKUserMessage['message'],
      parent_tool_use_id: null,
      session_id: sessionId,
    };
  }

  return stream();
}
