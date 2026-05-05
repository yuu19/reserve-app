import { expect, test } from '@playwright/test';
import {
	advanceStripeTestClock,
	createOwnerOrganization,
	createStripePaymentMethod,
	createStripeTestClock,
	deleteStripeTestClock,
	listBillingEvents,
	openContractsPage,
	readBillingSummary,
	readClockCustomer,
	readCustomerSubscription,
	replayStripeEvents,
	setDefaultPaymentMethod,
	startPremiumTrial
} from './stripe-test-clock-helpers';

test.describe.configure({ mode: 'serial' });

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
		request,
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
		await replayStripeEvents(request, events);
		await replayStripeEvents(request, events);

		await expect
			.poll(async () => readBillingSummary({ request, organizationId }), {
				timeout: 30_000,
				intervals: [1_000, 2_000, 5_000]
			})
			.toMatchObject({
				planCode: 'premium',
				planState: 'premium_paid',
				subscriptionStatus: 'active',
				paymentMethodStatus: 'registered'
			});

		await openContractsPage(page);
		await expect(page.getByText('現在はPremiumプラン利用中です。')).toBeVisible();
	});

	test('surfaces payment issue state after a failed Test Clock renewal', async ({
		page,
		request,
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
		const declinedPaymentMethodId = await createStripePaymentMethod('tok_chargeDeclined');
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
				timeout: 30_000,
				intervals: [1_000, 2_000, 5_000]
			})
			.toMatchObject({
				planCode: 'premium',
				planState: 'premium_paid',
				subscriptionStatus: 'past_due'
			});

		await openContractsPage(page);
		await expect(page.getByText(/支払い|未払い|Premium 機能/)).toBeVisible();
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
				timeout: 30_000,
				intervals: [1_000, 2_000, 5_000]
			})
			.toMatchObject({
				planCode: 'free',
				planState: 'free',
				subscriptionStatus: 'free'
			});

		await openContractsPage(page);
		await expect(page.getByText(/無料プラン|Premiumトライアル/)).toBeVisible();
	});
});
