import { describe, expect, it, vi } from 'vitest';
import {
  createWorkersAiAnswerModelProvider,
  readAiTokenUsage,
} from './cloudflare-ai-answer-provider.js';

describe('Cloudflare AI answer provider', () => {
  it('returns provider, model, latency, gateway log id, and token usage when available', async () => {
    const run = vi.fn(async () => ({
      response: '{"answer":"ok"}',
      usage: {
        prompt_tokens: 21,
        completion_tokens: 8,
      },
    }));
    const provider = createWorkersAiAnswerModelProvider({
      env: {
        AI: {
          run,
          aiGatewayLogId: '01JADMCQQQBWH3NXZ5GCRN98DP',
        },
        AI_ANSWER_MODEL: '@cf/test/chat',
      },
    });

    const result = await provider.generate({
      messages: [{ role: 'user', content: '予約枠を作るには？' }],
      skipCache: false,
      cacheTtl: 60,
    });

    expect(result).toMatchObject({
      provider: 'cloudflare-workers-ai',
      model: '@cf/test/chat',
      inputTokens: 21,
      outputTokens: 8,
      aiGatewayLogId: '01JADMCQQQBWH3NXZ5GCRN98DP',
    });
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('keeps token usage nullable when the Workers AI result omits usage metadata', () => {
    expect(readAiTokenUsage({ response: '{"answer":"ok"}' })).toEqual({
      inputTokens: null,
      outputTokens: null,
    });
  });
});
