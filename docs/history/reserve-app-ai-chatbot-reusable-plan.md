# yuu19/reserve-app AI Chatbot 再利用化 実行計画

## この文書の扱い

この文書は現行仕様の正本ではなく、AI チャット再利用化の履歴・計画メモです。
現行の AI チャット責務境界は [ai-chat-reusable-architecture.md](../ai/ai-chat-reusable-architecture.md) を確認してください。

## 0. 前提

この計画は、`yuu19/reserve-app` にすでに存在する AI Chatbot 実装を踏まえて、将来の SaaS 開発でも再利用しやすい形へ整理するための実行計画です。

Billing 部分はすでに作業中のため、この計画では扱いません。

## 1. 現在の実装前提

ご提示の内容から、現在の Chatbot / AI 関連実装はすでに以下の領域を持っています。

### Backend

```txt
apps/backend/wrangler.jsonc
apps/backend/src/auth-worker.ts
apps/backend/src/app/create-app.ts
apps/backend/src/worker.ts
apps/backend/src/routes/ai-routes.ts

apps/backend/src/features/ai/
  index.ts
  answer-generator.ts
  business-facts.ts
  context-resolver.ts
  conversation-store.ts
  embedding.ts
  indexer.ts
  prompt.ts
  rate-limit.ts
  retriever.ts
  source-visibility.ts

apps/backend/src/infra/db/schema.ts
apps/backend/drizzle/0018_ai_chatbot.sql
apps/backend/drizzle/0019_ai_message_observability.sql
apps/backend/scripts/index-ai-knowledge.mjs
```

### Web

```txt
apps/web/src/lib/ai-client.ts
apps/web/src/lib/features/ai-chat.svelte.ts

apps/web/src/lib/components/ai/
  index.ts
  AiChatWidget.svelte
  AiMessageList.svelte
  AiSourceList.svelte
  AiSuggestedActions.svelte

apps/web/src/routes/+layout.svelte
```

### Tests

```txt
apps/backend/src/features/ai/answer-generator.test.ts
apps/backend/src/features/ai/business-facts.test.ts
apps/backend/src/features/ai/conversation-store.test.ts
apps/backend/src/features/ai/embedding.test.ts
apps/backend/src/features/ai/indexer.test.ts
apps/backend/src/features/ai/prompt.test.ts
apps/backend/src/features/ai/rate-limit.test.ts
apps/backend/src/features/ai/source-visibility.test.ts

apps/web/src/lib/features/ai-chat.spec.ts
apps/web/src/lib/components/ai/AiChatWidget.svelte.spec.ts
apps/web/src/lib/components/ai/AiSourceList.svelte.spec.ts
packages/e2e/tests/e2e/ai/ai-chat-widget.spec.ts
```

### Docs / Specs

```txt
docs/history/ai-chat-proposal.md
apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
apps/docs/src/lib/manuals.ts
apps/docs/static/manuals/common-ai-chatbot/ai-chatbot-rag-flow.mmd
apps/docs/static/manuals/common-ai-chatbot/ai-chatbot-rag-flow.svg

specs/004-ai-chatbot/
  spec.md
  plan.md
  data-model.md
  contracts/ai-api.openapi.yaml
  contracts/ai-ui-contract.md
  quickstart.md
  tasks.md
```

## 2. 今回の結論

現在はすでに `features/ai` として chatbot / RAG / conversation / rate-limit / source visibility / UI / tests が存在するため、前回のように `packages/saas-chatbot-core` をゼロから作る計画ではなく、次の方針に変更します。

```txt
現行 features/ai を壊して作り直す
  ではなく

現行 features/ai を実装の正本として扱う
  ↓
純粋ロジックと port 型を reusable package に抽出する
  ↓
reserve-app 固有の business facts / context / source visibility / prompt は app 側に残す
  ↓
routes / web UI / docs / tests は既存資産を活かして再配線する
```

## 3. 再利用化の基本方針

### 3.1 共通化するもの

```txt
- 会話管理の型
- メッセージの型
- answer generation の port
- embedding provider の port
- retriever の port
- indexer の port
- conversation store の port
- rate limit の port
- source visibility policy の interface
- prompt builder の interface
- RAG source / citation / suggested action の型
- UI client contract
```

### 3.2 reserve-app 側に残すもの

```txt
- business-facts.ts の予約システム固有情報
- context-resolver.ts の組織 / 店舗 / public / admin 文脈解決
- source-visibility.ts の予約システム固有公開範囲
- prompt.ts の reserve-app 固有 system prompt
- index-ai-knowledge.mjs が参照する reserve-app 固有 knowledge source
- AiChatWidget の表示位置や +layout.svelte への組み込み方
```

### 3.3 すぐにやらないもの

