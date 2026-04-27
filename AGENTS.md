### デザインシステム
- デザインシステムの正式な仕様は DESIGN.md を参照してください。
- 色、タイポグラフィ、スペーシング、コンポーネント仕様などの判断は DESIGN.md を優先してください。
- preview.html は DESIGN.md に基づく静的プレビュー兼仕様確認ページです。
- preview.html は見た目の確認や実装イメージの参照に使用してよいですが、仕様の原典としては扱わないでください。
- DESIGN.md と preview.html に差異がある場合は、DESIGN.md を正としてください。

## Active Technologies
- TypeScript strict / Cloudflare Workers + Hono / SvelteKit / Expo / Better Auth / Drizzle ORM / Cloudflare D1 / Stripe / Resend / Sentry (001-organization-billing)
- Organization billing は既存 `organization_billing` を主 aggregate とし、webhook event、notification、audit/signal 系の append-only tables を併用する (001-organization-billing)

## Recent Changes
- 001-organization-billing: Speckit plan artifacts を organization 単位課金、trial-to-paid lifecycle、premium entitlement、internal billing inspection 向けに追加
