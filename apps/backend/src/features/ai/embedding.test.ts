import { describe, expect, it, vi } from 'vitest';
import { generateEmbedding, readEmbeddingShape, readEmbeddingVector } from './embedding.js';

describe('AI 埋め込みヘルパー', () => {
  it('既知の Workers AI 埋め込みレスポンス形状を解析する', () => {
    expect(readEmbeddingVector({ data: [[0.1, 0.2, 0.3]] })).toEqual([0.1, 0.2, 0.3]);
    expect(readEmbeddingVector({ response: [[0.4, 0.5]] })).toEqual([0.4, 0.5]);
    expect(readEmbeddingVector({ embedding: [0.6] })).toEqual([0.6]);
    expect(readEmbeddingVector({ vector: [0.7, 0.8] })).toEqual([0.7, 0.8]);
  });

  it('明示的な形状を返しなければベクトル長へフォールバックする', () => {
    expect(readEmbeddingShape({ shape: [1, 1024], data: [[0.1]] })).toEqual([1, 1024]);
    expect(readEmbeddingShape({ data: [[0.1, 0.2, 0.3]] })).toEqual([1, 3]);
    expect(readEmbeddingShape('missing')).toBeNull();
  });

  it('プロバイダーレスポンスにベクトルがない場合は例外を投げる', () => {
    expect(() => readEmbeddingVector({ data: [] })).toThrow(
      'Workers AI embedding response did not include a vector.',
    );
  });

  it('設定済みモデルと Gateway キャッシュオプションで Workers AI を呼び出す', async () => {
    const run = vi.fn(async () => ({ data: [[1, 2, 3]], shape: [1, 3] }));

    await expect(
      generateEmbedding({
        env: {
          AI: { run },
          AI_GATEWAY_ID: 'reserve-app-ai',
          AI_EMBEDDING_MODEL: '@cf/test/embedding',
        },
        text: '予約のキャンセル方法',
        cache: false,
      }),
    ).resolves.toEqual({ vector: [1, 2, 3], shape: [1, 3], model: '@cf/test/embedding' });
    expect(run).toHaveBeenCalledWith(
      '@cf/test/embedding',
      { text: '予約のキャンセル方法' },
      expect.objectContaining({
        gateway: expect.objectContaining({
          id: 'reserve-app-ai',
          skipCache: true,
          metadata: { purpose: 'ai-chat-embedding' },
        }),
      }),
    );
  });
});