```txt
- Billing 連携
- plan / entitlement 連携
- LINE / Slack 連携
- destructive tool call による予約作成
- agent marketplace 的な汎用機能
- multi provider fallback
```

## 4. 推奨する最終構成

### 4.1 package

```txt
packages/
  saas-chatbot-core/
    src/
      index.ts
      types.ts
      answer.ts
      conversation.ts
      embedding.ts
      knowledge.ts
      prompt.ts
      rate-limit.ts
      retriever.ts
      source-visibility.ts
      ui-contract.ts
      errors.ts
```

### 4.2 backend

```txt
apps/backend/src/
  routes/
    ai-routes.ts

  features/
    ai/
      index.ts

      answer-generator.ts
      business-facts.ts
      context-resolver.ts
      conversation-store.ts
      embedding.ts
      indexer.ts
      prompt.ts
      rate-limit.ts
      retriever.ts
      source-visibility.ts

      ai-route-context.ts
      ai-chat.usecase.ts
      ai-indexing.usecase.ts

  infra/
    ai/
      ai-provider.ts
      fake-ai-provider.ts
      cloudflare-ai-provider.ts
      openai-ai-provider.ts

    ai-knowledge/
      drizzle-ai-conversation-store.ts
      drizzle-ai-knowledge-store.ts
      drizzle-ai-observability-store.ts
```

### 4.3 web

```txt
apps/web/src/lib/
  ai-client.ts

  features/
    ai-chat.svelte.ts

  components/
    ai/
      index.ts
      AiChatWidget.svelte
      AiMessageList.svelte
      AiSourceList.svelte
      AiSuggestedActions.svelte
```

### 4.4 docs / specs

```txt
docs/
  ai-chat-proposal.md
  ai-chat-reusable-architecture.md

specs/004-ai-chatbot/
  spec.md
  plan.md
  data-model.md
  contracts/
    ai-api.openapi.yaml
    ai-ui-contract.md
  quickstart.md
  tasks.md
```

## 5. ファイル別の整理方針

## 5.1 `apps/backend/src/features/ai/answer-generator.ts`

### 現在の想定責務

```txt
- user message を受け取る
- context / facts / retrieved sources を組み立てる
- prompt を作る
- LLM provider に問い合わせる
- answer / sources / suggested actions を返す
```

### 再利用化後の方針

`answer-generator.ts` は残しますが、内部を次のように分けます。

```txt
saas-chatbot-core:
  - AnswerGeneratorInput
  - AnswerGeneratorResult
  - AnswerGenerationProvider
  - AnswerGenerationOptions
  - CitationSource
  - SuggestedAction

features/ai/answer-generator.ts:
  - reserve-app 用の answer generation orchestration
  - contextResolver / businessFacts / retriever / promptBuilder / provider を DI して使う
```

### 実装タスク

```txt
1. core に AnswerGeneratorInput / Result を移す
2. provider 呼び出し部分を AnswerGenerationProvider port にする
3. answer-generator.ts は port を受け取る orchestrator にする
4. answer-generator.test.ts を fake provider 前提に更新する
5. sources / suggestedActions の response shape を既存 UI と互換に保つ
```

## 5.2 `business-facts.ts`

### 現在の想定責務

```txt
- reserve-app の事業者 / 店舗 / サービス / 予約ルールなどの facts を組み立てる
```

### 再利用化後の方針

これは **core に移さない** ほうがよいです。

ただし、interface だけ core に置きます。

```ts
export interface BusinessFactsProvider<TContext = unknown> {
  getFacts(context: TContext): Promise<BusinessFact[]>;
}
```

### 実装タスク

```txt
1. core に BusinessFact / BusinessFactsProvider を追加
2. business-facts.ts は ReserveAppBusinessFactsProvider として整理
3. business-facts.test.ts は現行仕様を維持
4. facts の出力を prompt に直結せず、PromptContext 経由にする
```

## 5.3 `context-resolver.ts`

### 現在の想定責務

```txt
- public / admin / organization / store などの利用文脈を解決する
- どの knowledge / facts / source を見せてよいかの前提を作る
```

### 再利用化後の方針

`context-resolver.ts` は reserve-app 固有のまま残します。

core には generic な context 型だけ置きます。

```ts
export type ChatSubjectType = 'organization' | 'store' | 'public_site' | 'user' | 'admin';

export interface ChatRuntimeContext {
  subjectType: string;
  subjectId: string;
  actorUserId?: string | null;
  channel: string;
  locale?: string;
}
```

### 実装タスク

```txt
1. core に ChatRuntimeContext を追加
2. context-resolver.ts の戻り値を ChatRuntimeContext に寄せる
3. source-visibility / retriever / business-facts が同じ context を参照するようにする
4. context-resolver.test.ts を追加または既存テストを拡張する
```

