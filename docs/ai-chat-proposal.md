はい。`reserve-app` の既存構成なら、V1の実体は **Cloudflare Workers上のRAG構成**にするのが一番自然です。

ここでいう **V1** は「AIチャット機能のV1」です。Cloudflare Vectorize自体は、現行の Vectorize V2 index を使う前提にした方がよいです。Cloudflareのdocsでは、VectorizeはRAGや検索向けにベクトルを保存・検索するサービスとして位置づけられており、Workers AIで生成したembeddingをVectorizeに保存してqueryできます。([Cloudflare Workers][1])

## 全体構成

```txt id="etvlb0"
apps/web
  ↓
POST /api/v1/ai/chat

apps/backend / Cloudflare Worker
  ├─ Better Auth session確認
  ├─ organization / classroom / role 解決
  ├─ 質問をembedding化
  ├─ Vectorize検索
  ├─ D1からchunk本文・権限・DB文脈を取得
  ├─ LLMで回答生成
  └─ 会話ログ・feedback保存

Cloudflare
  ├─ D1: 会話、ナレッジ本文、metadata、既存業務DB
  ├─ Vectorize: embedding検索
  ├─ Workers AI: embedding生成 / LLM
  ├─ AI Gateway: ログ、rate limit、cache、fallback
  └─ R2: 将来PDF/画像/docs原本を置く場合
```

`reserve-app` はすでに `apps/backend` が Cloudflare Workers + Wrangler + Hono + Drizzle/D1 で動いていて、`apps/web` と `apps/docs` も個別にdeployするmonorepoです。
backendには既に D1 binding `DB`、R2 bucket、observability設定があるので、ここに `AI` binding と `VECTORIZE` binding を足すのがよいです。

## 追加するCloudflare binding

`apps/backend/wrangler.jsonc` に追加する想定です。

```jsonc id="yk6qsm"
{
  "ai": {
    "binding": "AI",
  },
  "vectorize": [
    {
      "binding": "AI_KNOWLEDGE_INDEX",
      "index_name": "reserve-app-knowledge",
    },
  ],
}
```

Workers AI は `env.AI.run()` でモデルを呼び出せます。Cloudflareのdocsでは、Workers AI binding は Wrangler 設定に `ai.binding = "AI"` を追加し、Worker内で `env.AI.run()` を使う形です。([Cloudflare Docs][2])
VectorizeもWorker bindingとして接続する形で、Cloudflare docsでは `[[vectorize]] binding = "VECTORIZE"` のように設定します。([Cloudflare Docs][3])

## Vectorize index

日本語FAQ・操作説明を扱うなら、embedding model は **多言語対応の `@cf/baai/bge-m3` を第一候補**にするのが良いです。Cloudflare Workers AI docsでは `bge-m3` は multi-lingual / multi-granularity なembedding modelとして掲載されています。([Cloudflare Docs][4])

ただし、Vectorize index は作成時に **dimensions と metric を固定**します。Cloudflareのチュートリアルでも、使うembedding modelの出力次元に合わせて `--dimensions=768 --metric=cosine` のように作成し、その設定は後から変更できない前提で説明されています。([Cloudflare Docs][3])

そのため実装では、まずdev環境で採用モデルの `shape` を確認してからindexを作るのが安全です。

```ts id="zyu85d"
const result = await env.AI.run('@cf/baai/bge-m3', {
  text: '予約のキャンセル方法を教えてください',
});

console.log(result.shape);
```

英語中心のdocsなら `@cf/baai/bge-base-en-v1.5` も使えます。このモデルは 768-dimensional vector を出力するため、`--dimensions=768` のVectorize indexと合わせられます。([Cloudflare Docs][5])
ただし `reserve-app` は日本語UI・日本語docsを想定しているようなので、最初から `bge-m3` 寄りで設計するのが良いです。

## D1とVectorizeの役割分担

重要なのは、**Vectorizeに本文を全部持たせない**ことです。

Cloudflare docsでも、vector databaseは通常のSQL DBとは違い、元データそのものではなくembeddingを保存するものとして説明されています。([Cloudflare Docs][3])

なので役割はこう分けます。

```txt id="lpo2tt"
D1
- chunk本文
- source path
- title
- locale
- visibility
- organizationId
- classroomId
- checksum
- indexedAt
- 会話ログ
- feedback

Vectorize
- chunkId
- embedding vector
- metadata
  - sourceKind
  - locale
  - visibility
  - organizationId
  - classroomId
  - tags
```

