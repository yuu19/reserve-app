# SaaS ごとに DB を分けて Billing schema を使い回すための実行計画

## 0. 前提

この計画は、複数の SaaS で同じ課金基盤を使い回すが、**DB は SaaS ごとに分ける**ことを前提にする。

```txt
reserve-app DB
  billing_account
  billing_subscription
  billing_entitlement
  ...

another-saas DB
  billing_account
  billing_subscription
  billing_entitlement
  ...
```

同じ DB に複数 SaaS の課金情報を入れないため、初期段階では `product_code` は必須にしない。
各 SaaS の DB 内で、`billing_*` table 名をそのまま使う。

---

## 1. 目的

現在の Billing v2 schema を、他の SaaS でも再利用できる形に整理する。

目的は次の 3 つ。

```txt
1. billing_* schema を共通 package として使えるようにする
2. SaaS ごとの差分を subject / catalog / entitlement / policy に閉じ込める
3. reserve-app の実装を壊さず、将来別 SaaS に移植できる状態にする
```

---

## 2. 非ゴール

次は今回の対象外にする。

```txt
- 複数 SaaS を 1 つの DB で運用する
- Stripe 以外の provider に本格対応する
- Billing UI を共通 package 化する
- 通知文面を共通化する
- reserve-app の業務ロジックを core に移す
- 全 usecase を最初から package 化する
```

---

## 3. 最終アーキテクチャ

理想形は次の構成。

```txt
packages/
  saas-billing-core/
    src/
      types.ts
      catalog.ts
      entitlement.ts
      operation.ts
      webhook.ts
      payment-issue.ts
      ports.ts

  saas-billing-drizzle/
    src/
      schema.ts
      stores/
        drizzle-billing-store.ts
        drizzle-billing-operation-store.ts
        drizzle-billing-event-store.ts

apps/
  backend/
    src/
      features/
        billing/
          policies/
            reserve-app-billing-catalog.ts
            reserve-app-billing-policy.ts
            reserve-app-entitlements.ts
          usecases/
          presenters/
          routes/

      infra/
        payment/
          stripe-billing-provider.ts
```

依存方向は次の通り。

```txt
apps/backend
  -> packages/saas-billing-core
  -> packages/saas-billing-drizzle

packages/saas-billing-drizzle
  -> packages/saas-billing-core

packages/saas-billing-core
  -> app に依存しない
```

---

## 4. DB を分ける場合の設計方針

DB を SaaS ごとに分ける場合、同じ schema をそのまま使える。

```txt
reserve-app DB:
  billing_account.subject_type = organization
  billing_account.subject_id = org_xxx

another-saas DB:
  billing_account.subject_type = workspace
  billing_account.subject_id = ws_xxx
```

この場合、`billing_account` の unique index は次でよい。

```ts
uniqueIndex('billing_account_subject_uidx').on(
  billingAccount.subjectType,
  billingAccount.subjectId,
);
```

`product_code` は不要。
ただし、将来 1 DB に複数プロダクトを入れる可能性が出たら、別途 `product_code` を追加する。

---

## 5. 共通 schema に含める table

共通化対象は以下。

```txt
billing_account
billing_subscription
billing_payment_issue
billing_invoice_event
billing_entitlement
billing_provider_event
billing_operation_attempt
billing_audit_event
billing_signal
billing_notification
billing_document_reference
```

これらは SaaS 課金基盤として再利用できる。

---

## 6. 共通 schema から app 固有 FK を外す

再利用 schema では、app 固有 table への FK は避ける。

例えば、現在のように `user.id` へ参照するカラムは、共通 package では plain text にする。

```txt
created_by_user_id
actor_user_id
recipient_user_id
```

理由:

```txt
- SaaS ごとに user table 名や auth provider が違う
- better-auth / custom auth / external auth などに対応しやすい
- DB per SaaS なら参照整合性は app 側 policy で担保できる
```

推奨:

```ts
createdByUserId: text('created_by_user_id')
actorUserId: text('actor_user_id')
recipientUserId: text('recipient_user_id')
```

もし app 側で FK を付けたい場合は、schema factory で optional reference を渡す方式を検討する。

```ts
createBillingSchema({
  userTable,
});
```

ただし最初は plain text で十分。

---

## 6.1 共通 package へ移す前に守る契約

共通化しても、Reserve App の現在の課金挙動は変えない。
特に、支払い失敗、通知履歴、監査履歴、内部調査、operation attempt の扱いは維持する。

必ず維持する契約:

```txt
- billing_account は課金対象ごとの root とする
- billing_payment_issue は billing_account_id ごとに 1 current row とする
- billing_operation_attempt.idempotency_key は unique とする
- billing_audit_event / billing_signal / billing_notification は sequence_number で account 内の順序を保証する
- billing_audit_event / billing_signal / billing_notification は billing_account_id + sequence_number を unique とする
- sequence 採番は衝突時に retry する
- billing_notification_dedupe_uidx は同じ attempt の同じ delivery status だけを重複排除する
```

この契約は schema、store、migration、test のすべてで確認する。
package 化のために制約や retry を弱めない。

---

## 7. 共通 package の責務

## 7.1 `saas-billing-core`

`saas-billing-core` は DB や Stripe SDK を知らない。

置くもの:

```txt
- BillingSubject
- BillingCatalog
- BillingPlan
- BillingEntitlement
- BillingSubscriptionStatus
- BillingOperationPurpose
- BillingOperationReuseKey
- ProviderEventClaimResult
- BillingProvider port
- BillingStore port
- BillingOperationStore port
- BillingEventStore port
- 純粋な判定関数
```

例:

```ts
export type BillingSubjectType = string;

export type BillingSubject = {
  subjectType: BillingSubjectType;
  subjectId: string;
};
```

共通 package では、未知の `subjectType` を別の値に丸めない。
読み取れない値はそのまま返すか、app 側の validation で拒否する。

### core に入れる純粋ロジック

```txt
- operation handoff decision
- webhook claim decision
- entitlement projection helper
- payment issue state helper
- catalog validation
```

### core に入れないもの

```txt
- Hono Context
- Better Auth session
- Drizzle table
- Stripe SDK
- reserve-app の文言
- organization / classroom / booking / ticket
- owner/admin/member の role 判定
```

---

## 7.2 `saas-billing-drizzle`

`saas-billing-drizzle` は Drizzle SQLite/D1 用の schema と store を持つ。
ただし、`apps/backend` には依存しない。

置くもの:

```txt
- billing table definitions
- DrizzleBillingStore
- DrizzleBillingOperationStore
- DrizzleBillingEventStore
- schema helper
```

store は次を外から受け取る。

```txt
- Drizzle database instance
- billing table definitions
- now() helper
- createId() helper
```

`AuthRuntimeDatabase` や `apps/backend/src/infra/db/schema.ts` は import しない。
Reserve App 側で使う場合は、app schema から billing tables を渡す。

```ts
createDrizzleBillingStore({
  database,
  tables: billingTables,
  now: () => new Date(),
  createId: () => crypto.randomUUID(),
});
```

DB は SaaS ごとに分かれるため、table 名は固定でよい。

```txt
billing_account
billing_subscription
...
```

---

## 8. app 側に残すもの

Reserve App 側に残すべきもの。

```txt
- organizationId -> BillingSubject への変換
- Free / Premium / Trial の意味
- 7 日間 trial
- premium price id の env
- booking.approval などの entitlement key
- owner だけが課金操作できる policy
- owner 通知の文面
- billing summary の表示形式
- internal inspection の表示形式
```

Reserve App では次のように subject を作る。

```ts
export const reserveAppBillingSubject = (organizationId: string) => ({
  subjectType: 'organization' as const,
  subjectId: organizationId,
});
```

別 SaaS では差し替える。

