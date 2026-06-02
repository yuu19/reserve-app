# Stripe 課金再利用化 実行計画（修正版）

## この文書の扱い

この文書は現行仕様の正本ではなく、課金再利用化の履歴・計画メモです。
現行の組織単位課金仕様は [billing.md](./billing.md) を確認してください。

`reserve-app` の Stripe 課金実装を、他の SaaS でも再利用できる形へ近づけるための実行計画です。

この計画では、最初から generic billing tables へ置き換えることはしません。
現行の `organization_billing` を正本として維持し、支払い失敗、通知、監査、内部調査、trial 開始、operation attempt、Stripe webhook retry の挙動を落とさずに、外側へ再利用可能な interface を作ります。

---

## 1. 基本方針

### 1.1 ゴール

```txt
現行 reserve-app の課金運用を壊さない
  ↓
課金 route / usecase / provider / store の境界を整理する
  ↓
Stripe 依存を provider adapter に閉じ込める
  ↓
現行 organization billing aggregate を generic interface で包む
  ↓
別 SaaS でも catalog / entitlement / subject / store adapter を差し替えて使えるようにする
```

### 1.2 非ゴール

初期実装では、次の変更は行いません。

```txt
- organization_billing を削除しない
- generic billing tables へ移行しない
- 支払い失敗 policy を core package に移さない
- 通知 retry policy を core package に移さない
- internal inspection の response を作り替えない
- webhook 処理を非同期 queue/job 化しない
- legacy ticket checkout webhook を削除しない
```

### 1.3 最重要原則

```txt
再利用化 = 現行 aggregate を薄い generic subscription に落とすことではない

再利用化 = 現行 aggregate を守りつつ、外側に再利用可能な契約を作ること
```

---

## 2. 必ず守る現行挙動

### 2.1 支払い失敗と復旧

支払いが失敗した組織では、owner に状態と次の操作を表示します。

`past_due` では猶予期間中だけ Premium 利用を継続できます。
復旧後に古い失敗履歴が残る場合は、現在の未払い状態とは分けて表示します。

守る内容:

```txt
- payment_issue_started_at
- provider issue time と application receipt time の区別
- past_due_grace_ends_at
- payment_failed
- payment_action_required
- past_due_grace_active
- past_due_grace_expired
- recovered
- stale_failure_history_only
```

### 2.2 通知と再試行

支払い失敗、対応が必要な支払い、猶予期限の通知は、対象 owner ごとに結果を記録します。

守る内容:

```txt
- recipient-scoped notification
- verified owner 単位の送信結果
- failed recipient だけへの retry
- sent recipient への重複送信防止
- notification delivery failure を billing success と扱わないこと
```

### 2.3 監査と内部調査

課金状態が変わったときは、owner 向け表示だけでなく、内部調査用の情報も残します。

守る内容:

```txt
- billing audit event
- billing signal
- invoice payment event
- document reference
- webhook receipt / failure / retry history
- internal billing inspection の response shape
```

### 2.4 Trial 開始

owner が trial を開始した時点で、Stripe trial subscription を作成します。

その後、D1 の課金状態を即時に `trialing` へ更新します。
Checkout URL を返す手続きには変えません。

守る内容:

```txt
- startTrial は Checkout handoff ではない
- Stripe trial subscription を作る
- D1 aggregate を同期的に trialing へ遷移させる
- trial_started_at / trial_start audit を残す
- operation attempt を残す
- trial 使用済みの永続判定を維持する
```

### 2.5 Stripe session の重複防止

Checkout、Setup Checkout、Customer Portal、Trial subscription の作成では、operation attempt を先に作ります。
Stripe provider 呼び出しには必ず idempotency key を渡します。

守る内容:

```txt
- 30 分 reuse window
- operation attempt
- handoff URL reuse
- Stripe idempotency key
- 二重クリック / ブラウザ再読み込み / ネットワーク retry で重複 session を作らないこと
```

Stripe idempotency 参考:

- https://docs.stripe.com/api/idempotent_requests

### 2.6 Webhook 冪等性

処理済みの Stripe event が再送された場合は、状態を再変更しません。
ただし、前回の処理が失敗した event は、Stripe の再送で再処理できるようにします。

守る内容:

```txt
- processed duplicate は no-op
- failed duplicate は再処理
- stale processing は再処理
- fresh processing は同期 webhook では成功済み扱いにしない
```

Stripe webhook 参考:

- https://docs.stripe.com/webhooks

