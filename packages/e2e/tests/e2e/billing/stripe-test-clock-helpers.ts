import crypto from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Stripe Test Clock E2E が webhook replay や billing API 呼び出しに使う backend base URL。
 *
 * この module の helper は実際の Stripe testmode API と local / deployed backend をまたぐ
 * E2E 専用 helper として使う。
 */
export const backendUrl = process.env.PUBLIC_BACKEND_URL?.trim() || 'http://localhost:3000';
/** Backend の Stripe webhook endpoint へ replay payload を送るための signing secret。 */
export const webhookSecret =
  process.env.STRIPE_WEBHOOK_SECRET?.trim() ||
  process.env.E2E_STRIPE_WEBHOOK_SECRET?.trim() ||
  'whsec_reserve_app_local_e2e';
/** E2E 専用 test hook header に渡す shared secret。 */
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
  items?: {
    data?: Array<{
      current_period_end?: number | null;
    }>;
  };
};

type StripeEvent = {
  id: string;
  type: string;
  created: number;
  data?: {
    object?: JsonRecord;
  };
};

type StripeInvoice = {
  id: string;
  status: string;
  subscription?: string | null;
  customer?: string | null;
};

type BillingPayload = {
  planCode: 'free' | 'premium';
  planState: 'free' | 'premium_trial' | 'premium_paid';
  subscriptionStatus:
    | 'free'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'incomplete'
    | null;
  paymentMethodStatus: 'not_started' | 'pending' | 'registered';
  paymentIssueState?:
    | 'none'
    | 'payment_failed'
    | 'payment_action_required'
    | 'past_due_grace_active'
    | 'past_due_grace_expired'
    | 'unpaid'
    | 'incomplete'
    | 'recovered'
    | 'stale_failure_history_only';
  paymentIssueTiming?: {
    issueStartedAt: string | null;
    issueStartedAtSource: 'provider_issue_time' | 'application_receipt_time' | 'none';
    graceEndsAt: string | null;
  };
  nextOwnerAction?: string | null;
};

type BillingActionEnvelope = {
  status: 'succeeded' | 'processing' | 'conflict' | 'failed';
  message: string | null;
  billing: BillingPayload | null;
};

/**
 * Stripe API 呼び出しに使う testmode secret key を取得する。
 *
 * @returns `sk_test_` で始まる Stripe secret key。
 * @throws {Error} `STRIPE_SECRET_KEY` が未設定、または live mode key に見える場合。
 */
const stripeSecretKey = (): string => {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || !key.startsWith('sk_test_')) {
    throw new Error('STRIPE_SECRET_KEY must be set to a Stripe testmode key.');
  }
  return key;
};

/**
 * Stripe REST API v1 を testmode key で呼び出す。
 *
 * @template T - 呼び出し側が期待する Stripe response payload。
 * @param input - Stripe API request option。
 * @param input.path - `/v1/` 以降の Stripe API path。
 * @param input.method - HTTP method。
 * @param input.body - `application/x-www-form-urlencoded` で送る body。
 * @returns Stripe API response payload。
 * @throws {Error} Stripe API が non-2xx response を返した場合。
 */
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
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const payload = (await response.json().catch(() => null)) as T | { error?: { message?: string } };
  if (!response.ok) {
    const errorPayload = payload as { error?: { message?: unknown } } | null;
    const message =
      errorPayload && typeof errorPayload.error?.message === 'string'
        ? errorPayload.error.message
        : 'Stripe API request failed.';
    throw new Error(message);
  }
  return payload as T;
};

/** `null` と `undefined` を除外した Stripe form body を作る。 */
const stripeForm = (entries: Record<string, string | number | null | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params;
};

/**
 * Subscription 本体または item 側から current period end を読み取る。
 *
 * Stripe API version によって period end の場所が異なるため、E2E assertion では最小値へ正規化する。
 */