## DBテーブル案

`apps/backend/src/db/schema.ts` にDrizzle schemaを追加する想定です。既存schemaには `organization`, `organization_billing`, `member`, `classroom`, `classroom_member`, `participant`, `service`, `booking` などが既にあるため、AI用テーブルは既存ドメインDBを補助する形にします。

```ts id="ffzcv1"
export const aiKnowledgeDocument = sqliteTable('ai_knowledge_document', {
  id: text('id').primaryKey(),
  sourceKind: text('source_kind').notNull(), // docs | specs | faq | db_snapshot
  sourcePath: text('source_path').notNull(),
  title: text('title').notNull(),
  locale: text('locale').default('ja').notNull(),
  visibility: text('visibility').default('authenticated').notNull(),
  checksum: text('checksum').notNull(),
  indexedAt: integer('indexed_at', { mode: 'timestamp_ms' }).notNull(),
});

export const aiKnowledgeChunk = sqliteTable('ai_knowledge_chunk', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourcePath: text('source_path').notNull(),
  title: text('title').notNull(),
  locale: text('locale').default('ja').notNull(),
  visibility: text('visibility').default('authenticated').notNull(),
  organizationId: text('organization_id'),
  classroomId: text('classroom_id'),
  tagsJson: text('tags_json'),
  indexedAt: integer('indexed_at', { mode: 'timestamp_ms' }).notNull(),
});

export const aiConversation = sqliteTable('ai_conversation', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  classroomId: text('classroom_id'),
  userId: text('user_id').notNull(),
  title: text('title'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const aiMessage = sqliteTable('ai_message', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  role: text('role').notNull(), // user | assistant
  content: text('content').notNull(),
  sourcesJson: text('sources_json'),
  retrievedContextJson: text('retrieved_context_json'),
  confidence: integer('confidence'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const aiFeedback = sqliteTable('ai_feedback', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull(),
  userId: text('user_id').notNull(),
  rating: text('rating').notNull(), // helpful | unhelpful
  resolved: integer('resolved', { mode: 'boolean' }).default(false).notNull(),
  comment: text('comment'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
```

## ファイル構成

既存backendは `OpenAPIHono` で `/api/v1/auth` と `/api/v1/public` をroute登録しているので、AIも同じ形式で `/api/v1/ai` に追加するのが自然です。

```txt id="o4d7i4"
apps/backend/src
├─ routes
│  └─ ai-routes.ts
│
├─ ai
│  ├─ context-resolver.ts
│  ├─ embedding.ts
│  ├─ retriever.ts
│  ├─ reranker.ts
│  ├─ answer-generator.ts
│  ├─ prompt.ts
│  ├─ source-visibility.ts
│  └─ indexer.ts
│
└─ scripts
   └─ index-ai-knowledge.mjs
```

`apps/web` 側は既に Hono client を使ってbackendを呼ぶ構成なので、`ai-client.ts` を追加してチャットUIから呼びます。

```txt id="sx54s6"
apps/web/src/lib
├─ ai-client.ts
└─ components/ai
   ├─ AiChatWidget.svelte
   ├─ AiMessageList.svelte
   ├─ AiSourceList.svelte
   └─ AiSuggestedActions.svelte
```

## インデックス作成フロー

対象はまずこの4つで十分です。

```txt id="7ptcpa"
1. apps/docs のmdsvex / markdown
2. specs/* の仕様書
3. 課金・予約・権限まわりの固定FAQ
4. 必要に応じたDB由来の安全なsummary
```

流れはこうです。

```txt id="dcbxjv"
Markdown / specs
  ↓
frontmatter抽出
  ↓
見出し単位でchunk化
  ↓
visibility付与
  ↓
Workers AIでembedding生成
  ↓
D1にchunk本文保存
  ↓
Vectorizeに { id: chunkId, values, metadata } upsert
```

chunk sizeは最初はこのくらいが扱いやすいです。

```txt id="yu679j"
chunk size: 500〜900文字
overlap: 80〜120文字
topK: 8〜12
最終的にLLMへ渡すcontext: 4〜6 chunks
```

## Vectorize metadata設計

`reserve-app` では権限境界が重要なので、metadata filterを前提にします。

