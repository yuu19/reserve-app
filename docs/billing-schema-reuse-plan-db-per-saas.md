# SaaS ごとに DB を分けて Billing schema を使い回すための現状と残作業

## この文書の扱い

この文書は現行仕様の正本ではなく、課金 schema 再利用化の履歴・計画メモです。
現行の組織単位課金仕様は [billing.md](./billing.md) を確認してください。

## 1. 前提

この文書は、複数の SaaS で同じ課金基盤を使い回し、DB は SaaS ごとに分ける方針を扱う。

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

同じ DB に複数 SaaS の課金情報を入れない。
そのため、v1 では `product_code` や table 名の差し替えを入れない。
各 SaaS の DB 内で、固定の `billing_*` table をそのまま使う。

## 2. 目的

Reserve App の課金挙動を落とさずに、他 SaaS へ移植できる課金基盤を用意する。

目的は次の 3 つ。

```txt
1. billing_* schema と Drizzle store を共通 package から使えるようにする
2. SaaS ごとの差分を subject / catalog / entitlement / policy に閉じ込める
3. Reserve App の既存の支払い失敗、通知、監査、内部調査、operation attempt を維持する
```

## 3. 非ゴール

次は v1 の対象外にする。

```txt
- 複数 SaaS を 1 つの DB で運用する
- table 名や table 定義を factory で注入する
- Stripe 以外の provider に本格対応する
- Billing UI を共通 package 化する
- 通知文面を共通化する
- Reserve App の業務ロジックを core に移す
- すべての usecase を最初から package 化する
```

table injection は将来の選択肢として残す。
ただし DB per SaaS の v1 では、固定の `billing_*` schema と `createId` / `now` 注入で十分とする。

## 4. 現在の package 状態

現在は `packages/saas-billing-core` と `packages/saas-billing-drizzle` が存在する。
Reserve App の backend は、その package を import して billing schema と store を使っている。

### 4.1 `saas-billing-core`

`saas-billing-core` は DB や Stripe SDK を知らない。

現在含めているもの。

```txt
- BillingSubjectType
- BillingCatalog
- BillingProvider port
- BillingStore port
- BillingOperationStore port
- BillingEventStore port
- operation reuse key helper
- webhook claim result
- entitlement helper
- payment issue helper
```

`BillingSubjectType` は `string` として扱う。
共通 package では、未知の `subjectType` を `organization` に丸めない。
アプリごとの許可値は、各 SaaS の policy や request validation で制御する。

### 4.2 `saas-billing-drizzle`

`saas-billing-drizzle` は Drizzle SQLite/D1 用の schema と store を持つ。
`apps/backend` の schema や `AuthRuntimeDatabase` には依存しない。

現在含めているもの。

```txt
- billing_* table definitions
- createDrizzleBillingStore
- createDrizzleBillingOperationStore
- createDrizzleBillingEventStore
- retryBillingSequenceInsert
```

store factory は次を受け取れる。

```ts
createDrizzleBillingStore({
  database,
  createId: () => crypto.randomUUID(),
  now: () => new Date(),
});

createDrizzleBillingOperationStore({
  database,
  createId: () => crypto.randomUUID(),
  now: () => new Date(),
});

createDrizzleBillingEventStore({
  database,
  createId: () => crypto.randomUUID(),
});
```

`createId` と `now` は省略できる。
省略した場合は、現行どおり `crypto.randomUUID()` と `new Date()` を使う。

`BillingEventStore` は各 method が受け取る `now` や `processedAt` を正本にする。
そのため factory の `now` は現時点では互換用の option として受け取り、暗黙の時刻更新には使わない。

### 4.3 Reserve App 側の接続

Reserve App の `apps/backend/src/infra/db/schema.ts` は、package の billing table を re-export している。

```ts
export {
  billingAccount,
  billingSubscription,
  billingPaymentIssue,
  billingInvoiceEvent,
  billingEntitlement,
  billingProviderEvent,
  billingOperationAttempt,
  billingAuditEvent,
  billingSignal,
  billingNotification,
  billingDocumentReference,
  billingTables,
} from '@repo/saas-billing-drizzle/schema';
```

backend の wrapper は、Reserve App の runtime DB 型を package 側の DB 型へ接続する薄い adapter になっている。
現在は既定値の `createId` / `now` を使うため、アプリの挙動は変わらない。

## 5. 維持する schema 契約

共通化しても、Reserve App の現在の課金挙動は変えない。
特に、支払い失敗、通知履歴、監査履歴、内部調査、operation attempt の扱いを維持する。

必ず維持する契約。

```txt
- billing_account は課金対象ごとの root とする
- billing_payment_issue は billing_account_id ごとに 1 current row とする
- billing_operation_attempt.idempotency_key は unique とする
- billing_operation_attempt は billing_account_id + reuse_key + attempt_number を unique とする
- billing_provider_event は provider + provider_event_id + scope を unique とする
- billing_audit_event / billing_signal / billing_notification は sequence_number で account 内の順序を保証する
- billing_audit_event / billing_signal / billing_notification は billing_account_id + sequence_number を unique とする
- sequence 採番は衝突時に retry する
- billing_notification_dedupe_uidx は同じ attempt の同じ delivery status だけを重複排除する
```

この契約は schema、store、migration、test のすべてで確認する。
package 化のために制約や retry を弱めない。

## 6. 共通 schema に含める table

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

これらは SaaS 課金基盤として再利用する。
DB per SaaS では table 名を変えずに使う。

## 7. SaaS ごとに差し替えるもの

共通 package は課金の保存先と基本操作を提供する。
契約や権限の意味づけは、各 SaaS 側に残す。

SaaS ごとに差し替えるもの。

```txt
- subject mapper
- plan catalog
- entitlement key
- entitlement projection
- permission policy
- notification policy
- presenter
- route / usecase
- provider env mapping
```

Reserve App では、課金対象は organization になる。

```ts
export const reserveAppBillingSubject = (organizationId: string) => ({
  subjectType: 'organization' as const,
  subjectId: organizationId,
});
```

別 SaaS では、同じ table を使いながら subject を変える。

```ts
export const workspaceBillingSubject = (workspaceId: string) => ({
  subjectType: 'workspace' as const,
  subjectId: workspaceId,
});
```

## 8. 別 SaaS への導入例

ここでは `workspace` を課金対象にする SaaS を例にする。
実装ファイルを増やすのではなく、導入時に必要な差し替え点を示す。

### 8.1 subject mapper

```ts
export const workspaceBillingSubject = (workspaceId: string) => ({
  subjectType: 'workspace' as const,
  subjectId: workspaceId,
});
```

### 8.2 catalog

```ts
import type { BillingCatalog } from '@repo/saas-billing-core';

export const workspaceBillingCatalog: BillingCatalog = {
  prices: [
    {
      planCode: 'pro',
      interval: 'month',
      provider: 'stripe',
      providerPriceId: env.STRIPE_PRO_MONTHLY_PRICE_ID,
    },
    {
      planCode: 'pro',
      interval: 'year',
      provider: 'stripe',
      providerPriceId: env.STRIPE_PRO_YEARLY_PRICE_ID,
    },
  ],
};
```

`planCode` の意味は table ではなく catalog で決める。
Reserve App では `free / premium`、別 SaaS では `free / pro / business` のように変えられる。

### 8.3 entitlement projection

```ts
import { createActiveEntitlementInput } from '@repo/saas-billing-core';
import type { BillingEntitlementInput, BillingSubscriptionStatus } from '@repo/saas-billing-core';

export const projectWorkspaceEntitlements = ({
  planCode,
  subscriptionStatus,
}: {
  planCode: string;
  subscriptionStatus: BillingSubscriptionStatus;
}): BillingEntitlementInput[] => {
  if (planCode !== 'pro' || subscriptionStatus !== 'active') {
    return [];
  }

  return [
    createActiveEntitlementInput({
      key: 'export.csv',
      source: 'paid',
      reason: 'active_subscription',
    }),
    createActiveEntitlementInput({
      key: 'team.invite',
      source: 'paid',
      reason: 'active_subscription',
    }),
  ];
};
```

アプリ本体は plan ではなく entitlement を見る。
これにより、plan 名が SaaS ごとに違っても利用可否の判定を揃えられる。

### 8.4 store 利用手順

```ts
import {
  createDrizzleBillingEventStore,
  createDrizzleBillingOperationStore,
  createDrizzleBillingStore,
} from '@repo/saas-billing-drizzle';

const billingStore = createDrizzleBillingStore({
  database,
  createId: () => crypto.randomUUID(),
  now: () => new Date(),
});

const operationStore = createDrizzleBillingOperationStore({
  database,
  createId: () => crypto.randomUUID(),
  now: () => new Date(),
});

const eventStore = createDrizzleBillingEventStore({
  database,
  createId: () => crypto.randomUUID(),
});
```

導入手順。

```txt
1. app の schema.ts で @repo/saas-billing-drizzle/schema を re-export する
2. Drizzle migration をその SaaS の app で生成する
3. subject mapper を作る
4. catalog を作る
5. entitlement projection を作る
6. BillingProvider を用意する
7. store / operation store / event store を usecase から呼ぶ
8. route / presenter / notification を app 側で作る
```

## 9. migration 運用

SaaS ごとに DB を分けるため、migration は各 app で生成する。

```txt
packages/saas-billing-drizzle/schema.ts
  ↓ import
apps/<saas>/src/infra/db/schema.ts
  ↓ drizzle generate
apps/<saas>/drizzle/*.sql
```

この方式では、app 固有 table と課金 table を同じ migration chain で管理できる。
D1 でも扱いやすい。

package に migration template を持つ案は、v1 では採用しない。
app 固有 migration との統合が複雑になるため。

### app 固有 FK を外す場合

既存 table から app 固有 FK を外す場合、SQLite/D1 では table rebuild を前提にする。
`ALTER TABLE` だけで FK を安全に外せる前提にしない。

手順。

```txt
1. FK なしの __new_billing_* table を作る
2. 既存 table から全列を copy する
3. index / unique index を再作成する
4. 旧 table を drop する
5. __new_billing_* を正式名へ rename する
6. migration replay と billing tests で確認する
```

この migration でも、`sequence_number`、unique index、通知 dedupe の形は維持する。

## 10. CI と検証

package 化した billing schema は、migration 生成漏れを CI で検知する。

CI では backend の Drizzle metadata check を実行する。

```txt
pnpm --filter @apps/backend exec drizzle-kit check --config ./drizzle.config.ts
```

package 側では、SQLite runtime dependency を追加しない。
Drizzle store の単体テストは fake Drizzle database で、次の挙動を検証する。

```txt
- provider event の初回 claim
- processed duplicate の no-op 扱い
- failed provider event の retry claim
- stale processing provider event の retry claim
- operation attempt の新規 claim
- fresh processing attempt の再利用
- succeeded handoff の再利用
- stale processing attempt の expired 化
- failed / expired update
- recent attempt の新しい順の読み取り
```

## 11. 現在完了していること

```txt
- billing_* schema は package から import できる
- Reserve App backend は package schema を re-export している
- 共通 Drizzle store は apps/backend の schema や AuthRuntimeDatabase を import していない
- unknown subjectType を organization に丸めない
- createId / now を store factory に注入できる
- sequence_number の unique 制約と retry helper は package にある
- workspace subject でも account / subscription / entitlement を扱える
- Drizzle metadata check を CI に追加している
```

## 12. 残作業

別 SaaS で実際に使うには、次が残る。

```txt
- その SaaS の app schema で billing schema を re-export する
- その SaaS の Drizzle migration を生成する
- subject mapper / catalog / entitlement projection を作る
- provider env と Stripe price id を用意する
- route / presenter / notification / permission policy を app 側に実装する
- migration replay と billing tests をその SaaS の CI に追加する
```

将来、同じ DB に複数 SaaS を入れる必要が出た場合は、`product_code` や table injection を再検討する。
現時点では DB per SaaS を前提に、固定 `billing_*` schema を維持する。

## 13. 最終判断

SaaS ごとに DB を分けるなら、課金用 table は固定名のまま使い回せる。

重要なのは次の分離。

```txt
共通:
  billing_* schema
  store interface
  Drizzle store
  webhook claim
  operation handoff
  sequence retry

app 固有:
  subject
  catalog
  entitlement
  permission
  notification
  presenter
  route / usecase
```

つまり、**DB は分ける、schema は同じ、意味づけは app policy で変える**のが v1 方針。
