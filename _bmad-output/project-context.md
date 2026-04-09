---
project_name: 'reserve-app'
user_name: 'Yusuke'
date: '2026-04-07'
sections_completed:
  - technology_stack
  - language_specific_rules
  - framework_specific_rules
  - testing_rules
  - code_quality_style_rules
  - development_workflow_rules
  - critical_dont_miss_rules
existing_patterns_found: 8
---

# AIエージェント向けプロジェクトコンテキスト

_このファイルは、このプロジェクトでコードを実装する AI エージェントが守るべき重要なルールと既存パターンを整理するためのものです。汎用的なベストプラクティスではなく、このリポジトリ固有で見落としやすい前提を優先します。_

---

## 技術スタックとバージョン

### 共通基盤

- モノレポは `pnpm 10.27.0` と `Turborepo 2.5.8` を前提にする。
- 共通の品質管理は `ESLint 9.39.2`、`Prettier 3.8.1`、`Vitest 4.0.18` を使う。
- TypeScript は各 app で strict 前提として扱い、型回避を常態化させない。

### Backend

- Backend は `Cloudflare Workers` 上の `Hono 4.11.7` アプリとして実装する。
- 認証は `Better Auth 1.4.18`、DB は `Drizzle ORM 0.45.1` + `Cloudflare D1` を前提にする。
- API 契約と入出力スキーマは `@hono/zod-openapi 1.2.1` と `Zod 4.3.6` に合わせる。
- `tsconfig.json` は `module: "NodeNext"` と `verbatimModuleSyntax: true` を有効にしているため、import/export はその前提を壊さない。
- JSX は `react-jsx` + `jsxImportSource: "hono/jsx"` を前提にする。
- デプロイとローカル実行は `Wrangler 4.62.0` を基準にする。

### Web

- Web は `SvelteKit 2.50.1` + `Svelte 5.48.2` + `Vite 7.3.1` を前提にする。
- UI 基盤は `Tailwind CSS 4.1.18`、`bits-ui 2.15.5`、`sveltekit-superforms 2.29.1` を使う。
- `svelte.config.js` では `remoteFunctions: true` と compiler の `async` experimental を有効にしているため、その前提で実装する。
- Remote Functions は段階移行中であり、既存 `authRpc` と共存する前提を崩さない。
- browser テストは `Playwright 1.58.0`、監視は `@sentry/sveltekit 10.39.0` を使う。

### Mobile

- Mobile は `Expo 54.0.12` + `React 19.1.0` + `React Native 0.81.4` を前提にする。
- ルーティングは `Expo Router 6.0.10` を使う。
- UI は `NativeWind 4.2.1` と `HeroUI Native 1.0.0-alpha.14` を前提にする。
- `babel.config.js` では `nativewind` と `react-native-reanimated/plugin` を有効にしているため、この構成を壊さない。
- データ取得やフォームは `@tanstack/react-query 5.69.2` と `@tanstack/react-form 1.0.5` を使う。

### 外部サービス

- 監視は `Sentry`、メール送信は `Resend`、課金は `Stripe` を前提にする。
- Cloudflare Workers への deploy と D1 migration を含む運用前提は `docs/README.md` と各 app の README を正本とする。

## 重要な実装ルール

### 言語固有ルール

- TypeScript は全 app で strict 前提として扱い、`any` や型アサーションで問題を隠さない。
- 外部 API や `fetch` レスポンス、セッション、DTO は `unknown` として受け、既存実装のように type guard で絞り込んでから使う。
- backend は `module: "NodeNext"` + `verbatimModuleSyntax: true` のため、ESM import/export を前提に実装し、既存の `.js` 拡張子付き相対 import 規約を壊さない。
- backend の JSX/TSX は `hono/jsx` 前提なので、React DOM 向け JSX と同じ前提で書き換えない。
- Web の Svelte 周辺ロジックは `.svelte.ts` に置かれている既存パターンを尊重し、状態ロジックを不用意に別様式へ崩さない。
- Remote Functions は `src/lib/remote/*.remote.ts` に配置し、引数あり関数には `zod` スキーマを必須にする。
- `.remote.ts` からクライアント専用モジュールを参照しない。
- Web は tabs ベースの既存整形、backend/mobile は spaces ベースの既存整形を維持し、ファイル単位のローカルスタイルを尊重する。
- エラーメッセージ抽出や JSON 解析は、既存の `isRecord`、`parseResponseBody`、`toErrorMessage` のような防御的パターンを優先して再利用または踏襲する。
- 値オブジェクトや role/status の判定は、文字列を直接拡散させず既存の union type・定数・正規化関数に寄せる。

