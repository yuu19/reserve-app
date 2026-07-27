# Premium addon 仕様

最終更新: 2026-07-25

## 1. この文書の扱い

この文書は、reserve-app の Premium addon に関する業務仕様、API 契約、Stripe 反映、監査、検証の正本です。

現行コードで動作する内容は「現行仕様」として記載します。
今後実装することが決まっている内容は「目標仕様」として分けます。
金額や税など、まだ決まっていない内容は「未決定事項」として明示します。

組織単位課金全体は [課金仕様](./billing.md) を参照してください。
Billing API の責務境界と将来の非同期同期方式は [共有 Billing API 設計メモ](./shared-billing-api-architecture.md) を参照してください。

## 2. 目的

Premium addon は、Premium 契約に含まれるスタッフ数と店舗数の上限を、組織単位で追加購入する機能です。

addon は業務データそのものを管理しません。
スタッフや店舗の追加可否を決める利用上限を、entitlement として提供します。

Billing API は、契約、addon 数量、課金状態、利用上限の正本です。
reserve-app backend は、Billing API が返した利用上限をスタッフ・店舗の業務操作へ適用します。

## 3. addon の種類

現在の Premium 基本枠と addon の効果は次のとおりです。

| addon          | addon code   | Premium 基本枠 | 数量 1 の効果             | entitlement  |
| -------------- | ------------ | -------------- | ------------------------- | ------------ |
| スタッフ追加枠 | `staff_seat` | 10 人          | スタッフ上限を 1 人増やす | `staffLimit` |
| 店舗追加枠     | `shop_slot`  | 3 店舗         | 店舗上限を 1 店舗増やす   | `shopLimit`  |

利用上限は次の式で求めます。

```txt
スタッフ上限 = 10 + staff_seat の有効数量
店舗上限     = 3 + shop_slot の有効数量
```

期間末の減数が予約されている間は、現在数量を利用上限に使います。
期間末に Stripe と Billing API の状態が更新された後、新しい数量を利用上限へ反映します。

## 4. 料金

### 4.1 現行 catalog の参考値

現行の product billing catalog には次の月額価格があります。

| addon          | 月額単価 | 通貨 | 状態                       |
| -------------- | -------- | ---- | -------------------------- |
| スタッフ追加枠 | 500 円   | JPY  | catalog に登録済み         |
| 店舗追加枠     | 1,000 円 | JPY  | catalog に登録済み         |
| 年額価格       | 未定     | JPY  | catalog と Stripe に未登録 |

この表の金額は、2026-07-25 時点の catalog の参考値です。
利用者へ保証する税込または税別の販売価格としては、まだ確定していません。

### 4.2 目標仕様

addon の請求周期は、Premium 本体の請求周期と一致させます。

- 月額 Premium では月額 addon Price を使います。
- 年額 Premium では年額 addon Price を使います。
- 対応する周期の有効な Price がない場合は、addon の増加を受け付けません。
- 年額契約で月額 Price へ自動的にフォールバックしません。

### 4.3 現行実装との差

現行実装は、年額 addon Price がない場合に月額 addon Price を探します。
これは目標仕様ではありません。
年額 addon Price を登録し、周期が一致しない Price へのフォールバックを削除する必要があります。

### 4.4 未決定事項

次はまだ決まっていません。

- 月額価格と年額価格を税込にするか税別にするか
- Stripe Tax または自動税計算を使うか
- スタッフ追加枠の年額単価
- 店舗追加枠の年額単価

## 5. 利用条件と権限

### 5.1 addon を変更できる条件

組織の owner だけが addon 数量を変更できます。

Billing API は、次をすべて満たす契約だけを変更対象にします。

- プランが Premium である
- Subscription status が `active` である
- Premium Price を catalog で解決できている
- Stripe Customer が存在する
- Stripe Subscription が存在する

無料、トライアル、支払い遅延、未払い、決済未完了、解約済みの組織では addon を変更できません。

