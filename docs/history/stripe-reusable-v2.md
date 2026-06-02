# Billing v2 実行手順書（MVP・既存データ破棄前提）

## この文書の扱い

この文書は現行仕様の正本ではなく、Billing v2 移行の履歴・計画メモです。
現行の組織単位課金仕様は [billing.md](../billing/billing.md) を確認してください。

## 目的

`reserve-app` の Stripe 課金実装を、他の SaaS でも再利用しやすい **Billing v2** に移行する。

今回は MVP 製作段階であり、既存データは捨てられる前提とする。  
そのため、旧 `organization_billing` 系テーブルからの backfill や production data migration は行わない。

代わりに、最初から以下を満たす v2 schema / store / usecase に寄せる。

```txt
- subjectType / subjectId による汎用課金対象
- generic billing tables
- operation attempt の DB 一意性
- timestamp_ms での時刻統一
- webhook claim に必要な payloadHash / attempt count / processing timestamp
- payment issue の current row と履歴の分離
- entitlement key ベースの feature gate
```

---

## レビュー指摘への対応方針

### 指摘 1: billing_operation_attempt に idempotencyKey の unique 制約がない

対応:

```txt
billing_operation_attempt.idempotency_key に unique index を付ける。
同時実行で同じ idempotencyKey の attempt が複数作られないよう DB で保証する。
```

Stripe の idempotency は provider 側の重複防止であり、アプリ側でも idempotency key の一意性を DB で保証する。

---

### 指摘 2: 既存データ backfill が不足

対応:

```txt
既存データは捨てられる前提なので backfill は行わない。
旧 organization_billing から v2 への mapping 章は削除する。
ローカル / dev / staging の DB は reset して v2 schema で作り直す。
```

既存データを残す手順は今回の対象外。

---

### 指摘 3: timestamp と timestamp_ms が混在する

対応:

```txt
Billing v2 の全時刻カラムは timestamp_ms に統一する。
grace period、trial end、handoff expiry、webhook stale 判定で単位不一致を起こさない。
```

Drizzle schema では以下を基本形にする。

```ts
integer('created_at', { mode: 'timestamp_ms' });
```

---

### 指摘 4: billing_provider_event に webhook claim 情報が不足

対応:

`billing_provider_event` に以下を追加する。

```txt
- payload_hash
- attempt_count
- processing_started_at
- last_attempt_at
- processing_stale_after_ms
```

これにより、以下の状態を安定して説明できるようにする。

```txt
- already_processed
- already_processing_fresh
- already_processing_stale_claimed
- failed duplicate retry
```

---

### 指摘 5: billing_payment_issue の current row 制約がない

対応:

`billing_payment_issue` を「現在状態」専用テーブルにし、`billing_account_id` で unique にする。

請求書と支払いの履歴は別テーブル `billing_invoice_event` に保存する。

```txt
billing_payment_issue
  現在の支払い問題状態を 1 account 1 row で保持

billing_invoice_event
  invoice_available / payment_failed / action_required / recovered などの履歴を append-only で保持
```

---

# 1. 最終ディレクトリ構成

```txt
packages/
  saas-billing-core/
    src/
      catalog.ts
      operation.ts
      ports.ts
      types.ts
      webhook.ts
      entitlement.ts
      payment-issue.ts
      index.ts

apps/backend/src/
  features/
    billing/
      billing.routes.ts
      billing.schemas.ts
      billing.route-context.ts

      usecases/
        get-billing-summary.usecase.ts
        start-trial-subscription.usecase.ts
        create-subscription-checkout.usecase.ts
        create-setup-checkout.usecase.ts
        create-subscription-update-portal.usecase.ts
        complete-trial-lifecycle.usecase.ts
        handle-provider-webhook.usecase.ts
        check-entitlement.usecase.ts

      presenters/
        billing-summary.presenter.ts
        billing-inspection.presenter.ts

      policies/
        reserve-app-billing-catalog.ts
        reserve-app-entitlements.ts
        reserve-app-billing-policy.ts

  infra/
    billing/
      drizzle-billing-store.ts
      drizzle-billing-operation-store.ts
      drizzle-billing-event-store.ts
      drizzle-billing-notification-store.ts
      drizzle-billing-inspection-store.ts

    payment/
      stripe-billing-provider.ts
```