```ts
export const anotherSaasBillingSubject = (workspaceId: string) => ({
  subjectType: 'workspace' as const,
  subjectId: workspaceId,
});
```

---

## 9. 再利用する schema の詳細方針

## 9.1 `billing_account`

課金対象と provider customer を結びつける。

```txt
subject_type
subject_id
provider
provider_customer_id
billing_email
billing_name
```

使い回し方:

```txt
reserve-app:
  subject_type = organization

another-saas:
  subject_type = workspace
```

---

## 9.2 `billing_subscription`

契約状態の正本。

```txt
plan_code
price_code
interval
status
trial_start
trial_end
current_period_start
current_period_end
cancel_at_period_end
```

`plan_code` の意味は table ではなく catalog で決める。

```txt
reserve-app:
  free / premium

another-saas:
  free / pro / business
```

---

## 9.3 `billing_entitlement`

機能利用可否の projection。

```txt
key
active
source
reason
valid_from
valid_until
```

Reserve App:

```txt
booking.approval
ticket.enabled
staff.invite
classroom.multiple
```

別 SaaS:

```txt
export.csv
team.invite
ai.assistant
project.unlimited
```

アプリ本体は plan ではなく entitlement を見る。

```ts
await requireEntitlement({
  subjectType: 'workspace',
  subjectId: workspaceId,
  key: 'export.csv',
});
```

---

## 9.4 `billing_operation_attempt`

Checkout / Portal / Setup / Trial の owner 操作を冪等にする。

重要な制約:

```txt
idempotency_key unique
billing_account_id + reuse_key + attempt_number unique
```

使い回す operation purpose:

```txt
start_trial_subscription
create_subscription_checkout
create_setup_checkout
create_portal_session
```

reuse key は core helper で作る。

```ts
buildBillingOperationReuseKey({
  purpose: 'create_subscription_checkout',
  subjectType: 'workspace',
  subjectId: workspaceId,
  planCode: 'pro',
  interval: 'month',
});
```

---

## 9.5 `billing_provider_event`

Webhook の冪等性 table。

重要な制約:

```txt
provider + provider_event_id + scope unique
```

持つ情報:

```txt
payload_hash
processing_status
receipt_status
attempt_count
processing_started_at
last_attempt_at
processing_stale_after_ms
failure_reason
failure_stage
```

使い回し方:

```txt
provider = stripe
scope = billing
```

別 provider に対応するときも同じ table を使える。

---

## 9.6 `billing_invoice_event` / `billing_document_reference`

請求書・支払いイベントと文書参照を分ける。

```txt
billing_invoice_event:
  invoice_available
  payment_succeeded
  payment_failed
  payment_action_required

billing_document_reference:
  invoice
  receipt
  hosted_invoice_url
  invoice_pdf_url
  receipt_url
```

この分離は維持する。

---

## 9.7 `billing_notification`

通知履歴を recipient scoped に残す。

```txt
notification_kind
channel
sequence_number
recipient_email
delivery_status
attempt_number
provider_event_id
```

同じ attempt の `requested / sent / failed` などを append-only で残すなら、unique key に `delivery_status` を含める。

```txt
billing_account_id
notification_kind
recipient_email
provider_event_id
attempt_number
delivery_status
```

通知文面・送信対象・retry policy は app 側に残す。

---

## 9.8 `billing_audit_event` / `billing_signal`

運用・調査用。

```txt
billing_audit_event:
  状態変更履歴

billing_signal:
  mismatch / unavailable / resolved などの調査 signal
```

共通 table として使える。
ただし `source_kind` や `reason` の vocabulary は app ごとに定義する。

重要な制約:

```txt
billing_account_id + sequence_number unique
```

履歴の並び順は `created_at` だけに依存しない。
同じ課金対象の中では `sequence_number` を使って順序を決める。

---

## 10. 実装フェーズ

## Phase 1: 現在の schema を shared package 用に固める

やること:

```txt
- current billing v2 schema を確認
- app 固有 FK を共通 schema から外す方針を決める
- schema package に移す table を確定
- docs に共通 schema の意図を記載
```

成果物:

```txt
docs/billing-schema-reuse.md
```

---

## Phase 2: `packages/saas-billing-core` を整理する

やること:

```txt
- BillingSubject
- BillingSubjectType を string として扱う方針
- BillingCatalog
- BillingProvider
- BillingStore
- BillingOperationStore
- BillingEventStore
- operation reuse key builder
- webhook claim result
- catalog validation
```

成果物:

```txt
packages/saas-billing-core/src/
  types.ts
  catalog.ts
  operation.ts
  webhook.ts
  ports.ts
```

---

## Phase 3: `packages/saas-billing-drizzle` を作る

やること:

```txt
- billing schema を package に移す
- DrizzleBillingStore を package に移す
- DrizzleBillingOperationStore を package に移す
- DrizzleBillingEventStore を package に移す
- database / tables / now / createId を注入できるようにする
- sequence 採番と retry helper を package に移す
```

注意:

```txt
- app の user table へ FK しない
- table 名は billing_* のまま
- DB per SaaS なので product_code は不要
- apps/backend の schema や AuthRuntimeDatabase を import しない
- unknown subjectType を organization に丸めない
- sequence_number の unique 制約と retry 方針を維持する
```

成果物:

```txt
packages/saas-billing-drizzle/src/schema.ts
packages/saas-billing-drizzle/src/stores/
```

---

## Phase 4: reserve-app 側を package schema に接続する

やること:

```txt
- apps/backend/src/infra/db/schema.ts で package の billing table 定義を re-export する
- reserve-app 固有 table はそのまま app schema に残す
- reserve-app billing store が package store に app 側の billing table bundle を渡す
```

イメージ:

```ts
export {
  billingAccount,
  billingSubscription,
  billingEntitlement,
  billingProviderEvent,
  billingOperationAttempt,
  billingInvoiceEvent,
  billingPaymentIssue,
  billingNotification,
  billingAuditEvent,
  billingSignal,
  billingDocumentReference,
} from '@repo/saas-billing-drizzle/schema';

export const reserveAppBillingTables = {
  billingAccount,
  billingSubscription,
  billingEntitlement,
  billingProviderEvent,
  billingOperationAttempt,
  billingInvoiceEvent,
  billingPaymentIssue,
  billingNotification,
  billingAuditEvent,
  billingSignal,
  billingDocumentReference,
};
```

```ts
const billingStore = createDrizzleBillingStore({
  database,
  tables: reserveAppBillingTables,
  now: () => new Date(),
  createId: () => crypto.randomUUID(),
});
```

---

## Phase 5: 別 SaaS で使える sample test を作る

別 SaaS 用のダミー subject で schema reuse を検証する。

```ts
it('workspace billing can reuse billing schema', async () => {
  const subject = {
    subjectType: 'workspace',
    subjectId: 'workspace_1',
  };

  const account = await billingStore.ensureAccount({
    ...subject,
    provider: 'stripe',
  });

  const subscription = await billingStore.upsertSubscription({
    billingAccountId: account.id,
    provider: 'stripe',
    planCode: 'pro',
    status: 'active',
    interval: 'month',
  });

  await billingStore.replaceEntitlements({
    billingAccountId: account.id,
    entitlements: [
      {
        key: 'export.csv',
        active: true,
        source: 'paid',
        reason: 'active_subscription',
      },
    ],
  });
});
```

これで `organization` に依存せず schema を使えることを確認する。

---

## Phase 6: migration 運用を決める

SaaS ごとに DB を分けるため、migration は次のどちらか。

### 案 A: 各 app で migration 生成

```txt
packages/saas-billing-drizzle/schema.ts
  ↓ import
apps/backend/src/infra/db/schema.ts
  ↓ drizzle generate
apps/backend/drizzle/*.sql
```

メリット:

```txt
- app 固有 table と一緒に migration 管理できる
- D1 では扱いやすい
```

デメリット:

```txt
- 各 app で migration が重複する
```

### 案 B: package に migration template を持つ

```txt
packages/saas-billing-drizzle/migrations/
```

メリット:

```txt
- billing schema の変更履歴を共通化できる
```

デメリット:

```txt
- app 固有 migration との統合が面倒
```

推奨は **案 A**。
最初は各 SaaS app で migration を生成する方が簡単。

### app 固有 FK を外す migration

既存 table から app 固有 FK を外す場合、SQLite/D1 では table rebuild を前提にする。
`ALTER TABLE` だけで FK を安全に外せる前提にしない。

手順:

```txt
1. FK なしの __new_billing_* table を作る
2. 既存 table から全列を copy する
3. index / unique index を再作成する
4. 旧 table を drop する
5. __new_billing_* を正式名へ rename する
6. migration replay と billing tests で確認する
```

対象になりやすい column:

```txt
created_by_user_id
actor_user_id
recipient_user_id
```

この migration でも、`sequence_number`、unique index、通知 dedupe の形は維持する。

---

## 11. 使い回し時の手順

新しい SaaS に導入する場合。

```txt
1. @repo/saas-billing-core を依存に追加
2. @repo/saas-billing-drizzle を依存に追加
3. app の schema.ts で billing schema を re-export
4. drizzle migration を生成
5. subject mapper を作る
6. plan catalog を作る
7. entitlement keys を定義
8. entitlement projection を作る
9. BillingProvider を用意する
10. route / presenter / notification を app 側で作る
```

---

## 12. 具体例: another-saas

### subject

```ts
export const anotherSaasBillingSubject = (workspaceId: string) => ({
  subjectType: 'workspace' as const,
  subjectId: workspaceId,
});
```

### catalog

```ts
export const anotherSaasBillingCatalog = {
  plans: [
    {
      planCode: 'pro',
      prices: [
        {
          interval: 'month',
          providerPriceId: env.STRIPE_PRO_MONTHLY_PRICE_ID,
        },
      ],
      entitlements: ['export.csv', 'team.invite'],
    },
  ],
};
```

### entitlement projection

```ts
export const projectAnotherSaasEntitlements = ({
  planCode,
  subscriptionStatus,
}: {
  planCode: string;
  subscriptionStatus: string;
}) => {
  if (planCode === 'pro' && subscriptionStatus === 'active') {
    return [
      {
        key: 'export.csv',
        active: true,
        source: 'paid',
        reason: 'active_subscription',
      },
      {
        key: 'team.invite',
        active: true,
        source: 'paid',
        reason: 'active_subscription',
      },
    ];
  }

  return [];
};
```

---

## 13. Done 条件

この計画の完了条件。

```txt
- [ ] billing_* schema が package から import できる
- [ ] app 固有 user table への FK が共通 schema から外れている
- [ ] Reserve App が package schema を使って動く
- [ ] Drizzle migration が生成できる
- [ ] Reserve App の billing tests が通る
- [ ] workspace subject の sample test が通る
- [ ] catalog / entitlement / subject だけ差し替えれば別 SaaS で使える
- [ ] docs に DB per SaaS 方針が明記されている
- [ ] 共通 Drizzle store が apps/backend の型や schema を import していない
- [ ] sequence_number の unique 制約と retry 方針が package 化後も維持されている
- [ ] unknown subjectType を organization に丸めない
- [ ] app 固有 FK を外す migration 手順が D1/SQLite 前提で明記されている
```

---

## 14. 最終判断

SaaS ごとに DB を分けるなら、課金用 table はかなり素直に使い回せる。

重要なのは次の分離。

```txt
共通:
  billing_* schema
  store interface
  Drizzle store
  webhook claim
  operation handoff

app 固有:
  subject
  catalog
  entitlement
  permission
  notification
  presenter
```

つまり、**DB は分ける、schema は同じ、意味づけは app policy で変える**のが最終方針。
