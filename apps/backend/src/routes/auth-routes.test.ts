import { describe, expect, it } from 'vitest';
import { resolveE2eStripeTestClockId } from './auth-routes.js';

describe('E2E Stripe Test Clock guard', () => {
  it('ignores test clock headers unless E2E testing is explicitly enabled', () => {
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

  it('requires the configured E2E secret', () => {
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

  it('accepts only Stripe test clock identifiers', () => {
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

  it('returns the test clock id for authorized E2E requests', () => {
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