## 5.4 `conversation-store.ts`

### 現在の想定責務

```txt
- conversation / message の永続化
- observability 用の message metadata 保存
```

### 再利用化後の方針

ここは再利用化の中核です。

```txt
core:
  - ConversationStore interface
  - Conversation
  - Message
  - MessageObservability

infra:
  - DrizzleConversationStore
```

現在の `features/ai/conversation-store.ts` が DB 実装を直接持っている場合は、`infra/ai-knowledge/drizzle-ai-conversation-store.ts` へ移すか、少なくとも interface と implementation を分けます。

### 実装タスク

```txt
1. core に ConversationStore interface を定義
2. 現行 conversation-store.ts から型を抽出
3. Drizzle 実装を infra に移動
4. features/ai は ConversationStore port のみ参照
5. conversation-store.test.ts は store contract test に変更
```

## 5.5 `embedding.ts`

### 現在の想定責務

```txt
- query / knowledge source の embedding を生成する
```

### 再利用化後の方針

embedding は provider 差し替えが重要なので、port 化します。

```ts
export interface EmbeddingProvider {
  embedText(input: EmbedTextInput): Promise<EmbeddingVector>;
  embedMany(input: EmbedManyInput): Promise<EmbeddingVector[]>;
}
```

### 実装タスク

```txt
1. core に EmbeddingProvider を追加
2. 現行 embedding.ts の provider 依存部分を infra/ai に移す
3. fake embedding provider を追加
4. embedding.test.ts は fake provider と dimension validation を確認する
```

## 5.6 `indexer.ts`

### 現在の想定責務

```txt
- knowledge source を読み込む
- chunking する
- embedding する
- DB / vector store に保存する
```

### 再利用化後の方針

indexer は再利用価値が高いですが、source loading は app 固有です。

```txt
core:
  - KnowledgeSource
  - KnowledgeChunk
  - KnowledgeIndexer
  - KnowledgeSourceLoader interface
  - ChunkingOptions

features/ai:
  - reserve-app 固有 source loader

infra:
  - embedding provider
  - vector / db store
```

### 実装タスク

```txt
1. core に KnowledgeSource / KnowledgeChunk を追加
2. indexer.ts を generic indexing pipeline に整理
3. reserve-app 固有 source loader を分離
4. scripts/index-ai-knowledge.mjs は usecase 呼び出しだけに薄くする
5. indexer.test.ts を chunking / visibility / embedding 保存の観点で更新
```

## 5.7 `retriever.ts`

### 現在の想定責務

```txt
- user query から関連 source / chunk を検索する
- source visibility を反映する
- answer-generator に渡す context を作る
```

### 再利用化後の方針

retriever は port と実装を分けます。

```ts
export interface KnowledgeRetriever {
  retrieve(input: RetrieveKnowledgeInput): Promise<RetrievedKnowledge[]>;
}
```

### 実装タスク

```txt
1. core に KnowledgeRetriever interface を追加
2. retriever.ts は ReserveAppKnowledgeRetriever または default implementation にする
3. sourceVisibilityPolicy を必ず注入する
4. retriever の戻り値を AiSourceList の UI contract と揃える
```

## 5.8 `prompt.ts`

### 現在の想定責務

```txt
- system prompt
- business facts
- retrieved context
- source citation 指示
- suggested action 指示
```

### 再利用化後の方針

prompt 本文は app 側、prompt builder の interface は core に置きます。

```ts
export interface PromptBuilder<TContext = unknown> {
  build(input: BuildPromptInput<TContext>): Promise<BuildPromptResult>;
}
```

### 実装タスク

```txt
1. core に PromptBuilder / PromptSection を追加
2. prompt.ts は ReserveAppPromptBuilder として整理
3. prompt.test.ts は prompt snapshot test を維持
4. prompt に provider 固有 API 形式を混ぜない
```

## 5.9 `rate-limit.ts`

### 現在の想定責務

```txt
- AI chat 利用回数 / IP / subject ごとの rate limit
```

### 再利用化後の方針

rate limit は SaaS 共通化しやすいです。

```ts
export interface ChatRateLimiter {
  check(input: RateLimitCheckInput): Promise<RateLimitCheckResult>;
  consume(input: RateLimitConsumeInput): Promise<void>;
}
```

### 実装タスク

```txt
1. core に ChatRateLimiter interface を追加
2. rate-limit.ts は implementation として残す
3. subjectType / subjectId / actorUserId / ipHash / channel で key を作れるようにする
4. rate-limit.test.ts を key generation / window / reset の観点で強化
```

## 5.10 `source-visibility.ts`

### 現在の想定責務

```txt
- public user に見せてよい source
- admin に見せてよい source
- organization / store の scope に合う source
```

### 再利用化後の方針