Cloudflare Vectorizeはmetadata filterを使って、検索対象をtenant/customer/product categoryなどで絞り込めます。filterは先に適用され、その後に `topK` が取られる仕様です。([Cloudflare Docs][6])

metadataはこうします。

```ts id="p59uez"
type AiVectorMetadata = {
  sourceKind: 'docs' | 'specs' | 'faq' | 'db_summary';
  locale: 'ja' | 'en';
  visibility: 'public' | 'authenticated' | 'participant' | 'staff' | 'manager' | 'admin' | 'owner';
  organizationId?: string;
  classroomId?: string;
  feature?: 'booking' | 'billing' | 'ticket' | 'invitation' | 'service';
};
```

検索時はユーザーのroleに応じてfilterを変えます。

```ts id="pwzbba"
const filter = {
  locale: { $eq: 'ja' },
  visibility: { $in: allowedVisibilities },
};
```

ownerなら：

```ts id="5dzj1c"
const allowedVisibilities = [
  'public',
  'authenticated',
  'participant',
  'staff',
  'manager',
  'admin',
  'owner',
];
```

participantなら：

```ts id="0byyao"
const allowedVisibilities = ['public', 'authenticated', 'participant'];
```

## チャット実行フロー

`POST /api/v1/ai/chat` の内部処理はこうです。

```txt id="prvzeh"
1. session取得
2. activeOrganizationId解決
3. member / classroomMember / participant からrole判定
4. currentPageとmessageからintent分類
5. messageをembedding化
6. Vectorize検索
7. D1からchunk本文を取得
8. 必要ならDB文脈を追加取得
9. 権限外の情報を除外
10. LLMに回答生成させる
11. sources / suggestedActions付きで返す
12. ai_messageに保存
```

## 具体的なAPI

```ts id="m67ugb"
const aiChatRoute = createRoute({
  method: 'post',
  path: '/chat',
  tags: ['AI'],
  summary: 'Ask AI assistant',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            message: z.string().min(1).max(4000),
            conversationId: z.string().optional(),
            organizationId: z.string().optional(),
            classroomId: z.string().optional(),
            currentPage: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'AI answer',
    },
    401: {
      description: 'Unauthorized',
    },
  },
});
```

レスポンスはこうします。

```ts id="dadg7l"
type AiChatResponse = {
  conversationId: string;
  messageId: string;
  answer: string;
  sources: Array<{
    sourceKind: 'docs' | 'specs' | 'faq' | 'db_summary';
    title: string;
    sourcePath?: string;
    chunkId?: string;
  }>;
  suggestedActions: Array<{
    label: string;
    href?: string;
    actionKind?: 'open_page' | 'contact_owner' | 'contact_support';
  }>;
  confidence: number;
  needsHumanSupport: boolean;
};
```

## Retrieval処理のイメージ

```ts id="jj94bu"
export async function retrieveKnowledge({
  env,
  database,
  message,
  allowedVisibilities,
  organizationId,
  classroomId,
}: {
  env: Env;
  database: Database;
  message: string;
  allowedVisibilities: string[];
  organizationId?: string;
  classroomId?: string;
}) {
  const embeddingResult = await env.AI.run('@cf/baai/bge-m3', {
    text: message,
  });

  const vector = embeddingResult.data?.[0] ?? embeddingResult.response?.[0];

  const matches = await env.AI_KNOWLEDGE_INDEX.query(vector, {
    topK: 12,
    returnMetadata: true,
    filter: {
      visibility: { $in: allowedVisibilities },
      locale: { $eq: 'ja' },
    },
  });

  const chunkIds = matches.matches.map((match) => match.id);

  const chunks = await database
    .select()
    .from(aiKnowledgeChunk)
    .where(inArray(aiKnowledgeChunk.id, chunkIds));

  return rerankAndTrim(chunks, matches);
}
```

実際の返却shapeは採用modelごとに確認して、`embedding.ts` に吸収しておくのが良いです。

## LLMへのcontext

LLMには、検索結果をそのまま雑に渡さず、以下のように構造化して渡します。

```txt id="z06a55"
System:
あなたは reserve-app のAIサポートです。
根拠がないことは断定しない。
ユーザーの権限外の情報は出さない。
操作を実行せず、案内のみ行う。

User context:
- userId
- organizationId
- classroomId
- role
- currentPage
- billing visibility
- booking visibility

Retrieved docs:
[1] title, sourcePath, content
[2] title, sourcePath, content

DB facts:
- planState
- paymentMethodStatus
- entitlementState
- canManageBilling
- canManageBookings

User question:
...
```

