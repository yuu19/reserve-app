import { describe, expect, test } from 'vitest';
import {
  applyAddonScheduleToSubscriptionSnapshot,
  appendStripeSubscriptionSchedulePhase,
  buildAddonPriceLookupIntervals,
  buildBillingApiFeatures,
  composeEntitlementRules,
  buildStripeAddonDecreaseScheduleItems,
  buildStripeSubscriptionItemsUpdateParams,
  createBillingApiApp,
  hasMixedImmediateAndScheduledAddonChanges,
  hasBillingApiCredentialScope,
  isAddonItemUpdateChanged,
  isBillingTestClockEnvironmentEnabled,
  isOwnedAddonScheduleMetadata,
  isSupportedStripeBillingEventType,
  parseBillingApiCredentialScopes,
  readStripeInvoiceEventSnapshot,
  readStripeSubscriptionScheduleSnapshot,
  readStripeTestClockSnapshot,
  readStripeSubscriptionSnapshot,
  resolveAddonProviderPriceId,
  resolveAddonScheduleReuse,
  resolveTestClockAdvanceTarget,
  shouldExposeAddonItemsForSubscriptionStatus,
  shouldCacheIdempotentResponse,
  shouldReleaseAddonSchedule,
  toInvoiceEventResponse,
} from './app.js';
import { billingAddonMutationAudit, billingAddonScheduleAttempt } from './db/schema.js';

