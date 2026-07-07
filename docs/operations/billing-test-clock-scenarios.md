# Billing API テストクロック scenario Phase 1 仕様

この文書は、Billing API の Test Clock scenario を reserve-app の課金確認で使うための Phase 1 仕様です。

Test Clock scenario は、Stripe test mode の時間を進めて契約状態の変化を確認するために使います。
通常の契約画面や管理画面の利用可否を、テスト用の契約状態へ直接切り替える機能ではありません。

確認する対象は、Billing API が作る test subject の契約状態、利用権限、請求・支払い event、reserve-app 側の internal 表示です。
通常の組織データ、通常の owner 契約操作、通常の管理画面の権限制御は test subject へ差し替えません。

Stripe secret、Webhook signing secret、カード番号、税務詳細、Stripe の raw payload は記録しません。
記録してよいものは、対象環境、対象 organization、scenario ID、Stripe test mode の安全な object ID、状態、時刻、判定だけです。

## 1. 目的

リリース前の課金確認で、契約状態が時間経過によって期待どおり変わることを確認します。

Phase 1 では、次の状態変化を internal operator が再現できるようにします。

| scenario                               | 確認する状態変化                     | 期待する主な結果                                                    |
| -------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `trial_expired_without_payment_method` | 支払い方法なしのトライアルが終了する | test subject は無料または解約済み相当になり、プレミアム権限が外れる |
| `monthly_renewal_success`              | 有効な月額契約が次の請求周期を迎える | test subject は有効な Premium 契約を維持し、支払い成功 event が残る |
| `payment_failed`                       | 有効な月額契約の更新支払いが失敗する | test subject は支払い問題を持つ状態になり、支払い失敗 event が残る  |

この仕様は、Billing API の Test Clock scenario API、reserve-app backend の internal proxy、reserve-app web の internal operator UI の実装基準にします。

## 2. 対象外

Phase 1 では、次の確認は扱いません。

| scenario                       | Phase 1 で扱わない理由                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `cancel_at_period_end`         | 期間末解約の予約、期間終了後の解約反映、owner 向け表示をまとめて確認する必要があるため                 |
| `addon_decrease_at_period_end` | Stripe Schedule による期間末減少は backend 実装対象だが、Test Clock E2E での期間終了後検証は別フェーズで扱うため |

通常の管理画面を test subject の契約状態で動かすことも Phase 1 の対象外です。
この確認が必要になった場合は、別の Phase で test organization または test billing context の設計を行います。

## 3. 利用者と権限

Test Clock scenario を作成、閲覧、時間移動できるのは internal operator だけです。

reserve-app backend は、既存の internal billing inspection と同じ考え方で操作者を確認します。
許可された確認者だけが internal route を呼び出せます。

通常の organization owner には、この操作 UI を表示しません。
`/admin/contracts` に Test Clock 操作を混ぜません。

実装メモ:

- internal operator の許可は `INTERNAL_OPERATOR_EMAILS` を使う。
- 既存の internal inspection route は `GET /api/v1/auth/internal/organizations/{organizationId}/billing-inspection`。
- Test Clock 操作も reserve-app backend の `/api/v1/auth/internal/...` 配下に追加する。

## 4. 安全条件

Test Clock scenario は検証環境でだけ有効にします。

Billing API は、次の条件をすべて満たす場合だけ Test Clock 操作を受け付けます。

- Test Clock API が明示的に有効である。
- Billing API の環境が sandbox として扱われている。
- Stripe secret key が test mode の key である。
- API key に Test Clock 用 scope がある。

実装メモ:

- Billing API 側の有効化条件は `BILLING_TEST_CLOCKS_ENABLED=true`、`BILLING_API_ENV=sandbox`、`STRIPE_SECRET_KEY=sk_test_...`。
- API key scope は `billing:test_clock` を必要とする。
- reserve-app backend から Billing API へ渡す key はブラウザへ出さない。

## 5. 操作の流れ

internal operator は、次の順で確認します。

1. テスト対象の organization を選ぶ。
2. scenario を選び、Test Clock scenario を作成する。
3. Billing API が test subject、Stripe Test Clock、Customer、Subscription を作る。
4. internal UI が test subject の billing summary、entitlement、scenario 状態を表示する。
5. 「7日進める」「1か月進める」などの相対操作で Test Clock を進める。
6. Stripe webhook が Billing API に届くまで待つ。
7. internal UI が summary、entitlement、支払い event の変化を poll して表示する。
8. 期待結果と実際の結果をチェックリストまたは検証レポートに記録する。

