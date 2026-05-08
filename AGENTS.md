### デザインシステム

- デザインシステムの正式な仕様は DESIGN.md を参照してください。
- 色、タイポグラフィ、スペーシング、コンポーネント仕様などの判断は DESIGN.md を優先してください。
- preview.html は DESIGN.md に基づく静的プレビュー兼仕様確認ページです。
- preview.html は見た目の確認や実装イメージの参照に使用してよいですが、仕様の原典としては扱わないでください。
- DESIGN.md と preview.html に差異がある場合は、DESIGN.md を正としてください。

## Active Technologies

- TypeScript strict / Cloudflare Workers + Hono / SvelteKit / Expo / Better Auth / Drizzle ORM / Cloudflare D1 / Stripe / Resend / Sentry (001-organization-billing)
- Organization billing は既存 `organization_billing` を主 aggregate とし、webhook event、notification、audit/signal 系の append-only tables を併用する (001-organization-billing)
- TypeScript strict / Cloudflare Workers + Hono / SvelteKit / Expo / Better Auth / Drizzle ORM / Cloudflare D1 / Stripe Billing, Checkout, Customer Portal / Resend / Sentry (002-billing-hardening)
- Billing hardening は既存 `organization_billing` を主 aggregate とし、operation attempt、webhook receipt、invoice/payment event、document reference、notification、audit/signal 系の append-only data を併用する (002-billing-hardening)
- TypeScript strict / Cloudflare Workers + Hono / SvelteKit / Expo / Better Auth / Drizzle ORM / Cloudflare D1 / Stripe Billing, Checkout, Customer Portal / Resend / Sentry (003-stripe-payment-failure)
- Stripe 支払い失敗対応は既存 `organization_billing` を主 aggregate とし、webhook receipt、invoice/payment event、recipient-scoped notification、audit/signal 系の append-only data を併用する (003-stripe-payment-failure)

## Recent Changes

- 001-organization-billing: Speckit plan artifacts を organization 単位課金、trial-to-paid lifecycle、premium entitlement、internal billing inspection 向けに追加
- 002-billing-hardening: Speckit plan artifacts を未払い/incomplete 制御、Stripe handoff 冪等性、reconciliation、invoice/payment event、owner notification、Customer Portal 条件、unknown price 対応向けに追加
- 003-stripe-payment-failure: Speckit plan artifacts を Stripe 支払い失敗時の猶予開始時刻、recipient 単位通知再試行、復旧後 stale failure 対応向けに追加
