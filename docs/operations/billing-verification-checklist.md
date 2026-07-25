# 決済関連動作確認チェックリスト

このチェックリストは、リリース前 QA で Stripe test mode を使って課金まわりの動作を確認するためのものです。

仕様の正本は [課金仕様](../billing/billing.md) です。

自動テストの位置づけは [テスト戦略](./test-strategy.md) を参照します。

AI agent を使って課金確認を補助する場合は、[AI agent による課金確認運用ガイド](./ai-agent-billing-verification.md) を参照します。

Billing API の Test Clock scenario を internal operator で確認する場合は、[Billing API テストクロック scenario Phase 1 仕様](./billing-test-clock-scenarios.md) を参照します。

Stripe secret、カード番号、税務詳細、Stripe の raw payload はこのチェックリストに記録しません。

記録するのは、確認した環境、テスト対象、Stripe test mode の安全な識別子、期待結果、判定だけにします。

## 1. 目的と使い方

リリース前に、無料プラン、トライアル、有料契約、支払い方法登録、契約管理、支払い失敗、復旧、Webhook、照合、通知、社内調査の主要な挙動を確認します。

確認は production 直接操作ではなく、Stripe test mode と検証用環境で行います。

### 記録欄

| 項目                                 | 記録 |
| ------------------------------------ | ---- |
| 確認日                               |      |
| 担当者                               |      |
| 対象 commit                          |      |
| 対象環境                             |      |
| API URL                              |      |
| Web URL                              |      |
| Stripe test mode account / workspace |      |
| 使用した monthly Price ID            |      |
| 使用した yearly Price ID             |      |
| 使用した staff addon Price ID        |      |
| 使用した shop addon Price ID         |      |
| 使用した Webhook endpoint            |      |
| GitHub Actions run                   |      |
| 備考                                 |      |

- [ ] 対象 commit と検証環境を記録した。
  - 期待結果: 後から同じコード、同じ環境、同じ Stripe test mode 設定を特定できる。
  - 記録:
- [ ] Stripe test mode の Premium/addon Price ID と Webhook endpoint を記録した。
  - 期待結果: secret や raw payload を残さず、検証に使った Stripe 設定だけを追跡できる。
  - 記録:
- [ ] Stripe secret、カード番号、税務詳細、raw payload を記録していないことを確認した。
  - 期待結果: チェックリスト、スクリーンショット、添付ログに秘密情報や支払い詳細が含まれない。
  - 記録:

## 2. 事前条件

課金機能を確認する前に、検証環境の前提を揃えます。

- [ ] D1 migration が対象環境に適用済みである。
  - 期待結果: `billing_account`、`billing_subscription`、`billing_payment_issue`、`billing_invoice_event`、`billing_provider_event`、`billing_operation_attempt`、`billing_audit_event`、`billing_signal`、`billing_notification`、`billing_document_reference` を使う課金状態の読み書きができる。
  - 記録:
- [ ] Stripe test mode の月額 Price と年額 Price が backend の環境変数と一致している。
  - 期待結果: `STRIPE_PREMIUM_MONTHLY_PRICE_ID` と `STRIPE_PREMIUM_YEARLY_PRICE_ID` が検証用 Price を指している。
  - 記録:
- [ ] Stripe Customer Portal が契約管理と支払い方法更新に対応している。
  - 期待結果: Portal で Premium の月額・年額 Price を扱える。
  - 記録:
- [ ] Stripe Webhook endpoint が検証用 API URL を向いている。
  - 期待結果: `checkout.session.*`、`customer.subscription.*`、`invoice.*` の event を受け取れる。
  - 記録:
- [ ] Webhook signing secret が backend の検証用 secret と一致している。
  - 期待結果: 署名が一致する通知だけが処理される。
  - 記録:
- [ ] Resend の検証用送信元が有効である。
  - 期待結果: owner 向け課金通知を検証できる。
  - 記録:
- [ ] Cloudflare Workers の scheduled trigger が対象環境で有効である。
  - 期待結果: 対象限定照合と全体照合が期待頻度で実行される。
  - 記録:
- [ ] 必要な secrets と vars が検証環境に設定済みである。
  - 期待結果: `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_PREMIUM_MONTHLY_PRICE_ID`、`STRIPE_PREMIUM_YEARLY_PRICE_ID`、`STRIPE_STAFF_SEAT_MONTHLY_PRICE_ID`、`STRIPE_SHOP_SLOT_MONTHLY_PRICE_ID`、`STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED`、`WEB_BASE_URL`、`RESEND_API_KEY`、`RESEND_FROM_EMAIL` が検証用途で揃っている。
  - 記録:
- [ ] Stripe 課金 E2E の GitHub Secrets が設定済みである。
  - 期待結果: `STRIPE_E2E_SECRET_KEY`、`STRIPE_E2E_PREMIUM_MONTHLY_PRICE_ID`、`STRIPE_E2E_PREMIUM_YEARLY_PRICE_ID`、`STRIPE_E2E_STAFF_SEAT_MONTHLY_PRICE_ID`、`STRIPE_E2E_SHOP_SLOT_MONTHLY_PRICE_ID`、必要に応じて `STRIPE_E2E_WEBHOOK_SECRET` が使える。
  - 記録:

実装メモ:

- backend 環境変数: [`apps/backend/.env.example`](../../apps/backend/.env.example)
- backend worker 設定: [`apps/backend/wrangler.jsonc`](../../apps/backend/wrangler.jsonc)
- Stripe Billing E2E workflow: [`.github/workflows/stripe-billing-e2e.yml`](../../.github/workflows/stripe-billing-e2e.yml)

## 3. 自動検証

通常の PR / `main` push で守る範囲と、Stripe test mode に依存する専用 E2E を分けて確認します。

- [ ] backend の課金関連テストが成功している。
  - 実行例: `pnpm --filter @apps/backend test:coverage`
  - 期待結果: 契約状態、Webhook 同期、照合、通知、社内調査に関係する backend 回帰がない。
  - 記録:
- [ ] web server の課金関連テストが成功している。
  - 実行例: `pnpm --filter @apps/web test:coverage`
  - 期待結果: 契約画面や権限制御に関係する server-side contract が壊れていない。
  - 記録:
- [ ] shared billing core の typecheck と test が成功している。
  - 実行例: `pnpm --filter @repo/saas-billing-core typecheck`
  - 実行例: `pnpm --filter @repo/saas-billing-core test`
  - 期待結果: 課金の共通型、port、entitlement、operation の contract が壊れていない。
  - 記録:
- [ ] shared billing Drizzle store の typecheck と test が成功している。
  - 実行例: `pnpm --filter @repo/saas-billing-drizzle typecheck`
  - 実行例: `pnpm --filter @repo/saas-billing-drizzle test`
  - 期待結果: billing v2 table と store の contract が壊れていない。
  - 記録:
- [ ] 契約画面の component / page test が成功している。
  - 実行例: `pnpm --filter @apps/web exec vitest run --project client src/routes/contracts/page.svelte.spec.ts`
  - 期待結果: owner 操作、non-owner の閲覧、支払い問題、請求書・領収書リンク表示の分岐が壊れていない。
  - 記録:
- [ ] 通常の web Playwright E2E が成功している。
  - 実行例: `pnpm --filter @repo/e2e test:e2e`
  - 期待結果: Stripe test mode に依存しない主要導線が壊れていない。
  - 記録:
- [ ] Stripe 課金 E2E が検証環境または GitHub Actions で成功している。
  - 実行例: `BILLING_E2E_ENABLED=true pnpm --filter @repo/e2e test:e2e:billing`
  - 期待結果: Billing API Test Clock scenario で、有料更新成功、支払い失敗、支払い方法なしの trial 終了、addon の即時増加・期間末削除・利用上限・監査記録の主要遷移が通る。
  - 記録:
- [ ] Billing API Test Clock scenario E2E が検証環境で成功している。
  - 実行例: `BILLING_E2E_ENABLED=true pnpm --filter @repo/e2e test:e2e:billing-api-clock`
  - 期待結果: Billing API が test subject を作成し、支払い方法なしの trial 終了を Test Clock と webhook replay 経由で free/canceled に収束させる。
  - 記録:
- [ ] GitHub Actions の Stripe Billing E2E 結果を確認した。
  - 期待結果: [Stripe Billing E2E](../../.github/workflows/stripe-billing-e2e.yml) の手動実行または定期実行が成功している。
  - 記録:

実装メモ:

- CI Tests workflow: [`.github/workflows/ci-tests.yml`](../../.github/workflows/ci-tests.yml)
- Playwright E2E 設定: [`packages/e2e/playwright.config.ts`](../../packages/e2e/playwright.config.ts)
- Billing API Test Clock scenario spec: [`packages/e2e/tests/e2e/billing/billing-api-test-clock-scenario.spec.ts`](../../packages/e2e/tests/e2e/billing/billing-api-test-clock-scenario.spec.ts)
- Legacy direct Stripe action Test Clock spec: [`packages/e2e/tests/e2e/billing/stripe-test-clock.spec.ts`](../../packages/e2e/tests/e2e/billing/stripe-test-clock.spec.ts)
- E2E scripts: [`packages/e2e/package.json`](../../packages/e2e/package.json)
- backend scripts: [`apps/backend/package.json`](../../apps/backend/package.json)

## 4. 手動確認

画面と Stripe Dashboard を併用し、ユーザーから見える状態と backend の契約状態が一致することを確認します。

### 無料プラン

- [ ] 新規または無料プランの組織で契約画面を開く。
  - 期待結果: 無料プランであることが表示される。
  - 記録:
- [ ] 無料プランの owner にトライアル開始と有料契約開始の導線が表示される。
  - 期待結果: owner は契約操作へ進める。
  - 記録:
- [ ] 無料プランの non-owner で契約画面を開く。
  - 期待結果: 契約状態は確認できるが、契約操作ボタンは表示されない。
  - 記録:
- [ ] 無料プランで Premium 機能を開く。
  - 期待結果: 機能は利用できず、Premium が必要であることが説明される。
  - 記録:

### トライアル

- [ ] owner で 7 日間の Premium トライアルを開始する。
  - 期待結果: 契約状態が Premium トライアルになり、終了予定日が表示される。
  - 記録:
- [ ] 同じ組織でトライアルを重ねて開始できないことを確認する。
  - 期待結果: 2 回目のトライアル開始はできない。
  - 記録:
- [ ] トライアル中に Premium 機能を利用できる。
  - 期待結果: 対象機能の server-side 権限制御でもブロックされない。
  - 記録:
- [ ] トライアル中に支払い方法登録へ進む。
  - 期待結果: Stripe Checkout の支払い方法登録画面へ遷移する。
  - 記録:

### 有料契約

- [ ] owner で月額 Premium の有料契約を開始する。
  - 期待結果: Stripe Checkout へ遷移し、完了後に Premium 契約として表示される。
  - 記録:
- [ ] owner で年額 Premium の有料契約を開始する。
  - 期待結果: Stripe Checkout へ遷移し、完了後に年額契約として表示される。
  - 記録:
- [ ] 短時間に同じ契約開始操作を繰り返す。
  - 期待結果: 有効な handoff が再利用され、Stripe の手続きが乱立しない。
  - 記録:
- [ ] 未知の Stripe Price を受け取った状態を確認する。
  - 期待結果: Premium 機能は有効にならず、owner にはサポート確認が必要であることが表示される。
  - 記録:

### 支払い方法

- [ ] トライアル中に支払い方法を登録する。
  - 期待結果: 登録完了後、支払い方法の状態が登録済みとして表示される。
  - 記録:
- [ ] 支払い方法登録の戻り直後に契約画面を確認する。
  - 期待結果: backend の契約状態が確認できるまで、成功扱いではなく確認中として表示される。
  - 記録:
- [ ] 支払い方法未登録のままトライアル終了を進める。
  - 期待結果: Premium は継続されず、無料プランへ戻る。
  - 記録:

### Customer Portal

- [ ] 有料契約中の owner で Customer Portal を開く。
  - 期待結果: Stripe Customer Portal へ遷移し、契約管理と支払い方法更新ができる。
  - 記録:
- [ ] `trialing`、`active`、`past_due`、`unpaid`、`incomplete` の対象契約で Portal 導線を確認する。
  - 期待結果: Stripe と連携済みで許可された状態だけ Portal を開ける。
  - 記録:
- [ ] 無料プラン、解約済み、Stripe subscription なしの組織で Portal 導線を確認する。
  - 期待結果: Portal 導線は表示されない。
  - 記録:

### 解約

- [ ] Customer Portal で期間末解約を設定する。
  - 期待結果: 契約画面に期間末解約予定が表示され、期間終了までは Premium 機能を使える。
  - 記録:
- [ ] 解約済みになった契約を確認する。
  - 期待結果: Premium 機能は停止し、業務データは削除されない。
  - 記録:

### トライアル終了

- [ ] 支払い方法登録済みのトライアルを Test Clock で終了させる。
  - 期待結果: 契約状態が Premium 有料契約へ収束する。
  - 記録:
- [ ] 支払い方法未登録のトライアルを Test Clock で終了させる。
  - 期待結果: 契約状態が無料プランへ戻る。
  - 記録:
- [ ] トライアル終了 3 日前通知の対象を確認する。
  - 期待結果: 検証済み owner にだけ通知される。
  - 記録:

### 支払い失敗

- [ ] Test Clock で更新時の支払い失敗を発生させる。
  - 期待結果: 契約画面に支払い問題が表示され、owner に支払い方法または請求状況の確認が案内される。
  - 記録:
- [ ] 支払い失敗の開始時刻を確認する。
  - 期待結果: Stripe event の発生時刻を優先し、取得できない場合だけアプリの受信時刻を使う。
  - 記録:
- [ ] 支払い遅延の猶予期限を確認する。
  - 期待結果: 遅延開始から 7 日間は猶予として扱い、期限を過ぎると Premium 機能を停止する。
  - 記録:
- [ ] `invoice.payment_action_required` を処理する。
  - 期待結果: 支払い認証待ちとして表示され、owner に Stripe での認証完了が案内される。
  - 記録:

### 復旧

- [ ] 支払い方法を復旧し、Stripe event を再処理する。
  - 期待結果: 契約状態が Premium 有料契約へ戻り、Premium 機能の利用可否が復旧する。
  - 記録:
- [ ] 復旧後に契約画面を確認する。
  - 期待結果: 現在の支払い問題は解消済みとして扱われる。
  - 記録:
- [ ] 復旧後に定期照合を確認する。
  - 期待結果: Stripe 側とアプリ側の状態差分が解消済みまたは調査可能な状態に収束する。
  - 記録:

### 古い支払い失敗履歴

- [ ] 支払い成功後に古い支払い失敗通知を再送する。
  - 期待結果: 支払い問題は再オープンされず、履歴としてだけ保持される。
  - 記録:
- [ ] 契約画面で古い支払い失敗履歴を確認する。
  - 期待結果: owner には履歴として表示され、現在の契約状態は復旧済みのままになる。
  - 記録:

## 5. 権限と安全性

owner と non-owner の表示差分、保存しない情報、リンク表示の範囲を確認します。

- [ ] owner だけがトライアル開始、有料契約開始、支払い方法登録、Customer Portal を実行できる。
  - 期待結果: admin、manager、staff、participant は契約状態を確認できても、契約操作は実行できない。
  - 記録:
- [ ] non-owner の契約画面を確認する。
  - 期待結果: 閲覧のみ可能で、支払い手続き、支払い方法登録、Customer Portal のボタンは表示されない。
  - 記録:
- [ ] non-owner で請求書・領収書リンクを確認する。
  - 期待結果: 請求書・領収書リンクと請求イベントの詳細は表示されない。
  - 記録:
- [ ] owner で請求書・領収書リンクを確認する。
  - 期待結果: Stripe が提供する安全なリンクだけを表示する。
  - 記録:
- [ ] 支払い方法登録後の確認中表示を確認する。
  - 期待結果: backend で登録済みを確認するまで、成功扱いにしない。
  - 記録:
- [ ] カード情報、支払い方法の詳細、税務詳細、Stripe raw payload が保存されていないことを確認する。
  - 期待結果: D1、ログ、社内調査画面、通知履歴に保存禁止情報が残っていない。
  - 記録:
- [ ] Webhook 署名失敗時の記録を確認する。
  - 期待結果: 契約状態は変更されず、安全な失敗理由だけが残る。
  - 記録:

## 6. Webhook / 照合 / 通知

Stripe 通知の正当性、重複、照合、owner 通知を確認します。

- [ ] 正しい署名の Stripe Webhook を処理する。
  - 期待結果: `checkout.session.*`、`customer.subscription.*`、`invoice.*` が契約状態または履歴へ反映される。
  - 記録:
- [ ] 署名なし、署名不一致、期限切れの Webhook を送る。
  - 期待結果: 契約状態は変更されない。
  - 記録:
- [ ] 同じ Stripe event id を複数回送る。
  - 期待結果: 2 回目以降は no-op になり、契約状態、通知、請求イベントが重複作成されない。
  - 記録:
- [ ] `invoice.finalized`、`invoice.paid`、`invoice.payment_succeeded` を処理する。
  - 期待結果: 請求書または支払い成功の履歴として確認できる。
  - 記録:
- [ ] `invoice.payment_failed` を処理する。
  - 期待結果: 支払い失敗履歴が残り、検証済み owner へ通知される。
  - 記録:
- [ ] `invoice.payment_action_required` を処理する。
  - 期待結果: 支払い対応要求履歴が残り、検証済み owner へ通知される。
  - 記録:
- [ ] 同じ Stripe event で owner 通知を再送する。
  - 期待結果: 同じ owner へ重複通知しない。
  - 記録:
- [ ] owner 通知の送信失敗を発生させる。
  - 期待結果: 利用者向け操作は必要以上に失敗扱いにせず、通知結果と再試行対象を確認できる。
  - 記録:
- [ ] 検証済み owner がいない組織で支払い失敗通知を処理する。
  - 期待結果: admin、manager、staff、participant には課金通知を送らず、社内調査用の印だけを残す。
  - 記録:
- [ ] 対象限定照合を確認する。
  - 期待結果: 支払い問題や処理中など復旧優先度が高い契約が Stripe と再照合される。
  - 記録:
- [ ] 全体照合を確認する。
  - 期待結果: Stripe と連携済みの契約全体が日次で照合される。
  - 記録:
- [ ] 照合で差分が見つかる状態を確認する。
  - 期待結果: 契約状態が補正され、監査履歴と状態差分の印が残る。
  - 記録:

実装メモ:

- Stripe 通知同期: [`apps/backend/src/domain/billing/stripe-webhook-sync.ts`](../../apps/backend/src/domain/billing/stripe-webhook-sync.ts)
- 定期照合: [`apps/backend/src/domain/billing/organization-billing-maintenance.ts`](../../apps/backend/src/domain/billing/organization-billing-maintenance.ts)
- 通知処理: [`apps/backend/src/domain/billing/reserve-app-billing-notifications.ts`](../../apps/backend/src/domain/billing/reserve-app-billing-notifications.ts)
- 請求書・支払いイベント: [`apps/backend/src/domain/billing/reserve-app-billing-invoice-events.ts`](../../apps/backend/src/domain/billing/reserve-app-billing-invoice-events.ts)