課金系の質問では、既存の `OrganizationBillingPayload` にある `planState`, `paymentMethodStatus`, `subscriptionStatus`, `entitlementState`, `canViewBilling`, `canManageBilling` を使って回答するのが良いです。これらは既にweb側の型に定義されています。

## AI Gatewayの位置づけ

V1では **AI Gatewayを必ず挟む**のが良いです。

理由は、ログ、rate limiting、cache、fallback、guardrailsを後から足しやすいからです。Cloudflare AI GatewayはAIアプリの使用状況・コスト・エラーの可視化、rate limiting、cache、fallbackなどを提供すると説明されています。([クラウドフレア][7])
またAI Gatewayのpersistent logsにはプラン別の上限があり、Freeでは全gateway合計100,000 logs、Paidではgatewayごとに10,000,000 logsという記載があります。([Cloudflare Docs][8])

V1ではこの設定で十分です。

```txt id="pb9xn9"
- AI Gateway: enabled
- cache: docs質問のみ短時間ON
- billing/個人情報を含む質問: cache OFF
- logs: ON
- prompt/response DLP: 後でON
- rate limit: user単位・organization単位で制限
```

## 回答対象ごとのcontext設計

### 予約・サービス系

```txt id="de2vzo"
質問例:
「予約枠を作るには？」
「キャンセル期限はどこで設定する？」
「承認制予約と即時予約の違いは？」

使うcontext:
- docs chunk
- service設定
- slot設定
- classroom role
- canManageBookings
```

### 参加者・招待系

```txt id="05e11g"
質問例:
「参加者を招待できない」
「参加者自身で予約できる？」

使うcontext:
- docs chunk
- invitation仕様
- participant record
- canManageParticipants
```

### チケット系

```txt id="5dtv2p"
質問例:
「チケットが残っているのに予約できない」
「回数券を付与するには？」

使うcontext:
- ticketType
- ticketPack
- ticketLedger summary
- participant role
- docs chunk
```

### 課金系

```txt id="zqi8m8"
質問例:
「Premiumが有効にならない」
「支払い方法を登録したい」
「請求書はどこ？」

使うcontext:
- organizationBilling summary
- canViewBilling
- canManageBilling
- paymentIssueState
- nextOwnerAction
- docs chunk
```

請求書や領収書は `owner_only` の扱いになっているので、owner以外には詳細を返さず、「オーナーに確認してください」と案内するのが安全です。

## V1での実装優先順位

```txt id="ps4u2h"
1. wrangler.jsonc に AI / Vectorize binding 追加
2. ai_knowledge_document / ai_knowledge_chunk migration追加
3. docs/specsをchunk化するindex script作成
4. Vectorize upsert処理作成
5. /api/v1/ai/chat 追加
6. role別 visibility filter 実装
7. billing / booking / invitation / ticket のDB facts resolver作成
8. apps/webにチャットUI追加
9. feedback保存
10. AI Gatewayでログ・rate limit・cache調整
```

## 最終構成のおすすめ

`reserve-app` のV1はこの構成が良いです。

```txt id="zggzrv"
LLM:
- Workers AI または外部LLMをAI Gateway経由で呼ぶ

Embeddings:
- 第一候補: @cf/baai/bge-m3
- 英語docs中心なら: @cf/baai/bge-base-en-v1.5

Vector DB:
- Cloudflare Vectorize
- index: reserve-app-knowledge
- metric: cosine
- dimensions: 採用embedding modelに合わせて固定

Metadata filter:
- locale
- visibility
- organizationId
- classroomId
- feature

Source of truth:
- D1
- apps/docs
- specs
- 既存のorganization / billing / booking DB

Backend:
- apps/backend/src/routes/ai-routes.ts
- apps/backend/src/ai/*

Frontend:
- apps/web/src/lib/ai-client.ts
- apps/web/src/lib/components/ai/*
```

一番大事なのは、**Vectorizeは検索、D1は正本、backendは権限判定、LLMは回答生成だけ**に分けることです。
この分離にしておけば、将来「AIが予約作成を補助する」「問い合わせチケットを自動作成する」「管理者向け運用copilotにする」方向にも安全に拡張できます。