---

# 2. Billing v2 schema

## 2.1 共通 timestamp helper 方針

全時刻カラムは `timestamp_ms` に統一する。

```ts
const createdAt = integer('created_at', { mode: 'timestamp_ms' })
  .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
  .notNull();

const updatedAt = integer('updated_at', { mode: 'timestamp_ms' })
  .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
  .$onUpdate(() => new Date())
  .notNull();
```

---

## 2.2 billing_account

```ts
export const billingAccount = sqliteTable(
  'billing_account',
  {
    id: text('id').primaryKey(),

    subjectType: text('subject_type').notNull(), // organization | workspace | team | user
    subjectId: text('subject_id').notNull(),

    provider: text('provider').notNull(), // stripe
    providerCustomerId: text('provider_customer_id'),

    billingEmail: text('billing_email'),
    billingName: text('billing_name'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('billing_account_subject_uidx').on(table.subjectType, table.subjectId),
    uniqueIndex('billing_account_provider_customer_uidx').on(
      table.provider,
      table.providerCustomerId,
    ),
  ],
);
```

---

## 2.3 billing_subscription

```ts
export const billingSubscription = sqliteTable(
  'billing_subscription',
  {
    id: text('id').primaryKey(),

    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),

    provider: text('provider').notNull(), // stripe
    providerSubscriptionId: text('provider_subscription_id'),
    providerScheduleId: text('provider_schedule_id'),

    planCode: text('plan_code').notNull(), // free | premium | pro | etc
    priceCode: text('price_code'),
    interval: text('interval'), // month | year

    status: text('status').notNull(),
    // free | trialing | active | past_due | canceled | unpaid | incomplete

    currentPeriodStart: integer('current_period_start', { mode: 'timestamp_ms' }),
    currentPeriodEnd: integer('current_period_end', { mode: 'timestamp_ms' }),

    trialStart: integer('trial_start', { mode: 'timestamp_ms' }),
    trialEnd: integer('trial_end', { mode: 'timestamp_ms' }),

    cancelAt: integer('cancel_at', { mode: 'timestamp_ms' }),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' })
      .default(false)
      .notNull(),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('billing_subscription_account_idx').on(table.billingAccountId),
    uniqueIndex('billing_subscription_provider_subscription_uidx').on(
      table.provider,
      table.providerSubscriptionId,
    ),
  ],
);
```

---

## 2.4 billing_payment_issue

現在状態専用。  
`billing_account_id` で unique にし、Store の `readPaymentIssue` は必ずこの table を読む。

```ts
export const billingPaymentIssue = sqliteTable(
  'billing_payment_issue',
  {
    id: text('id').primaryKey(),

    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),

    billingSubscriptionId: text('billing_subscription_id').references(
      () => billingSubscription.id,
      { onDelete: 'set null' },
    ),

    state: text('state').notNull(),
    // none | payment_failed | payment_action_required | past_due_grace_active |
    // past_due_grace_expired | unpaid | incomplete | recovered | stale_failure_history_only

    issueStartedAt: integer('issue_started_at', { mode: 'timestamp_ms' }),
    issueStartedAtSource: text('issue_started_at_source').notNull(),
    // provider_issue_time | application_receipt_time | none

    pastDueGraceEndsAt: integer('past_due_grace_ends_at', { mode: 'timestamp_ms' }),

    latestProviderEventId: text('latest_provider_event_id'),
    latestInvoiceId: text('latest_invoice_id'),
    latestPaymentIntentId: text('latest_payment_intent_id'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('billing_payment_issue_account_uidx').on(table.billingAccountId),
    index('billing_payment_issue_state_idx').on(table.state),
  ],
);
```

---

## 2.5 billing_invoice_event

請求書・支払いイベント全般の履歴 table。

```ts
export const billingInvoiceEvent = sqliteTable(
  'billing_invoice_event',
  {
    id: text('id').primaryKey(),

    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),

    billingSubscriptionId: text('billing_subscription_id').references(
      () => billingSubscription.id,
      { onDelete: 'set null' },
    ),

    eventType: text('event_type').notNull(),
    // invoice_available | payment_failed | payment_action_required | payment_succeeded | recovered | stale_failure

    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id'),
    providerInvoiceId: text('provider_invoice_id'),
    providerPaymentIntentId: text('provider_payment_intent_id'),

    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('billing_invoice_event_account_created_idx').on(table.billingAccountId, table.createdAt),
    uniqueIndex('billing_invoice_event_provider_uidx').on(
      table.provider,
      table.providerEventId,
      table.eventType,
    ),
  ],
);
```