これは SaaS ごとに差し替えるべき policy です。

```ts
export interface SourceVisibilityPolicy<TContext = unknown> {
  canReadSource(input: CanReadSourceInput<TContext>): Promise<boolean>;
  buildVisibilityFilter(input: BuildVisibilityFilterInput<TContext>): Promise<VisibilityFilter>;
}
```

### 実装タスク

```txt
1. core に SourceVisibilityPolicy を追加
2. source-visibility.ts は ReserveAppSourceVisibilityPolicy として整理
3. retriever はこの policy を必ず通す
4. source-visibility.test.ts は public/admin/store/organization の境界を維持
```

## 6. DB / migration 方針

現在すでに以下が存在します。

```txt
apps/backend/drizzle/0018_ai_chatbot.sql
apps/backend/drizzle/0019_ai_message_observability.sql
apps/backend/src/infra/db/schema.ts:1073
```

そのため、再利用化のためにいきなり新規 table を大量追加するのではなく、まず現行 table を確認して分類します。

## 6.1 DB 監査タスク

```txt
1. schema.ts の AI 関連 table 範囲を確認
2. 0018_ai_chatbot.sql の table / index / constraints を確認
3. 0019_ai_message_observability.sql の追加 column / table を確認
4. 現行 table が以下を持つか確認
   - conversation id
   - message id
   - subject / scope
   - channel
   - source / citation
   - token usage
   - latency
   - provider / model
   - error code
   - visibility scope
```

## 6.2 大変更を許容できる場合の推奨

このプロジェクトは現在も開発中です。
個人開発で既存 AI データを捨てられるため、AI 関連 migration は **Option B: AI migration 作り直し方式** を採用します。

この判断では、既存データの維持よりも、MVP 段階で schema と実装境界をきれいに揃えることを優先します。

### Option A: 追加 migration 方式

```txt
0018_ai_chatbot.sql
0019_ai_message_observability.sql
0020_ai_chatbot_reusable_refactor.sql
```

メリット:

```txt
- 履歴が残る
- 作業差分がわかりやすい
```

デメリット:

```txt
- 開発初期では migration が少し複雑になる
```

### Option B: AI migration 作り直し方式

```txt
0018_ai_chatbot.sql を再設計
0019_ai_message_observability.sql を統合または削除
dev DB は reset
必要なら remote D1 も reset または recreate
Vectorize index は再投入
```

メリット:

```txt
- 個人開発では最もきれい
- 将来の保守が楽
- core / infra / app 固有層の境界に合わせて table shape を再設計できる
```

デメリット:

```txt
- 既存 dev data は消える
- remote D1 に残っている AI chat data も、必要なら捨てる前提になる
- migration journal / snapshot / schema.ts の整合を同時に取る必要がある
- Vectorize の既存 chunk id / metadata は再投入前提になる
```

### Option B の採用条件

```txt
- 既存 AI conversation / message / feedback / usage counter は破棄できる
- 既存 knowledge document / chunk は再 index できる
- remote D1 も reset / recreate / migration 再適用してよい
- Drizzle migration journal と snapshot を作り直せる
- Vectorize index は削除または stale chunk を無効化し、全量再投入できる
- 本番反映済み履歴より、MVP 段階の schema 清潔性を優先する
```

### Option B で必ず同時に更新するもの

```txt
- apps/backend/drizzle/0018_ai_chatbot.sql
- apps/backend/drizzle/0019_ai_message_observability.sql の統合または削除
- apps/backend/drizzle/meta/_journal.json
- apps/backend/drizzle/meta/*_snapshot.json
- apps/backend/src/infra/db/schema.ts
- apps/backend/scripts/index-ai-knowledge.mjs の再投入手順
- specs/004-ai-chatbot/data-model.md
- specs/004-ai-chatbot/quickstart.md
```

## 6.3 目標 DB shape

Option B では table 名も含めて整理できます。
ただし、再設計後も indexer、retriever、conversation store、UI contract が同じ概念を参照できる状態にします。

現行 table 名を維持する場合は、次の対応で読み替えます。

```txt
ai_source         -> ai_knowledge_document
ai_source_chunk   -> ai_knowledge_chunk
ai_message_source -> ai_message.sources_json / retrieved_context_json
ai_usage_event    -> ai_message observability fields または新規 usage event table
```

概念としては以下を満たす状態にします。