対象外の主な status は次のとおりです。

- `trialing`
- `past_due`
- `unpaid`
- `incomplete`
- `canceled`

### 5.2 addon の表示条件

addon 読み取り API 自体は、同期済みの課金対象であれば呼び出せます。
ただし、addon 明細を返すのは `active` Subscription だけです。

非 active 契約に以前の addon 行が残っていても、現在有効な購入枠としては表示しません。
Stripe の内部 Price ID、Subscription Item ID、Schedule ID は利用者向け API に返しません。

## 6. 数量の意味

更新要求の `quantity` は、Premium 基本枠へ追加する目標数量です。
スタッフや店舗の合計上限ではありません。

例:

```txt
staff_seat.quantity = 2
staffLimit = Premium 基本枠 10 + 追加枠 2 = 12
```

現行 API では、数量に次の制約があります。

- 0 以上の整数
- 1 addon あたり 999 以下
- 同じ要求内で同じ addon code を重複させない
- 変更する addon だけを送る部分更新

`999` は異常な入力を防ぐための技術的な安全上限です。
999 個まで販売することを保証する商品上限ではありません。
商品上の最大購入数は未決定です。

`quantity: 0` は即時削除ではありません。
現在数量が 1 以上の場合は、契約期間末に 0 へ変更する削除予約です。

要求に含めなかった addon の目標数量は変更しません。

## 7. 数量変更の反映時期

### 7.1 状態遷移

| 操作                                       | Stripe への反映            | entitlement への反映           |
| ------------------------------------------ | -------------------------- | ------------------------------ |
| 未購入または数量 0 から 1 以上へ増やす     | 即時。日割り請求を作成する | 成功後すぐに増やす             |
| 現在数量より増やす                         | 即時。日割り請求を作成する | 成功後すぐに増やす             |
| 現在数量より減らす                         | 現在の契約期間末に変更する | 期間末までは現在数量を維持する |
| 現在数量から 0 にする                      | 現在の契約期間末に削除する | 期間末までは現在数量を維持する |
| 期間末変更を現在数量へ戻す                 | 期間末変更を取り消す       | 現在数量を維持する             |
| 変更予定がなく、現在数量と同じ値を指定する | Stripe を変更しない        | 現在値を返す                   |

増加では Stripe の日割り計算を有効にします。
支払いを完了できない場合は、addon 増加を適用しません。

減数と削除では日割り返金を行いません。
現在の契約期間が終わるまで、購入済み数量と利用上限を維持します。

### 7.2 期間末変更の表示

期間末変更がある addon は、現在値と予定値を分けて返します。

```json
{
  "addonCode": "shop_slot",
  "quantity": 2,
  "status": "active",
  "pendingQuantity": 0,
  "pendingEffectiveAt": "2026-08-25T00:00:00.000Z"
}
```

この例では現在 2 店舗分が有効です。
`pendingEffectiveAt` に 0 へ変更します。

## 8. 増加と期間末変更の分離

即時増加と、減数・削除・予約取消などの期間末 Schedule 変更を、同じ更新要求に含めることはできません。

例:

```json
{
  "items": [
    { "addonCode": "staff_seat", "quantity": 3 },
    { "addonCode": "shop_slot", "quantity": 0 }
  ]
}
```

スタッフ枠が現在 2、店舗枠が現在 2 の場合、この要求は即時増加と期間末削除を混在させています。
Billing API は Stripe を変更せず `409 bad_request` を返します。

利用者向け画面でも、増加と期間末変更を一度に確定させません。
それぞれの変更内容と反映時期を表示し、利用者が別々に確認して実行します。
backend が一つの操作を自動的に二つへ分割することはありません。

## 9. 実利用数が新しい上限を超える場合

### 9.1 目標仕様

addon 減数後にスタッフ数または店舗数が新しい利用上限を超えても、既存データを削除・停止しません。

