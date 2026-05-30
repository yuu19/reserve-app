# @repo/saas-billing-drizzle

別 SaaS の backend に、既存の課金 schema と Drizzle store を導入するための入口です。
設計判断と残作業の詳細は [SaaS ごとに DB を分けて Billing schema を使い回すための現状と残作業](../../docs/billing-schema-reuse-plan-db-per-saas.md) を正とします。

この README では、導入時に最低限確認する手順だけをまとめます。

## この package が提供するもの

`@repo/saas-billing-drizzle` は、SaaS ごとに DB を分ける前提で固定名の `billing_*` table と Drizzle 実装を提供します。

- `billing_account` から始まる `billing_*` schema
- `createDrizzleBillingStore`
- `createDrizzleBillingOperationStore`
- `createDrizzleBillingEventStore`
- `retryBillingSequenceInsert`

`billing_audit_event`、`billing_signal`、`billing_notification` は、課金対象内の `sequence_number` 順序を維持します。
衝突時は `retryBillingSequenceInsert` で再試行します。

## 併用する core package

業務上の契約、plan、権限判定に近い型や helper は `@repo/saas-billing-core` を併用します。

- `BillingCatalog`
- `BillingProvider`
- `BillingStore`
- `BillingOperationStore`
- `BillingEventStore`
- `createActiveEntitlementInput`
- `hasActiveBillingEntitlement`
- operation reuse key helper

`@repo/saas-billing-drizzle` は保存先と Drizzle 実装を担当します。
契約の意味づけ、画面表示、通知、権限 policy は各 SaaS の app 側に置きます。

## v1 の前提

DB は SaaS ごとに分けます。
同じ DB に複数 SaaS の課金情報を混ぜません。

そのため v1 では、次を対象外にします。

- `product_code` による SaaS 識別
- table 名の差し替え
- table 定義の injection
- app 固有の route、presenter、通知文面、権限 policy の共通化

各 SaaS の DB では、固定名の `billing_*` table をそのまま使います。

## 導入手順

1. app 側の Drizzle schema で `@repo/saas-billing-drizzle/schema` を re-export する。
2. その SaaS の app で Drizzle migration を生成する。
3. 課金対象を決める subject mapper を作る。
4. Stripe price id と plan の対応を表す catalog を作る。
5. 契約状態から entitlement を作る projection を作る。
6. `createDrizzleBillingStore`、`createDrizzleBillingOperationStore`、`createDrizzleBillingEventStore` を app の DB 型へ接続する。
7. route、usecase、presenter、notification、permission policy を app 側で実装する。
8. migration replay と billing regression をその SaaS の CI に追加する。

## 最小コード例

ここでは `workspace` を課金対象にする SaaS を例にします。

### schema re-export

```ts
// apps/<saas>/src/infra/db/schema.ts
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

### subject mapper

```ts
export const workspaceBillingSubject = (workspaceId: string) => ({
  subjectType: 'workspace' as const,
  subjectId: workspaceId,
});
```

`BillingSubjectType` は `string` です。
許可する subject は、各 SaaS の request validation や policy で制御します。

### catalog

```ts
import type { BillingCatalog } from '@repo/saas-billing-core';

type WorkspaceBillingEnv = {
  STRIPE_PRO_MONTHLY_PRICE_ID: string;
  STRIPE_PRO_YEARLY_PRICE_ID: string;
};

export const createWorkspaceBillingCatalog = (env: WorkspaceBillingEnv): BillingCatalog => ({
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
});
```

`planCode` の意味は table ではなく catalog と app policy で決めます。

### entitlement projection

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

アプリ本体は plan 名ではなく entitlement を見て利用可否を判定します。

### store wiring

```ts
import {
  createDrizzleBillingEventStore,
  createDrizzleBillingOperationStore,
  createDrizzleBillingStore,
  type DrizzleBillingDatabase,
} from '@repo/saas-billing-drizzle';

export const createWorkspaceBillingStores = (database: DrizzleBillingDatabase) => ({
  billingStore: createDrizzleBillingStore({
    database,
    createId: () => crypto.randomUUID(),
    now: () => new Date(),
  }),
  operationStore: createDrizzleBillingOperationStore({
    database,
    createId: () => crypto.randomUUID(),
    now: () => new Date(),
  }),
  eventStore: createDrizzleBillingEventStore({
    database,
    createId: () => crypto.randomUUID(),
  }),
});
```

`createId` と `now` は省略できます。
テストで ID と時刻を固定したい場合は明示的に注入します。

## 検証

package 側の型と store 挙動を確認します。

```sh
pnpm --filter @repo/saas-billing-drizzle typecheck
pnpm --filter @repo/saas-billing-drizzle test
```

app 側では、migration と billing regression を確認します。

```sh
pnpm --filter @apps/backend exec drizzle-kit check --config ./drizzle.config.ts
pnpm --filter @repo/e2e test:e2e:billing
```

別 SaaS では、上の app 名を導入先に読み替えます。
生成した migration は、その SaaS の D1/SQLite migration replay で確認します。
