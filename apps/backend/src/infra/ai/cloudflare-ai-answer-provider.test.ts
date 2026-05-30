import { describe, expect, it, vi } from 'vitest';
import {
  createWorkersAiAnswerModelProvider,
  readAiTokenUsage,
} from './cloudflare-ai-answer-provider.js';

describe('Cloudflare AI 回答プロバイダー', () => {
  it('利用可能な場合はプロバイダー・モデル・レイテンシ・Gateway ログ ID・トークン使用量を返す', async () => {
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

  it('Workers AI 結果に使用量メタデータがない場合はトークン使用量を nullable に保つ', () => {
    expect(readAiTokenUsage({ response: '{"answer":"ok"}' })).toEqual({
      inputTokens: null,
      outputTokens: null,
    });
  });
});