上限を超えている間は、次の新規操作だけを禁止します。

- 新しいスタッフの追加または招待
- 新しい店舗の追加

既存のスタッフ、店舗、予約、参加者は維持します。
利用数を上限内へ戻すか、addon 数量を再び増やすと新規追加を再開できます。

### 9.2 責務

Billing API は `staffLimit` と `shopLimit` を返します。
reserve-app backend は実際のスタッフ数・店舗数と比較し、業務操作を許可または拒否します。

Billing API はスタッフ・店舗の実データを読みません。
課金変更を理由に業務データを自動削除しません。

### 9.3 現行実装との差

Billing API は addon 数量から数値 entitlement を生成しています。
一方、reserve-app backend には `staffLimit` と `shopLimit` を使った新規追加禁止が未実装です。

## 10. 即時増加の請求確認

### 10.1 目標仕様

利用者が addon を増やす前に、Stripe の請求プレビューを表示します。

確認画面には少なくとも次を表示します。

- 変更前と変更後の addon 数量
- addon の単価と請求周期
- 今回発生する日割り請求の見込み額
- 次回請求の見込み額
- 通貨
- 見積の取得時刻または有効期限

利用者が確認した後だけ、即時増加 command を送ります。
プレビュー取得後に契約状態や価格が変わった場合は、再プレビューを求めます。

### 10.2 現行実装との差

現行 Billing API には、addon の請求プレビュー API がありません。
更新 command は Stripe の日割り計算を有効にしますが、更新前の見込み額を返しません。

## 11. API 仕様

### 11.1 reserve-app backend

利用者向け Web client は Billing API を直接呼びません。
認証済みの reserve-app backend を経由します。

| 操作     | method  | path                                        |
| -------- | ------- | ------------------------------------------- |
| 一覧取得 | `GET`   | `/api/v1/auth/organizations/billing/addons` |
| 数量更新 | `PATCH` | `/api/v1/auth/organizations/billing/addons` |

backend は次を担当します。

- ログイン状態を確認する
- 対象組織を解決する
- owner 権限を確認する
- Billing API へ課金対象を同期する
- Billing API の addon command を呼び出す
- Billing API の結果を課金画面へ返す

`organizationId` を省略した場合は、現在選択中の組織を使います。

更新 request の例:

```http
PATCH /api/v1/auth/organizations/billing/addons
Idempotency-Key: 7a9dd86d-86b1-43fc-949c-a9e96dcfe665
Content-Type: application/json
```

```json
{
  "organizationId": "org_123",
  "items": [
    { "addonCode": "staff_seat", "quantity": 2 },
    { "addonCode": "shop_slot", "quantity": 1 }
  ]
}
```

backend が受け付ける addon code は `staff_seat` と `shop_slot` です。
一つの request には 1 件以上 2 件以下の item を指定できます。

現行の更新 response は、契約と entitlement の action summary を返します。
Billing API が返した addon 明細は、そのまま Web client へ返していません。
画面で確定後の addon 明細が必要な場合は一覧を再取得します。

### 11.2 Billing API

| 操作     | scope           | method  | path                                                                  |
| -------- | --------------- | ------- | --------------------------------------------------------------------- |
| 一覧取得 | `billing:read`  | `GET`   | `/api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/addon-items` |
| 数量更新 | `billing:write` | `PATCH` | `/api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/addon-items` |

更新 request:

```json
{
  "actor": {
    "type": "user",
    "id": "user_123"
  },
  "items": [
    { "addonCode": "staff_seat", "quantity": 2 },
    { "addonCode": "shop_slot", "quantity": 1 }
  ]
}
```

Billing API 自体は 1 request あたり最大 20 item を受け付けます。
同じ `addonCode` を重複させることはできません。

更新 response:

```json
{
  "summary": {
    "appId": "reserve",
    "subjectType": "organization",
    "subjectId": "org_123",
    "subscription": {},
    "entitlements": {
      "features": {
        "staffLimit": 12,
        "shopLimit": 4
      }
    }
  },
  "addonItems": {
    "appId": "reserve",
    "subjectType": "organization",
    "subjectId": "org_123",
    "items": [
      {
        "addonCode": "shop_slot",
        "quantity": 1,
        "status": "active",
        "pendingQuantity": null,
        "pendingEffectiveAt": null
      },
      {
        "addonCode": "staff_seat",
        "quantity": 2,
        "status": "active",
        "pendingQuantity": null,
        "pendingEffectiveAt": null
      }
    ],
    "syncedAt": "2026-07-25T00:00:00.000Z"
  }
}
```

`items` は addon code の昇順で返します。

### 11.3 互換 API

次の API は、一括 PATCH へ移行する前の client のために残している互換 adapter です。

```txt
PUT /api/v1/apps/{appId}/subjects/{subjectType}/{subjectId}/addon-items/{addonCode}
```

新規実装では使用しません。
この API は単一 addon と 1 以上の数量だけを受け付けるため、`quantity: 0` による削除予約には使えません。

## 12. 冪等性

### 12.1 利用者向け backend

addon 更新では `Idempotency-Key` header が必須です。
1 文字以上 128 文字以下の値を指定します。

同じ利用者操作を再送するときは同じ key を使います。
数量を元の値へ戻す場合でも、別の利用者操作であれば新しい key を使います。

例:

```txt
2 -> 3: key-a
3 -> 2: key-b
```

backend は受け取った key の hash を使い、組織と操作者を含む Billing API 用 key を生成します。
item の順序は addon code 順に正規化します。
同じ操作を item の並び順だけ変えて再送しても、Billing API へ同じ body を送ります。

課金対象の同期には addon command とは別の冪等性キーを使います。
組織名、slug、請求担当者を含む同期本文が変わった場合は、新しい同期キーを使います。
同期本文が変わっても、同じ addon 操作の command key と body は変えません。

### 12.2 Billing API

Billing API は、app と `Idempotency-Key` の組み合わせで response を保存します。
同じ key、method、path、body の再送では、保存済みの status と response を返します。

同じ key を異なる request に再利用した場合は、`409 idempotency_conflict` を返します。
既定の保存期間は 24 時間です。

成功 response と、入力不正や競合などの確定した業務エラーを保存します。
一時的な provider 障害や内部保存失敗を表す 5xx response は保存しません。
同じ key で再送すると、完了していない処理を再開します。

## 13. 競合制御

### 13.1 現行仕様

現行 API には、読み取り後の状態が変わっていないことを検証する version がありません。
異なる冪等性キーを持つ更新が同じ addon で競合した場合は、後から処理された要求が優先されます。

### 13.2 目標仕様

addon 一覧と更新 response に、subject 単位で単調増加する `version` を含めます。
更新 request は、利用者が確認した状態の `expectedVersion` を指定します。

保存済み version と一致しない場合は Stripe を変更せず、`409 version_conflict` を返します。
利用者向け画面は addon 一覧を再取得し、変更内容を再確認させます。

同じ冪等性キーの再送では、version を再判定する前に保存済み response を返します。
これにより、成功 response を受け取れなかった再送が、新しい version を理由に失敗することを防ぎます。

この version は、課金イベント配送で実装済みの subject revision と同じ連番を利用します。
将来 command response と backend projection を接続するときも、この連番を共有します。

## 14. Stripe Subscription Schedule

減数と削除は Stripe Subscription Schedule で現在の契約期間末へ予約します。

Billing API は addon 変更が作成した Schedule ID を保持します。
別の契約変更が管理している Schedule を addon 更新で上書きしません。
所有していない Schedule が Subscription に存在する場合は `409` を返します。

複数 addon に期間末変更がある場合は、一つの addon 用 Schedule へ将来数量をまとめます。
一部の予約を取り消した場合は、残る予約だけで Schedule を更新します。
すべての期間末変更を取り消した場合は、addon 用 Schedule を release します。

