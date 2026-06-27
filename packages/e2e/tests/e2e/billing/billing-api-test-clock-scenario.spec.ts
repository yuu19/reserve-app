import { expect, test } from '@playwright/test';
import {
  advanceBillingApiTestClockScenario,
  deleteStripeTestClock,
  createBillingApiTestClockScenario,
  listBillingEvents,
  readBillingApiSummary,
  readBillingApiTestClockScenario,
  replayStripeEventsToBillingApiRepeatedly,
  syncBillingApiSubject,
} from './stripe-test-clock-helpers';

const BILLING_API_SCENARIO_TIMEOUT_MS = 180_000;
const BILLING_API_SETTLE_TIMEOUT_MS = 60_000;

const toSecondPrecisionIso = (value: Date) =>
  new Date(Math.floor(value.getTime() / 1000) * 1000).toISOString();

test.describe.configure({ mode: 'serial', timeout: BILLING_API_SCENARIO_TIMEOUT_MS });

test.describe('Billing API Test Clock scenario', () => {
  const clocksToDelete: string[] = [];

  test.afterEach(async () => {
    while (clocksToDelete.length > 0) {
      const clockId = clocksToDelete.pop();
      if (clockId) {
        await deleteStripeTestClock(clockId).catch(() => undefined);
      }
    }
  });

  test('月次更新成功が Test Clock 経由で active premium を維持する', async ({ request }) => {
    const slug = `billing-api-e2e-renewal-${Date.now()}`;
    const sourceSubjectId = `org_${slug}`;
    const createdGte = Math.floor(Date.now() / 1000) - 60;

    await syncBillingApiSubject({
      request,
      subjectId: sourceSubjectId,
      displayName: `Billing API E2E ${slug}`,
    });

    const scenario = await createBillingApiTestClockScenario({
      request,
      subjectId: sourceSubjectId,
      frozenTime: new Date().toISOString(),
      scenarioType: 'monthly_renewal_success',
    });
    clocksToDelete.push(scenario.providerTestClockId);

    expect(scenario).toMatchObject({
      scenarioType: 'monthly_renewal_success',
      status: 'ready',
      summary: {
        subscription: {
          planCode: 'premium',
          status: 'active',
        },
        entitlements: {
          planCode: 'premium',
          status: 'active',
          timeSource: 'stripe_test_clock',
        },
      },
    });
    expect(scenario.summary.entitlements.features['organization.premium']).toBe(true);
    const currentPeriodEnd = scenario.summary.subscription?.currentPeriodEnd;
    expect(currentPeriodEnd).toBeTruthy();
    const targetFrozenTime = toSecondPrecisionIso(
      new Date(new Date(currentPeriodEnd as string).getTime() + 2 * 60 * 60 * 1000),
    );

    const advanced = await advanceBillingApiTestClockScenario({
      request,
      sourceSubject: scenario.sourceSubject,
      scenarioId: scenario.scenarioId,
      frozenTime: targetFrozenTime,
    });
    expect(advanced.targetFrozenTime).toBeTruthy();

    await expect
      .poll(
        async () =>
          readBillingApiTestClockScenario({
            request,
            sourceSubject: scenario.sourceSubject,
            scenarioId: scenario.scenarioId,
          }),
        {
          timeout: BILLING_API_SETTLE_TIMEOUT_MS,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toMatchObject({
        status: 'ready',
        targetFrozenTime: advanced.targetFrozenTime,
      });

    const events = await listBillingEvents({
      clockId: scenario.providerTestClockId,
      customerId: scenario.providerCustomerId as string,
      subscriptionId: scenario.providerSubscriptionId as string,
      createdGte,
    });
    expect(events.some((event) => event.type === 'invoice.payment_succeeded')).toBe(true);
    await replayStripeEventsToBillingApiRepeatedly({
      request,
      events,
      repeatCount: 5,
    });

    await expect
      .poll(
        async () =>
          readBillingApiSummary({
            request,
            subject: scenario.testSubject,
          }),
        {
          timeout: BILLING_API_SETTLE_TIMEOUT_MS,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toMatchObject({
        subscription: {
          planCode: 'premium',
          status: 'active',
        },
        entitlements: {
          planCode: 'premium',
          status: 'active',
          timeSource: 'stripe_test_clock',
          evaluatedAt: advanced.targetFrozenTime,
        },
      });
  });

  test('月次更新失敗が Test Clock 経由で past_due に収束する', async ({ request }) => {
    const slug = `billing-api-e2e-failed-${Date.now()}`;
    const sourceSubjectId = `org_${slug}`;
    const createdGte = Math.floor(Date.now() / 1000) - 60;

    await syncBillingApiSubject({
      request,
      subjectId: sourceSubjectId,
      displayName: `Billing API E2E ${slug}`,
    });

    const scenario = await createBillingApiTestClockScenario({
      request,
      subjectId: sourceSubjectId,
      frozenTime: new Date().toISOString(),
      scenarioType: 'payment_failed',
    });
    clocksToDelete.push(scenario.providerTestClockId);

    expect(scenario).toMatchObject({
      scenarioType: 'payment_failed',
      status: 'ready',
      summary: {
        subscription: {
          planCode: 'premium',
          status: 'active',
        },
        entitlements: {
          planCode: 'premium',
          status: 'active',
          timeSource: 'stripe_test_clock',
        },
      },
    });
    expect(scenario.summary.entitlements.features['organization.premium']).toBe(true);
    const currentPeriodEnd = scenario.summary.subscription?.currentPeriodEnd;
    expect(currentPeriodEnd).toBeTruthy();
    const targetFrozenTime = toSecondPrecisionIso(
      new Date(new Date(currentPeriodEnd as string).getTime() + 2 * 60 * 60 * 1000),
    );

    const advanced = await advanceBillingApiTestClockScenario({
      request,
      sourceSubject: scenario.sourceSubject,
      scenarioId: scenario.scenarioId,
      frozenTime: targetFrozenTime,
    });
    expect(advanced.targetFrozenTime).toBeTruthy();

    await expect
      .poll(
        async () =>
          readBillingApiTestClockScenario({
            request,
            sourceSubject: scenario.sourceSubject,
            scenarioId: scenario.scenarioId,
          }),
        {
          timeout: BILLING_API_SETTLE_TIMEOUT_MS,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toMatchObject({
        status: 'ready',
        targetFrozenTime: advanced.targetFrozenTime,
      });

    await expect
      .poll(
        async () =>
          (
            await listBillingEvents({
              clockId: scenario.providerTestClockId,
              customerId: scenario.providerCustomerId as string,
              subscriptionId: scenario.providerSubscriptionId as string,
              createdGte,
            })
          ).map((event) => event.type),
        {
          timeout: BILLING_API_SETTLE_TIMEOUT_MS,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toContain('invoice.payment_failed');

    const events = await listBillingEvents({
      clockId: scenario.providerTestClockId,
      customerId: scenario.providerCustomerId as string,
      subscriptionId: scenario.providerSubscriptionId as string,
      createdGte,
    });
    await replayStripeEventsToBillingApiRepeatedly({
      request,
      events,
      repeatCount: 5,
    });

    await expect
      .poll(
        async () =>
          readBillingApiSummary({
            request,
            subject: scenario.testSubject,
          }),
        {
          timeout: BILLING_API_SETTLE_TIMEOUT_MS,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toMatchObject({
        subscription: {
          planCode: 'premium',
          status: 'past_due',
        },
        entitlements: {
          planCode: 'premium',
          status: 'past_due',
          features: {},
          entitlements: [],
          timeSource: 'stripe_test_clock',
          evaluatedAt: advanced.targetFrozenTime,
        },
      });
  });

  test('支払い方法なしの trial 終了が Test Clock 経由で free/canceled に収束する', async ({
    request,
  }) => {
    const slug = `billing-api-e2e-${Date.now()}`;
    const sourceSubjectId = `org_${slug}`;
    const createdGte = Math.floor(Date.now() / 1000) - 60;

    await syncBillingApiSubject({
      request,
      subjectId: sourceSubjectId,
      displayName: `Billing API E2E ${slug}`,
    });

    const scenario = await createBillingApiTestClockScenario({
      request,
      subjectId: sourceSubjectId,
      frozenTime: new Date().toISOString(),
      trialDays: 1,
    });
    clocksToDelete.push(scenario.providerTestClockId);

    expect(scenario).toMatchObject({
      scenarioType: 'trial_expired_without_payment_method',
      status: 'ready',
      sourceSubject: {
        subjectType: 'organization',
        subjectId: sourceSubjectId,
      },
      summary: {
        entitlements: {
          planCode: 'premium',
          status: 'trialing',
          timeSource: 'stripe_test_clock',
        },
      },
    });
    expect(scenario.summary.entitlements.features['organization.premium']).toBe(true);
    expect(scenario.providerCustomerId).toBeTruthy();
    expect(scenario.providerSubscriptionId).toBeTruthy();

    const trialEnd = scenario.summary.subscription?.trialEnd;
    expect(trialEnd).toBeTruthy();
    const targetFrozenTime = new Date(new Date(trialEnd as string).getTime() + 2 * 60 * 60 * 1000);
    const targetFrozenTimeIso = toSecondPrecisionIso(targetFrozenTime);

    await advanceBillingApiTestClockScenario({
      request,
      sourceSubject: scenario.sourceSubject,
      scenarioId: scenario.scenarioId,
      frozenTime: targetFrozenTimeIso,
    });

    await expect
      .poll(
        async () =>
          readBillingApiTestClockScenario({
            request,
            sourceSubject: scenario.sourceSubject,
            scenarioId: scenario.scenarioId,
          }),
        {
          timeout: BILLING_API_SETTLE_TIMEOUT_MS,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toMatchObject({
        status: 'ready',
        targetFrozenTime: targetFrozenTimeIso,
      });

    const events = await listBillingEvents({
      clockId: scenario.providerTestClockId,
      customerId: scenario.providerCustomerId as string,
      subscriptionId: scenario.providerSubscriptionId as string,
      createdGte,
    });
    expect(events.length).toBeGreaterThan(0);
    await replayStripeEventsToBillingApiRepeatedly({
      request,
      events,
      repeatCount: 5,
    });

    await expect
      .poll(
        async () =>
          readBillingApiSummary({
            request,
            subject: scenario.testSubject,
          }),
        {
          timeout: BILLING_API_SETTLE_TIMEOUT_MS,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toMatchObject({
        subscription: {
          planCode: 'free',
          status: 'canceled',
        },
        entitlements: {
          planCode: 'free',
          status: 'canceled',
          features: {},
          entitlements: [],
          timeSource: 'stripe_test_clock',
          evaluatedAt: targetFrozenTimeIso,
        },
      });
  });
});