Test Clock を進めた直後に契約状態が変わるとは限りません。
Stripe webhook の配信と Billing API の処理が終わるまで、UI は「webhook待ち」または「反映待ち」として表示します。

Phase 1 では、UI から Stripe event を取得して replay する操作は提供しません。
Webhook 経路そのものを確認するため、実際の Stripe webhook 配信を待ちます。

## 6. test subject の扱い

Billing API は、選択した organization を source subject として扱います。
scenario ごとに別の test subject を作ります。

test subject は、source subject の表示名、請求先メール、請求先名、連絡先をもとに作ります。
metadata には、source subject と scenario を追跡できる安全な識別子を保存します。

source subject の通常契約状態は変更しません。
test subject の契約状態を、通常の管理画面や Premium gate の判定には使いません。

実装メモ:

- source subject: 実 organization に対応する Billing API subject。
- test subject: `sourceSubjectId` と scenario をもとに生成する Billing API subject。
- response には `sourceSubject` と `testSubject` を両方含める。

## 7. scenario の初期状態

### 支払い方法なしのトライアル終了

`trial_expired_without_payment_method` は、支払い方法がない Premium trial を作ります。

開始直後の期待状態:

- test subject は Premium trial 中である。
- trial end は Test Clock 上の未来時刻である。
- 支払い方法は登録されていない。

時間移動後の期待状態:

- trial end を超えたあと、subscription は解約済みまたは無料相当へ収束する。
- entitlement の `organization.premium` は無効になる。
- summary の評価時刻は Test Clock の時刻になる。

### 月次更新成功

`monthly_renewal_success` は、有効な月額 Premium 契約を作ります。

Billing API は、検証用の有効な PaymentMethod を Customer の default payment method に設定します。
Stripe test mode の固定 PaymentMethod ID を使います。

開始直後の期待状態:

- test subject は月額 Premium の active 契約である。
- 支払い方法は登録済みである。
- 次回請求日は Test Clock 上の未来時刻である。

時間移動後の期待状態:

- 次回請求日を超えたあとも active 契約を維持する。
- 支払い成功 event が記録される。
- current period end が次の期間へ進む。
- entitlement の `organization.premium` は有効なままである。

### 月次更新失敗

`payment_failed` は、有効な月額 Premium 契約の更新支払い失敗を作ります。

この scenario は、trial 終了時の初回決済失敗ではありません。
既に active になっている月額契約が、次の請求周期で失敗する状態を確認します。

Billing API は、開始時点で有効な PaymentMethod を使って active 月額契約を作ります。
`advance` 実行直前に、更新時に失敗する PaymentMethod を Customer の default payment method に設定します。
Stripe test mode の固定 PaymentMethod ID を使います。

開始直後の期待状態:

- test subject は月額 Premium の active 契約である。
- まだ次回請求は実行されていない。
- 次回請求日は Test Clock 上の未来時刻である。

時間移動後の期待状態:

- invoice payment failed event が記録される。
- subscription は `past_due` など支払い問題を表す状態へ変わる。
- summary は支払い問題を表示できる。
- entitlement は支払い猶予の policy に従って評価される。

## 8. PaymentMethod の扱い

Phase 1 では、internal UI や reserve-app backend の request に Stripe test PaymentMethod ID を含めません。

Billing API が scenario ごとに固定の test PaymentMethod ID を使います。
これにより、operator は scenario を選ぶだけで必要な初期状態を作れます。

実装メモ:

- 成功支払い用の PaymentMethod ID は Billing API 内で固定する。
- 失敗支払い用の PaymentMethod ID も Billing API 内で固定する。
- PaymentMethod は Customer に attach し、Customer の default payment method に設定する。
- `payment_failed` は `advance` 実行直前に subscription 側の default payment method を解除し、更新 invoice では Customer default payment method を使わせる。
- この処理は Test Clock が有効な sandbox 環境でだけ実行する。

## 9. 時間移動 API

Test Clock の時間移動は、相対指定を正式な contract として扱います。

operator は「7日進める」「1か月進める」などを選びます。
Billing API は、現在の scenario の frozen time から target frozen time を計算します。

request の例:

```json
{
  "advanceBy": {
    "amount": 7,
    "unit": "day"
  }
}
```

対応する単位:

| unit    | 意味                   |
| ------- | ---------------------- |
| `day`   | 指定した日数だけ進める |
| `month` | 指定した月数だけ進める |

Billing API は、計算後の target frozen time を scenario に保存します。
advance 後の response には、scenario status、現在の frozen time、target frozen time、summary を含めます。

絶対時刻の `frozenTime` 指定は、既存互換または低レベル操作として残してよいです。
ただし internal UI の通常操作は `advanceBy` を使います。

## 10. reserve-app backend の役割

reserve-app backend は、internal operator の認可と Billing API への代理実行を担当します。

backend は次を行います。

- session を確認する。
- internal operator であることを確認する。
- 対象 organization を確認する。
- Billing API に source subject を同期する。
- Billing API の Test Clock scenario API を呼び出す。
- Billing API の response を internal UI 向けに返す。

backend は Stripe API を直接呼びません。
backend は Billing API key をブラウザへ返しません。

想定する internal route:

| 操作              | route                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| scenario 作成     | `POST /api/v1/auth/internal/organizations/{organizationId}/billing-test-clock-scenarios`                      |
| scenario 読み取り | `GET /api/v1/auth/internal/organizations/{organizationId}/billing-test-clock-scenarios/{scenarioId}`          |
| scenario 時間移動 | `POST /api/v1/auth/internal/organizations/{organizationId}/billing-test-clock-scenarios/{scenarioId}/advance` |

## 11. Billing API の役割

Billing API は、Test Clock scenario の正本です。

Billing API は次を行います。

- Test Clock を作る。
- test subject を作る。
- Test Clock に紐づく Stripe Customer を作る。
- scenario に応じた Subscription と PaymentMethod を作る。
- Test Clock を進める。
- Stripe webhook を受け取り、summary と entitlement に反映する。
- scenario の status、frozen time、target frozen time を保存する。

Billing API は、summary と entitlement の評価時刻を Test Clock の frozen time に合わせます。
通常環境では、評価時刻は server time を使います。

response には、次の情報を含めます。

- `scenarioId`
- `scenarioType`
- `status`
- `providerTestClockId`
- `providerCustomerId`
- `providerSubscriptionId`
- `sourceSubject`
- `testSubject`
- `frozenTime`
- `targetFrozenTime`
- `summary`

## 12. internal UI の表示

internal UI は、通常の契約画面とは分けて表示します。

UI は次を表示します。

- 対象 organization。
- scenario 種別。
- source subject と test subject。
- Test Clock の状態。
- 現在の frozen time。
- target frozen time。
- subscription の plan、status、trial end、current period end。
- entitlement の plan、status、features、evaluated at、time source。
- invoice/payment event の概要。
- webhook 反映待ちの状態。

UI は次の操作を提供します。

- scenario 作成。
- scenario 読み取り。
- 7日進める。
- 1か月進める。
- 最新状態を再取得する。

UI は、Stripe secret、Webhook signing secret、カード番号、税務詳細、Stripe raw payload を表示しません。

## 13. poll と webhook 待ち

Test Clock advance 後、UI は scenario を poll します。

poll の目的は次の 2 つです。

- Test Clock が `ready` に戻ったか確認する。
- Billing API の summary と entitlement が webhook 処理後の状態へ変わったか確認する。

Test Clock が `ready` でも、subscription や invoice event がまだ反映されていない場合があります。
この場合は、UI で「Stripe webhook の反映待ち」と表示します。

Phase 1 では、UI から Stripe events を replay しません。
Webhook が届かない場合は、Stripe Dashboard と Billing API の webhook endpoint 設定を確認します。

## 14. 確認結果の記録

確認結果は、[決済関連動作確認チェックリスト](./billing-verification-checklist.md) または検証レポートに記録します。

記録する項目:

- 対象 commit。
- 対象環境。
- 対象 organization。
- scenario ID。
- test subject ID。
- Stripe test mode の Customer ID、Subscription ID、Test Clock ID。
- advance 操作。
- 期待結果。
- 実際の summary、entitlement、invoice/payment event の安全な要約。
- 判定。

記録しない項目:

- Stripe secret。
- Webhook signing secret。
- カード番号。
- 税務詳細。
- Stripe raw payload。

## 15. 実装順序

Phase 1 は、次の順で実装します。

1. Billing API の scenario type に `monthly_renewal_success` と `payment_failed` を追加する。
2. Billing API に testmode 専用 PaymentMethod attach と default 設定を追加する。
3. Billing API の advance request に `advanceBy` を追加する。
4. reserve-app backend に internal proxy route を追加する。
5. internal UI を追加する。
6. Billing API Test Clock scenario E2E を 3 scenario に広げる。
7. 既存の課金確認チェックリストと AI agent 運用ガイドから、この仕様を参照する。

実装後は、次の確認を行います。

```bash
BILLING_E2E_ENABLED=true pnpm --filter @repo/e2e test:e2e:billing-api-clock
```

必要に応じて、関連する backend/web の targeted test も実行します。
