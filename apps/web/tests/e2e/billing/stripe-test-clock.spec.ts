import { expect, test } from '@playwright/test';
import {
	advanceStripeTestClock,
	createDeclinedStripePaymentMethod,
	createOwnerOrganization,
	createStripePaymentMethod,
	createStripeTestClock,
	deleteStripeTestClock,
	listBillingEvents,
	openContractsPage,
	readBillingSummary,
	readClockCustomer,
	readCustomerSubscription,
	recoverSubscriptionPaymentMethod,
	replayStripeEvents,
	replayStripeEventsRepeatedly,
	setDefaultPaymentMethod,
	startPremiumTrial
} from './stripe-test-clock-helpers';

const STRIPE_BILLING_E2E_TIMEOUT_MS = 180_000;
const STRIPE_BILLING_SETTLE_TIMEOUT_MS = 60_000;
const STRIPE_BILLING_UI_TIMEOUT_MS = 15_000;

test.describe.configure({ mode: 'serial', timeout: STRIPE_BILLING_E2E_TIMEOUT_MS });

test.describe('Stripe Test Clock billing lifecycle', () => {
	const clocksToDelete: string[] = [];

	test.afterEach(async () => {
		while (clocksToDelete.length > 0) {
			const clockId = clocksToDelete.pop();
			if (clockId) {
				await deleteStripeTestClock(clockId).catch(() => undefined);
			}
		}
	});

	test('converges from trial to paid after a successful Test Clock renewal', async ({
		page,
		request
	}) => {
		const slug = `billing-e2e-paid-${Date.now()}`;
		const createdGte = Math.floor(Date.now() / 1000) - 60;
		const clock = await createStripeTestClock(slug);
		clocksToDelete.push(clock.id);

		const { organizationId } = await createOwnerOrganization({
			request,
			context: page.context(),
			slug
		});
		const trial = await startPremiumTrial({
			request,
			organizationId,
			clockId: clock.id
		});
		expect(trial.status).toBe('succeeded');

		const customer = await readClockCustomer(clock.id);
		const subscription = await readCustomerSubscription(customer.id);
		const paymentMethodId = await createStripePaymentMethod('tok_visa');
		await setDefaultPaymentMethod({
			customerId: customer.id,
			subscriptionId: subscription.id,
			paymentMethodId
		});

		const trialEnd = subscription.trial_end ?? subscription.current_period_end;
		expect(trialEnd).toBeTruthy();
		await advanceStripeTestClock({
			clockId: clock.id,
			frozenTime: Number(trialEnd) + 7_200
		});

		const events = await listBillingEvents({
			clockId: clock.id,
			customerId: customer.id,
			subscriptionId: subscription.id,
			createdGte
		});
		await replayStripeEventsRepeatedly({
			request,
			events,
			repeatCount: 5
		});

		await expect
			.poll(async () => readBillingSummary({ request, organizationId }), {
				timeout: STRIPE_BILLING_SETTLE_TIMEOUT_MS,
				intervals: [1_000, 2_000, 5_000]
			})
			.toMatchObject({
				planCode: 'premium',
				planState: 'premium_paid',
				subscriptionStatus: 'active',
				paymentMethodStatus: 'registered'
			});

		await openContractsPage(page);
		await expect(page.getByText('Premiumプラン', { exact: true })).toBeVisible({
			timeout: STRIPE_BILLING_UI_TIMEOUT_MS
		});
	});

	test('surfaces payment issue state after a failed Test Clock renewal', async ({
		page,
		request
	}) => {
		const slug = `billing-e2e-failed-${Date.now()}`;
		const createdGte = Math.floor(Date.now() / 1000) - 60;
		const clock = await createStripeTestClock(slug);
		clocksToDelete.push(clock.id);

		const { organizationId } = await createOwnerOrganization({
			request,
			context: page.context(),
			slug
		});
		await startPremiumTrial({
			request,
			organizationId,
			clockId: clock.id
		});

		const customer = await readClockCustomer(clock.id);
		const subscription = await readCustomerSubscription(customer.id);
		const successfulPaymentMethodId = await createStripePaymentMethod('tok_visa');
		await setDefaultPaymentMethod({
			customerId: customer.id,
			subscriptionId: subscription.id,
			paymentMethodId: successfulPaymentMethodId
		});

		const trialEnd = subscription.trial_end ?? subscription.current_period_end;
		await advanceStripeTestClock({
			clockId: clock.id,
			frozenTime: Number(trialEnd) + 7_200
		});
		await replayStripeEvents(
			request,
			await listBillingEvents({
				clockId: clock.id,
				customerId: customer.id,
				subscriptionId: subscription.id,
				createdGte
			})
		);

		const activeSubscription = await readCustomerSubscription(customer.id);
		const declinedPaymentMethodId = await createDeclinedStripePaymentMethod();
		await setDefaultPaymentMethod({
			customerId: customer.id,
			subscriptionId: activeSubscription.id,
			paymentMethodId: declinedPaymentMethodId
		});

		expect(activeSubscription.current_period_end).toBeTruthy();
		await advanceStripeTestClock({
			clockId: clock.id,
			frozenTime: Number(activeSubscription.current_period_end) + 7_200
		});
		const failureEvents = await listBillingEvents({
			clockId: clock.id,
			customerId: customer.id,
			subscriptionId: activeSubscription.id,
			createdGte
		});
		await replayStripeEvents(request, failureEvents);

		await expect
			.poll(async () => readBillingSummary({ request, organizationId }), {
				timeout: STRIPE_BILLING_SETTLE_TIMEOUT_MS,
				intervals: [1_000, 2_000, 5_000]
			})
			.toMatchObject({
				planCode: 'premium',
				planState: 'premium_paid',
				subscriptionStatus: 'past_due'
			});

		await openContractsPage(page);
		await expect(page.getByText('支払い遅延', { exact: true })).toBeVisible({
			timeout: STRIPE_BILLING_UI_TIMEOUT_MS
		});

		await recoverSubscriptionPaymentMethod({
			customerId: customer.id,
			subscriptionId: activeSubscription.id
		});
		await replayStripeEventsRepeatedly({
			request,
			events: await listBillingEvents({
				clockId: clock.id,
				customerId: customer.id,
				subscriptionId: activeSubscription.id,
				createdGte
			}),
			repeatCount: 5
		});

		await expect
			.poll(async () => readBillingSummary({ request, organizationId }), {
				timeout: STRIPE_BILLING_SETTLE_TIMEOUT_MS,
				intervals: [1_000, 2_000, 5_000]
			})
			.toMatchObject({
				planCode: 'premium',
				planState: 'premium_paid',
				subscriptionStatus: 'active',
				paymentIssueState: 'recovered'
			});
	});

	test('returns to free when a trial ends without a payment method', async ({ page, request }) => {
		const slug = `billing-e2e-cancel-${Date.now()}`;
		const createdGte = Math.floor(Date.now() / 1000) - 60;
		const clock = await createStripeTestClock(slug);
		clocksToDelete.push(clock.id);

		const { organizationId } = await createOwnerOrganization({
			request,
			context: page.context(),
			slug
		});
		await startPremiumTrial({
			request,
			organizationId,
			clockId: clock.id
		});

		const customer = await readClockCustomer(clock.id);
		const subscription = await readCustomerSubscription(customer.id);
		const trialEnd = subscription.trial_end ?? subscription.current_period_end;
		await advanceStripeTestClock({
			clockId: clock.id,
			frozenTime: Number(trialEnd) + 7_200
		});
		await replayStripeEvents(
			request,
			await listBillingEvents({
				clockId: clock.id,
				customerId: customer.id,
				subscriptionId: subscription.id,
				createdGte
			})
		);

		await expect
			.poll(async () => readBillingSummary({ request, organizationId }), {
				timeout: STRIPE_BILLING_SETTLE_TIMEOUT_MS,
				intervals: [1_000, 2_000, 5_000]
			})
			.toMatchObject({
				planCode: 'free',
				planState: 'free',
				subscriptionStatus: 'free'
			});

		await openContractsPage(page);
		await expect(page.getByText('無料プラン', { exact: true })).toBeVisible({
			timeout: STRIPE_BILLING_UI_TIMEOUT_MS
		});
	});
});
