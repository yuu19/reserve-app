# テスト戦略

最終更新: 2026-05-07

## 1. 目的

このリポジトリのテストは、次の3点を最短で検知するために置く。

- 認可や招待の破壊的変更
- 予約ドメインの業務回帰
- Web UI の主要導線の回帰

網羅率を先に追うのではなく、変更リスクが高い境界に厚く置く。特に `authorization`、`auth-routes`、`booking-routes`、`remote` 層、主要な `.svelte` ページは優先度が高い。

## 2. テストレイヤー

### Backend

主な対象:

- API 契約
- 認可
- 招待フロー
- booking / ticket の業務ルール
- migration が前提になる挙動

現状の主力は `apps/backend/src/app.test.ts` の統合テスト。Hono app を起動し、認証・D1・招待・予約をまとめて検証する。

方針:

- route 挙動が変わる変更は、まず backend 統合テストで守る
- 複数テーブルにまたがるロジックは unit test より API レベルの統合テストを優先する
- 純粋関数で分岐が多い場合だけ、小さい unit test を近接配置する

### Web server

主な対象:

- `src/lib/features/*.spec.ts`
- `src/lib/remote/*.spec.ts`
- `.svelte` 以外の page/load/action ロジック

`apps/web` の `server` project は Node 環境で走る。データ整形、routing 判定、RPC client への依存、session/context の導出はここで守る。

方針:

- UI 見た目ではなく、判定・変換・画面データの整形をここで検証する
- バグが `remote` や feature state に閉じるなら browser test を増やす前に server test を足す

### Web browser

主な対象:

- `src/**/*.svelte.spec.ts`
- ルート単位の表示分岐
- ボタン表示、導線、簡単なイベント反応

`apps/web/vite.config.ts` の `client` project は Playwright を使う browser test。Svelte コンポーネントと page の振る舞いを実ブラウザで確認する。

方針:

- `.svelte` の回帰は browser test で守る
- 1つの画面で重要な分岐が複数ある場合は、最低でも代表ケースを 1 つ入れる
- 細かい CSS の差分ではなく、ユーザーが見える状態遷移を確認する

### Mobile

現状:

- 自動テストは未設定
- `typecheck` と `lint`、実機または Expo での smoke test を正本とする

当面の方針:

- API 契約の破壊は backend / web server 側で先に捕まえる
- mobile 変更では少なくともログイン、org/classroom 切替、招待一覧、招待受諾の手動確認を行う
- 画面数が増えた時点で、React Native 向けの自動テスト導入を再検討する

## 3. 実行コマンド

### ルート

```bash
pnpm test
pnpm test:watch
```

`turbo` 経由で各 app の `test` / `test:watch` を実行する。

### Backend

```bash
pnpm --filter @apps/backend test
pnpm --filter @apps/backend test:watch
```

### Web server

```bash
pnpm --filter @apps/web test
pnpm --filter @apps/web test:watch
```

`apps/web` の `test` は `vitest run --project server`。CI でもこの project を実行する。

### Web browser

```bash
pnpm --filter @apps/web exec vitest run --project client
pnpm --filter @apps/web test:unit -- --project client
```

browser test は現状 CI の必須対象ではない。UI を大きく触った PR ではローカルで実行する。

### Stripe 課金 E2E

```bash
pnpm --filter @apps/web test:e2e:billing
```

Stripe 課金 E2E は、実際の Stripe test mode と Test Clock を使って契約状態の遷移を確認する。
通常の PR ごとの web E2E には含めない。

実行には Stripe test mode のキーと Premium 価格 ID が必要。  
支払い失敗対応では、成功更新、支払い失敗、支払い方法の復旧、同じ Stripe event の複数回再送をまとめて確認する。

実装メモ:

- 秘密情報は GitHub Secrets の `STRIPE_E2E_SECRET_KEY`、`STRIPE_E2E_PREMIUM_MONTHLY_PRICE_ID`、`STRIPE_E2E_PREMIUM_YEARLY_PRICE_ID` に置く。
- webhook 署名の検証値を明示したい場合は `STRIPE_E2E_WEBHOOK_SECRET` を置く。
- CI では既存の `STRIPE_SECRET_KEY`、`STRIPE_PREMIUM_MONTHLY_PRICE_ID`、`STRIPE_PREMIUM_YEARLY_PRICE_ID`、`E2E_STRIPE_WEBHOOK_SECRET` へ割り当てて実行する。
- 実行時は `BILLING_E2E_ENABLED=true` を明示する。秘密情報がない環境ではこの E2E を必須 CI にしない。

### Mobile

```bash
pnpm --filter @apps/mobile typecheck
pnpm --filter @apps/mobile lint
```

## 4. CI で守る範囲

GitHub Actions `.github/workflows/ci-tests.yml` では次を実行する。

- `pnpm --filter @apps/backend test`
- `pnpm --filter @apps/web test`
- `pnpm --filter @apps/docs build`

これは次を意味する。

- backend 統合テストは PR / `main` push ごとに必須
- web server test は PR / `main` push ごとに必須
- docs の production build は PR / `main` push ごとに必須
- web browser test は手動実行
- mobile は自動テスト未導入

Stripe 課金 E2E は `.github/workflows/stripe-billing-e2e.yml` で別に実行する。
手動実行と毎日 03:30 JST の定期実行を行う。
実 Stripe API に依存するため、通常の PR 必須 CI には含めない。
この workflow は Stripe 側のテスト環境、価格、Test Clock の状態に依存する。  
失敗した場合は、まず GitHub Actions の artifact、Stripe Dashboard の Test Clock、対象 Customer / Subscription / Invoice を確認する。
アプリの unit / integration test が通っていて Stripe 課金 E2E だけが失敗する場合は、外部依存の一時不調か、Stripe 設定の差分として切り分ける。

## 5. 変更種別ごとの期待値

### 認可・招待・セッション

最低限実施:

- backend 統合テスト
- web server test

追加推奨:

- 導線変更がある場合は該当 `.svelte.spec.ts`

対象例:

- `apps/backend/src/booking/authorization.ts`
- `apps/backend/src/routes/auth-routes.ts`
- `apps/web/src/lib/features/auth-session.svelte.ts`
- `apps/web/src/lib/features/organization-context.svelte.ts`

### 予約・回数券・participant 操作

最低限実施:

- backend 統合テスト
- 関連する `remote` spec

追加推奨:

- participant/admin 画面を触るなら browser test

### Web の状態管理・remote 層

最低限実施:

- `src/lib/features/*.spec.ts`
- `src/lib/remote/*.spec.ts`

`.svelte` を触っていなければ browser test は必須ではない。

### Svelte コンポーネント / ページ

最低限実施:

- 影響画面の `.svelte.spec.ts`

追加推奨:

- 判定ロジックが複雑なら feature test も追加する

### Migration / D1 スキーマ変更

最低限実施:

- migration 適用を伴う backend 統合テスト
- 既存データの読み替えがある場合は回帰ケースを追加する

## 6. テスト追加の判断基準

次の変更では、原則としてテストを追加または更新する。

- 権限の可否が変わる
- API の response shape が変わる
- 招待の status 遷移が変わる
- 予約可能条件や承認条件が変わる
- UI の表示分岐や遷移先が変わる
- 過去に障害を出した箇所を触る

逆に、単純な文言変更や明らかなリファクタのみで挙動不変なら、既存テストの修正だけでよい。

## 7. PR ごとの完了条件

### 小変更

- 影響範囲の test / typecheck / lint が通る

### 中変更

- 影響 app のテスト一式が通る
- バグ修正なら再発ケースの test を 1 つ追加する

### 大変更

- backend 統合テスト
- web server test
- 必要な browser test
- 手動確認メモ

少なくとも「どのレイヤーで壊れるはずだったか」が説明できる状態で出す。

## 8. 現時点のギャップ

- mobile の自動テストがない
- 通常の web browser test が CI の必須ではない
- coverage の閾値は未設定

このため、認可・招待・予約のような高リスク変更は、backend 統合テストを最優先に厚くする。