const readSubscriptionCurrentPeriodEnd = (subscription: StripeSubscription): number | undefined => {
  if (typeof subscription.current_period_end === 'number') {
    return subscription.current_period_end;
  }
  const itemPeriodEnds =
    subscription.items?.data
      ?.map((item) => item.current_period_end)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) ??
    [];
  return itemPeriodEnds.length > 0 ? Math.min(...itemPeriodEnds) : undefined;
};

const normalizeStripeSubscription = (subscription: StripeSubscription): StripeSubscription => ({
  ...subscription,
  current_period_end: readSubscriptionCurrentPeriodEnd(subscription),
});

/**
 * 現在時刻を frozen time とする Stripe Test Clock を作成する。
 *
 * @param name - Stripe dashboard や API response で clock を識別する名前。
 * @returns 作成された Stripe Test Clock。
 */
export const createStripeTestClock = async (name: string): Promise<StripeTestClock> =>
  stripeRequest<StripeTestClock>({
    path: 'test_helpers/test_clocks',
    method: 'POST',
    body: stripeForm({
      frozen_time: Math.floor(Date.now() / 1000),
      name,
    }),
  });

/**
 * Stripe Test Clock を削除する。
 *
 * @param clockId - 削除する Test Clock id。
 */
export const deleteStripeTestClock = async (clockId: string) => {
  await stripeRequest<JsonRecord>({
    path: `test_helpers/test_clocks/${encodeURIComponent(clockId)}`,
    method: 'DELETE',
  });
};

/**
 * Stripe Test Clock を指定時刻まで進め、Stripe 側の status が `ready` に戻るまで待つ。
 *
 * @param input - Advance 対象と到達時刻。
 * @param input.clockId - Advance する Test Clock id。
 * @param input.frozenTime - 到達させる Unix time seconds。
 * @returns Advance 完了後の Test Clock。
 */
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
    body: stripeForm({ frozen_time: frozenTime }),
  });

  await expect
    .poll(
      async () =>
        stripeRequest<StripeTestClock>({
          path: `test_helpers/test_clocks/${encodeURIComponent(clockId)}`,
        }),
      {
        timeout: 90_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toMatchObject({ status: 'ready' });

  return stripeRequest<StripeTestClock>({
    path: `test_helpers/test_clocks/${encodeURIComponent(clockId)}`,
  });
};

/**
 * Stripe test token から PaymentMethod を作成する。
 *
 * @param token - `tok_visa` などの Stripe test token。
 * @returns 作成した PaymentMethod id。
 */
export const createStripePaymentMethod = async (token: string): Promise<string> => {
  const paymentMethod = await stripeRequest<{ id: string }>({
    path: 'payment_methods',
    method: 'POST',
    body: stripeForm({
      type: 'card',
      'card[token]': token,
    }),
  });
  return paymentMethod.id;
};

/**
 * 支払い失敗 path を作るための declined PaymentMethod を作成する。
 *
 * @param token - 失敗挙動を持つ Stripe test token。
 * @returns 作成した PaymentMethod id。
 */
export const createDeclinedStripePaymentMethod = async (
  token = 'tok_chargeCustomerFail',
): Promise<string> => createStripePaymentMethod(token);

/**
 * PaymentMethod を customer に attach し、customer と subscription の default に設定する。
 *
 * @param input - Stripe customer / subscription / payment method の id。
 * @param input.customerId - PaymentMethod を attach する customer id。
 * @param input.subscriptionId - default payment method を更新する subscription id。
 * @param input.paymentMethodId - default に設定する PaymentMethod id。
 */
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
    body: stripeForm({ customer: customerId }),
  });
  await stripeRequest<JsonRecord>({
    path: `customers/${encodeURIComponent(customerId)}`,
    method: 'POST',
    body: stripeForm({ 'invoice_settings[default_payment_method]': paymentMethodId }),
  });
  await stripeRequest<JsonRecord>({
    path: `subscriptions/${encodeURIComponent(subscriptionId)}`,
    method: 'POST',
    body: stripeForm({ default_payment_method: paymentMethodId }),
  });
};