## 実装メモ

V1 の初期実装では、ログイン済みユーザーが画面右下の AI サポートから質問できます。
回答は、検索済みのナレッジ、利用者が見てもよい業務情報、現在の権限を組み合わせて作成します。
AI は予約作成、課金変更、参加者変更、チケット付与、招待送信などの操作を実行しません。

実装メモ:

- Backend は `/api/v1/ai/chat`、`/api/v1/ai/messages/{messageId}/feedback`、`/api/v1/internal/ai/knowledge`、`/api/v1/internal/ai/feedback-themes` を追加します。
- Cloudflare binding は `AI` と `AI_KNOWLEDGE_INDEX` を使います。
- AI Gateway は `AI_GATEWAY_ID` で指定します。課金、支払い、個人情報を含む質問や sensitive な業務情報を含む回答では cache を無効にします。
- Embedding model は `AI_EMBEDDING_MODEL`、回答 model は `AI_ANSWER_MODEL` で差し替えられます。既定は `@cf/baai/bge-m3` と `@cf/meta/llama-3.1-8b-instruct` です。
- Vectorize index は `reserve-app-knowledge` を想定します。作成前に採用 embedding model の `shape` を確認し、その dimensions と `cosine` metric で作成します。
- D1 には `ai_knowledge_document`、`ai_knowledge_chunk`、`ai_knowledge_index_run`、`ai_conversation`、`ai_message`、`ai_feedback`、`ai_usage_counter` を追加します。
- 会話本文は 180 日で匿名化します。低評価などの集計用フィードバックは 1 年で削除します。
- 知識投入は `apps/backend/scripts/index-ai-knowledge.mjs` と `apps/backend/src/ai/indexer.ts` を起点にします。D1 を正本、Vectorize を検索用 index として扱います。

## ローカル検証メモ

実装後に次の検証を通しています。

```bash
pnpm --filter @apps/backend typecheck
pnpm --filter @apps/web typecheck
pnpm --filter @apps/backend exec vitest run src/ai/source-visibility.test.ts src/ai/rate-limit.test.ts src/ai/embedding.test.ts src/ai/prompt.test.ts src/ai/answer-generator.test.ts src/ai/indexer.test.ts src/ai/business-facts.test.ts src/ai/conversation-store.test.ts
pnpm --filter @apps/web exec vitest run --project server src/lib/features/ai-chat.spec.ts --maxWorkers=1
pnpm --filter @apps/web exec vitest run --project client src/lib/components/ai/AiChatWidget.svelte.spec.ts src/lib/components/ai/AiSourceList.svelte.spec.ts --maxWorkers=1
```

確認結果:

- Backend typecheck: pass
- Web typecheck: pass, `svelte-check found 0 errors and 0 warnings`
- Backend AI unit tests: 8 files / 27 tests pass
- Web AI state tests: 1 file / 3 tests pass
- Web AI component tests: 2 files / 4 tests pass

[1]: https://workers.cloudflare.com/product/vectorize/?utm_source=chatgpt.com 'Cloudflare Vectorize - Vector Database for RAG Applications'
[2]: https://developers.cloudflare.com/workers-ai/configuration/bindings/?utm_source=chatgpt.com 'Workers Bindings · Cloudflare Workers AI docs'
[3]: https://developers.cloudflare.com/vectorize/get-started/embeddings/?utm_source=chatgpt.com 'Vectorize and Workers AI · Cloudflare Vectorize docs'
[4]: https://developers.cloudflare.com/workers-ai/models/bge-m3/?utm_source=chatgpt.com 'bge-m3 (BAAI) · Cloudflare AI docs · Cloudflare Workers AI docs'
[5]: https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/?utm_source=chatgpt.com 'bge-base-en-v1.5 (BAAI) · Cloudflare AI docs · Cloudflare Workers AI docs'
[6]: https://developers.cloudflare.com/vectorize/reference/metadata-filtering/?utm_source=chatgpt.com 'Metadata filtering · Cloudflare Vectorize docs'
[7]: https://www.cloudflare.com/developer-platform/products/ai-gateway/?utm_source=chatgpt.com 'AI Gateway | Observability for AI applications | Cloudflare'
[8]: https://developers.cloudflare.com/ai-gateway/reference/pricing/?utm_source=chatgpt.com 'Pricing · Cloudflare AI Gateway docs'
