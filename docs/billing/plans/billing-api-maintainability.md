# Billing API 保守性改善計画

最終更新: 2026-07-30

## この文書の扱い

この文書は、Billing API と直接接続する reserve-app backend の複雑性を下げるための実装計画です。
現行仕様の正本ではありません。

- 現行の組織単位課金仕様は [billing.md](../billing.md) を参照してください。
- Billing API の責務境界は [shared-billing-api-architecture.md](../shared-billing-api-architecture.md) を参照してください。
- 現行のイベント配送は [billing-api-event-outbox.md](../billing-api-event-outbox.md) を参照してください。
- 本計画の各項目は、実装と検証が完了するまで「目標」として扱います。
- 実装完了後は現行仕様文書へ結果を反映し、この文書を `docs/history/` へ移します。

## 目的

Billing API の正本性と障害回復能力を維持しながら、次の問題を解消します。

- `apps/billing-api/src/app.ts` に集中した route、use case、domain、D1、Stripe処理を分離する。
- Billing API とBackendに重複している契約・支払い状態を削減する。
- Webhook、Queue、通知の再試行責務を分ける。
- 冪等性、イベント順序、Schedule回復をコード構造とテストで保証する。
- 開発中の互換処理と移行flagを廃止し、目標構造を直接採用する。

商品、価格、trial、addonの業務仕様自体は変更しません。

## 対象範囲

### 対象

- `apps/billing-api`
- `packages/billing-types`
- `packages/billing-client`
- Billing APIへ接続するBackendのroute、client、Queue consumer
- BackendのEntitlement投影
- Billing通知の判断、Outbox、配信履歴
- Stripe billing webhookの受信境界
- Billing API／BackendのBilling関連D1 schemaとmigration
- Billing APIのunit、integration、contract、Test Clockテスト

### 対象外

- Premiumプラン、価格、addon数量規則の変更
- 契約画面のUI再設計
- 汎用Notification APIの新設
- 予約、店舗、スタッフ等の非Billing業務データの再設計
- 旧ticket checkoutの廃止

旧ticket checkoutは別の業務機能としてBackendに残します。

### 初期段階で導入しないもの

初期実装の複雑性を抑えるため、次はこの計画へ含めません。

- Billing APIとBackendによる全subjectの定期照合
- provider照合専用のsubject別cursor、lease、指数backoff、Queue job
- 全featureへの`ports.ts`と一テーブル一repository
- Billing APIから`@repo/saas-billing-core`へのdomain／port移動
- 通知3テーブルの期間別cleanup
- 専用DLQ管理画面と古いpayloadの汎用replay
- cutover用maintenance flag、Webhook保留応答、旧新payload互換consumer

これらは運用データまたは本番公開要件から必要性を確認し、別計画で判断します。

## 現状評価

### 確認した構造

2026-07-29時点で、`apps/billing-api/src/app.ts` は7,086行あり、17 routeに加えて次の処理を同じmoduleに持っています。

- Hono route登録とHTTP response生成
- API key認証とscope検証
- request解析
- Billing subject、subscription、entitlementの読み書き
- Checkout、Portal、Payment Method、Test ClockのStripe呼び出し
- addonの即時増加と期間末減少
- Subscription Scheduleの作成、解放、Webhook回復
- Stripe webhookのevent family判定と状態同期
- API冪等性
- revision更新とevent outbox作成

特に`updateAddonItems`、`handleStripeBillingWebhookEvent`、`createBillingApiApp`は、複数の責務と分岐を持つ変更衝突点です。

イベント配送も、Billing APIのoutbox処理が239行、Backendのconsumerが662行あり、状態投影、通知判断、メール送信再試行が連結しています。

### 良い点

次の仕組みは維持します。

- Billing APIを契約、支払い、addon、Entitlementの正本とする境界
- subject単位のrevision
- 状態変更、revision、outboxのD1 batch
- at-least-once配送を前提としたBackend inbox
- subject単位のconsumer cursorとlease
- operationから導出するStripe冪等性キー
- addon Schedule操作の回復記録
- Stripe Test Clockによる実サービス検証

### Phase 0で直す正しさの問題

構造分割より先に、次の正しさの問題を修正します。

1. `subscription_schedule.canceled`が対応event集合、共有型、転送対象に含まれていない。
2. 遅れて届いたSchedule webhookが新しいpending状態を上書きできる。
3. Backend consumerはBilling APIの最新summaryを取得しても、通知helperが古いBackend投影を再読込する。
4. `billing_api_idempotency.expires_at`を保存しているが、再利用判定と削除に使っていない。
5. 同じ冪等性キーの同時requestを原子的にclaimしていない。

### 後続フェーズで解消する境界・運用上の問題

次の問題は、先に共有契約または新しいQueue構成を確定する必要があります。

1. Billing APIのClientとQueue consumerが共有型を実行時検証せず、JSONを型assertionしている。
2. DLQに到達したBilling Eventをアプリ内で調査・復旧する経路がない。
3. Entitlement responseの`syncedAt`がStripeとの最終同期時刻ではなく、応答生成時刻になっている。

実行時契約検証はPhase 1、高リスク対象のprovider照合はPhase 3、DLQからの復旧はPhase 8の完了条件にします。

## 実装対応表（正本）

本計画の実装範囲、必須テスト、完了判定は次の表を正本とします。
設計説明、Phase説明、runbookと表の内容が矛盾する場合は、この表を優先します。

- リスクIDは実装、PR、検証記録で共通して使用します。
- 「必須テスト」は[必須テスト定義](#必須テスト定義)のIDを参照します。
- 各リスクは、対象実装に加えて必須テストが成功し、完了条件を示す証跡を残した時点で完了です。
- Phase全体は、そのPhaseを最終実装Phaseとするリスクがすべて完了した時点で完了です。
- 移行・切替操作は[Billing API 保守性改善 cutover runbook](./billing-api-maintainability-cutover-runbook.md)に従います。

| ID  | リスク                                                                                               | 実装Phase | 必須テスト         | 完了条件                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------- | --------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | Schedule eventの欠落、順序逆転、古いWebhookによってpending状態が退行する                             | Phase 0   | T01、T02、T05      | `subscription_schedule.canceled`を含む対象eventが共有契約と処理対象に入り、最新Stripe snapshotに基づく遷移が終端状態や別attemptを退行させない                   |
| R02 | Consumerが取得済みsummaryではなく古いBackend投影を再読込し、誤った通知を判断する                     | Phase 0   | T01、T08           | 通知判断が同一処理内で取得・検証したBilling API summaryだけを使用し、古い投影を参照しない                                                                       |
| R03 | API冪等性の期限切れ、同時実行、lease回収が未定義で、処理が重複または固定化する                       | Phase 0   | T03                | 同一keyの同時claimが1件に収束し、request hash競合、24時間後の再利用、lease切れ回収、5xx後の再試行が実D1上で確認できる                                           |
| R04 | 状態、revision、event outboxが部分的に確定する                                                       | Phase 0   | T03                | command成功時は3要素が同じD1 batchで確定し、注入した失敗時はいずれも部分確定しない                                                                              |
| R05 | HTTP／Queue境界が型assertionだけに依存し、不正payloadや未知versionを内部へ通す                       | Phase 1   | T04                | Billing API、Billing Client、Queue consumerが共有schemaでruntime validationし、不正responseと未知schema versionを境界で拒否する                                 |
| R06 | route、use case、domain、D1、Stripe処理が巨大moduleへ集中し、変更影響が広がる                        | Phase 2   | T01、T11           | Billing API内のvertical sliceへ分割し、外部I/Oの具体実装の結合を`create-app.ts`へ限定して、既存route contractを維持したまま`app.ts`を廃止する                   |
| R07 | Billing webhookのBackend転送と直接受信が併存し、所有境界と重複排除が曖昧になる                       | Phase 8   | T04、T05、T10      | Billing用Stripe eventをBilling APIが直接受信し、provider event claimで重複を1件へ収束させ、Backendには旧ticket checkoutだけが残る                               |
| R08 | `syncedAt`が応答生成時刻で更新され、Stripeとの同期欠落を新鮮と誤認する                               | Phase 3   | T05、T07、T10      | `syncedAt`はprovider照合成功時だけ進み、全件巡回を行わず、高リスク対象の15分照合と`refresh=if_stale`による対象別回復が確認できる                                |
| R09 | revisionを増やさない通知eventが状態eventや別通知と一意制約で衝突する                                 | Phase 4   | T03、T04、T06      | 状態変更は`subject + revision`、通知要求は`subject + notification kind + trigger key`を基準に重複排除し、一方の失敗が他方のcursorを停止させない                 |
| R10 | Queue契約切替中に旧payloadが新consumerへ混入する                                                     | Phase 7   | T04、T06、T09      | 開発データを破棄してversion付き新Queueへ一括切替し、新Queueには新schemaだけが存在する。旧payloadのdrainや互換consumerを必要としない                             |
| R11 | retry上限到達eventを調査・復旧できず、古いpayloadの再適用で状態を壊す                                | Phase 8   | T06、T09           | DLQ eventをD1、Sentry、既存Billing調査機能で追跡でき、DLQ ID指定の状態再同期または通知再判定を実行できる                                                        |
| R12 | Entitlement投影から有効期間とprovider鮮度が失われ、期限切れPremiumを許可する                         | Phase 5   | T07、T10           | 投影がrevision、有効期間、`syncedAt`、評価時刻、鮮度上限、照合時刻を保持し、有効期間外または鮮度超過時はread-through後も修復不能なら対象操作をfail-closedにする |
| R13 | Billing event処理とメール配信retryが結合し、ACK後の通知消失またはResend障害によるevent再実行が起きる | Phase 6   | T06、T08           | recipient単位の通知判断と1件のOutboxを同一batchで保存してからACKし、同じOutboxを再試行し、Logを1 attemptにつき1行だけ保持する                                   |
| R14 | 通知履歴が旧Billing aggregateを参照し、履歴を保ったまま旧tableを削除できない                         | Phase 9   | T08、T09           | 通知3テーブルをorganization／subject基準へ移行し、1:1:N関係と履歴の件数、欠損、一意性、参照結果を確認してから`billing_account`を削除する                        |
| R15 | 旧転送、shadow、fallback、移行flag、旧route／schemaが残り、実行経路が二重化する                      | Phase 9   | T01、T04、T09、T11 | 廃止対象名の参照がmigration履歴とhistory文書以外で0件となり、Billing API未設定時にも旧Billing処理へfallbackしない                                               |
| R16 | local fakeだけで完了扱いし、実Stripe、Queue復旧、現行仕様文書との差異を見逃す                        | Phase 10  | T09、T10、T12      | cutover検証記録と主要Test Clock scenarioが成功し、現行仕様・運用文書を実装結果へ更新して本計画をhistoryへ移す                                                   |

## 採用する設計

### 1. Billing APIのmodule構成

Billing API内のvertical sliceを先に作ります。
共有packageへの抽出は、この計画へ含めません。

```text
apps/billing-api/src/
├── app/
│   ├── create-app.ts
│   ├── middleware/
│   └── responses/
├── features/
│   ├── subjects/
│   │   ├── routes.ts
│   │   └── usecase.ts
│   ├── trials/
│   ├── addons/
│   ├── handoffs/
│   ├── webhooks/
│   └── test-clocks/
├── domain/
│   ├── entitlements/
│   ├── subscription-schedules/
│   └── billing-events/
└── infra/
    ├── db/
    ├── stripe/
    ├── idempotency/
    └── outbox/
```

依存方向は次に限定します。

```text
feature route -> feature use case -> domain
                              |
                              +-> feature-local interface <- infra

app/create-app -> features + infra
```

- featureのrouteは認証済みinputをuse caseへ渡し、結果をHTTPへ変換します。
- featureのuse caseは一つのcommandまたはqueryを調整します。
- 保存、Stripe、Queue、時刻等のinterfaceは、fakeへ差し替える必要がある外部I/Oにだけ定義します。
- interfaceは利用するfeatureの近くへ置きます。全featureへ`ports.ts`を必須化しません。
- `domain`は状態遷移、policy、値objectを持ちます。
- `infra`はfeatureが必要とするD1、Stripe、Queue等の外部I/Oを実装します。
- `features`から`infra`をimportしません。
- `domain`はHono、D1、Drizzle、Stripeの型へ依存しません。
- `app.ts`は廃止します。
- `create-app.ts`だけがroute、use case、D1 store、Stripe adapter、Queue adapterを結合します。

#### 分割の単位

- routeとuse caseが小さい間は同じfeature directoryに置く。
- 外部I/Oを持たない小さな処理にはinterfaceを作らない。
- addon、webhook、handoff等でfake Stripe／fake storeが必要な場合だけ、利用側に最小interfaceを置く。
- D1実装は`infra/db`、Stripe実装は`infra/stripe`に置く。
- subject bundle、revision commit、outbox、API冪等性のうち、複数featureで意味と変更理由が一致した操作だけを共有する。
- `@repo/saas-billing-core`のport導入やBilling API側domainの同packageへの移動は、分割後の重複を確認してから別計画で判断する。

全テーブルを扱う巨大repositoryは作りません。
一テーブル一repositoryの機械的な抽象化も行いません。

### 2. addon Scheduleの状態遷移

Schedule操作はdiscriminated unionと純粋な状態遷移関数で表現します。
XState等の新しいstate machine依存は追加しません。

概念上の状態は少なくとも次を区別します。

```text
processing
provider_applied
committed
failed
released
completed
canceled
```

遷移関数は現在状態、操作、attempt ID、Stripeの最新Schedule snapshotを受け取り、次の状態と必要なeffectを返します。

- 終端状態からpending状態へ戻さない。
- 別attemptが所有するScheduleを更新しない。
- provider更新前のattemptをWebhookだけで成功扱いしない。
- 同じsnapshotの再適用はno-opにする。

Webhook payloadは状態の正本として使いません。
`subscription_schedule.*`を再同期トリガーとして扱い、Stripeから最新ScheduleとSubscriptionを取得して遷移関数へ渡します。
取得に失敗した場合はローカル状態を変更せず、再試行可能な失敗にします。

`event.created`は監査と診断には保存しますが、状態更新順の唯一の根拠にはしません。

### 3. Stripe webhook

Billing用Stripe webhookはBilling APIが直接受信します。
BackendからBilling APIへのWebhook転送と`BILLING_API_WEBHOOK_FORWARD_ENABLED`は廃止します。

BackendのStripe endpointには旧ticket checkoutだけを残します。
Billing APIはBilling metadataを持たない`checkout.session.completed`を安全に無視します。

Webhook処理は共通pipelineと4つのevent family handlerへ分けます。

1. Checkout completed
2. Subscription lifecycle
3. Subscription Schedule
4. Invoice／payment

共通pipelineは次だけを担当します。

- 署名確認後のprovider event claim
- app／subjectの解決
- 処理結果と失敗理由の記録
- 状態、revision、outboxの原子的commit
- commit後のoutbox dispatch要求

event family handlerはStripe snapshotからdomain commandを作り、保存する変更を返します。

対応対象へ`subscription_schedule.canceled`と`customer.subscription.trial_will_end`を追加します。
`trial_will_end`は状態変更として扱わず、通知要求として扱います。

#### Provider鮮度と`syncedAt`

`syncedAt`はresponse生成時刻ではありません。
Billing APIがStripeの最新状態を取得し、ローカルの課金状態と照合できた時刻です。

provider-linked subjectには`provider_synced_at`と`provider_sync_failed_at`を永続化します。
`provider_synced_at`は次の場合だけ更新します。

- Stripe webhook処理で最新Subscription／Scheduleを取得し、照合に成功した。
- Billing command完了後に最新provider状態を取得し、照合に成功した。
- 高リスク対象の定期照合が成功した。
- `refresh=if_stale`を指定したsummary readから対象subjectの照合に成功した。

summaryを読み取っただけでは`provider_synced_at`を更新しません。
照合に失敗した場合は`provider_sync_failed_at`だけを更新します。
照合に成功した場合は同列を`null`へ戻します。
providerに紐づかないfree subjectでは、Billing API内の最新commandまたはsubject同期の確定時刻を`syncedAt`として返します。

#### 高リスク対象の定期照合

全subjectは巡回しません。
Billing APIの15分Cronは、既存の状態列から次の対象だけを抽出します。

- 非終端のSchedule attemptまたはpending addonを持つsubject
- `past_due`、`unpaid`、`incomplete`のsubscription
- trial終了前後24時間のsubject
- 期間末解約の適用前後24時間のsubject
- `provider_sync_failed_at`を持つsubject

対象は`provider_synced_at`が古い順に上限付きで処理します。
Subscriptionと所有するScheduleをStripeから取得します。

- 差分がある場合は、状態、Entitlement、revision、outboxを同じD1 batchで更新する。
- 差分がない場合は`provider_synced_at`だけを更新し、revisionとoutboxは増やさない。
- 失敗時は`provider_synced_at`を更新せず、次の15分Cronで再試行する。
- batch上限へ到達した場合はSentryへ通知する。

初期段階では、subject別cursor、lease、attempt数、指数backoffを持ちません。
全件照合は実装せず、必要性を運用データで確認してから別計画で判断します。

`maxStaleSeconds`はBackend投影を同期呼出しなしで信頼できる期間です。
高リスク対象の15分照合周期とは別の設定として扱います。

#### 認可時のオンデマンド照合

既存のsummary readへ`refresh=if_stale`を追加します。
このoptionを指定した場合だけ、provider snapshotが`maxStaleSeconds`を超えていれば対象subjectをStripeと照合します。

- provider snapshotが十分に新しい場合はD1のsummaryを返す。
- 照合で差分がある場合は、状態、Entitlement、revision、outboxを同じD1 batchで更新する。
- 差分がない場合は`provider_synced_at`だけを更新し、revisionとoutboxは増やさない。
- Stripeと照合できない場合は`503 provider_unavailable`を返し、古いsummaryを成功responseとして返さない。

optionなしのsummary readは、契約画面、AI facts、診断等のために保存済みsummaryを返します。
初期段階では同時refresh用のsubject leaseを作りません。
重複するStripe GETは計測し、必要になった場合だけ抑制します。

### 4. Billing Event契約

HTTPとQueueの公開契約は共有Zod schemaを正本とします。
既存`@repo/billing-types`は、schemaと`z.infer`による型を公開するcontract packageへ変更します。

実行時検証を次の境界で必須にします。

- Billing APIのHTTP request
- Billing APIが返すHTTP response
- `@repo/billing-client`が受け取るresponse
- Billing APIがQueueへ投入するevent
- Backend Queue consumerが受け取るevent

domain内部の関数へZod schemaを持ち込みません。

イベントはdiscriminated unionにします。

```ts
type BillingSubjectEvent =
  | {
      kind: 'state_changed';
      subjectRevision: number;
      affectedResources: BillingResource[];
    }
  | {
      kind: 'notification_requested';
      notification: 'trial_will_end';
      subjectRevisionAtCreation: number;
      triggerKey: string;
      providerEventId?: string;
    };
```

両方にevent ID、schema version、app、subject、発生時刻を持たせます。
provider eventが存在する場合だけ、そのIDを監査情報として含めます。

- `state_changed`だけがEntitlement投影のrevisionを進めます。
- `notification_requested`は現在のsummaryを再取得して判定するため、状態変更としてrevisionを増やしません。
- メールアドレス、Stripe生payload、請求書URLはQueue payloadへ含めません。
- 通知要求はnotification kindとtrigger keyで重複排除します。
- Webhook由来のtrigger keyにはprovider event IDを使います。
- 定期判定では`trial_end:<時刻>`等、同じ業務境界から同じ値になるdomain keyを使います。

#### Outbox／Inboxの一意性

状態変更と通知要求は、同じdispatch、lease、再試行基盤を利用します。
ただし、状態revisionと通知の重複排除を同じ一意制約では扱いません。

OutboxとInboxは次の識別情報を列として持ちます。

```text
event_kind
subject_revision       nullable
notification_kind      nullable
notification_trigger_key nullable
provider_event_id        nullable
```

- `state_changed`では`subject_revision`を必須にする。
- `notification_requested`では`notification_kind`と`notification_trigger_key`を必須にする。
- event IDはevent kindにかかわらず一意にする。
- 状態変更だけに`subject + subject_revision`の条件付き一意制約を適用する。
- 通知要求だけに`subject + notification_kind + notification_trigger_key`の条件付き一意制約を適用する。
- Backend cursorは`state_changed`を完了した場合だけ進める。
- 通知要求の失敗や再試行は、状態変更のrevision処理を停止させない。

`notification_requested`は現在のBilling API summaryから要否を再判定します。
状態変更との配送順や、通知専用の連番には依存しません。

### 5. Backendの最小Entitlement投影

Backendに完全なBilling aggregateを複製しません。
業務認可に必要なEntitlement、適用済みrevision、有効期間、snapshot鮮度だけを保持します。

想定する保存単位は次のとおりです。

```text
billing_event_consumer_cursor
  app_id
  subject_type
  subject_id
  last_processed_revision

billing_entitlement_projection_state
  organization_id
  billing_revision
  synced_at
  evaluated_at
  time_source
  max_stale_seconds
  last_reconciled_at

billing_entitlement_projection
  organization_id
  entitlement_key
  value_type
  value_json
  active
  valid_from
  valid_until
  generated_at
  source_revision
  updated_at
```

既存cursorをrevisionの基準として再利用します。
Entitlementと投影状態の置換、inbox完了、cursor更新、通知判断の保存は、同じD1 batchで確定します。

#### 認可時の動作

- revisionが連続していても、有効期間とsnapshot鮮度の両方を確認する。
- Entitlementは`validFrom <= evaluated time < validUntil`の場合だけ有効とする。
- `validFrom`がない場合は開始時刻の制約なし、`validUntil`がない場合は個別の終了時刻なしとして扱う。
- snapshotは`current time < syncedAt + maxStaleSeconds`の場合だけ信頼する。
- 投影が未作成、有効期間外、鮮度超過のいずれかであればBilling APIからread-throughする。
- incoming revisionに欠番がある場合は、先行eventを待ち続けず最新summaryで投影を修復する。
- 修復に成功したら、summaryのrevision、Entitlement、有効期間、鮮度情報を原子的に保存する。
- Billing APIが利用不能なら、該当組織のPremium操作だけを`billing_entitlement_unavailable`で拒否する。
- 無料機能、他組織、Billingと無関係な処理には波及させない。

通常の組織認可ではserver timeを評価時刻に使います。
Stripe Test Clockのtest subjectは業務認可へ利用しませんが、contractを欠落させないため`evaluatedAt`と`timeSource`を保存します。

#### イベント欠落からの回復

Backendは全組織の定期照合を行いません。
Queue eventの反映と、認可時のread-throughを基本にします。

- BackendはBilling APIから返された`syncedAt`を変更せず投影する。
- Backendがsummaryを取得した時刻で`syncedAt`を上書きしない。
- 投影が未作成、revision欠番、有効期間外、鮮度超過の場合は、`refresh=if_stale`付きでsummaryを取得する。
- Billing APIが`503 provider_unavailable`を返した場合は、対象Premium操作だけをfail-closedにする。
- trial終了、支払い猶予終了、`validUntil`到達は、次のeventを待たず認可時刻で無効化する。

契約画面や内部調査によるoptionなしのsummary readは、provider鮮度を回復したことにはしません。
Backend側の全件Cronは削除します。

契約画面、内部Billing調査、通知判断、AIのBilling factsはBilling APIのqueryを利用します。
移行後はBackendの契約、subscription、payment issue、invoice event等の重複投影を削除します。

### 6. 通知境界

Billing Event Consumerはメールを直接送信しません。
Consumerの責務は次までです。

1. eventをclaimする。
2. Billing APIの最新summaryを取得する。
3. 通知が現在も必要か判定する。
4. 確認済みownerをrecipient単位で解決する。
5. recipientごとのBilling通知判断と共通Notification Outbox jobを保存する。
6. inboxを確定してQueue messageをACKする。状態変更の場合だけcursorも進める。

メール送信とResend再試行はNotification Outbox workerが担当します。

#### Notification Outboxの一般化

既存`notification_outbox`をBackend内部の共通配信基盤へ一般化します。
外部向けのNotification APIは作りません。

- `store_id`、`booking_id`、`participant_id`を発生元に応じてnullableにする。
- `organization_id`は必須のまま維持する。
- `source_type`と`source_id`を追加する。
- 予約とBillingのtemplate payloadをdiscriminated unionで検証する。
- 配信claim、lease、backoff、dead判定、provider結果記録を共通化する。
- 実装を`features/booking`から通知専用moduleへ移す。
- Billing通知では`source_type = billing_notification`、`source_id = billing_notification.id`とする。

`notification_log`も同じ発生元モデルへ変更します。

- `organization_id`は必須のまま維持する。
- `store_id`と`booking_id`をnullableにする。
- `source_type`と`source_id`を追加する。
- 予約通知は従来どおりstoreとbookingを記録する。
- Billing通知はorganizationとBilling通知判断を発生元として記録する。

#### 3テーブルの関係

1通のrecipient向け通知を次の関係で保存します。

```text
billing_notification 1:1 notification_outbox 1:N notification_log
```

| 記録                   | 意味                                    | 作成・更新主体                                                             |
| ---------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `billing_notification` | recipient単位の通知判断と判断時snapshot | Billing Event Consumerが1回だけ作成し、更新しない                          |
| `notification_outbox`  | 1通分の配信jobと現在のretry状態         | Consumerが判断と同じD1 batchで作成し、Notification workerだけが更新する    |
| `notification_log`     | 1回の配信attempt                        | Notification workerがclaim時に`processing`で作成し、同じ行を結果で確定する |

Consumerは`billing_notification` IDとOutbox IDを先に生成します。
通知判断、Outbox、inbox完了を同じD1 batchで保存してからQueueをACKします。
retryでは新しい通知判断やOutboxを作りません。

`notification_log`は`outbox_id + attempt_number`を一意にします。
Outboxのclaimと`processing` Logの作成は同じD1 batchで確定します。
1 attemptにつき1行だけを持ち、`started_at`と`completed_at`を記録します。
attempt全体の`cancelled`、`dead`等の状態はOutboxだけが保持します。

#### 重複排除

通知判断の重複排除は`billing_notification.dedupe_key`を正本とします。

```text
organization／subject
+ notification kind
+ normalized recipient
+ trigger key
```

- Webhook由来のtrigger keyにはprovider event IDを使う。
- 定期判定では`trial_end:<時刻>`等の決定的なdomain keyを使う。
- provider event IDは任意の監査情報として保存する。
- Outboxのidempotency keyは`billing-notification:<billing_notification ID>`とする。
- Notification Logは通知要否や重複排除を判断しない。

#### Billing通知記録

`billing_notification`はBilling固有の通知判断と状態snapshotに限定して残します。
親は削除予定のBilling aggregateではなく、reserve-appのorganizationにします。

保持する情報:

- organization ID
- app、subject type、subject ID
- 判断時のsubject revision
- notification kind
- trigger keyとdedupe key
- provider event／invoice識別子。存在する場合だけ保持する
- 判断時の契約・支払い状態
- recipientと選定理由
- trial終了時刻等の判断材料
- 対応する`notification_outbox` ID

保持しない情報:

- 配信attempt数
- retry状態
- Resend message ID
- 配信エラー

配信状態は`notification_outbox`と`notification_log`から導出します。

#### 保持期間

初期段階では3テーブルを自動削除しません。
個別のOutbox削除も提供しません。
organizationを削除する場合だけ、関連する通知判断、Outbox、Logを一括削除します。

保存するpayloadは通知の再試行と調査に必要な最小限へ限定します。
Stripe生payload、secret、不要なprovider responseを保存しません。
期間による自動削除と匿名化は、本番公開前に別計画で決定します。

#### 既存履歴の移行

既存履歴は削除しません。
Phase 6で`billing_account`とjoinしてorganizationをbackfillし、次を確認してからtableを再構築します。

- 移行前後の履歴件数が一致する。
- organizationを解決できない履歴が0件である。
- 既存の通知重複排除キーが新しいorganization基準のキーへ一意に移行できる。
- 対応するOutboxがある履歴は`notification_outbox` IDを保持する。
- 新しい1:1:N関係に欠損や重複がない。
- 内部調査とowner向け履歴がorganizationだけで同じ結果を返す。

この検証が完了するまで`billing_account`を削除しません。

### 7. API冪等性

`billing_api_idempotency`は24時間のAPI response cacheとして扱います。
責務はHTTP requestの重複排除、request hash競合の検出、response cacheに限定します。
Stripe副作用の有無や回復状態は管理しません。

レコードは少なくとも次の状態とleaseを持ちます。

```text
processing
completed
```

処理手順:

1. `app_id + idempotency_key`を原子的にclaimする。
2. 同じrequest hashが完了済みなら保存responseを返す。
3. 異なるrequest hashなら`409 idempotency_conflict`を返す。
4. 同じrequestが処理中なら進行中を表す確定したerrorを返す。
5. lease切れの`processing`はtoken付き条件更新で回収する。
6. 5xxはresponseとして固定せず、再claim可能にする。
7. 完了responseは24時間保持する。
8. Cronで期限切れレコードを削除する。

Stripe handoffの`billing_operation_attempt`とaddon Schedule attemptは、provider副作用とその回復だけを担当します。
API idempotencyと同じkeyを使用しますが、API idempotencyからattemptへの外部キーは持ちません。

lease回収後にuse caseを再開する場合は、Stripeを呼び出す前に同じkeyのattemptを必ず確認します。

- attemptが成功済みなら、保存済みprovider結果からresponseを再構築する。
- attemptが処理中で回収対象でなければ、providerを再実行しない。
- attemptが回収可能な場合だけ、そのattemptの回復手順を実行する。
- provider副作用を持たないuse caseはAPI idempotencyだけを利用する。

operation attempt、Schedule attempt、監査履歴はAPI response cacheのTTLで削除しません。

### 8. DLQと復旧

`reserve-billing-events-dlq`にconsumerを設定し、再試行上限を超えたeventをBackend D1へ保存します。

記録内容:

- event ID、schema version
- app、subject、revision
- Queue attempt数
- 最終エラー
- payloadの安全なsnapshot
- DLQ到達時刻
- 解決状態とoperator記録

DLQ consumerはD1保存とSentry通知後にmessageをACKします。

復旧操作は二つに分けます。

- `resync`: `refresh=if_stale`付きの最新summaryから状態投影を再同期する。
- `re-evaluate-notification`: 現在状態を再検証してから、必要な通知判断だけを新しいidempotency keyで登録する。

古いstate change payloadをそのまま再適用しません。
既存のorganization単位Billing調査機能へ直近DLQ情報を追加します。
Sentryに記録したorganization IDとDLQ IDから対象を確認できるようにします。

初期段階で追加する操作は、DLQ ID指定の上記2 actionだけです。
専用のDLQ一覧画面、汎用filter、payload replayは作りません。

## 廃止するもの

後方互換性は維持しません。
ただし、旧ticket checkoutは対象外です。

- BackendからBilling APIへのStripe webhook転送
- `BILLING_API_WEBHOOK_FORWARD_ENABLED`
- 単一addon更新の旧`PUT .../addon-items/:addonCode`
- Billing API shadow readと`BILLING_API_SHADOW_ENABLED`
- Billing API action／summaryを任意化する移行flag
- Billing API失敗時の旧Backend Billing状態へのfallback
- Backend内のStripe billing webhook同期処理
- Backend内の完全なBilling aggregate投影
- Queue consumerからの直接Resend呼び出し
- `billing_notification`による配信retry状態の管理
- 型assertionだけに依存するBilling API response／event parsing

削除時はimport、環境変数、Wrangler設定、テスト、運用文書を同じ変更で整理します。

## 実装フェーズ

Phaseは実装順序だけを表します。
各Phaseの完了判定は、[実装対応表（正本）](#実装対応表正本)に記載した対象リスクの完了条件だけで行います。

| Phase    | 目的                                   | 対象リスク         | 主な変更                                                                                            |
| -------- | -------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| Phase 0  | 構造変更前に正しさを固定する           | R01〜R04           | Schedule回復、通知summary参照、API冪等性、D1原子性、現行route characterization                      |
| Phase 1  | 共有contractと外部I/O境界を作る        | R05、R06の境界準備 | 共有Zod schema、runtime validation、必要な外部I/Oだけのfeature-local interface、fake Stripe adapter |
| Phase 2  | Billing APIをvertical sliceへ分割する  | R06、R07の受信準備 | subject、trial、addon、handoff、webhook、test clockのfeature化と`app.ts`廃止                        |
| Phase 3  | provider鮮度と対象別回復を実装する     | R08                | `provider_synced_at`、高リスク対象の15分照合、`refresh=if_stale`、`503 provider_unavailable`        |
| Phase 4  | Event v2契約と保存制約を準備する       | R09                | event union、trigger key、Outbox／Inboxの条件付き一意制約、contract test                            |
| Phase 5  | Backendの最小投影consumerを作る        | R12                | Entitlement投影、有効期間、鮮度、revision gap、認可時read-through                                   |
| Phase 6  | 通知判断と配信jobを分離する            | R13、R14の移行準備 | recipient単位の通知判断、共通Outbox、1 attempt 1 Log、既存履歴backfill                              |
| Phase 7  | Queue v2へ一括切替する                 | R10                | 新Queue／DLQ、新producer／consumer binding、開発用Billing API D1再作成                              |
| Phase 8  | Stripe直接WebhookとDLQ復旧を有効化する | R07、R11           | 直接endpoint、Backend転送停止、Sentry／inspection、2種類の復旧action                                |
| Phase 9  | 旧実装とschemaを撤去する               | R14、R15           | 旧Billing投影、転送、shadow、fallback、flag、単一addon routeの削除                                  |
| Phase 10 | 実サービス検証と文書昇格を行う         | R16                | Stripe Test Clock、復旧確認、現行仕様更新、計画のhistory化                                          |

機械的なmodule移動と挙動変更は同じcommitへ混在させません。
Phase 7以降の環境変更は、[cutover runbook](./billing-api-maintainability-cutover-runbook.md)に記載した対象確認と証跡を満たす場合だけ実施します。
Phase 4ではEvent v2のcontractと保存処理を準備しますが、Queue v2への送信はPhase 7まで有効化しません。
Phase 5とPhase 6のconsumerはfixtureとintegration testで検証し、Phase 7で新Queue bindingを有効化します。

## 必須テスト定義

対応表のテストIDは次を意味します。
テスト名や配置は実装中に変更できますが、ここで定義した検証責務は減らしません。

| ID  | 種別                          | 検証責務                                                                                                                                                |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 | HTTP characterization         | 17 routeのpath、認証、主要success／error status、response contract、互換維持対象の挙動                                                                  |
| T02 | Domain unit                   | Entitlement合成、addon更新分類、Schedule状態遷移、event mapping、通知要否、retryable／terminal分類                                                      |
| T03 | D1 integration                | API冪等性claim、lease、expiry、attempt確認後の回復、状態・revision・outbox原子性、event identity制約、障害注入                                          |
| T04 | Contract                      | Billing APIのrequest／response、Billing Client runtime parse、`refresh=if_stale`、`provider_unavailable`、Event v2、未知version、不正payload、PII非包含 |
| T05 | D1＋fake Stripe integration   | provider event claim、Schedule順序逆転、Stripe成功後のD1失敗、`syncedAt`、高リスク抽出、15分照合、対象別refresh                                         |
| T06 | Queue／DLQ integration        | inbox、cursor、重複、順序逆転、通知eventとの独立性、DLQ保存、inspection、2種類の復旧action、ACK境界                                                     |
| T07 | Entitlement integration       | 有効期間、provider鮮度、`refresh=if_stale`、revision gap、`validUntil`到達、`provider_unavailable`時の限定fail-closed                                   |
| T08 | Notification integration      | 判断とOutboxの原子保存、1:1:N制約、trigger key、recipient単位dedupe、同一Outbox再送、1 attempt 1 Log、履歴backfill                                      |
| T09 | Migration／cutover rehearsal  | migration replay、通知履歴の件数・欠損・一意性、開発D1再作成、新Queue限定配送、旧resource破棄、seed再実行                                               |
| T10 | Stripe Test Clock E2E         | trial終了、月次更新、支払い失敗・回復、支払い方法なし、addon増減、Schedule終端、event再送                                                               |
| T11 | Architecture check            | vertical sliceの依存方向、不要な`ports.ts`／一テーブル一repositoryの不在、共有core未導入、具体adapterのcomposition root限定                             |
| T12 | Documentation／evidence check | runbook証跡、Sentryと内部調査結果、現行仕様・運用文書への反映、検証レベルの明示                                                                         |

T03、T05〜T09は、対象migrationを先頭から適用したD1で実行します。
T10は通常CIから分離し、検証環境で実行します。
local fake Stripeの成功を、実Stripe確認済みとは表現しません。

## 移行・切替

公開前かつ後方互換性不要という前提で、Billing API D1の契約データはbackfillせず、新schemaで再作成します。
Backend D1全体はresetせず、organization、store、予約、認証、既存通知履歴を保持します。

次の詳細は[Billing API 保守性改善 cutover runbook](./billing-api-maintainability-cutover-runbook.md)を正とします。

- 対象環境、database、Queue、DLQ、Stripe endpointの特定
- Billing API D1の再作成、migration、seed、credential更新
- Backend D1の追加migration、通知履歴backfill、旧table撤去
- 新Queue binding、Stripe endpoint切替、旧resource破棄
- 再作成、seed再実行、中止判断、証跡の記録

旧契約データ、旧outbox、旧Queue backlogは移行しません。
一時的なmaintenance flag、Webhook保留応答、旧payload互換consumerは実装しません。
作業中はBilling操作の停止を許容し、失敗時は新D1を再作成してseedからやり直します。

通常の`deploy:workers`だけでresource確認を省略しません。
新Queueは`reserve-billing-events-v2`、新DLQは`reserve-billing-events-v2-dlq`とし、互換性のないcontract変更ではQueue名のversionも更新します。

## 完了判定

本計画の完了条件は、[実装対応表（正本）](#実装対応表正本)のR01〜R16がすべて完了していることです。
Phase末尾の独立した完了条件や、この表と重複する総合チェックリストは設けません。

完了時は、各リスクIDについて次の証跡をPR、検証記録、またはrunbook実施記録から追跡できるようにします。

- 実装差分
- 必須テストの実行結果
- migration／cutoverを伴う場合の件数と対象resource
- local、検証環境、実Stripe、デプロイ済みの区別

## 実装時に守ること

- 正しさの修正とファイル移動を同じ変更へ混在させない。
- 状態変更とoutbox作成を別transactionにしない。
- Stripe API呼び出しをD1 transaction内で行わない。
- QueueとWebhookの配送順を前提にしない。
- Queue ACKを通知jobの永続化より先に行わない。
- Billing API障害を無料機能や他組織へ波及させない。
- PII、Stripe生payload、secretをevent、監査、ログへ保存しない。
- 実装済み、ローカル検証済み、実Stripe確認済み、デプロイ済みを区別して記録する。