### フレームワーク固有ルール

- 認可モデルは `organization` と `classroom` の 2 階層を前提にし、変更時は `docs/architecture.md` の定義を正本として扱う。
- 権限制御は `facts -> effective -> sources -> display` の 4 層で扱い、サーバ/クライアントの判定は `display` ではなく `effective` を正本にする。
- `display.primaryRole` や `badges` は UI 表示専用であり、権限制御ロジックに流用しない。
- booking 系データは `classroom_id` 必須運用が前提のため、新規データや新規 API でも classroom 文脈を落とさない。
- Web は Remote Functions へ段階移行中なので、読み取り系を `src/lib/remote/*.remote.ts` に寄せつつ、既存 `src/lib/rpc-client.ts` を書き込み系中心に維持する方針を崩さない。
- Remote Functions への移行は「1機能ずつ」行い、一度に全画面・全機能を置換しない。
- Remote Functions 導入時は既存 UI 挙動を変えず、段階ごとにテストを追加する。
- `403` は想定内の権限制御分岐として扱い、Fail-fast が必要な非OKレスポンスとは分けて扱う。
- active organization 未選択時は、取得系では即エラーにせず空データを返す既存方針を維持する。
- Web/Mobile は同じ access-tree DTO と unified invitation DTO を消費する前提なので、片方だけ独自 shape に分岐させない。
- Mobile は Expo + Better Auth + HeroUI Native の現行構成を前提にし、認証・招待・organization 切替フローを Web と別概念にしない。
- Svelte の route/load/page ロジック、feature state、remote 層は責務が分かれているため、画面実装時に責務を混線させない。

### テストルール

- このリポジトリのテストは網羅率優先ではなく、認可・招待・予約・主要導線の高リスク境界を優先する。
- 認可、招待、予約、D1 migration 前提の挙動を変える場合は、まず backend 統合テストで守る。
- backend は `apps/backend/src/app.test.ts` を中心とした API レベルの統合テストを優先し、複数テーブルにまたがるロジックを unit test だけで済ませない。
- 純粋関数で分岐が多いロジックのみ、近接した小さな unit test を追加する。
- Web server test は `src/lib/features/*.spec.ts`、`src/lib/remote/*.spec.ts`、`.svelte` 以外の page/load/action ロジックを守る場所として使う。
- UI 見た目ではなく、判定・変換・画面データ整形・routing 判定は server test で守る。
- `.svelte` の表示分岐やユーザーに見える状態遷移は browser test で守る。
- `.svelte` を触っていない変更では、browser test を機械的に増やすより feature/remote の server test を優先する。
- `apps/web` の CI 必須対象は server project であり、browser test は現状ローカル確認前提であることを理解して追加・運用する。
- Mobile は自動テスト未設定のため、変更時は少なくともログイン、org/classroom 切替、招待一覧、招待受諾を手動確認する。
- 次の変更では原則としてテスト追加または更新を行う: 権限可否変更、API response shape 変更、招待 status 遷移変更、予約条件変更、UI の表示分岐変更、障害既出箇所の変更。
- 小変更でも、バグ修正なら再発ケースのテストを 1 つ追加する。
- CI で守られているのは backend test と web server test であり、mobile と web browser test は未自動化領域として扱う。

### コード品質・スタイルルール

