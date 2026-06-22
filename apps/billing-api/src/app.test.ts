import { describe, expect, test } from 'vitest';
import { createBillingApiApp } from './app.js';

describe('createBillingApiApp', () => {
  test('returns health status', async () => {
    const response = await createBillingApiApp().request('/api/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