/**
 * 有効な payment method を設定し、open invoice があれば即時支払いして subscription を復旧させる。
 *
 * @param input - 復旧対象の customer / subscription と test token。
 * @param input.customerId - 復旧対象の Stripe customer id。
 * @param input.subscriptionId - 復旧対象の Stripe subscription id。
 * @param input.token - 復旧用 PaymentMethod を作る Stripe test token。
 * @returns 復旧に設定した PaymentMethod id。
 */
export const recoverSubscriptionPaymentMethod = async ({
  customerId,
  subscriptionId,
  token = 'tok_visa',
}: {
  customerId: string;
  subscriptionId: string;
  token?: string;
}) => {
  const paymentMethodId = await createStripePaymentMethod(token);
  await setDefaultPaymentMethod({
    customerId,
    subscriptionId,
    paymentMethodId,
  });

  const invoicePayload = await stripeRequest<{ data: StripeInvoice[] }>({
    path: `invoices?${stripeForm({
      customer: customerId,
      subscription: subscriptionId,
      status: 'open',
      limit: 1,
    }).toString()}`,
  });
  const openInvoice = invoicePayload.data[0];
  if (openInvoice) {
    await stripeRequest<JsonRecord>({
      path: `invoices/${encodeURIComponent(openInvoice.id)}/pay`,
      method: 'POST',
    });
  }

  return paymentMethodId;
};

/**
 * Test Clock に紐づく Stripe customer を 1 件読み取る。
 *
 * @param clockId - 検索対象の Test Clock id。
 * @returns Test Clock に紐づく Stripe customer。
 * @throws {Error} 該当 customer がまだ作成されていない場合。
 */
export const readClockCustomer = async (clockId: string): Promise<StripeCustomer> => {
  const payload = await stripeRequest<{ data: StripeCustomer[] }>({
    path: `customers?${stripeForm({ test_clock: clockId, limit: 1 }).toString()}`,
  });
  const customer = payload.data[0];
  if (!customer) {
    throw new Error(`No Stripe customer found for ${clockId}.`);
  }
  return customer;
};

/**
 * Customer に紐づく subscription を読み取り、current period end を正規化する。
 *
 * @param customerId - 検索対象の Stripe customer id。
 * @returns Customer の subscription。
 * @throws {Error} 該当 subscription がまだ作成されていない場合。
 */
export const readCustomerSubscription = async (customerId: string): Promise<StripeSubscription> => {
  const payload = await stripeRequest<{ data: StripeSubscription[] }>({
    path: `subscriptions?${stripeForm({ customer: customerId, status: 'all', limit: 10 }).toString()}`,
  });
  const subscription = payload.data[0];
  if (!subscription) {
    throw new Error(`No Stripe subscription found for ${customerId}.`);
  }
  return normalizeStripeSubscription(subscription);
};

/**
 * Stripe event が対象 Test Clock / customer / subscription の billing event か判定する。
 */
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

/**
 * 対象 Test Clock の billing webhook replay に必要な Stripe events を作成順で取得する。
 *
 * @param input - Event 検索と絞り込みに使う Stripe id。
 * @param input.clockId - 対象 Test Clock id。
 * @param input.customerId - 対象 Stripe customer id。
 * @param input.subscriptionId - 対象 Stripe subscription id。
 * @param input.createdGte - 取得対象 event の作成時刻下限 Unix time seconds。
 * @returns Backend webhook へ replay する billing 関連 Stripe events。
 */
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
    'created[gte]': createdGte,
  });
  const payload = await stripeRequest<{ data: StripeEvent[] }>({
    path: `events?${query.toString()}`,
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
        'invoice.payment_action_required',
      ].includes(event.type),
    )
    .filter((event) =>
      eventMatchesBillingObject({
        event,
        clockId,
        customerId,
        subscriptionId,
      }),
    )
    .sort((first, second) => first.created - second.created || first.id.localeCompare(second.id));
};

/**
 * Backend webhook endpoint が検証できる Stripe signature header を作成する。
 */
const signStripeWebhookPayload = (payload: string) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
};

