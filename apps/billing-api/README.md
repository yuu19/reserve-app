# Billing API

複数の SaaS で共有する契約・請求・利用権限の API です。

各 SaaS は、自分の組織やワークスペースを Billing API に同期します。
Billing API は契約状態と利用権限を返します。
各 SaaS は、その利用権限を自分の業務ルールに当てはめて操作を許可します。

## 初期スコープ

この初期実装では、次を扱います。

- 課金対象の同期
- 契約状態と利用権限の参照
- ローカルのトライアル開始と終了
- API key 認証
- 書き込み API の `Idempotency-Key`
- Stripe Checkout、支払い方法登録、Customer Portal への handoff
- Stripe billing webhook の署名確認、受領記録、契約・利用権限への反映
- product billing catalog からの plan、price、entitlement rule seed SQL 生成

Stripe webhook は、Checkout 完了、Subscription lifecycle、Invoice paid/payment succeeded/payment failed/payment action required を処理します。
Price が catalog に存在しない場合は `priceResolution: "unknown"` として保存し、利用権限は空にします。
課金対象を解決できない webhook は warning として保存し、Stripe には 200 を返します。

## API の前提

API path には必ず `appId` を含めます。

```txt
/api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}
```

API key は `billing_app_credential` に保存した hash で検証します。
平文の key は保存しません。

書き込み API では `Idempotency-Key` header が必須です。
同じ key で異なる request body を送ると conflict として拒否します。

Checkout、支払い方法登録、Customer Portal への handoff では、`billing_operation_attempt` に処理履歴を保存します。
同じ対象、同じ目的の成功済み handoff URL は、既定で 30 分間再利用します。

## Bootstrap

最初にアプリと API key hash を D1 に登録します。

```sql
INSERT INTO billing_app (id, name, status)
VALUES ('reserve', 'Reserve App', 'active');

INSERT INTO billing_app_credential (
  id,
  app_id,
  key_prefix,
  key_hash,
  scopes_json
)
VALUES (
  'cred_reserve_dev',
  'reserve',
  'rbk_live',
  '<sha256 hex of raw api key>',
  '["subject:write","billing:read","billing:write"]'
);
```

API key hash は SHA-256 の hex 文字列です。

Checkout と Customer Portal の戻り先は、`billing_redirect_template` に登録します。

```sql
INSERT INTO billing_redirect_template (
  id,
  app_id,
  key,
  success_url,
  cancel_url
)
VALUES (
  'redirect_reserve_default',
  'reserve',
  'default',
  'https://web.wakureserve.com/contracts',
  'https://web.wakureserve.com/contracts'
);
```

有料プランの Checkout には、`billing_plan` と `billing_price` の登録も必要です。
`billing_price.provider_price_id` には Stripe Price ID を保存します。
catalog seed SQL は `packages/product-billing-config` から生成します。

```bash
pnpm --filter @apps/billing-api run catalog:seed:sql -- --app reserve
```

`STRIPE_PREMIUM_MONTHLY_PRICE_ID` と `STRIPE_PREMIUM_YEARLY_PRICE_ID` を設定して実行すると、Stripe Price ID も SQL に含まれます。
API credential はこの seed では生成しません。

## Entitlements

`GET /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/entitlements` は、互換性のため `entitlements` 配列を正本として返します。
同じレスポンスに、各 SaaS が UI 制御や上限判定で使いやすい派生値として `features` object も含めます。

```json
{
  "appId": "reserve",
  "subjectType": "organization",
  "subjectId": "org_123",
  "planCode": "premium",
  "status": "active",
  "priceResolution": "known",
  "features": {
    "staffLimit": 10,
    "shopLimit": 3,
    "monthlyReservationLimit": 3000,
    "onlinePayment": true,
    "customDomain": true,
    "reminderNotification": true
  },
  "entitlements": []
}
```

`features` は現在有効な entitlement だけから生成します。
Stripe subscription が `trialing` または `active` の場合だけ entitlement を付与し、`past_due`、`unpaid`、`incomplete`、`canceled` では空にします。

## Secrets

Stripe 連携には、次の secret が必要です。

```bash
pnpm --filter @apps/billing-api exec wrangler secret put STRIPE_SECRET_KEY
pnpm --filter @apps/billing-api exec wrangler secret put STRIPE_WEBHOOK_SECRET
```

`STRIPE_SECRET_KEY` は Checkout、支払い方法登録、Customer Portal の作成に使います。
`STRIPE_WEBHOOK_SECRET` は Stripe billing webhook の署名確認に使います。

実装メモ:

- Worker: `apps/billing-api/src/worker.ts`
- DB schema: `apps/billing-api/src/db/schema.ts`
- Migrations: `apps/billing-api/drizzle/0001_billing_api_initial.sql`, `apps/billing-api/drizzle/0002_billing_operation_attempt.sql`, `apps/billing-api/drizzle/0003_subscription_price_resolution.sql`
- Client: `packages/billing-client`
- Shared types: `packages/billing-types`
- Product billing config: `packages/product-billing-config`