```txt
ai_conversation
  - id
  - subject_type
  - subject_id
  - actor_user_id
  - channel
  - status
  - created_at
  - updated_at
  - last_message_at

ai_message
  - id
  - conversation_id
  - role
  - content
  - provider
  - model
  - input_tokens
  - output_tokens
  - latency_ms
  - error_code
  - created_at

ai_source
  - id
  - source_type
  - source_key
  - visibility_scope
  - title
  - body
  - created_at
  - updated_at

ai_source_chunk
  - id
  - source_id
  - chunk_index
  - content
  - embedding
  - visibility_scope
  - created_at

ai_message_source
  - message_id
  - source_id
  - chunk_id
  - score

ai_usage_event
  - id
  - subject_type
  - subject_id
  - conversation_id
  - provider
  - model
  - input_tokens
  - output_tokens
  - latency_ms
  - created_at
```

## 7. Route / app integration 方針

現在の関連ファイル:

```txt
apps/backend/src/routes/ai-routes.ts
apps/backend/src/app/create-app.ts
apps/backend/src/auth-worker.ts
apps/backend/src/worker.ts
```

## 7.1 方針

```txt
- ai-routes.ts は維持する
- route handler の中に provider / DB 実装を直接書かない
- createAiRouteContext を作る
- create-app.ts は registerAiRoutes(ctx) を呼ぶだけに近づける
```

## 7.2 目標形

```ts
// apps/backend/src/routes/ai-routes.ts
export const registerAiRoutes = (app: Hono<AppEnv>, ctx: AiRouteContext) => {
  app.post('/api/v1/ai/chat', async (c) => {
    const input = await c.req.json();
    const result = await ctx.sendMessageUseCase.execute({
      request: input,
      actor: c.get('actor'),
    });

    return c.json(result.body, result.status);
  });
};
```

## 7.3 実装タスク

```txt
1. ai-route-context.ts を追加
2. answerGenerator / retriever / stores / rateLimiter / provider を context にまとめる
3. ai-routes.ts の直接 import を減らす
4. create-app.ts は registerAiRoutes を呼ぶだけにする
5. auth-worker.ts / worker.ts の entrypoint は変えない
```

## 8. Web 側の整理方針

現在の関連ファイル:

```txt
apps/web/src/lib/ai-client.ts
apps/web/src/lib/features/ai-chat.svelte.ts
apps/web/src/lib/components/ai/AiChatWidget.svelte
apps/web/src/lib/components/ai/AiMessageList.svelte
apps/web/src/lib/components/ai/AiSourceList.svelte
apps/web/src/lib/components/ai/AiSuggestedActions.svelte
apps/web/src/routes/+layout.svelte
```

## 8.1 方針

Web 側はすでに component 分離されているため、作り直しではなく contract を整理します。

```txt
- ai-client.ts は backend API contract に合わせる
- ai-chat.svelte.ts は UI state machine として維持
- components/ai は reserve-app 以外でも使えるよう props を整理
- +layout.svelte は表示条件だけを持つ
```

## 8.2 `ai-client.ts`

### 実装タスク

```txt
1. API response 型を backend schema と揃える
2. sendMessage / startConversation / resetConversation などを明示する
3. source / suggestedActions / error response を型安全にする
4. fetch error と API error を分ける
```

## 8.3 `ai-chat.svelte.ts`

### 実装タスク

```txt
1. conversation state を明示する
   - idle
   - opening
   - ready
   - sending
   - error
2. messages / sources / suggestedActions を分離
3. retry / reset / close を action として整理
4. ai-chat.spec.ts を state transition test にする
```

## 8.4 Components

### `AiChatWidget.svelte`

```txt
- widget の開閉
- initial suggested actions
- layout との接続
- mobile 表示
```

### `AiMessageList.svelte`

```txt
- user / assistant message 表示
- loading message
- error message
```

### `AiSourceList.svelte`

```txt
- RAG source 表示
- visibility label
- source title / excerpt / score
```

### `AiSuggestedActions.svelte`

```txt
- suggested action のクリック
- prompt shortcut
- disabled state
```

## 8.5 Web Done 条件

```txt
- AiChatWidget.svelte.spec.ts が通る
- AiSourceList.svelte.spec.ts が通る
- ai-chat.spec.ts が通る
- e2e/ai/ai-chat-widget.spec.ts が通る
- backend response shape 変更時に型で検知できる
```

## 9. Docs / Specs 更新方針

現在 docs/specs が充実しているため、計画書を新規で増やすだけでなく既存文書を更新します。

## 9.1 更新対象

```txt
docs/history/ai-chat-proposal.md
apps/docs/src/routes/manuals/common/ai-chatbot/+page.md
apps/docs/static/manuals/common-ai-chatbot/ai-chatbot-rag-flow.mmd
apps/docs/static/manuals/common-ai-chatbot/ai-chatbot-rag-flow.svg

specs/004-ai-chatbot/spec.md
specs/004-ai-chatbot/plan.md
specs/004-ai-chatbot/data-model.md
specs/004-ai-chatbot/contracts/ai-api.openapi.yaml
specs/004-ai-chatbot/contracts/ai-ui-contract.md
specs/004-ai-chatbot/quickstart.md
specs/004-ai-chatbot/tasks.md
```

