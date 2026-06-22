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
- Stripe billing webhook の署名確認と受領記録

Checkout、支払い方法登録、Customer Portal の API path は固定済みです。
Stripe handoff の実処理は、reserve-app の既存 billing route を client 経由に寄せる段階で接続します。

## API の前提

API path には必ず `appId` を含めます。

```txt
/api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}
```

API key は `billing_app_credential` に保存した hash で検証します。
平文の key は保存しません。

書き込み API では `Idempotency-Key` header が必須です。
同じ key で異なる request body を送ると conflict として拒否します。

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

実装メモ:

- Worker: `apps/billing-api/src/worker.ts`
- DB schema: `apps/billing-api/src/db/schema.ts`
- Migration: `apps/billing-api/drizzle/0001_billing_api_initial.sql`
- Client: `packages/billing-client`
- Shared types: `packages/billing-types`