/**
 * Stripe events を backend webhook endpoint に replay する。
 *
 * 同じ呼び出し内で重複 event id が渡された場合は 1 回だけ送信する。
 *
 * @param request - Backend webhook endpoint を呼び出す Playwright request context。
 * @param events - replay 対象の Stripe events。
 */
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
        'stripe-signature': signStripeWebhookPayload(payload),
      },
      data: payload,
    });
    expect(response.status(), `${event.type} webhook should be accepted`).toBe(200);
  }
};

/**
 * 同じ Stripe events を複数回 replay して webhook handler の冪等性を検証する。
 *
 * @param input - Replay 対象と繰り返し回数。
 * @param input.request - Backend webhook endpoint を呼び出す Playwright request context。
 * @param input.events - replay 対象の Stripe events。
 * @param input.repeatCount - replay を繰り返す回数。
 */
export const replayStripeEventsRepeatedly = async ({
  request,
  events,
  repeatCount = 5,
}: {
  request: APIRequestContext;
  events: StripeEvent[];
  repeatCount?: number;
}) => {
  for (let index = 0; index < repeatCount; index += 1) {
    await replayStripeEvents(request, events);
  }
};

/**
 * Billing E2E 専用の owner account と organization を作成する。
 *
 * 作成後の session cookie は browser context に同期され、契約画面の page 操作に引き継がれる。
 *
 * @param input - Billing E2E organization 作成 option。
 * @param input.request - backend API を呼び出す Playwright request context。
 * @param input.context - owner session を同期する browser context。
 * @param input.slug - account email と organization slug に使う一意 slug。
 * @returns Owner email と作成した organization id。
 */
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
      password: 'password1234',
    },
  });
  expect(signUp.status()).toBe(200);

  const organization = await request.post(`${backendUrl}/api/v1/auth/organizations`, {
    data: {
      name: `Billing E2E ${slug}`,
      slug,
    },
  });
  expect(organization.status()).toBe(200);
  const organizationPayload = (await organization.json()) as { id?: string };
  expect(organizationPayload.id).toBeTruthy();

  const storageState = await request.storageState();
  await context.addCookies(storageState.cookies);

  return {
    email,
    organizationId: organizationPayload.id as string,
  };
};

/**
 * E2E test hook header で Stripe Test Clock を指定して premium trial を開始する。
 *
 * @param input - Trial 開始対象と Test Clock。
 * @param input.request - owner として認証済みの request context。
 * @param input.organizationId - trial を開始する organization id。
 * @param input.clockId - backend が Stripe customer 作成時に使う Test Clock id。
 * @returns Trial 開始 API の action envelope。
 */
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
      'x-e2e-stripe-test-clock-id': clockId,
    },
    data: {
      organizationId,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as BillingActionEnvelope;
};

/**
 * Organization billing summary を backend API から読み取る。
 *
 * Envelope 形式と direct payload 形式の両方を受け入れ、E2E assertion が使う
 * `BillingPayload` に正規化する。
 *
 * @param input - Billing summary 読み取り対象。
 * @param input.request - owner として認証済みの request context。
 * @param input.organizationId - billing summary を読む organization id。
 * @returns 正規化された billing summary payload。
 */
export const readBillingSummary = async ({
  request,
  organizationId,
}: {
  request: APIRequestContext;
  organizationId: string;
}): Promise<BillingPayload> => {
  const response = await request.get(
    `${backendUrl}/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(
      organizationId,
    )}`,
  );
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    billing?: BillingPayload | null;
  } & Partial<BillingPayload>;
  const billing =
    payload.billing ?? (typeof payload.planCode === 'string' ? (payload as BillingPayload) : null);
  expect(billing).toBeTruthy();
  return billing as BillingPayload;
};

/**
 * Admin contracts page を開き、契約 heading が表示されるまで待つ。
 *
 * @param page - Owner session を持つ Playwright page。
 */
export const openContractsPage = async (page: Page) => {
  await page.goto('/admin/contracts');
  await expect(page.getByRole('heading', { level: 1, name: '契約' })).toBeVisible({
    timeout: 15_000,
  });
};