Schedule には、Billing API が管理する対象と操作を識別する metadata を付けます。
Billing API は、Stripe への反映前に操作記録を作成します。
Stripe 反映後に契約状態の保存が失敗しても、同じ冪等性キーの再送または
`subscription_schedule.*` webhook から期間末変更を復元します。

操作記録は `processing`、`provider_applied`、`committed`、`failed` の状態を持ちます。
顧客向けの期間末変更と課金イベントは同じ D1 batch で確定します。
操作記録は外部処理の回復用であり、顧客向け状態の代わりにはしません。

Schedule の将来 phase では `duration.interval` と `duration.interval_count` を使います。
削除済みの `iterations` parameter は使いません。

## 15. webhook と entitlement の確定

Stripe webhook を受信すると、Billing API は Subscription item を addon catalog と照合します。

- catalog で解決できた Subscription item を addon 現在数量へ反映します。
- Stripe から消えた addon item は数量 0、`inactive` にします。
- 期間末変更が適用済みなら pending 状態を消します。
- 有効な addon 数量と addon entitlement rule から利用上限を再計算します。
- Schedule の作成、更新、release、完了通知から未確定の期間末変更を復元します。

addon 明細と entitlement は、同じ Stripe Subscription snapshot から計算します。
期間末変更を予約しただけでは、現在の利用上限を減らしません。
期間末到達後の snapshot に新しい数量が現れた時点で利用上限を更新します。

期間末直前の API response と、期間末後の webhook 反映には時間差があり得ます。
正本は Billing API が webhook を処理した後の addon 明細と entitlement です。

将来は Billing API から reserve-app backend へ event を非同期配送します。
操作直後は command response、通常時は Worker event を同じ version-aware projector で反映します。

## 16. 監査

有効な request として受け付けた addon 更新は、成功と失敗の両方を追記型の監査記録へ保存します。

主な記録内容は次のとおりです。

- app
- billing account
- Subscription。契約がない拒否では `null`
- 冪等性キー
- 操作者の種別と ID
- 要求した addon と数量
- 変更前の安全な addon 要約
- 変更後の安全な addon 要約
- 期間末の反映予定時刻
- 成功または失敗
- 失敗 code と message
- 記録時刻

Stripe の raw payload、カード情報、支払い方法の詳細は保存しません。
同じ冪等性キーの再送で監査記録を重複作成しません。

形式不正で actor や item を解釈できない request は、addon 監査の対象外です。
同期済みの無料 subject など、契約がないため拒否した有効な request は billing account を親として記録します。

## 17. 主なエラー

| HTTP | code                       | 条件                                                            |
| ---- | -------------------------- | --------------------------------------------------------------- |
| 400  | `idempotency_key_required` | `Idempotency-Key` がない                                        |
| 400  | `bad_request`              | actor、item、数量、重複 addon code が不正                       |
| 400  | `bad_request`              | 正の数量に使える active addon Price がない                      |
| 404  | `subject_not_found`        | 課金対象が Billing API に同期されていない                       |
| 409  | `bad_request`              | active の有料 Premium 契約ではない                              |
| 409  | `bad_request`              | 即時増加と期間末変更が混在している                              |
| 409  | `bad_request`              | 別の契約変更が Stripe Schedule を管理している                   |
| 409  | `idempotency_conflict`     | 同じ冪等性キーを異なる request に再利用した                     |
| 409  | `version_conflict`         | 目標仕様。読み取り後に addon 状態が更新された                   |
| 502  | `internal_error`           | Stripe mutation が失敗した                                      |
| 503  | `provider_not_configured`  | Stripe secret または必要な provider Price ID が設定されていない |

reserve-app backend は Billing API のエラーを、owner 向けの課金 action response へ変換して返します。

## 18. 検証

### 18.1 現在の自動検証

Billing API の unit test は、少なくとも次を確認します。

- 日割り増加で `error_if_incomplete` と `create_prorations` を使う
- Schedule phase で `duration` を使う
- addon 所有 Schedule だけを再利用する
- Schedule metadata が同じ課金対象を示す場合に所有権を復元する
- 5xx response を冪等性キャッシュへ固定しない
- Stripe の現在数量から addon entitlement を合成する
- 予約がなくなった場合に Schedule を release する
- 即時増加と期間末変更の混在を拒否する
- 非 active Subscription の addon 明細を公開しない
- inactive addon の再購入に active catalog Price を使う
- 未購入 addon の数量 0 を no-op として扱う
- 監査は billing account 必須、Subscription 任意である

Stripe Test Clock E2E は、少なくとも次を確認します。

- 複数 addon の初回増加
- entitlement 上限の増加
- 混在 request の拒否と Stripe 状態不変
- addon の即時増加
- addon の期間末削除予約
- 期間末前は現在数量と entitlement を維持
- webhook 後に数量 0、`inactive`、pending なしへ収束
- addon の再購入
- 成功・失敗の監査記録

### 18.2 追加が必要な検証

目標仕様に合わせて、次の検証を追加する必要があります。

- 月額 Premium は月額 addon Price だけを使う
- 年額 Premium は年額 addon Price だけを使う
- 対応周期の Price がない場合に安全に拒否する
- 日割り請求プレビューと確定 command の一致
- stale `expectedVersion` の拒否
- 冪等再送が version 判定より先に保存済み response を返す
- addon 減数後に既存業務データを維持し、新規追加だけを拒否する
- 非同期 event の重複、順序逆転、欠落から projection を回復する

## 19. 実装状況

| 項目                                              | 状況     |
| ------------------------------------------------- | -------- |
| addon catalog と月額 Price                        | 実装済み |
| 複数 addon の部分更新                             | 実装済み |
| 即時増加と支払い失敗時の非適用                    | 実装済み |
| 期間末の減数・削除・予約取消                      | 実装済み |
| Schedule 所有権保護                               | 実装済み |
| addon entitlement 合成                            | 実装済み |
| active 契約だけの addon 明細公開                  | 実装済み |
| 冪等性と変更監査                                  | 実装済み |
| 月額・年額で同じ周期の addon Price を使う         | 未実装   |
| 税区分                                            | 未決定   |
| 商品上の最大購入数                                | 未決定   |
| 実利用数超過時に新規スタッフ・店舗追加を止める    | 未実装   |
| 日割り請求プレビュー                              | 未実装   |
| `version` / `expectedVersion` による競合制御      | 未実装   |
| addon 管理画面                                    | 未実装   |
| command response と Worker event の共通 projector | 未実装   |

## 20. 実装参照

- Product catalog: [`packages/product-billing-config/src/index.mjs`](../../packages/product-billing-config/src/index.mjs)
- Shared types: [`packages/billing-types/src/index.ts`](../../packages/billing-types/src/index.ts)
- Billing API client: [`packages/billing-client/src/index.ts`](../../packages/billing-client/src/index.ts)
- Billing API routes and Stripe behavior: [`apps/billing-api/src/app.ts`](../../apps/billing-api/src/app.ts)
- Billing API schema: [`apps/billing-api/src/db/schema.ts`](../../apps/billing-api/src/db/schema.ts)
- reserve-app backend route schemas: [`apps/backend/src/features/billing/billing.schemas.ts`](../../apps/backend/src/features/billing/billing.schemas.ts)
- reserve-app backend action: [`apps/backend/src/features/billing/billing-actions.usecase.ts`](../../apps/backend/src/features/billing/billing-actions.usecase.ts)
- Stripe Test Clock E2E: [`packages/e2e/tests/e2e/billing/billing-api-test-clock-scenario.spec.ts`](../../packages/e2e/tests/e2e/billing/billing-api-test-clock-scenario.spec.ts)
