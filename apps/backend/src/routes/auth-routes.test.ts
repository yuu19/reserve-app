import { describe, expect, it } from 'vitest';
import { resolveE2eStripeTestClockId } from './auth-routes.js';

describe('E2E Stripe Test Clock ガード', () => {
  it('E2E テストが明示的に有効でない場合は Test Clock ヘッダーを無視する', () => {
    expect(
      resolveE2eStripeTestClockId({
        env: {
          E2E_TESTING_ENABLED: 'false',
          E2E_TEST_SECRET: 'secret',
        },
        headers: new Headers({
          'x-e2e-test-secret': 'secret',
          'x-e2e-stripe-test-clock-id': 'clock_disabled',
        }),
      }),
    ).toBeNull();
  });

  it('設定済み E2E シークレットを要求する', () => {
    expect(
      resolveE2eStripeTestClockId({
        env: {
          E2E_TESTING_ENABLED: 'true',
          E2E_TEST_SECRET: 'secret',
        },
        headers: new Headers({
          'x-e2e-test-secret': 'wrong-secret',
          'x-e2e-stripe-test-clock-id': 'clock_wrong_secret',
        }),
      }),
    ).toBeNull();
  });

  it('Stripe Test Clock 識別子だけを受け入れる', () => {
    expect(
      resolveE2eStripeTestClockId({
        env: {
          E2E_TESTING_ENABLED: 'true',
          E2E_TEST_SECRET: 'secret',
        },
        headers: new Headers({
          'x-e2e-test-secret': 'secret',
          'x-e2e-stripe-test-clock-id': 'cus_not_clock',
        }),
      }),
    ).toBeNull();
  });

  it('認可済み E2E リクエストには Test Clock ID を返す', () => {
    expect(
      resolveE2eStripeTestClockId({
        env: {
          E2E_TESTING_ENABLED: 'true',
          E2E_TEST_SECRET: 'secret',
        },
        headers: new Headers({
          'x-e2e-test-secret': 'secret',
          'x-e2e-stripe-test-clock-id': 'clock_authorized',
        }),
      }),
    ).toBe('clock_authorized');
  });
});