## 9.2 更新内容

```txt
- 現行 features/ai の責務一覧
- 再利用化後の package boundary
- backend route contract
- UI contract
- RAG flow diagram
- source visibility policy
- rate limit policy
- message observability
- indexing script の実行方法
```

## 10. 実行フェーズ

## Phase 0: 現行棚卸し

### 目的

現行 `features/ai` を壊さず、どこを core に抽出するかを確定する。

### 作業

```txt
1. features/ai の各 file の責務を markdown にまとめる
2. schema.ts の AI 関連 table を抜き出す
3. 0018 / 0019 migration を確認する
4. ai-routes.ts の endpoint / request / response を整理する
5. web ai-client.ts の contract を整理する
6. 現行 test が保証している仕様を一覧化する
```

### 成果物

```txt
docs/ai-chat-current-implementation-map.md
```

### Done 条件

```txt
- 各 file の責務が一覧化されている
- 抽出候補と app 固有候補が分かれている
- 現行 API contract が明文化されている
- 現行 DB table が明文化されている
```

## Phase 1: core package 作成

### 目的

既存実装から型と port を抽出する。

### 作業

```txt
1. packages/saas-chatbot-core を作成
2. types.ts に共通型を置く
3. answer.ts に answer generation 型を置く
4. conversation.ts に conversation / message 型を置く
5. embedding.ts に EmbeddingProvider を置く
6. knowledge.ts に KnowledgeSource / KnowledgeChunk を置く
7. retriever.ts に KnowledgeRetriever を置く
8. prompt.ts に PromptBuilder を置く
9. rate-limit.ts に ChatRateLimiter を置く
10. source-visibility.ts に SourceVisibilityPolicy を置く
11. ui-contract.ts に UI response 型を置く
12. package.json / tsconfig.json / exports を既存 package と同じ形で追加する
13. apps/backend/package.json に @repo/saas-chatbot-core を workspace dependency として追加する
```

### Done 条件

```txt
- core package が typecheck できる
- core package は reserve-app に依存しない
- core package は provider SDK に依存しない
- @repo/saas-chatbot-core として workspace から解決できる
- features/ai から core 型を import できる
```

## Phase 2: backend feature の port 化

### 目的

`features/ai` を app 固有 adapter / orchestration 層にする。

### 作業

```txt
1. answer-generator.ts を core port ベースに変更
2. business-facts.ts を BusinessFactsProvider 実装にする
3. context-resolver.ts の戻り値を ChatRuntimeContext に寄せる
4. conversation-store.ts を interface / implementation に分ける
5. embedding.ts を provider port / implementation に分ける
6. indexer.ts を generic pipeline + reserve source loader に分ける
7. prompt.ts を PromptBuilder 実装にする
8. rate-limit.ts を ChatRateLimiter 実装にする
9. retriever.ts を KnowledgeRetriever 実装にする
10. source-visibility.ts を SourceVisibilityPolicy 実装にする
```

### Done 条件

```txt
- features/ai は core 型と port を使っている
- provider SDK が answer-generator.ts に直書きされていない
- DB 実装が usecase に直書きされていない
- 既存 backend unit test が通る
```

## Phase 3: infra 分離

### 目的

DB / provider / storage / embedding 実装を infra に寄せる。

### 作業

```txt
1. infra/ai/fake-ai-provider.ts を作る
2. infra/ai/cloudflare-ai-provider.ts または openai-ai-provider.ts を作る
3. infra/ai-knowledge/drizzle-ai-conversation-store.ts を作る
4. infra/ai-knowledge/drizzle-ai-knowledge-store.ts を作る
5. infra/ai-knowledge/drizzle-ai-observability-store.ts を作る
6. features/ai/conversation-store.ts から DB 実装を移す
7. features/ai/embedding.ts から provider 実装を移す
```

### Done 条件

```txt
- features/ai は infra 実装を DI で受け取る
- infra 実装は core port を実装している
- fake provider で test できる
```

## Phase 4: route context 化

### 目的

`ai-routes.ts` を薄くし、依存を明示する。

### 作業

```txt
1. features/ai/ai-route-context.ts を作る
2. createAiRouteContext を作る
3. ai-routes.ts で usecase を呼ぶだけにする
4. create-app.ts で registerAiRoutes(app, aiCtx) する
5. auth-worker.ts / worker.ts の責務を変えずに接続を確認する
```

### Done 条件

```txt
- ai-routes.ts が薄い route adapter になっている
- request validation が schemas / usecase 側に整理されている
- route test が通る
```

## Phase 5: DB schema 調整

### 目的

現行 AI tables を再利用可能な形に調整する。

### 作業