- ファイル配置は既存の責務分離を優先し、backend は `routes` / `booking` / `db` / `payment` / `email`、web は `routes` / `lib/features` / `lib/remote` / `lib/components`、mobile は `src/lib` と UI 層の分離を維持する。
- Web の取得系ロジックは `src/lib/remote/*.remote.ts`、状態や画面向け整形は `src/lib/features/*.svelte.ts` に寄せ、責務を混在させない。
- Svelte route は `+page.svelte` / `+page.server.ts` 規約、spec は近接配置の `*.spec.ts` / `*.svelte.spec.ts` 規約を維持する。
- backend の route・domain・schema 名称、web の feature/remote 名称、mobile の API/認証 helper 名称は既存の命名規則を踏襲し、別流儀に寄せない。
- 役割、招待状態、回数券状態、権限ソースのようなドメイン語彙は docs と既存コードの用語を正本にし、似た別名を増やさない。
- 既存ファイルのインデント、import 並び、改行スタイルはその app / そのファイルの流儀に合わせる。
- Web は tabs、backend/mobile は spaces という現状差分を無理に統一しない。
- Lint/format 設定に反しないことは前提だが、整形のためだけの大規模ノイズ変更は避ける。
- コメントは必要最小限にし、自明な処理説明ではなく、判断理由や壊しやすい前提を書く。
- 実装判断で迷った場合の正本は `docs/architecture.md`、`docs/test-strategy.md`、`docs/authorization.md`、各 app の README とする。
- brownfield 変更では、既存の互換経路や段階移行中の構成を前提にし、理想形へ一気に寄せるリファクタを混ぜない。

### 開発ワークフロールール

- 日常的な確認コマンドはルートの `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm test` を基準にする。
- app 単位で確認する場合は `pnpm --filter @apps/backend ...`、`pnpm --filter @apps/web ...`、`pnpm --filter @apps/mobile ...` の既存運用に従う。
- build 対象は現状 `backend` と `web` が中心であり、mobile は同じ前提で扱わない。
- backend deploy は Cloudflare Workers + D1 migration を含むため、schema 変更時は migration と運用影響を必ずセットで考える。
- D1 schema を変える変更では migration ファイル、既存データ互換、統合テストを一緒に扱い、コードだけ先に合わせない。
- web deploy は backend の後段に置かれる前提があるため、API shape を変える変更では backend/web の整合を壊さない順序を意識する。
- CI で必須なのは backend test と web server test であり、それ以外はローカル確認や手動確認の責務が残る前提で進める。
- staged migration 中の領域では、旧 organization スコープ互換経路を一度に削除せず、docs の移行ステータスに沿って段階的に進める。
- 環境変数、Sentry、Resend、Stripe、Cloudflare の設定値は各 app README を正本とし、名前や前提を推測で変更しない。
- deploy やインフラ変更を伴う作業では、`docs/README.md` と各 app README に書かれた順序を優先する。
- 実装完了の判断は「コードが書けたか」ではなく、「影響レイヤーの test / typecheck / lint と必要な手動確認が揃ったか」で行う。

### 重要な見落とし禁止ルール

- `display` 系フィールドを権限制御の根拠にしない。権限判定は常に `effective` を正本にする。
- `organization` 文脈だけで新規 booking 系処理を作らない。booking ドメインは `classroom_id` 必須前提で扱う。
- access-tree DTO や invitation DTO を web/mobile の片方だけで独自拡張しない。
- staged migration 中の `authRpc` と Remote Functions の共存を無視して、全面置換や全面削除を一度に行わない。
- `.remote.ts` にクライアント専用依存を持ち込まない。
- `403` を単なる障害として扱って UI 分岐を壊さない。
- active organization 未選択時の取得系を即エラー化しない。既存方針どおり空データ分岐を維持する。
- docs に書かれた role/status/source 用語を別名へ言い換えて増殖させない。
- D1 schema 変更で migration や既存データ互換の検討を飛ばさない。
- browser test が CI 必須でないことを理由に、UI の重要分岐変更を未検証のまま終えない。
- mobile は自動テスト未整備だからこそ、認証・招待・organization/classroom 切替の手動 smoke を省略しない。
- 大規模な整形、命名変更、責務再編を機能変更と同時に混ぜない。
- 旧互換経路や段階移行中のルートを、docs の移行ステータス確認なしに削除しない。
- `docs/architecture.md`、`docs/test-strategy.md`、README 群と矛盾する実装を「コードが通るから」で進めない。