---

## 2.6 billing_entitlement

```ts
export const billingEntitlement = sqliteTable(
  'billing_entitlement',
  {
    id: text('id').primaryKey(),

    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),

    key: text('key').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),

    source: text('source').notNull(), // free | trial | paid | manual | admin_override
    reason: text('reason').notNull(),

    validFrom: integer('valid_from', { mode: 'timestamp_ms' }),
    validUntil: integer('valid_until', { mode: 'timestamp_ms' }),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('billing_entitlement_account_key_uidx').on(table.billingAccountId, table.key),
    index('billing_entitlement_key_active_idx').on(table.key, table.active),
  ],
);
```

---

## 2.7 billing_provider_event

Webhook claim に必要な情報を持つ。

```ts
export const billingProviderEvent = sqliteTable(
  'billing_provider_event',
  {
    id: text('id').primaryKey(),

    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),

    scope: text('scope').notNull(), // billing
    payloadHash: text('payload_hash').notNull(),

    processingStatus: text('processing_status').notNull(),
    // processing | processed | failed

    receiptStatus: text('receipt_status').notNull(),
    // received | duplicate | duplicate_processing | processed

    duplicateDetected: integer('duplicate_detected', { mode: 'boolean' }).default(false).notNull(),
    duplicateDetectedAt: integer('duplicate_detected_at', { mode: 'timestamp_ms' }),

    attemptCount: integer('attempt_count').default(1).notNull(),

    processingStartedAt: integer('processing_started_at', { mode: 'timestamp_ms' }),
    lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp_ms' }),
    processingStaleAfterMs: integer('processing_stale_after_ms').notNull(),

    failureReason: text('failure_reason'),

    billingAccountId: text('billing_account_id').references(() => billingAccount.id, {
      onDelete: 'set null',
    }),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('billing_provider_event_uidx').on(
      table.provider,
      table.providerEventId,
      table.scope,
    ),
    index('billing_provider_event_processing_idx').on(
      table.processingStatus,
      table.processingStartedAt,
    ),
  ],
);
```

---

## 2.8 billing_operation_attempt

`idempotency_key` は必ず unique にする。

```ts
export const billingOperationAttempt = sqliteTable(
  'billing_operation_attempt',
  {
    id: text('id').primaryKey(),

    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),

    purpose: text('purpose').notNull(),
    // start_trial_subscription | create_subscription_checkout |
    // create_setup_checkout | create_portal_session

    reuseKey: text('reuse_key').notNull(),
    attemptNumber: integer('attempt_number').notNull(),

    idempotencyKey: text('idempotency_key').notNull(),

    state: text('state').notNull(),
    // processing | succeeded | failed | expired | conflict

    handoffUrl: text('handoff_url'),
    handoffExpiresAt: integer('handoff_expires_at', { mode: 'timestamp_ms' }),

    provider: text('provider').notNull(),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    providerCheckoutSessionId: text('provider_checkout_session_id'),
    providerPortalSessionId: text('provider_portal_session_id'),

    failureReason: text('failure_reason'),

    createdByUserId: text('created_by_user_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('billing_operation_attempt_idempotency_uidx').on(table.idempotencyKey),
    uniqueIndex('billing_operation_attempt_reuse_attempt_uidx').on(
      table.billingAccountId,
      table.reuseKey,
      table.attemptNumber,
    ),
    index('billing_operation_attempt_reuse_state_idx').on(
      table.billingAccountId,
      table.reuseKey,
      table.state,
    ),
    index('billing_operation_attempt_handoff_expiry_idx').on(table.handoffExpiresAt),
  ],
);
```

### operation attempt claim rule