### 2.7 Customer Portal flow

契約変更では、通常の Portal home ではなく subscription update flow を使います。
支払い方法登録は、現行どおり Setup Checkout として扱います。

守る内容:

```txt
- subscription update flow を維持する
- flow_data.type = subscription_update
- flow_data.subscription_update.subscription に対象 subscription id を渡す
- 支払い方法登録は Setup Checkout として維持する
```

Customer Portal session 参考:

- https://docs.stripe.com/api/customer_portal/sessions/create

### 2.8 Price catalog

Stripe price id が未設定のまま provider 呼び出しへ進めません。

守る内容:

```txt
- ?? '' で空文字 price id を catalog に入れない
- owner 操作では price id 未設定なら明示的な error を返す
- webhook で unknown price を受け取った場合、Premium entitlement を付与しない
- unknown price は internal signal として残す
```

---

## 3. 初期アーキテクチャ

初期実装では、共通 package を薄く保ちます。
支払い失敗 policy、通知 retry、内部調査 read model は reserve-app 側に残します。

```txt
packages/saas-billing-core
  ports
  provider event claim の型
  provider port の型
  operation handoff の共通型
  catalog の共通型

apps/backend/src/features/billing
  reserve-app の billing routes
  reserve-app の usecase adapter
  reserve-app の catalog
  reserve-app の entitlement policy

apps/backend/src/infra/billing
  現行 organization billing tables を読む Store adapter
  webhook event store adapter
  operation attempt store adapter

apps/backend/src/infra/payment
  Stripe provider adapter
```

---

## 4. Core に置くもの

`packages/saas-billing-core` は、アプリ固有の業務状態を持ちすぎないようにします。

### 4.1 共通型

```ts
export type BillingSubjectType = 'organization' | 'workspace' | 'team' | 'user';

export type BillingInterval = 'month' | 'year';

export type BillingProviderCode = 'stripe';

export type BillingOperationPurpose =
  | 'start_trial_subscription'
  | 'create_subscription_checkout'
  | 'create_setup_checkout'
  | 'create_portal_session';
```

### 4.2 Portal flow

```ts
export type BillingPortalFlow =
  | { type: 'default' }
  | { type: 'subscription_update'; subscriptionId: string }
  | { type: 'subscription_cancel'; subscriptionId: string };
```

reserve-app では、支払い方法登録に `payment_method_update` portal flow は使わず、Setup Checkout を使います。
core には将来拡張として追加可能ですが、初期実装では扱いません。

### 4.3 Provider port

`customerId` は provider port 上では必須にします。
customer の作成・再利用は usecase 側で `ensureProviderCustomer` として扱います。

```ts
export interface BillingProvider {
  createCustomer(input: {
    email?: string | null;
    name?: string | null;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCustomer>;

  createTrialSubscription(input: {
    customerId: string;
    priceId: string;
    trialDays: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderSubscription>;

  createSubscriptionCheckoutSession(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession>;

  createSetupCheckoutSession(input: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCheckoutSession>;

  createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
    flow: BillingPortalFlow;
    idempotencyKey: string;
  }): Promise<ProviderPortalSession>;

  retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription | null>;

  retrieveCustomerSummary(customerId: string): Promise<ProviderCustomerSummary | null>;
}
```

---

## 5. Webhook event claim 設計

### 5.1 Claim result

`processing fresh` と `processing stale` を分けます。
同期 webhook では `processing fresh` を成功済み扱いの 2xx no-op にしません。

```ts
export type ProviderEventClaimResult =
  | { kind: 'claimed'; attempt: number }
  | { kind: 'already_processed' }
  | { kind: 'already_processing_fresh' }
  | { kind: 'already_processing_stale_claimed'; attempt: number };
```

### 5.2 Event store

```ts
export interface BillingEventStore {
  claimProviderEvent(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    eventType: string;
    payloadHash: string;
    now: Date;
    staleProcessingAfterMs: number;
  }): Promise<ProviderEventClaimResult>;

  markProviderEventProcessed(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    processedAt: Date;
  }): Promise<void>;

  markProviderEventFailed(input: {
    provider: BillingProviderCode;
    providerEventId: string;
    failedAt: Date;
    errorMessage: string;
  }): Promise<void>;
}
```

### 5.3 再送時の扱い

| 既存状態                | 再送時の扱い                          |
| ----------------------- | ------------------------------------- |
| `processed`             | no-op で 2xx                          |
| `failed`                | `processing` に戻して再処理           |
| `processing` かつ stale | 再処理                                |
| `processing` かつ fresh | 同期 webhook では成功済み扱いにしない |
| 未受領                  | `processing` として claim             |

