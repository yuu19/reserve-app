import { describe, expect, it, vi } from 'vitest';
import { generateEmbedding, readEmbeddingShape, readEmbeddingVector } from './embedding.js';

describe('AI embedding helpers', () => {
  it('parses known Workers AI embedding response shapes', () => {
    expect(readEmbeddingVector({ data: [[0.1, 0.2, 0.3]] })).toEqual([0.1, 0.2, 0.3]);
    expect(readEmbeddingVector({ response: [[0.4, 0.5]] })).toEqual([0.4, 0.5]);
    expect(readEmbeddingVector({ embedding: [0.6] })).toEqual([0.6]);
    expect(readEmbeddingVector({ vector: [0.7, 0.8] })).toEqual([0.7, 0.8]);
  });

  it('returns explicit shape or falls back to vector length', () => {
    expect(readEmbeddingShape({ shape: [1, 1024], data: [[0.1]] })).toEqual([1, 1024]);
    expect(readEmbeddingShape({ data: [[0.1, 0.2, 0.3]] })).toEqual([1, 3]);
    expect(readEmbeddingShape('missing')).toBeNull();
  });

  it('throws when the provider response has no vector', () => {
    expect(() => readEmbeddingVector({ data: [] })).toThrow(
      'Workers AI embedding response did not include a vector.',
    );
  });

  it('calls Workers AI with the configured model and gateway cache options', async () => {
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
