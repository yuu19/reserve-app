import { expect, test } from '@playwright/test';
import {
  advanceBillingApiTestClockScenario,
  deleteStripeTestClock,
  createBillingApiTestClockScenario,
  listBillingEvents,
  readBillingApiAddonItems,
  readBillingApiAddonMutationAudits,
  readBillingApiSummary,
  readBillingApiTestClockScenario,
  readCustomerSubscription,
  replayStripeEventsToBillingApiRepeatedly,
  syncBillingApiSubject,
  updateBillingApiAddonItems,
  updateBillingApiAddonItemsExpectingError,
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

  test('addon の混在更新を拒否し、分割した増加と期間末削除が entitlement と監査へ反映される', async ({
    request,
  }) => {
    const slug = `billing-api-e2e-addon-${Date.now()}`;
    const sourceSubjectId = `org_${slug}`;
    const createdGte = Math.floor(Date.now() / 1000) - 60;

    await syncBillingApiSubject({
      request,
      subjectId: sourceSubjectId,
      displayName: `Billing API addon E2E ${slug}`,
    });

    const scenario = await createBillingApiTestClockScenario({
      request,
      subjectId: sourceSubjectId,
      frozenTime: new Date().toISOString(),
      scenarioType: 'monthly_renewal_success',
    });
    clocksToDelete.push(scenario.providerTestClockId);

    const initialUpdate = await updateBillingApiAddonItems({
      request,
      subject: scenario.testSubject,
      items: [
        { addonCode: 'staff_seat', quantity: 2 },
        { addonCode: 'shop_slot', quantity: 2 },
      ],
      idempotencyKey: `billing-api-e2e-addon-initial-${scenario.scenarioId}`,
    });
    expect(initialUpdate.addonItems.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          addonCode: 'staff_seat',
          quantity: 2,
          pendingQuantity: null,
        }),
        expect.objectContaining({
          addonCode: 'shop_slot',
          quantity: 2,
          pendingQuantity: null,
        }),
      ]),
    );
    expect(initialUpdate.summary.entitlements.features).toMatchObject({
      staffLimit: 12,
      shopLimit: 5,
    });

    const mixedFailure = await updateBillingApiAddonItemsExpectingError({
      request,
      subject: scenario.testSubject,
      items: [
        { addonCode: 'staff_seat', quantity: 3 },
        { addonCode: 'shop_slot', quantity: 0 },
      ],
      idempotencyKey: `billing-api-e2e-addon-mixed-${scenario.scenarioId}`,
      expectedStatus: 409,
    });
    expect(mixedFailure).toEqual({
      error: {
        code: 'bad_request',
        message:
          'Immediate addon increases and period-end addon changes must use separate requests.',
      },
    });
    await expect
      .poll(() => readBillingApiAddonItems({ request, subject: scenario.testSubject }), {
        timeout: BILLING_API_SETTLE_TIMEOUT_MS,
        intervals: [1_000, 2_000, 5_000],
      })
      .toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            addonCode: 'staff_seat',
            quantity: 2,
            pendingQuantity: null,
          }),
          expect.objectContaining({
            addonCode: 'shop_slot',
            quantity: 2,
            pendingQuantity: null,
          }),
        ]),
      });

    const increaseUpdate = await updateBillingApiAddonItems({
      request,
      subject: scenario.testSubject,
      items: [{ addonCode: 'staff_seat', quantity: 3 }],
      idempotencyKey: `billing-api-e2e-addon-increase-${scenario.scenarioId}`,
    });
    expect(increaseUpdate.addonItems.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          addonCode: 'staff_seat',
          quantity: 3,
          pendingQuantity: null,
        }),
        expect.objectContaining({
          addonCode: 'shop_slot',
          quantity: 2,
          pendingQuantity: null,
        }),
      ]),
    );
    expect(increaseUpdate.summary.entitlements.features).toMatchObject({
      staffLimit: 13,
      shopLimit: 5,
    });

    const decreaseUpdate = await updateBillingApiAddonItems({
      request,
      subject: scenario.testSubject,
      items: [{ addonCode: 'shop_slot', quantity: 0 }],
      idempotencyKey: `billing-api-e2e-addon-decrease-${scenario.scenarioId}`,
    });
    const currentPeriodEnd = decreaseUpdate.summary.subscription?.currentPeriodEnd;
    expect(currentPeriodEnd).toBeTruthy();
    expect(decreaseUpdate.addonItems.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          addonCode: 'staff_seat',
          quantity: 3,
          pendingQuantity: null,
        }),
        expect.objectContaining({
          addonCode: 'shop_slot',
          quantity: 2,
          status: 'active',
          pendingQuantity: 0,
          pendingEffectiveAt: currentPeriodEnd,
        }),
      ]),
    );
    expect(decreaseUpdate.summary.entitlements.features).toMatchObject({
      staffLimit: 13,
      shopLimit: 5,
    });

    await expect
      .poll(() => readBillingApiAddonItems({ request, subject: scenario.testSubject }), {
        timeout: BILLING_API_SETTLE_TIMEOUT_MS,
        intervals: [1_000, 2_000, 5_000],
      })
      .toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ addonCode: 'staff_seat', quantity: 3 }),
          expect.objectContaining({ addonCode: 'shop_slot', pendingQuantity: 0 }),
        ]),
      });

    const auditBeforeAdvance = readBillingApiAddonMutationAudits({ subject: scenario.testSubject });
    expect(auditBeforeAdvance).toHaveLength(4);
    expect(auditBeforeAdvance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: 'succeeded',
          actor_id: 'billing-api-e2e',
          failure_code: null,
        }),
        expect.objectContaining({
          outcome: 'failed',
          actor_id: 'billing-api-e2e',
          result_items_json: null,
          failure_code: 'bad_request',
        }),
      ]),
    );
    expect(auditBeforeAdvance.map((row) => JSON.parse(row.requested_items_json))).toEqual(
      expect.arrayContaining([
        [
          { addonCode: 'staff_seat', quantity: 2 },
          { addonCode: 'shop_slot', quantity: 2 },
        ],
        [
          { addonCode: 'staff_seat', quantity: 3 },
          { addonCode: 'shop_slot', quantity: 0 },
        ],
        [{ addonCode: 'staff_seat', quantity: 3 }],
        [{ addonCode: 'shop_slot', quantity: 0 }],
      ]),
    );

    const targetFrozenTime = toSecondPrecisionIso(
      new Date(new Date(currentPeriodEnd as string).getTime() + 2 * 60 * 60 * 1000),
    );
    await advanceBillingApiTestClockScenario({
      request,
      sourceSubject: scenario.sourceSubject,
      scenarioId: scenario.scenarioId,
      frozenTime: targetFrozenTime,
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
      .toMatchObject({ status: 'ready', targetFrozenTime });

    const events = await listBillingEvents({
      clockId: scenario.providerTestClockId,
      customerId: scenario.providerCustomerId as string,
      subscriptionId: scenario.providerSubscriptionId as string,
      createdGte,
    });
    expect(events.some((event) => event.type === 'customer.subscription.updated')).toBe(true);
    await replayStripeEventsToBillingApiRepeatedly({ request, events, repeatCount: 5 });

    await expect
      .poll(() => readBillingApiAddonItems({ request, subject: scenario.testSubject }), {
        timeout: BILLING_API_SETTLE_TIMEOUT_MS,
        intervals: [1_000, 2_000, 5_000],
      })
      .toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            addonCode: 'staff_seat',
            quantity: 3,
            status: 'active',
            pendingQuantity: null,
          }),
          expect.objectContaining({
            addonCode: 'shop_slot',
            quantity: 0,
            status: 'inactive',
            pendingQuantity: null,
            pendingEffectiveAt: null,
          }),
        ]),
      });

    await expect
      .poll(() => readBillingApiSummary({ request, subject: scenario.testSubject }), {
        timeout: BILLING_API_SETTLE_TIMEOUT_MS,
        intervals: [1_000, 2_000, 5_000],
      })
      .toMatchObject({
        entitlements: {
          planCode: 'premium',
          status: 'active',
          features: expect.objectContaining({
            staffLimit: 13,
            shopLimit: 3,
          }),
          timeSource: 'stripe_test_clock',
          evaluatedAt: targetFrozenTime,
        },
      });

    const removalAppliedSummary = await readBillingApiSummary({
      request,
      subject: scenario.testSubject,
    });
    const releasePeriodEnd = removalAppliedSummary.subscription?.currentPeriodEnd;
    expect(releasePeriodEnd).toBeTruthy();
    const releaseFrozenTime = toSecondPrecisionIso(
      new Date(new Date(releasePeriodEnd as string).getTime() + 2 * 60 * 60 * 1000),
    );
    await advanceBillingApiTestClockScenario({
      request,
      sourceSubject: scenario.sourceSubject,
      scenarioId: scenario.scenarioId,
      frozenTime: releaseFrozenTime,
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
      .toMatchObject({ status: 'ready', targetFrozenTime: releaseFrozenTime });

    await expect
      .poll(() => readCustomerSubscription(scenario.providerCustomerId as string), {
        timeout: BILLING_API_SETTLE_TIMEOUT_MS,
        intervals: [1_000, 2_000, 5_000],
      })
      .toMatchObject({ schedule: null });

    const releaseEvents = await listBillingEvents({
      clockId: scenario.providerTestClockId,
      customerId: scenario.providerCustomerId as string,
      subscriptionId: scenario.providerSubscriptionId as string,
      createdGte,
    });
    await replayStripeEventsToBillingApiRepeatedly({
      request,
      events: releaseEvents,
      repeatCount: 5,
    });

    const reactivated = await updateBillingApiAddonItems({
      request,
      subject: scenario.testSubject,
      items: [{ addonCode: 'shop_slot', quantity: 1 }],
      idempotencyKey: `billing-api-e2e-addon-reactivate-${scenario.scenarioId}`,
    });
    expect(reactivated.addonItems.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          addonCode: 'shop_slot',
          quantity: 1,
          status: 'active',
          pendingQuantity: null,
        }),
      ]),
    );
    expect(reactivated.summary.entitlements.features).toMatchObject({ shopLimit: 4 });
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