```txt
1. 現行 table と目標 shape の差分を出す
2. subject_type / subject_id が足りなければ追加
3. channel が足りなければ追加
4. provider / model / token / latency が足りなければ追加
5. source visibility scope が足りなければ追加
6. message observability を usage event として読める形にする
7. Option B 前提で 0018 / 0019 / Drizzle meta / Vectorize 再投入手順を揃える
```

### Done 条件

```txt
- 会話が subject に紐づく
- message observability が保存される
- sources / citations が保存または再現できる
- indexer / retriever が同じ source model を使う
```

## Phase 6: indexing script 整理

### 目的

`scripts/index-ai-knowledge.mjs` を再利用しやすくする。

### 作業

```txt
1. script 内の業務ロジックを usecase に移す
2. script は CLI 引数 parse + usecase 呼び出しだけにする
3. source loader を app 固有に分ける
4. indexer は core 型を使う
5. dry-run option を追加する
6. reindex target option を追加する
```

### Done 条件

```txt
- script が薄くなっている
- indexer.test.ts が通る
- knowledge source の visibility が保存される
- docs の quickstart から実行できる
```

## Phase 7: Web contract 整理

### 目的

既存 UI を活かしながら、API contract を再利用可能にする。

### 作業

```txt
1. core ui-contract.ts と ai-client.ts の型を揃える
2. ai-chat.svelte.ts を state machine として整理
3. AiChatWidget の props を整理
4. AiSourceList の source 型を core 型に寄せる
5. AiSuggestedActions の action 型を core 型に寄せる
6. +layout.svelte の組み込み条件を feature flag 化する
```

### Done 条件

```txt
- web unit test が通る
- e2e ai-chat-widget test が通る
- backend response shape と web client 型が一致する
```

## Phase 8: docs / specs 更新

### 目的

現行実装と再利用化後の構成を docs/specs に反映する。

### 作業

```txt
1. docs/history/ai-chat-proposal.md を更新
2. docs/ai/ai-chat-reusable-architecture.md を追加
3. specs/004-ai-chatbot/plan.md を更新
4. specs/004-ai-chatbot/data-model.md を更新
5. ai-api.openapi.yaml を更新
6. ai-ui-contract.md を更新
7. rag flow mmd/svg を更新
8. manual page を更新
```

### Done 条件

```txt
- API と UI contract が docs と一致する
- RAG flow が現行構成と一致する
- quickstart で index + chat の流れを再現できる
```

## Phase 9: hardening

### 目的

再利用化後の実運用に必要な最低限の堅牢化を行う。

### 作業

```txt
1. provider timeout を明示
2. rate limit key を subject / actor / IP / channel で整理
3. source visibility を retriever で必ず適用
4. observability に request id / latency / provider / model を保存
5. prompt version を保存
6. failed answer generation を記録
7. e2e test を追加または更新
```

### Done 条件

```txt
- 失敗時の原因を追える
- source visibility の漏れを test できる
- rate limit が test されている
- provider 変更時に feature 層を変更しなくてよい
```

## 11. 推奨 PR 分割

### PR 1: 現行棚卸し docs

```txt
- docs/ai-chat-current-implementation-map.md
- 既存 API / DB / UI contract の整理
```

### PR 2: core package

```txt
- packages/saas-chatbot-core
- 共通型
- port interface
- ui-contract 型
```

### PR 3: features/ai port 化

```txt
- answer-generator
- business-facts
- context-resolver
- prompt
- retriever
- source-visibility
- rate-limit
```

### PR 4: infra 分離

```txt
- provider adapter
- drizzle store
- fake provider
- embedding provider
```

### PR 5: route context

```txt
- ai-route-context.ts
- ai-routes.ts 整理
- create-app.ts 接続
```

### PR 6: DB / migration

```txt
- AI schema 差分
- migration
- store test
```

### PR 7: indexing script

```txt
- index-ai-knowledge.mjs 薄型化
- source loader
- dry-run
- quickstart 更新
```

### PR 8: Web contract

```txt
- ai-client.ts
- ai-chat.svelte.ts
- components/ai
- unit / e2e test
```

### PR 9: docs / specs

```txt
- specs/004-ai-chatbot
- manual page
- RAG flow diagram
```

### PR 10: hardening

```txt
- timeout
- usage / observability
- prompt version
- source visibility test
```

## 12. 既存テストの扱い

現在すでに test があるため、再利用化の成否は既存テストを壊さず、責務変更後に test 名と観点を更新できるかで判断します。

### Backend test

```txt
answer-generator.test.ts
  - provider port 経由で回答生成できる
  - source / suggestedActions が維持される
  - provider error を扱える

business-facts.test.ts
  - reserve-app 固有 facts が維持される

conversation-store.test.ts
  - ConversationStore contract test に変更

embedding.test.ts
  - EmbeddingProvider contract test に変更

indexer.test.ts
  - source loader / chunking / embedding / visibility を確認

prompt.test.ts
  - PromptBuilder output を snapshot または structured assertion で確認

rate-limit.test.ts
  - subject / actor / channel key を確認

source-visibility.test.ts
  - public / admin / organization / store 境界を確認
```

### Web test

```txt
ai-chat.spec.ts
  - state machine test にする

AiChatWidget.svelte.spec.ts
  - open / close / send / error を確認

AiSourceList.svelte.spec.ts
  - source display contract を確認

ai-chat-widget.spec.ts
  - 実際の UI flow を確認
```

## 13. Done 条件チェックリスト

```txt
- [ ] 現行 features/ai の責務一覧が docs 化されている
- [ ] packages/saas-chatbot-core が存在する
- [ ] core は reserve-app に依存していない
- [ ] core は provider SDK に依存していない
- [ ] answer-generator.ts は provider port 経由で動く
- [ ] business-facts.ts は app 固有 provider として残っている
- [ ] context-resolver.ts は ChatRuntimeContext を返す
- [ ] conversation-store.ts は ConversationStore port に分離されている
- [ ] embedding.ts は EmbeddingProvider port に分離されている
- [ ] indexer.ts は generic pipeline と app source loader に分かれている
- [ ] retriever.ts は SourceVisibilityPolicy を必ず通す
- [ ] prompt.ts は PromptBuilder 実装になっている
- [ ] rate-limit.ts は subject / actor / channel を扱える
- [ ] source-visibility.ts は app 固有 policy として残っている
- [ ] ai-routes.ts は薄い route adapter になっている
- [ ] create-app.ts は registerAiRoutes を呼ぶだけに近い
- [ ] index-ai-knowledge.mjs は CLI wrapper に近い
- [ ] ai-client.ts は backend contract と一致する
- [ ] AiChatWidget 既存テストが通る
- [ ] backend AI 既存テストが通る
- [ ] specs/004-ai-chatbot が更新されている
- [ ] manual page が更新されている
- [ ] RAG flow diagram が更新されている
```

## 14. 注意点

### 14.1 `features/ai` をすぐに `features/chatbot` へ rename しない

大変更を許容できるとしても、現在すでに docs / tests / web / routes が `ai` 名で揃っています。

そのため、初期段階では `features/ai` の名前を維持するのが安全です。

```txt
推奨:
features/ai は維持
packages/saas-chatbot-core を追加
内部で chatbot core 型を利用

非推奨:
最初に features/ai -> features/chatbot へ全面 rename
```

rename は以下が完了してからでよいです。

```txt
- core 抽出
- route context 化
- web contract 整理
- docs 更新
```

### 14.2 source visibility を最優先で守る

RAG chatbot では、source visibility の漏れが最も危険です。

```txt
- retriever で必ず source visibility を適用する
- answer-generator 側だけで filter しない
- UI に出す source も visibility 済みのものだけにする
- source-visibility.test.ts を regression test として重視する
```

### 14.3 prompt に権限を任せない

```txt
NG:
prompt に「見せてはいけない情報は出さない」と書くだけ

OK:
context-resolver + source-visibility + retriever filter + test で制御する
```

### 14.4 provider を feature に漏らさない

```txt
NG:
answer-generator.ts が特定 provider SDK に直接依存する

OK:
infra/ai の provider adapter が core port を実装する
```

### 14.5 UI contract を安定させる

`AiSourceList` と `AiSuggestedActions` があるため、backend response shape を不用意に変えると web 側が壊れます。

```txt
- ai-ui-contract.md を更新
- ai-client.ts の型を更新
- component test を更新
```

## 15. 最終結論

現在の `reserve-app` には、すでに AI chatbot 実装がかなり揃っています。

そのため、次にやるべきことは「新しい chatbot 基盤を別に作る」ことではありません。

```txt
やるべきこと:
現行 features/ai を活かし、
型・port・contract・provider 境界・store 境界を抽出して、
将来の SaaS でも使える chatbot core にする

やらない方がよいこと:
現行 AI 実装を捨てて、packages/saas-chatbot-core から作り直す
```

最終的な構成は次の関係にします。

```txt
packages/saas-chatbot-core
  汎用型 / port / contract

apps/backend/src/features/ai
  reserve-app 用 orchestration / business facts / prompt / visibility policy

apps/backend/src/infra/ai
  provider adapter

apps/backend/src/infra/ai-knowledge
  DB / embedding / knowledge store

apps/web/src/lib/components/ai
  既存 UI component を contract 化して維持
```

この順番なら、既存の backend / web / tests / docs / specs を活かしながら、次の SaaS 開発でも再利用できる AI Chatbot 基盤に整理できます。