describe('createBillingApiApp', () => {
  test('returns health status', async () => {
    const response = await createBillingApiApp().request('/api/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test('keeps the legacy single-addon update route during the batch rollout', () => {
    expect(createBillingApiApp().routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'PUT',
          path: '/api/v1/apps/:appId/subjects/:subjectType/:subjectId/addon-items/:addonCode',
        }),
      ]),
    );
  });

  test('builds feature map from currently effective entitlements', () => {
    const timestamp = new Date('2026-06-23T00:00:00.000Z');
    const baseRow = {
      id: 'entitlement_1',
      appId: 'reserve',
      subjectRowId: 'subject_1',
      billingAccountId: 'account_1',
      active: true,
      source: 'paid',
      reason: 'stripe_subscription_active',
      validFrom: null,
      generatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const features = buildBillingApiFeatures({
      timestamp,
      entitlements: [
        {
          ...baseRow,
          key: 'staffLimit',
          valueType: 'number',
          valueJson: '10',
          validUntil: new Date('2026-07-23T00:00:00.000Z'),
        },
        {
          ...baseRow,
          id: 'entitlement_2',
          key: 'onlinePayment',
          valueType: 'boolean',
          valueJson: 'true',
          validUntil: null,
        },
        {
          ...baseRow,
          id: 'entitlement_3',
          key: 'expiredFeature',
          valueType: 'boolean',
          valueJson: 'true',
          validUntil: new Date('2026-06-22T00:00:00.000Z'),
        },
      ] as never,
    });

    expect(features).toEqual({
      staffLimit: 10,
      onlinePayment: true,
    });
  });

  test('composes addon entitlements from the incoming provider snapshot quantity', () => {
    const rules = composeEntitlementRules({
      planRules: [
        {
          entitlementKey: 'staffLimit',
          valueType: 'number',
          valueJson: '10',
        },
      ],
      addonRules: [
        {
          addonCode: 'staff_seat',
          entitlementKey: 'staffLimit',
          valueJson: '2',
          aggregation: 'increment',
        },
      ],
      addonItems: [{ addonCode: 'staff_seat', quantity: 3 }],
    });

    expect(rules).toEqual([
      {
        entitlementKey: 'staffLimit',
        valueType: 'number',
        valueJson: '16',
      },
    ]);
  });

  test('parses supported credential scopes and ignores unknown values', () => {
    expect(
      parseBillingApiCredentialScopes(
        JSON.stringify([
          'subject:write',
          'billing:read',
          'billing:write',
          'billing:test_clock',
          'admin:all',
        ]),
      ),
    ).toEqual(['subject:write', 'billing:read', 'billing:write', 'billing:test_clock']);
    expect(parseBillingApiCredentialScopes('{"not":"an array"}')).toEqual([]);
  });

  test('checks required credential scope', () => {
    expect(
      hasBillingApiCredentialScope({
        scopes: ['billing:read'],
        requiredScope: 'billing:read',
      }),
    ).toBe(true);
    expect(
      hasBillingApiCredentialScope({
        scopes: ['billing:read'],
        requiredScope: 'billing:write',
      }),
    ).toBe(false);
  });

  test('enables Test Clock API only for sandbox test-mode Stripe keys', () => {
    expect(
      isBillingTestClockEnvironmentEnabled({
        BILLING_TEST_CLOCKS_ENABLED: 'true',
        BILLING_API_ENV: 'sandbox',
        STRIPE_SECRET_KEY: 'sk_test_123',
      } as never),
    ).toBe(true);
    expect(
      isBillingTestClockEnvironmentEnabled({
        BILLING_TEST_CLOCKS_ENABLED: 'true',
        BILLING_API_ENV: 'production',
        STRIPE_SECRET_KEY: 'sk_test_123',
      } as never),
    ).toBe(false);
    expect(
      isBillingTestClockEnvironmentEnabled({
        BILLING_TEST_CLOCKS_ENABLED: 'true',
        BILLING_API_ENV: 'sandbox',
        STRIPE_SECRET_KEY: 'sk_live_123',
      } as never),
    ).toBe(false);
  });

  test('normalizes Stripe Test Clock payloads', () => {
    expect(
      readStripeTestClockSnapshot({
        id: 'clock_123',
        status: 'internal_failure',
        frozen_time: 1_783_000_000,
      }),
    ).toEqual({
      id: 'clock_123',
      status: 'failed',
      frozenTime: new Date('2026-07-02T13:46:40.000Z'),
    });
  });

  test('resolves Test Clock advanceBy requests from the current frozen time', () => {
    expect(
      resolveTestClockAdvanceTarget({
        currentFrozenTime: new Date('2026-06-27T00:00:00.000Z'),
        request: { advanceBy: { amount: 7, unit: 'day' } },
      })?.toISOString(),
    ).toBe('2026-07-04T00:00:00.000Z');
    expect(
      resolveTestClockAdvanceTarget({
        currentFrozenTime: new Date('2026-06-27T00:00:00.000Z'),
        request: { advanceBy: { amount: 1, unit: 'month' } },
      })?.toISOString(),
    ).toBe('2026-07-27T00:00:00.000Z');
    expect(
      resolveTestClockAdvanceTarget({
        currentFrozenTime: new Date('2026-06-27T00:00:00.000Z'),
        request: { frozenTime: '2026-07-05T00:00:00.000Z' },
      })?.toISOString(),
    ).toBe('2026-07-05T00:00:00.000Z');
  });

  test('normalizes Stripe subscription payload for billing sync', () => {
    const snapshot = readStripeSubscriptionSnapshot({
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      current_period_start: 1_780_000_000,
      current_period_end: 1_782_592_000,
      cancel_at_period_end: false,
      metadata: {
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'org_123',
        planCode: 'premium',
      },
      items: {
        data: [
          {
            id: 'si_base',
            quantity: 1,
            price: {
              id: 'price_monthly',
              recurring: {
                interval: 'month',
              },
            },
          },
          {
            id: 'si_staff',
            quantity: 2,
            price: {
              id: 'price_staff_seat_monthly',
              recurring: {
                interval: 'month',
              },
            },
          },
        ],
      },
    });

    expect(snapshot).toMatchObject({
      id: 'sub_123',
      customerId: 'cus_123',
      status: 'active',
      providerPriceId: 'price_monthly',
      interval: 'month',
      metadata: {
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'org_123',
        planCode: 'premium',
      },
      items: [
        {
          id: 'si_base',
          providerPriceId: 'price_monthly',
          quantity: 1,
          interval: 'month',
        },
        {
          id: 'si_staff',
          providerPriceId: 'price_staff_seat_monthly',
          quantity: 2,
          interval: 'month',
        },
      ],
    });
    expect(snapshot?.currentPeriodStart?.toISOString()).toBe('2026-05-28T20:26:40.000Z');
    expect(snapshot?.currentPeriodEnd?.toISOString()).toBe('2026-06-27T20:26:40.000Z');
  });

  test('supports invoice finalized webhook as a billing event', () => {
    expect(isSupportedStripeBillingEventType('invoice.finalized')).toBe(true);
    expect(isSupportedStripeBillingEventType('subscription_schedule.updated')).toBe(true);
    expect(isSupportedStripeBillingEventType('customer.subscription.trial_will_end')).toBe(false);
  });

  test('reads and validates addon schedule ownership metadata', () => {
    const schedule = readStripeSubscriptionScheduleSnapshot({
      id: 'sub_sched_1',
      subscription: 'sub_1',
      status: 'active',
      metadata: {
        billingManagedBy: 'reserve_billing_api_addon',
        billingAppId: 'reserve',
        billingSubjectType: 'organization',
        billingSubjectId: 'org_1',
        billingAccountId: 'account_1',
        billingSubscriptionId: 'subscription_1',
        billingAddonAttemptId: 'attempt_1',
      },
    });

    expect(schedule).not.toBeNull();
    expect(schedule?.providerSubscriptionId).toBe('sub_1');
    expect(
      isOwnedAddonScheduleMetadata({
        metadata: schedule!.metadata,
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'org_1',
        billingAccountId: 'account_1',
        billingSubscriptionId: 'subscription_1',
      }),
    ).toBe(true);
    expect(
      isOwnedAddonScheduleMetadata({
        metadata: schedule!.metadata,
        appId: 'reserve',
        subjectType: 'organization',
        subjectId: 'org_other',
        billingAccountId: 'account_1',
        billingSubscriptionId: 'subscription_1',
      }),
    ).toBe(false);
  });

  test('does not freeze retryable server failures in the idempotency response cache', () => {
    expect(shouldCacheIdempotentResponse(200)).toBe(true);
    expect(shouldCacheIdempotentResponse(409)).toBe(true);
    expect(shouldCacheIdempotentResponse(499)).toBe(true);
    expect(shouldCacheIdempotentResponse(500)).toBe(false);
    expect(shouldCacheIdempotentResponse(503)).toBe(false);
  });

  test('prefers yearly addon prices but falls back to monthly addon prices', () => {
    expect(buildAddonPriceLookupIntervals('year')).toEqual(['year', 'month']);
    expect(buildAddonPriceLookupIntervals('month')).toEqual(['month']);
    expect(buildAddonPriceLookupIntervals(null)).toEqual(['month']);
  });

  test('builds future schedule items by applying pending addon decrease targets only', () => {
    expect(
      buildStripeAddonDecreaseScheduleItems({
        currentItems: [
          { providerPriceId: 'price_base_yearly', quantity: 1 },
          { providerPriceId: 'price_staff_seat_monthly', quantity: 4 },
          { providerPriceId: 'price_shop_slot_monthly', quantity: 3 },
        ],
        targets: [{ providerPriceId: 'price_staff_seat_monthly', quantity: 2 }],
      }),
    ).toEqual([
      { providerPriceId: 'price_base_yearly', quantity: 1 },
      { providerPriceId: 'price_staff_seat_monthly', quantity: 2 },
      { providerPriceId: 'price_shop_slot_monthly', quantity: 3 },
    ]);
  });

  test('guards immediate addon increases against incomplete proration payments', () => {
    const params = buildStripeSubscriptionItemsUpdateParams([
      {
        providerSubscriptionItemId: 'si_staff',
        providerPriceId: 'price_staff_seat_monthly',
        quantity: 3,
      },
      {
        providerSubscriptionItemId: null,
        providerPriceId: 'price_shop_slot_monthly',
        quantity: 2,
      },
    ]);

    expect(params.get('payment_behavior')).toBe('error_if_incomplete');
    expect(params.get('proration_behavior')).toBe('create_prorations');
    expect(params.get('items[0][id]')).toBe('si_staff');
    expect(params.get('items[0][quantity]')).toBe('3');
    expect(params.get('items[1][price]')).toBe('price_shop_slot_monthly');
    expect(params.get('items[1][quantity]')).toBe('2');
  });

  test('uses duration instead of removed iterations for future subscription schedule phases', () => {
    const params = new URLSearchParams();

    appendStripeSubscriptionSchedulePhase({
      params,
      phaseIndex: 1,
      startDate: new Date('2026-07-23T00:00:00.000Z'),
      durationInterval: 'month',
      durationIntervalCount: 1,
      items: [{ providerPriceId: 'price_staff_seat_monthly', quantity: 2 }],
    });

    expect(params.has('phases[1][iterations]')).toBe(false);
    expect(params.get('phases[1][duration][interval]')).toBe('month');
    expect(params.get('phases[1][duration][interval_count]')).toBe('1');
  });

  test('reuses only a Schedule owned by an addon change', () => {
    expect(
      resolveAddonScheduleReuse({
        currentProviderScheduleId: 'sub_schedule_unrelated',
        addonOwnedScheduleId: null,
      }),
    ).toEqual({ scheduleId: null, conflict: true });
    expect(
      resolveAddonScheduleReuse({
        currentProviderScheduleId: 'sub_schedule_addon',
        addonOwnedScheduleId: 'sub_schedule_addon',
      }),
    ).toEqual({ scheduleId: 'sub_schedule_addon', conflict: false });
    expect(
      resolveAddonScheduleReuse({
        currentProviderScheduleId: null,
        addonOwnedScheduleId: 'sub_schedule_addon',
      }),
    ).toEqual({ scheduleId: 'sub_schedule_addon', conflict: false });
  });

  test('releases an addon-owned schedule when no decrease remains', () => {
    expect(
      shouldReleaseAddonSchedule({
        pendingTargetCount: 0,
        addonOwnedScheduleId: 'sub_schedule_addon',
      }),
    ).toBe(true);
    expect(
      shouldReleaseAddonSchedule({
        pendingTargetCount: 1,
        addonOwnedScheduleId: 'sub_schedule_addon',
      }),
    ).toBe(false);
    expect(
      shouldReleaseAddonSchedule({
        pendingTargetCount: 0,
        addonOwnedScheduleId: null,
      }),
    ).toBe(false);
  });

  test('rejects immediate increases when the mutation also requires schedule reconciliation', () => {
    expect(
      hasMixedImmediateAndScheduledAddonChanges({
        immediateItemCount: 1,
        requiresSchedule: true,
      }),
    ).toBe(true);
    expect(
      hasMixedImmediateAndScheduledAddonChanges({
        immediateItemCount: 2,
        requiresSchedule: false,
      }),
    ).toBe(false);
    expect(
      hasMixedImmediateAndScheduledAddonChanges({
        immediateItemCount: 0,
        requiresSchedule: true,
      }),
    ).toBe(false);
  });

  test('scopes addon mutation audits to an account without requiring a subscription', () => {
    expect(billingAddonMutationAudit.billingAccountId.notNull).toBe(true);
    expect(billingAddonMutationAudit.billingSubscriptionId.notNull).toBe(false);
    expect(billingAddonScheduleAttempt.billingSubscriptionId.notNull).toBe(true);
    expect(billingAddonScheduleAttempt.targetItemsJson.notNull).toBe(true);
  });

  test('applies the reconciled addon schedule without replacing the known subscription state', () => {
    const subscription = readStripeSubscriptionSnapshot({
      id: 'sub_123',
      customer: 'cus_123',
      schedule: null,
      status: 'active',
      current_period_start: 1_780_000_000,
      current_period_end: 1_782_592_000,
      cancel_at_period_end: false,
      metadata: {},
      items: {
        data: [
          {
            id: 'si_base',
            quantity: 1,
            price: {
              id: 'price_monthly',
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    });
    expect(subscription).not.toBeNull();

    const scheduled = applyAddonScheduleToSubscriptionSnapshot({
      subscription: subscription!,
      providerScheduleId: 'sub_schedule_addon',
    });
    const released = applyAddonScheduleToSubscriptionSnapshot({
      subscription: scheduled,
      providerScheduleId: null,
    });

    expect(scheduled).toEqual({
      ...subscription,
      providerScheduleId: 'sub_schedule_addon',
    });
    expect(released).toEqual(subscription);
  });

  test('exposes persisted addon items only for active subscriptions', () => {
    expect(shouldExposeAddonItemsForSubscriptionStatus('active')).toBe(true);
    expect(shouldExposeAddonItemsForSubscriptionStatus('trialing')).toBe(false);
    expect(shouldExposeAddonItemsForSubscriptionStatus('past_due')).toBe(false);
    expect(shouldExposeAddonItemsForSubscriptionStatus('unpaid')).toBe(false);
    expect(shouldExposeAddonItemsForSubscriptionStatus('canceled')).toBe(false);
    expect(shouldExposeAddonItemsForSubscriptionStatus(null)).toBe(false);
  });

  test('uses the active catalog price when reactivating an inactive addon', () => {
    expect(
      resolveAddonProviderPriceId({
        currentItemStatus: 'inactive',
        currentProviderPriceId: 'price_retired',
        activeProviderPriceId: 'price_current',
        quantity: 1,
      }),
    ).toBe('price_current');
    expect(
      resolveAddonProviderPriceId({
        currentItemStatus: 'inactive',
        currentProviderPriceId: 'price_retired',
        activeProviderPriceId: 'price_current',
        quantity: 0,
      }),
    ).toBe('price_retired');
  });

  test('treats an absent zero-quantity addon as unchanged before provider resolution', () => {
    expect(
      isAddonItemUpdateChanged({
        requestedQuantity: 0,
        currentQuantity: 0,
        pendingQuantity: null,
      }),
    ).toBe(false);
    expect(
      isAddonItemUpdateChanged({
        requestedQuantity: 2,
        currentQuantity: 2,
        pendingQuantity: null,
      }),
    ).toBe(false);
    expect(
      isAddonItemUpdateChanged({
        requestedQuantity: 2,
        currentQuantity: 2,
        pendingQuantity: 1,
      }),
    ).toBe(true);
    expect(
      isAddonItemUpdateChanged({
        requestedQuantity: 1,
        currentQuantity: 0,
        pendingQuantity: null,
      }),
    ).toBe(true);
  });

  test('normalizes Stripe invoice payload for invoice event history', () => {
    const snapshot = readStripeInvoiceEventSnapshot({
      eventType: 'invoice.payment_failed',
      eventCreatedAt: new Date('2026-06-26T00:00:00.000Z'),
      invoice: {
        id: 'in_123',
        status: 'open',
        payment_intent: 'pi_123',
        hosted_invoice_url: 'https://pay.stripe.test/invoice',
        invoice_pdf: 'https://pay.stripe.test/invoice.pdf',
      },
    });

    expect(snapshot).toEqual({
      eventType: 'payment_failed',
      ownerFacingStatus: 'failed',
      providerInvoiceId: 'in_123',
      providerPaymentIntentId: 'pi_123',
      providerStatus: 'open',
      hostedInvoiceUrl: 'https://pay.stripe.test/invoice',
      invoicePdfUrl: 'https://pay.stripe.test/invoice.pdf',
      occurredAt: new Date('2026-06-26T00:00:00.000Z'),
    });
  });

  test('serializes billing invoice event rows for API responses', () => {
    const timestamp = new Date('2026-06-26T00:00:00.000Z');

    expect(
      toInvoiceEventResponse({
        id: 'event_1',
        appId: 'reserve',
        billingAccountId: 'account_1',
        billingSubscriptionId: 'subscription_1',
        provider: 'stripe',
        providerEventId: 'evt_1',
        eventType: 'payment_action_required',
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        providerInvoiceId: 'in_1',
        providerPaymentIntentId: 'pi_1',
        providerStatus: 'open',
        ownerFacingStatus: 'action_required',
        hostedInvoiceUrl: 'https://pay.stripe.test/invoice',
        invoicePdfUrl: 'https://pay.stripe.test/invoice.pdf',
        occurredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      } as never),
    ).toEqual({
      id: 'event_1',
      provider: 'stripe',
      providerEventId: 'evt_1',
      eventType: 'payment_action_required',
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      providerInvoiceId: 'in_1',
      providerPaymentIntentId: 'pi_1',
      providerStatus: 'open',
      ownerFacingStatus: 'action_required',
      hostedInvoiceUrl: 'https://pay.stripe.test/invoice',
      invoicePdfUrl: 'https://pay.stripe.test/invoice.pdf',
      occurredAt: '2026-06-26T00:00:00.000Z',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
    });
  });
});
