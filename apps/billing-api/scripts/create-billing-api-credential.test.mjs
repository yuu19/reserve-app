import { describe, expect, test } from 'vitest';
import {
  createBillingApiRawKey,
  generateBillingApiCredentialSql,
} from './create-billing-api-credential.mjs';

describe('generateBillingApiCredentialSql', () => {
  test('generates credential insert SQL with a key hash only', () => {
    const sql = generateBillingApiCredentialSql({
      appId: 'reserve',
      keyPrefix: 'rbk_live',
      rawKey: 'rbk_live_test_raw_key',
      credentialId: 'cred_reserve_test',
    });

    expect(sql).toContain('INSERT INTO billing_app_credential');
    expect(sql).toContain("'cred_reserve_test'");
    expect(sql).toContain("'reserve'");
    expect(sql).toContain("'rbk_live'");
    expect(sql).toContain('subject:write');
    expect(sql).toContain('billing:read');
    expect(sql).toContain('billing:write');
    expect(sql).toContain('ON CONFLICT(key_hash) DO UPDATE SET');
    expect(sql).not.toContain('rbk_live_test_raw_key');
  });

  test('creates a raw key with the requested prefix', () => {
    const rawKey = createBillingApiRawKey({ prefix: 'rbk_live' });

    expect(rawKey).toMatch(/^rbk_live_[A-Za-z0-9_-]+$/);
  });
});