### 5.4 `processing fresh` の response

同期 webhook のままでは、処理完了を確認できない限り `2xx no-op` を返しません。

方針:

```txt
processing fresh を受け取った場合:
  1. 短時間だけ既存処理の結果を確認する
  2. processed を確認できた場合だけ 2xx
  3. processed を確認できない場合は 5xx
  4. Stripe 再送に任せる
```

非同期 queue/job 化した場合だけ、`processing fresh -> 2xx` を許可します。

---

## 6. Operation attempt 設計

### 6.1 reuseKey

operation attempt の reuseKey を purpose ごとに定義します。

```ts
export type BillingOperationReuseKey =
  | `start_trial_subscription:${BillingSubjectType}:${string}:${string}`
  | `create_subscription_checkout:${BillingSubjectType}:${string}:${string}:${BillingInterval}`
  | `create_setup_checkout:${BillingSubjectType}:${string}`
  | `create_portal_session:${BillingSubjectType}:${string}:default`
  | `create_portal_session:${BillingSubjectType}:${string}:subscription_update:${string}`
  | `create_portal_session:${BillingSubjectType}:${string}:subscription_cancel:${string}`;
```

読み替え:

```txt
start_trial_subscription:${subjectType}:${subjectId}:${planCode}

create_subscription_checkout:${subjectType}:${subjectId}:${planCode}:${interval}

create_setup_checkout:${subjectType}:${subjectId}

create_portal_session:${subjectType}:${subjectId}:default

create_portal_session:${subjectType}:${subjectId}:subscription_update:${providerSubscriptionId}

create_portal_session:${subjectType}:${subjectId}:subscription_cancel:${providerSubscriptionId}
```

### 6.2 attempt 状態の扱い

| 状態                          | 扱い                                                  |
| ----------------------------- | ----------------------------------------------------- |
| `succeeded` + handoffUrl 有効 | reuse                                                 |
| `pending` + fresh             | 短時間待つ、または `409 retry_later`                  |
| `pending` + stale             | takeover または新 attempt                             |
| `failed`                      | reuse しない。新 attempt と新 idempotencyKey で retry |

### 6.3 failed attempt の retry

failed attempt は reuse しません。
retry 時は新しい operation attempt と新しい idempotency key を作ります。

ただし、Stripe 側で object が作成済みの可能性がある場合は、metadata / provider object id / customer state を確認してから再作成します。

### 6.4 operation attempt flow

```txt
1. reuseKey を生成する
2. operation attempt を claim する
3. succeeded + handoffUrl 有効なら reuse する
4. pending + fresh なら短時間待つか retry_later を返す
5. failed / stale なら新 attempt を作る
6. provider call に idempotencyKey を渡す
7. providerObjectId / handoffUrl / handoffExpiresAt を保存する
```

---

## 7. Catalog validation

### 7.1 空 price id を禁止する

`?? ''` で空文字 price id を catalog に入れません。

```ts
export type CatalogBuildResult =
  | { ok: true; catalog: BillingCatalog }
  | { ok: false; errors: CatalogValidationError[] };
```

### 7.2 Error code

```ts
export type CatalogValidationErrorCode =
  | 'billing_price_not_configured'
  | 'billing_plan_not_found'
  | 'billing_interval_not_supported'
  | 'billing_unknown_provider_price';
```

意味:

| code                             | 意味                                            |
| -------------------------------- | ----------------------------------------------- |
| `billing_price_not_configured`   | env に必要な price id がない                    |
| `billing_plan_not_found`         | planCode が catalog に存在しない                |
| `billing_interval_not_supported` | plan はあるが interval がない                   |
| `billing_unknown_provider_price` | webhook で未知の provider price id を受け取った |

### 7.3 owner 操作時

```txt
checkout / trial:
  price id 未設定なら 422
```

### 7.4 webhook 時

```txt
unknown provider price:
  entitlement を付与しない
  internal signal を残す
```

### 7.5 startup failure にはしない

Cloudflare Workers では、billing env 不備があっても health check や auth は動いてほしい場合があります。
そのため、catalog validation は startup hard fail にはしません。

```txt
billing summary:
  readOnlyReason として設定不足を返す

checkout / trial:
  422 billing_price_not_configured

webhook:
  unknown price は entitlement なし + signal
```

---