```txt
1. billingAccountId + reuseKey の既存 attempt を見る
2. succeeded + handoffUrl 有効なら reuse
3. processing + fresh なら retry_later
4. processing + stale なら expired にして新 attempt
5. failed は reuse しない
6. attemptNumber = max(attemptNumber) + 1
7. idempotencyKey = `${reuseKey}:${attemptNumber}`
8. insert 時は idempotencyKey unique で衝突を防ぐ
9. onConflictDoNothing 後、既存 attempt を読み直す
```

---

## 2.9 billing_audit_event

```ts
export const billingAuditEvent = sqliteTable(
  'billing_audit_event',
  {
    id: text('id').primaryKey(),

    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),

    sequenceNumber: integer('sequence_number').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceContext: text('source_context'),

    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),

    previousSnapshotJson: text('previous_snapshot_json'),
    nextSnapshotJson: text('next_snapshot_json'),

    provider: text('provider'),
    providerEventId: text('provider_event_id'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('billing_audit_event_account_created_idx').on(table.billingAccountId, table.createdAt),
    uniqueIndex('billing_audit_event_account_sequence_uidx').on(
      table.billingAccountId,
      table.sequenceNumber,
    ),
  ],
);
```

---

## 2.10 billing_signal

```ts
export const billingSignal = sqliteTable(
  'billing_signal',
  {
    id: text('id').primaryKey(),

    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),

    sequenceNumber: integer('sequence_number').notNull(),
    signalKind: text('signal_kind').notNull(),
    signalStatus: text('signal_status').notNull(),
    sourceKind: text('source_kind').notNull(),
    reason: text('reason').notNull(),

    appSnapshotJson: text('app_snapshot_json'),

    provider: text('provider'),
    providerEventId: text('provider_event_id'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    providerPlanState: text('provider_plan_state'),
    providerSubscriptionStatus: text('provider_subscription_status'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('billing_signal_account_kind_status_idx').on(
      table.billingAccountId,
      table.signalKind,
      table.signalStatus,
    ),
    uniqueIndex('billing_signal_account_sequence_uidx').on(
      table.billingAccountId,
      table.sequenceNumber,
    ),
  ],
);
```

---

## 2.11 billing_notification

通知は同じ attempt の状態を更新せず、`requested` / `retried` と `sent` / `failed` / `skipped` を別 row として履歴に残す。
`billing_notification_dedupe_uidx` は同一状態の重複だけを止めるため、`deliveryStatus` も一意キーに含める。

```ts
export const billingNotification = sqliteTable(
  'billing_notification',
  {
    id: text('id').primaryKey(),

    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),

    channel: text('channel').default('email').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    notificationKind: text('notification_kind').notNull(),

    recipientUserId: text('recipient_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    recipientEmail: text('recipient_email').notNull(),

    deliveryStatus: text('delivery_status').notNull(),
    // requested | retried | sent | failed | skipped
    attemptNumber: integer('attempt_number').default(1).notNull(),

    providerMessageId: text('provider_message_id'),
    failureReason: text('failure_reason'),

    provider: text('provider'),
    providerEventId: text('provider_event_id'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    providerInvoiceId: text('provider_invoice_id'),
    planState: text('plan_state'),
    subscriptionStatus: text('subscription_status'),
    paymentMethodStatus: text('payment_method_status'),
    trialEndsAt: integer('trial_ends_at', { mode: 'timestamp_ms' }),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    failedAt: integer('failed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    // 同じ attempt の requested/sent/failed などを append-only の履歴行として残す。
    uniqueIndex('billing_notification_dedupe_uidx').on(
      table.billingAccountId,
      table.notificationKind,
      table.recipientEmail,
      table.providerEventId,
      table.attemptNumber,
      table.deliveryStatus,
    ),
    uniqueIndex('billing_notification_account_sequence_uidx').on(
      table.billingAccountId,
      table.sequenceNumber,
    ),
    index('billing_notification_retry_idx').on(table.notificationKind, table.deliveryStatus),
  ],
);
```

---

## 2.12 billing_document_reference

```ts
export const billingDocumentReference = sqliteTable(
  'billing_document_reference',
  {
    id: text('id').primaryKey(),

    billingAccountId: text('billing_account_id')
      .notNull()
      .references(() => billingAccount.id, { onDelete: 'cascade' }),

    documentKind: text('document_kind').notNull(), // invoice | receipt

    provider: text('provider').notNull(),
    providerDocumentId: text('provider_document_id').notNull(),

    hostedInvoiceUrl: text('hosted_invoice_url'),
    invoicePdfUrl: text('invoice_pdf_url'),
    receiptUrl: text('receipt_url'),

    availability: text('availability').notNull(),
    ownerFacingStatus: text('owner_facing_status').notNull(),

    providerDerived: integer('provider_derived', { mode: 'boolean' }).default(true).notNull(),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('billing_document_reference_provider_uidx').on(
      table.provider,
      table.providerDocumentId,
      table.documentKind,
    ),
    index('billing_document_reference_account_idx').on(table.billingAccountId),
  ],
);
```

---

# 3. 既存データの扱い

既存データは捨ててよいので、backfill はしない。

## 3.1 local / dev

```bash
rm -rf apps/backend/.wrangler
pnpm --filter @apps/backend db:generate
pnpm --filter @apps/backend d1:migrate:local
```

## 3.2 remote dev / staging

必要なら remote DB を作り直す。

```txt
- old D1 database を削除または別名退避
- new D1 database を作成
- wrangler.jsonc の database_id を更新
- migrations を適用
```

## 3.3 production data がある場合

この手順書では扱わない。  
本番データを残す場合は、別途 backfill / rollback 計画を作成する。

---

# 4. Store v2 実装

## 4.1 BillingStore

```ts
export type BillingStore = {
  findAccountBySubject(input: {
    subjectType: BillingSubjectType;
    subjectId: string;
  }): Promise<BillingAccount | null>;

  ensureAccount(input: {
    subjectType: BillingSubjectType;
    subjectId: string;
    provider: 'stripe';
    billingEmail?: string | null;
    billingName?: string | null;
  }): Promise<BillingAccount>;

  updateProviderCustomerId(input: {
    billingAccountId: string;
    providerCustomerId: string;
  }): Promise<void>;

  findCurrentSubscription(input: { billingAccountId: string }): Promise<BillingSubscription | null>;

  upsertSubscription(input: BillingSubscriptionUpsert): Promise<BillingSubscription>;

  readEntitlements(input: { billingAccountId: string }): Promise<BillingEntitlement[]>;

  replaceEntitlements(input: {
    billingAccountId: string;
    entitlements: BillingEntitlementInput[];
  }): Promise<void>;

  readPaymentIssue(input: { billingAccountId: string }): Promise<BillingPaymentIssue | null>;

  upsertPaymentIssue(input: BillingPaymentIssueUpsert): Promise<void>;

  appendPaymentIssueEvent(input: BillingPaymentIssueEventInput): Promise<void>;
};
```

## 4.2 DrizzleBillingStore

```txt
apps/backend/src/infra/billing/drizzle-billing-store.ts
```

責務:

```txt
- billing_account の作成 / 取得
- billing_subscription の upsert
- billing_entitlement の projection
- billing_payment_issue current row の upsert
- billing_invoice_event の append
```

禁止:

```txt
- Stripe provider を呼ばない
- Hono Context に依存しない
- reserve-app の route response を作らない
```

---

# 5. OperationStore v2 実装

```txt
apps/backend/src/infra/billing/drizzle-billing-operation-store.ts
```

## 5.1 claimAttempt

```ts
export type ClaimBillingOperationAttemptInput = {
  billingAccountId: string;
  purpose: BillingOperationPurpose;
  reuseKey: BillingOperationReuseKey;
  provider: 'stripe';
  createdByUserId?: string | null;
  now: Date;
};
```

## 5.2 claim 手順

```txt
1. billingAccountId + reuseKey の最新 attempt を取得
2. succeeded + handoffUrl 有効なら reused
3. processing + fresh なら reused processing
4. processing + stale なら expired にする
5. failed は reuse しない
6. attemptNumber を計算
7. idempotencyKey を生成
8. unique idempotencyKey で insert
9. conflict した場合は既存 row を fetch
```

## 5.3 idempotencyKey

```ts
idempotencyKey = `billing:${reuseKey}:${attemptNumber}`;
```

DB で unique:

```ts
uniqueIndex('billing_operation_attempt_idempotency_uidx').on(table.idempotencyKey);
```

---

# 6. Webhook EventStore v2 実装

```txt
apps/backend/src/infra/billing/drizzle-billing-event-store.ts
```

## 6.1 claimProviderEvent

```ts
export type ClaimProviderEventResult =
  | { kind: 'claimed'; attempt: number }
  | { kind: 'already_processed' }
  | { kind: 'already_processing_fresh' }
  | { kind: 'already_processing_stale_claimed'; attempt: number };
```

## 6.2 claim 手順

```txt
1. provider + providerEventId + scope で insert
2. insert 成功なら claimed
3. processed なら already_processed
4. failed なら processing に戻して attemptCount + 1
5. processing で processingStartedAt が stale なら attemptCount + 1
6. processing で fresh なら already_processing_fresh
```

`payloadHash` は同じ event id で payload が変わっていないかの診断に使う。

---

# 7. Reserve-app adapter

## 7.1 subject mapping

```ts
export const reserveAppBillingSubject = (organizationId: string) => ({
  subjectType: 'organization' as const,
  subjectId: organizationId,
});
```

## 7.2 entitlement keys

```ts
export const RESERVE_APP_ENTITLEMENTS = {
  ORGANIZATION_PREMIUM: 'organization.premium',
  STORE_MULTIPLE: 'store.multiple',
  STAFF_INVITE: 'staff.invite',
  BOOKING_APPROVAL: 'booking.approval',
  TICKET_ENABLED: 'ticket.enabled',
  ADVANCED_BILLING_COMMUNICATIONS: 'billing.advanced_communications',
} as const;
```

## 7.3 catalog

```ts
export const createReserveAppBillingCatalog = (env: AuthRuntimeEnv): BillingCatalog => {
  // price id が空なら catalog error
};
```

## 7.4 plan to entitlement

```ts
export const projectReserveAppEntitlements = ({
  planCode,
  subscriptionStatus,
  trialEnd,
  currentPeriodEnd,
  paymentIssue,
}: BillingProjectionInput): BillingEntitlementInput[] => {
  // free -> 基本 entitlement なし
  // trialing -> trial source
  // active -> paid source
  // past_due grace active -> policy に応じて paid source
  // unknown price -> entitlement なし
};
```

---

# 8. Billing usecase v2

## 8.1 getBillingSummary

```txt
1. subject を解決
2. account を読む
3. subscription を読む
4. payment issue current row を読む
5. entitlements を読む
6. owner-only history / documents / notifications を読む
7. presenter で response へ変換
```

## 8.2 startTrialSubscription

```txt
1. owner 権限確認
2. account ensure
3. trial 使用済み判定
4. catalog price 解決
5. operation attempt claim
6. provider customer ensure
7. trial subscription create
8. subscription upsert
9. entitlement projection
10. audit append
11. operation succeeded
```

## 8.3 createSubscriptionCheckout

```txt
1. owner 権限確認
2. account ensure
3. active lifecycle conflict 判定
4. catalog price 解決
5. operation attempt claim
6. provider customer ensure
7. checkout session create
8. operation succeeded with handoffUrl
```

## 8.4 createSetupCheckout

```txt
1. owner 権限確認
2. trialing subscription 確認
3. operation attempt claim
4. setup checkout create
5. operation succeeded
```

## 8.5 createSubscriptionUpdatePortal

```txt
1. owner 権限確認
2. provider subscription id 確認
3. operation attempt claim
4. portal session create with subscription_update flow
5. operation succeeded
```

---

# 9. Webhook v2

## 9.1 entrypoint

`create-app.ts` は以下だけ行う。

```txt
1. raw body
2. signature verify
3. event parse
4. handleStripeBillingWebhookV2
5. organization billing 以外の legacy ticket checkout fallback
```

## 9.2 handleStripeBillingWebhookV2

```txt
1. payloadHash を計算
2. provider event claim
3. already_processed -> 200
4. already_processing_fresh -> 500
5. event normalize
6. account / subscription upsert
7. payment issue upsert
8. payment issue event append
9. entitlement projection
10. audit / signal / notification
11. mark processed / failed
```

---

# 10. Entitlement gate 置き換え

## 10.1 Before

```ts
await ctx.requireOrganizationPremiumFeature(organizationId);
```

## 10.2 After

```ts
await ctx.requireOrganizationEntitlement({
  organizationId,
  key: RESERVE_APP_ENTITLEMENTS.BOOKING_APPROVAL,
});
```

## 10.3 置換対象

```txt
- booking approval
- ticket feature
- staff invite
- multiple store
- advanced billing communication
```

---

# 11. 実装順

## PR 1: Billing v2 schema

Scope:

```txt
- billing_account
- billing_subscription
- billing_payment_issue
- billing_invoice_event
- billing_entitlement
- billing_provider_event
- billing_operation_attempt
- billing_audit_event
- billing_signal
- billing_notification
- billing_document_reference
```

Done:

```txt
- 全 timestamp は timestamp_ms
- operation attempt idempotency_key unique
- payment issue current row は billing_account_id unique
- provider event は payload_hash / attempt_count / processing_started_at を持つ
```

---

## PR 2: Billing v2 stores

Scope:

```txt
- DrizzleBillingStore
- DrizzleBillingOperationStore
- DrizzleBillingEventStore
- DrizzleBillingInspectionStore
```

Done:

```txt
- Store は Stripe provider を呼ばない
- Store は Hono Context に依存しない
- claimAttempt は idempotencyKey unique を前提に実装
- claimProviderEvent は stale / failed retry を実装
```

---

## PR 3: reserve-app v2 adapter

Scope:

```txt
- reserve-app subject mapper
- reserve-app catalog
- reserve-app entitlement keys
- reserve-app entitlement projection
```

Done:

```txt
- organizationId -> subjectType/subjectId
- premium plan -> entitlement keys
- unknown price -> entitlement なし
```

---

## PR 4: Billing routes/usecases v2

Scope:

```txt
- summary
- trial
- checkout
- setup checkout
- portal
- trial completion
```

Done:

```txt
- organization_billing 旧 store を使わない
- billing v2 store を使う
- route response は必要に応じて変えてよい
```

---

## PR 5: Webhook v2

Scope:

```txt
- provider event claim
- subscription projection
- payment issue projection
- entitlement projection
- audit/signal/notification
```

Done:

```txt
- processed duplicate no-op
- failed duplicate retry
- fresh processing は同期 webhook で 500
- unknown price no entitlement
```

---

## PR 6: entitlement gate 置き換え

Scope:

```txt
- booking
- ticket
- staff
- store
```

Done:

```txt
- premium 判定ではなく entitlement key 判定
```

---

## PR 7: 旧 organization_billing 削除

既存データを捨てられるため、v2 が動いたら旧 table / 旧 domain 関数を削除してよい。

Scope:

```txt
- organization_billing
- organization_billing_* append-only tables
- old organization billing domain functions
- old compatibility code
```

Done:

```txt
- backend typecheck
- backend test
- web 契約画面が v2 response を読む
```

---

# 12. テスト計画

## 12.1 Schema / Store

```txt
- billing_operation_attempt.idempotencyKey unique
- duplicate idempotencyKey insert は 2 件にならない
- billing_payment_issue は account ごとに 1 current row
- provider event duplicate は processed no-op
- provider event failed は retry claim
- provider event stale processing は retry claim
```

## 12.2 Usecase

```txt
- trial start creates subscription and entitlements
- checkout creates handoff and operation attempt
- setup checkout uses existing customer
- portal uses subscription_update flow
- unknown price creates no entitlement
```

## 12.3 Webhook

```txt
- checkout.session.completed
- customer.subscription.created
- customer.subscription.updated
- invoice.payment_failed
- invoice.payment_action_required
- invoice.paid
- duplicate event
- failed retry event
```

## 12.4 Entitlement

```txt
- free has no premium feature
- trialing has trial-sourced entitlement
- active has paid-sourced entitlement
- unknown price has no entitlement
- past_due grace policy is applied
```

---

# 13. 最終判断

既存データを捨てられるなら、次は **Billing v2 schema + generic store** に進むべき。

今回のレビュー指摘を反映した重要ポイントは以下。

```txt
- idempotencyKey は DB unique
- timestamp_ms に統一
- billing_provider_event は payloadHash / attemptCount / processingStartedAt を持つ
- billing_payment_issue は current row を unique にする
- backfill はしない
```

これにより、MVP 段階で将来の SaaS 再利用に向いた課金基盤を作れる。
