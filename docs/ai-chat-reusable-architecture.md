# AI チャット再利用アーキテクチャ

## 目的

AI チャットは、ログイン中の利用者に合わせて予約運用や契約状態を案内します。
回答は、利用者が参照できる説明と現在の業務情報だけを材料にします。
AI は予約作成、契約変更、招待送信などの操作を実行しません。

Phase 7 後の構成では、SaaS 共通にできる型と port を `@repo/saas-chatbot-core` に集約しています。
ReserveApp 固有の認可、業務情報、Cloudflare 実装、Web 表示は、それぞれ別の層に残しています。

## 責務境界

### core package

`packages/saas-chatbot-core` は、複数 SaaS で共有できる契約だけを持ちます。
ここには UI の wire type、会話保存の port、検索・生成・埋め込み・利用制限の port、visibility や suggested action の union を置きます。

この package は ReserveApp の DB schema や Hono route を知りません。
そのため、他 SaaS では同じ型と port を使いながら、別の DB や別の provider adapter を接続できます。

### backend feature

`apps/backend/src/features/ai` は、利用者の質問を ReserveApp の会話として処理します。
この層は、ログイン状態、組織、店舗、役割、現在ページの hint を解決し、許可されたナレッジと業務情報だけを回答生成へ渡します。

実装メモ:

- API schema は `ai.schemas.ts` に置きます。
- route 依存の組み立ては `ai-route-context.ts` に寄せます。
- chat、feedback、internal review の処理は usecase file に分けます。
- `ai-routes.ts` は Hono/OpenAPI の薄い adapter として扱います。

### infra providers

`apps/backend/src/infra/ai` は、Workers AI と AI Gateway への接続を担当します。
回答生成 provider、埋め込み provider、test 用 fake provider をここに分けます。

`apps/backend/src/infra/ai-knowledge` は、D1 と Vectorize に近い保存・検索処理を担当します。
会話保存、ナレッジ検索、ナレッジ投入、観測情報の保存は、この層で Drizzle schema に接続します。

実装メモ:

- Drizzle schema は `apps/backend/src/infra/db/schema.ts` が正です。
- D1 はナレッジ本文、metadata、会話、フィードバック、利用回数の正本です。
- Vectorize は検索 index であり、回答の正本ではありません。

### web widget

`apps/web/src/lib/ai-client.ts` は backend API を呼び、backend のエラーを Web 内部の typed error に変換します。
`apps/web/src/lib/features/ai-chat.svelte.ts` は、会話 ID、入力、送信状態、フィードバック状態、利用回数表示を管理します。

UI contract は `packages/saas-chatbot-core/src/ui-contract.ts` を共有元にします。
`AiChatUiStatus` は `closed | ready | sending | error` です。
送信失敗時は入力を戻します。
組織や店舗の scope が変わったときは会話をリセットし、古い応答は反映しません。

## API と UI の境界

backend の成功応答は `AiChatResponse` として `rateLimit` を含みます。
401/403 は `{ message }`、429 は `{ message, retryAfterSeconds }` を返します。

Web は backend payload をそのまま画面状態にせず、`AiChatClientErrorPayload` に丸めます。
`kind` は `api`、`network`、`parse` のいずれかです。
この型は Web client 内部の contract であり、backend の wire shape とは分けて扱います。

## Suggested action

suggested action は案内だけを表します。
予約、契約、参加者、回数券、招待、購入などの業務操作を実行しません。

`open_page` は、許可された既存ページへの移動だけに使います。
`href` が `null` または未指定の場合、Web はリンクではなくテキストとして表示します。

## 今回確認した backend integration test 範囲

今回の本番反映では、公開 API、DB schema、runtime route、Web UI の wire shape は変えていません。
追加確認は `apps/backend/src/app.test.ts` の `AI route integration` に集約しています。

確認済みの範囲:

- 未ログインの chat request と不正な request body を拒否すること。
- 根拠付き回答で、source、usage event、会話、assistant message が保存されること。
- Vectorize 検索失敗時に fallback 状態を保存し、安全な回答に留めること。
- 別組織の chat と、別 scope の conversationId 再利用を拒否すること。
- store scope が requested organization の中だけで有効になること。
- currentPage は回答の hint としてだけ使い、participant の請求情報や source 権限を広げないこと。
- feedback は message owner だけが登録でき、重複時は更新され、payload validation が効くこと。
- internal AI endpoint は operator だけが使え、knowledge freshness と feedback themes を返すこと。

実行コマンド:

```bash
pnpm --filter @apps/backend exec vitest run src/app.test.ts --maxWorkers=1 -t "AI route integration"
pnpm --filter @apps/backend exec vitest run src/app.test.ts --maxWorkers=1
pnpm --filter @apps/backend exec vitest run src/features/ai/ai-contract.test.ts src/features/ai/ai-chat.usecase.test.ts src/features/ai/ai-feedback.usecase.test.ts src/features/ai/ai-route-context.test.ts --maxWorkers=1
```

## 公開マニュアル更新後の knowledge reindex

公開マニュアルは、docs site と AI チャットの回答根拠の両方で使います。
`apps/docs/src/routes/manuals/common/ai-chatbot/+page.md` を更新した場合は、PR 経由で main に反映し、`deploy-workers.yml` の backend、web、docs 反映完了を確認してから、対象 source path だけを再投入します。

```bash
pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --dry-run --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
CF_AI_GATEWAY_TOKEN=... WRANGLER_CLOUDFLARE_API_TOKEN=... pnpm --filter @apps/backend exec node scripts/index-ai-knowledge.mjs --apply --source-path apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
```

dry-run は discovery だけを行い、D1、Vectorize、Workers AI には書き込みません。
apply は production credentials を使う運用作業です。
対象 source path の文書を本番 D1 と Vectorize に反映し、同じ文書の古い chunk を stale として扱います。

## 変更時の確認

core type を変える場合は、backend feature と web widget の両方の contract test を確認します。

```bash
pnpm --filter @repo/saas-chatbot-core typecheck
pnpm --filter @apps/backend exec vitest run src/features/ai/ai-contract.test.ts --maxWorkers=1
pnpm --filter @apps/web exec vitest run --project server src/lib/ai-client.spec.ts src/lib/features/ai-chat.spec.ts --maxWorkers=1
```

runtime API、DB schema、Svelte props を変える場合は、この文書だけでなく `specs/004-ai-chatbot` の contract と quickstart も同時に更新します。