## 8. Store adapter の境界

Store adapter は DB access と既存 aggregate 関数の橋渡しだけを行います。

```txt
Store adapter が行うこと:
  - 現行 organization billing table を読む
  - 現行 organization billing table を更新する
  - 既存 aggregate 関数を呼ぶ
  - audit / signal / notification / document read model を読む

Store adapter が行わないこと:
  - Stripe provider を呼ばない
  - Checkout / Portal / Trial の provider call をしない
  - app-specific route response を作らない
```

Stripe provider 呼び出しは billing usecase から `BillingProvider` port 経由で行います。

---

## 9. Billing route 分離

### 9.1 初期分離では公開 path を変えない

初期分離では `/api/v1/billing` を新設しません。

既存の `authRoutes` に `registerBillingRoutes(authRoutes, ctx)` で登録し、既存 client の URL / request schema / response shape を維持します。

```txt
Before:
  auth-routes.ts 内に billing route handler がある

After:
  features/billing/billing.routes.ts に handler を移す
  auth-routes.ts は registerBillingRoutes(authRoutes, ctx) を呼ぶ
  path / request / response は変えない
```

新 namespace への移行は別 issue とします。

### 9.2 移動対象

```txt
- billing summary
- trial start
- trial completion
- paid checkout
- setup checkout
- Customer Portal
- billing documents
- billing history
- internal billing inspection
```

---

## 10. Trial usecase

### 10.1 startTrialSubscription

`startTrialSubscription` は URL を返しません。

```txt
1. actor が billing 操作権限を持つことを確認
2. trial 使用済みでないことを確認
3. catalog から trial 対象 price を解決
4. operation attempt を claim
5. provider customer を ensure
6. Stripe trial subscription を idempotencyKey 付きで作成
7. D1 aggregate を trialing へ同期更新
8. audit / signal / operation attempt を保存
9. trial 状態と trialEndsAt を返す
```

### 10.2 返却例

```ts
type StartTrialResult =
  | {
      ok: true;
      status: 'trialing';
      trialEndsAt: string;
    }
  | {
      ok: false;
      status: 409 | 422 | 500;
      code: string;
      message: string;
    };
```

---

## 11. Checkout usecase

### 11.1 createSubscriptionCheckoutHandoff

```txt
1. actor が billing 操作権限を持つことを確認
2. 現在の subscription state を確認
3. 二重 checkout が許可される状態か確認
4. catalog から price を解決
5. provider customer を ensure
6. operation attempt を claim
7. reuse window 内の handoff があれば返す
8. Stripe Checkout session を idempotencyKey 付きで作成
9. handoff URL を operation attempt に保存
10. URL を返す
```

### 11.2 customerId

provider call には必ず `customerId: string` を渡します。
`customerId: null` を provider port に渡す設計は禁止します。

---

## 12. Setup Checkout usecase

支払い方法登録は Customer Portal の `payment_method_update` ではなく Setup Checkout を使います。

```txt
1. actor が billing 操作権限を持つことを確認
2. provider customer を ensure
3. operation attempt を claim
4. reuse window 内の handoff があれば返す
5. Stripe Setup Checkout session を idempotencyKey 付きで作成
6. URL を返す
```

---

## 13. Customer Portal usecase

### 13.1 Portal home

```txt
flow = { type: 'default' }
```

### 13.2 Subscription update

```txt
flow = {
  type: 'subscription_update',
  subscriptionId: providerSubscriptionId
}
```

この場合、Stripe adapter では次を設定します。

```ts
flow_data: {
  type: 'subscription_update',
  subscription_update: {
    subscription: providerSubscriptionId,
  },
  after_completion: {
    type: 'redirect',
    redirect: {
      return_url: returnUrl,
    },
  },
}
```

### 13.3 Subscription cancel

```txt
flow = {
  type: 'subscription_cancel',
  subscriptionId: providerSubscriptionId
}
```

### 13.4 reuseKey

```txt
create_portal_session:${subjectType}:${subjectId}:default
create_portal_session:${subjectType}:${subjectId}:subscription_update:${providerSubscriptionId}
create_portal_session:${subjectType}:${subjectId}:subscription_cancel:${providerSubscriptionId}
```

---

## 14. Webhook usecase

### 14.1 create-app.ts で行うこと

```txt
1. raw body を取得
2. stripe-signature を取得
3. 署名検証
4. Stripe event parse
5. billing webhook usecase へ渡す
6. organization billing に該当しない event は legacy ticket checkout usecase へ渡す
```

### 14.2 billing webhook usecase

```txt
1. provider event id を claim
2. already_processed なら no-op
3. already_processing_fresh なら成功済み扱いにしない
4. claimed / stale claimed なら処理する
5. organization billing event として処理
6. processed / failed を記録
```

### 14.3 response policy

```txt
processed:
  200

already_processed:
  200

already_processing_fresh:
  既存処理が短時間内に processed になったことを確認できた場合だけ 200
  確認できなければ 500

processing failed:
  mark failed
  retry 可能なら 500
```

---

## 15. Legacy ticket checkout webhook

旧 ticket checkout の webhook 処理は削除しません。

```txt
- features/tickets/legacy-ticket-checkout-webhook.usecase.ts を維持
- organization billing webhook に該当しない event だけ渡す
- 将来削除する場合は別 migration と rollout 判断を必要とする
```

---

## 16. 実装順

### Step 0: baseline 確認

```bash
pnpm --filter @apps/backend typecheck
pnpm --filter @apps/backend test
pnpm --filter @apps/backend lint
```

### Step 1: Billing route を分離する

```txt
apps/backend/src/features/billing/
  billing.routes.ts
  billing.schemas.ts
  billing.usecases.ts
```

要件:

```txt
- 公開 path を変えない
- request / response shape を変えない
- auth-routes.ts から billing handler を移す
- auth-routes.ts は registerBillingRoutes を呼ぶだけに近づける
```

### Step 2: route 互換テストを追加する

```txt
- 既存 billing summary endpoint
- trial start endpoint
- checkout endpoint
- setup checkout endpoint
- portal endpoint
- documents endpoint
- inspection endpoint
```

### Step 3: Operation attempt reuseKey 仕様を実装する

```txt
- reuseKey builder を作る
- failed attempt は reuse しない
- pending fresh の扱いを実装する
- pending stale の扱いを実装する
```

### Step 4: Stripe provider adapter を作る

```txt
apps/backend/src/infra/payment/stripe-billing-provider.ts
```

要件:

```txt
- customerId は provider port 上必須
- idempotencyKey は全作成系操作で必須
- subscription_update flow を維持
- setup checkout を維持
```

### Step 5: Trial / Checkout / Setup / Portal usecase に operation attempt を統合する

```txt
- startTrialSubscription
- createSubscriptionCheckoutHandoff
- createSetupCheckoutHandoff
- createPortalHandoff
```

### Step 6: Store adapter を作る

```txt
apps/backend/src/infra/billing/
  organization-billing-store.ts
  organization-billing-event-store.ts
  organization-billing-operation-store.ts
  organization-billing-audit-store.ts
  organization-billing-notification-store.ts
  organization-billing-document-store.ts
```

要件:

```txt
- 現行 table を使う
- generic table は追加しない
- Stripe provider を呼ばない
```

### Step 7: Webhook event claim を置き換える

要件:

```txt
- processed duplicate no-op
- failed duplicate retry
- stale processing retry
- fresh processing は成功済み扱いにしない
```

### Step 8: Catalog validation を厳格化する

要件:

```txt
- 空 price id を catalog に入れない
- owner 操作では 422
- webhook unknown price は entitlement なし + signal
```

### Step 9: 薄い core package を追加する

```txt
packages/saas-billing-core/
  src/
    index.ts
    types.ts
    ports.ts
    operation.ts
    catalog.ts
    webhook.ts
```

初期 scope:

```txt
- provider port の型
- event claim の型
- operation handoff の型
- catalog の型
```

### Step 10: auth-routes.ts の billing import を削る

billing route 登録以外の billing 実装 import を削ります。

---

## 17. Done 条件