## 7. 社内調査

許可された社内担当者だけが、課金状態の調査画面または調査 API で安全な情報を確認できることを確認します。

- [ ] 社内調査のアクセス権を確認する。
  - 期待結果: `INTERNAL_OPERATOR_EMAILS` で許可された担当者だけが利用できる。
  - 記録:
- [ ] 現在の契約状態を確認する。
  - 期待結果: plan、subscription、支払い方法、支払い問題、猶予期限を分類できる。
  - 記録:
- [ ] owner の課金操作履歴を確認する。
  - 期待結果: トライアル開始、checkout、支払い方法登録、Portal handoff の状態と失敗理由を確認できる。
  - 記録:
- [ ] Webhook の受信履歴を確認する。
  - 期待結果: 署名検証、重複、処理状態、失敗理由を確認できる。
  - 記録:
- [ ] 請求書・領収書の参照を確認する。
  - 期待結果: 安全に表示できる Stripe 上の参照だけを確認できる。
  - 記録:
- [ ] 請求イベントを確認する。
  - 期待結果: 請求書利用可能、支払い成功、支払い失敗、支払い対応要求の履歴を確認できる。
  - 記録:
- [ ] owner 通知履歴を確認する。
  - 期待結果: recipient 単位の送信、失敗、再試行、重複抑止を確認できる。
  - 記録:
- [ ] 監査履歴を確認する。
  - 期待結果: 契約状態の変更前後と変更元を確認できる。
  - 記録:
- [ ] 状態差分の印を確認する。
  - 期待結果: 照合による mismatch、pending、resolved、unavailable を確認できる。
  - 記録:
- [ ] 社内調査にカード情報、税務詳細、Stripe raw payload が表示されないことを確認する。
  - 期待結果: 問い合わせ分類に必要な安全な識別子と状態だけが表示される。
  - 記録:

実装メモ:

- 社内調査: [`apps/backend/src/domain/billing/internal-billing-inspection.ts`](../../apps/backend/src/domain/billing/internal-billing-inspection.ts)
- 契約画面: [`apps/web/src/routes/contracts/+page.svelte`](../../apps/web/src/routes/contracts/+page.svelte)
- 課金 store 境界: [`apps/backend/src/features/billing/billing.store.ts`](../../apps/backend/src/features/billing/billing.store.ts)

## 8. リリース判定

未確認項目、外部依存、保留判断を明確に残します。

| 判定項目                 | 記録                   |
| ------------------------ | ---------------------- |
| 総合判定                 | 合格 / 保留 / 差し戻し |
| 未確認項目               |                        |
| 既知の制限               |                        |
| 外部依存ブロッカー       |                        |
| 追加対応 issue / PR      |                        |
| リリース可否の最終判断者 |                        |
| 最終判断日時             |                        |

- [ ] 合格条件を満たしている。
  - 期待結果: 自動検証、主要な手動確認、Webhook/照合/通知、社内調査が検証済みである。
  - 記録:
- [ ] 保留条件を記録した。
  - 期待結果: Stripe test mode、Resend、Cloudflare scheduled trigger、GitHub Actions など外部依存の一時不調を、アプリ不具合と分けて記録できる。
  - 記録:
- [ ] 差し戻し条件を記録した。
  - 期待結果: 利用者の課金状態、Premium 利用可否、支払い問題、保存禁止情報、owner-only 制御に影響する不具合はリリース前に止める。
  - 記録:
- [ ] 未確認項目の扱いを決めた。
  - 期待結果: 未確認のまま進める項目がある場合、理由、影響、後続確認日を記録している。
  - 記録:
- [ ] 外部依存ブロッカーを記録した。
  - 期待結果: Stripe、Resend、Cloudflare、GitHub Actions の設定差分や一時不調を追跡できる。
  - 記録:
