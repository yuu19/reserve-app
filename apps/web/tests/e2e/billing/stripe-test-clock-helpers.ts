import crypto from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const backendUrl = process.env.PUBLIC_BACKEND_URL?.trim() || 'http://localhost:3000';
export const webhookSecret =
	process.env.STRIPE_WEBHOOK_SECRET?.trim() ||
	process.env.E2E_STRIPE_WEBHOOK_SECRET?.trim() ||
	'whsec_reserve_app_local_e2e';
export const e2eTestSecret = process.env.E2E_TEST_SECRET?.trim() || 'reserve-app-e2e-secret';

type JsonRecord = Record<string, unknown>;

type StripeTestClock = {
	id: string;
	status: string;
	frozen_time: number;
};

type StripeCustomer = {
	id: string;
	test_clock?: string | null;
};

type StripeSubscription = {
	id: string;
	customer: string;
	status: string;
	current_period_end?: number;
	trial_end?: number | null;
	test_clock?: string | null;
};

type StripeEvent = {
	id: string;
	type: string;
	created: number;
	data?: {
		object?: JsonRecord;
	};
};

type BillingPayload = {
	planCode: 'free' | 'premium';
	planState: 'free' | 'premium_trial' | 'premium_paid';
	subscriptionStatus: 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | null;
	paymentMethodStatus: 'not_started' | 'pending' | 'registered';
};

type BillingActionEnvelope = {
	status: 'succeeded' | 'processing' | 'conflict' | 'failed';
	message: string | null;
	billing: BillingPayload | null;
};

const stripeSecretKey = (): string => {
	const key = process.env.STRIPE_SECRET_KEY?.trim();
	if (!key || !key.startsWith('sk_test_')) {
		throw new Error('STRIPE_SECRET_KEY must be set to a Stripe testmode key.');
	}
	return key;
};

const stripeRequest = async <T>({
	path,
	method = 'GET',
	body,
}: {
	path: string;
	method?: 'GET' | 'POST' | 'DELETE';
	body?: URLSearchParams;
}): Promise<T> => {
	const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\/+/, '')}`, {
		method,
		headers: {
			authorization: `Bearer ${stripeSecretKey()}`,
			...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
		},
		body
	});
	const payload = (await response.json().catch(() => null)) as T | { error?: { message?: string } };
	if (!response.ok) {
		const errorPayload = payload as { error?: { message?: unknown } } | null;
		const message =
			errorPayload &&
			typeof errorPayload.error?.message === 'string'
				? errorPayload.error.message
				: 'Stripe API request failed.';
		throw new Error(message);
	}
	return payload as T;
};

const stripeForm = (entries: Record<string, string | number | null | undefined>) => {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(entries)) {
		if (value !== null && value !== undefined) {
			params.set(key, String(value));
		}
	}
	return params;
};

export const createStripeTestClock = async (name: string): Promise<StripeTestClock> =>
	stripeRequest<StripeTestClock>({
		path: 'test_helpers/test_clocks',
		method: 'POST',
		body: stripeForm({
			frozen_time: Math.floor(Date.now() / 1000),
			name
		})
	});

export const deleteStripeTestClock = async (clockId: string) => {
	await stripeRequest<JsonRecord>({
		path: `test_helpers/test_clocks/${encodeURIComponent(clockId)}`,
		method: 'DELETE'
	});
};

export const advanceStripeTestClock = async ({
	clockId,
	frozenTime,
}: {
	clockId: string;
	frozenTime: number;
}): Promise<StripeTestClock> => {
	await stripeRequest<StripeTestClock>({
		path: `test_helpers/test_clocks/${encodeURIComponent(clockId)}/advance`,
		method: 'POST',
		body: stripeForm({ frozen_time: frozenTime })
	});

	await expect
		.poll(
			async () =>
				stripeRequest<StripeTestClock>({
					path: `test_helpers/test_clocks/${encodeURIComponent(clockId)}`
				}),
			{
				timeout: 90_000,
				intervals: [1_000, 2_000, 5_000]
			}
		)
		.toMatchObject({ status: 'ready' });

	return stripeRequest<StripeTestClock>({
		path: `test_helpers/test_clocks/${encodeURIComponent(clockId)}`
	});
};

export const createStripePaymentMethod = async (token: string): Promise<string> => {
	const paymentMethod = await stripeRequest<{ id: string }>({
		path: 'payment_methods',
		method: 'POST',
		body: stripeForm({
			type: 'card',
			'card[token]': token
		})
	});
	return paymentMethod.id;
};

export const setDefaultPaymentMethod = async ({
	customerId,
	subscriptionId,
	paymentMethodId,
}: {
	customerId: string;
	subscriptionId: string;
	paymentMethodId: string;
}) => {
	await stripeRequest<JsonRecord>({
		path: `payment_methods/${encodeURIComponent(paymentMethodId)}/attach`,
		method: 'POST',
		body: stripeForm({ customer: customerId })
	});
	await stripeRequest<JsonRecord>({
		path: `customers/${encodeURIComponent(customerId)}`,
		method: 'POST',
		body: stripeForm({ 'invoice_settings[default_payment_method]': paymentMethodId })
	});
	await stripeRequest<JsonRecord>({
		path: `subscriptions/${encodeURIComponent(subscriptionId)}`,
		method: 'POST',
		body: stripeForm({ default_payment_method: paymentMethodId })
	});
};

export const readClockCustomer = async (clockId: string): Promise<StripeCustomer> => {
	const payload = await stripeRequest<{ data: StripeCustomer[] }>({
		path: `customers?${stripeForm({ test_clock: clockId, limit: 1 }).toString()}`
	});
	const customer = payload.data[0];
	if (!customer) {
		throw new Error(`No Stripe customer found for ${clockId}.`);
	}
	return customer;
};

export const readCustomerSubscription = async (customerId: string): Promise<StripeSubscription> => {
	const payload = await stripeRequest<{ data: StripeSubscription[] }>({
		path: `subscriptions?${stripeForm({ customer: customerId, status: 'all', limit: 10 }).toString()}`
	});
	const subscription = payload.data[0];
	if (!subscription) {
		throw new Error(`No Stripe subscription found for ${customerId}.`);
	}
	return subscription;
};

const eventMatchesBillingObject = ({
	event,
	clockId,
	customerId,
	subscriptionId,
}: {
	event: StripeEvent;
	clockId: string;
	customerId: string;
	subscriptionId: string;
}) => {
	const object = event.data?.object;
	if (!object) {
		return false;
	}
	if (object.test_clock === clockId) {
		return true;
	}
	if (object.customer === customerId) {
		return true;
	}
	if (object.subscription === subscriptionId) {
		return true;
	}
	if (object.id === subscriptionId) {
		return true;
	}
	return false;
};

export const listBillingEvents = async ({
	clockId,
	customerId,
	subscriptionId,
	createdGte,
}: {
	clockId: string;
	customerId: string;
	subscriptionId: string;
	createdGte: number;
}): Promise<StripeEvent[]> => {
	const query = stripeForm({
		limit: 100,
		'created[gte]': createdGte
	});
	const payload = await stripeRequest<{ data: StripeEvent[] }>({
		path: `events?${query.toString()}`
	});
	return payload.data
		.filter((event) =>
			[
				'checkout.session.completed',
				'customer.subscription.created',
				'customer.subscription.updated',
				'customer.subscription.deleted',
				'customer.subscription.trial_will_end',
				'invoice.finalized',
				'invoice.paid',
				'invoice.payment_succeeded',
				'invoice.payment_failed',
				'invoice.payment_action_required'
			].includes(event.type)
		)
		.filter((event) =>
			eventMatchesBillingObject({
				event,
				clockId,
				customerId,
				subscriptionId
			})
		)
		.sort((first, second) => first.created - second.created || first.id.localeCompare(second.id));
};

const signStripeWebhookPayload = (payload: string) => {
	const timestamp = Math.floor(Date.now() / 1000);
	const signature = crypto
		.createHmac('sha256', webhookSecret)
		.update(`${timestamp}.${payload}`)
		.digest('hex');
	return `t=${timestamp},v1=${signature}`;
};

export const replayStripeEvents = async (
	request: APIRequestContext,
	events: StripeEvent[],
): Promise<void> => {
	const seen = new Set<string>();
	for (const event of events) {
		if (seen.has(event.id)) {
			continue;
		}
		seen.add(event.id);
		const payload = JSON.stringify(event);
		const response = await request.post(`${backendUrl}/api/webhooks/stripe`, {
			headers: {
				'content-type': 'application/json',
				'stripe-signature': signStripeWebhookPayload(payload)
			},
			data: payload
		});
		expect(response.status(), `${event.type} webhook should be accepted`).toBe(200);
	}
};

export const createOwnerOrganization = async ({
	request,
	context,
	slug,
}: {
	request: APIRequestContext;
	context: BrowserContext;
	slug: string;
}) => {
	const email = `${slug}@example.com`;
	const signUp = await request.post(`${backendUrl}/api/v1/auth/sign-up`, {
		data: {
			name: 'Billing E2E Owner',
			email,
			password: 'password1234'
		}
	});
	expect(signUp.status()).toBe(200);

	const organization = await request.post(`${backendUrl}/api/v1/auth/organizations`, {
		data: {
			name: `Billing E2E ${slug}`,
			slug
		}
	});
	expect(organization.status()).toBe(200);
	const organizationPayload = (await organization.json()) as { id?: string };
	expect(organizationPayload.id).toBeTruthy();

	const storageState = await request.storageState();
	await context.addCookies(storageState.cookies);

	return {
		email,
		organizationId: organizationPayload.id as string
	};
};

export const startPremiumTrial = async ({
	request,
	organizationId,
	clockId,
}: {
	request: APIRequestContext;
	organizationId: string;
	clockId: string;
}): Promise<BillingActionEnvelope> => {
	const response = await request.post(`${backendUrl}/api/v1/auth/organizations/billing/trial`, {
		headers: {
			'x-e2e-test-secret': e2eTestSecret,
			'x-e2e-stripe-test-clock-id': clockId
		},
		data: {
			organizationId
		}
	});
	expect(response.status()).toBe(200);
	return (await response.json()) as BillingActionEnvelope;
};

export const readBillingSummary = async ({
	request,
	organizationId,
}: {
	request: APIRequestContext;
	organizationId: string;
}): Promise<BillingPayload> => {
	const response = await request.get(
		`${backendUrl}/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(
			organizationId
		)}`
	);
	expect(response.status()).toBe(200);
	const payload = (await response.json()) as { billing?: BillingPayload | null };
	expect(payload.billing).toBeTruthy();
	return payload.billing as BillingPayload;
};

export const openContractsPage = async (page: Page) => {
	await page.goto('/admin/contracts');
	await expect(page.getByRole('heading', { name: /契約|プラン|Premium/ })).toBeVisible({
		timeout: 15_000
	});
};