```txt
- [ ] 現行 organization_billing 系テーブルを消していない
- [ ] 支払い失敗、猶予、復旧、stale failure の表示が維持されている
- [ ] owner 通知と recipient-scoped retry が維持されている
- [ ] audit、signal、internal inspection が維持されている
- [ ] trial 開始は trial subscription 作成と D1 aggregate 即時更新を維持している
- [ ] trial 使用済みの永続判定が維持されている
- [ ] Checkout、Setup、Portal、Trial で operation attempt と idempotency key を使っている
- [ ] 30 分 handoff reuse window が維持されている
- [ ] operation attempt の reuseKey が purpose ごとに定義されている
- [ ] failed operation attempt は reuse せず、新しい attempt / idempotencyKey で retry する
- [ ] provider port の createSubscriptionCheckoutSession は customerId 必須である
- [ ] processed webhook duplicate は no-op になる
- [ ] failed webhook event は Stripe 再送で再処理できる
- [ ] processing fresh webhook を同期処理では成功済み扱いの 2xx no-op にしない
- [ ] Customer Portal の subscription update flow が維持されている
- [ ] 支払い方法登録は Setup Checkout として維持されている
- [ ] catalog に空 price id が入らない
- [ ] catalog validation error code が定義されている
- [ ] unknown Stripe price では entitlement を付与しない
- [ ] Store adapter から Stripe provider を呼んでいない
- [ ] billing route 分離後も既存 URL / request / response shape が変わっていない
- [ ] legacy ticket checkout webhook が維持されている
- [ ] 既存 billing UI、trial、checkout、portal、webhook、internal inspection の回帰テストが通る
```

---

## 18. テスト計画

### 18.1 Trial

```txt
- owner が trial を開始すると Stripe trial subscription が作成される
- D1 aggregate が trialing になる
- audit が作られる
- operation attempt が succeeded になる
- trial 使用済みの組織では再開始できない
- 同じ操作を reuse window 内に再実行しても provider call が二重にならない
- failed attempt 後の retry では新しい idempotencyKey を使う
```

### 18.2 Checkout

```txt
- 30 分以内は同じ Checkout URL を返す
- provider call に idempotency key が渡る
- provider call の customerId は必須
- 対象 interval の price id が未設定なら 422 を返す
- 既存 active/trialing/past_due/unpaid/incomplete subscription では二重 checkout を開始しない
```

### 18.3 Setup Checkout

```txt
- trial 中の支払い方法登録で Setup Checkout URL を返す
- customer がなければ idempotency key 付きで作成する
- reuse window 内は同じ setup handoff を返す
```

### 18.4 Customer Portal

```txt
- subscription update flow に subscription id を渡す
- free、canceled、subscription id なしの組織では subscription update portal を開けない
- reuse window 内は同じ portal handoff を返す
- 支払い方法登録は Portal ではなく Setup Checkout を使う
```

### 18.5 Webhook

```txt
- new event は processing から processed になる
- processed duplicate は状態、通知、entitlement、履歴を増やさない
- failed duplicate は再処理される
- stale processing は再処理される
- fresh processing は同期 webhook では成功済み扱いにしない
- invalid signature では課金状態を変更しない
- unknown price は entitlement なしになり、signal を残す
- invoice.payment_failed で支払い問題状態が更新される
- invoice.paid で復旧状態が記録される
```

### 18.6 Notification

```txt
- payment failed と action required は verified owner ごとに送信結果を持つ
- retry は failed recipient だけに行う
- sent recipient には再送しない
- past due grace reminder が維持される
```

### 18.7 Internal Inspection

```txt
- payment issue、recipient notification、document、invoice event、webhook receipt、audit、signal が読める
- duplicate webhook と failed retry の履歴が説明できる
- billing profile readiness が読める
- response shape が移行前後で変わらない
```

---

## 19. 将来の generic table 移行条件

generic table への移行は、初期実装の目的ではありません。

移行する場合は、次の条件を満たしてから別計画として実施します。

```txt
- 支払い失敗、通知、監査、inspection を落とさない data model がある
- 既存 organization_billing と新 read model の差分比較ができる
- rollback 時に append-only records を失わない
- production data の backfill 手順がある
- Stripe webhook の duplicate/retry semantics が移行後も変わらない
```

---

## 20. Rollback 方針

一気に進める場合でも、rollback しやすいように次を守ります。

```txt
- organization_billing 系 table を消さない
- 既存 route path を変えない
- route 分離後も旧 response shape を維持する
- core package 導入後も app 側 adapter を通じて現行関数に戻せるようにする
- generic table を初期実装で追加しない
```

---

## 21. 最終結論

再利用化の第一段階では、課金状態を薄い generic subscription に落としません。

```txt
現行の組織課金を正本として維持する
  ↓
現行挙動を保持した adapter を作る
  ↓
Stripe provider と operation handoff を port 化する
  ↓
必要最小限の型だけ core package に移す
```

別 SaaS では次を差し替えます。

```txt
- 課金対象の種類
- plan catalog
- entitlement key
- 課金操作権限
- Store adapter
- return URL
- app 固有の通知と調査 policy
```

この順序なら、`reserve-app` の現行運用を壊さずに、再利用可能な課金境界を作れます。
