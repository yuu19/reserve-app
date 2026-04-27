# ユーザーマニュアル設計案

この設計案は、2026-04-23 時点の `apps/web` 実装を参照して作成したものです。  
目的は、いま存在する機能をもとに、`apps/docs` へ段階的にユーザーマニュアルを追加できるようにすることです。

## 1. 前提

- 対象読者は `管理者` と `参加者` の2系統です。
- 実装上は `公開イベント閲覧` も独立した導線として存在します。
- マニュアルの主対象は `apps/web` です。
- `apps/mobile` は別導線なので、この設計案では対象外にします。
- 旧互換や自動リダイレクト用のルートではなく、最終的に到達する画面をマニュアル対象にします。

## 2. 現行実装から見える主要導線

### 管理者向け

- 初回セットアップ: `/admin/onboarding`
- ログイン: `/admin/login`
- ダッシュボード: `/admin/dashboard`
- 組織設定: `/admin/settings`
- 教室管理: `/admin/classrooms`
- 予約運用: `/admin/bookings`
- サービス管理: `/admin/services`, `/admin/services/new`
- 単発枠管理: `/admin/schedules/slots`
- 定期スケジュール管理: `/admin/schedules/recurring`
- 参加者管理 / 回数券管理: `/admin/participants`
- 管理者招待: `/admin/invitations`
- 契約 / Premium: `/admin/contracts`

### 参加者向け

- ログイン: `/participant/login`
- 参加者ホーム: `/participant/home`
- 予約確認 / 申込: `/participant/bookings`
- 参加者招待への対応: `/participant/invitations`
- 管理者招待への対応: `/participant/admin-invitations`

### 公開導線

- 公開イベント一覧: `/events`
- 公開イベント詳細: `/events/[slotId]`

## 3. マニュアル情報設計の基本方針

### 役割ごとに分ける

管理者と参加者では、目的も権限も画面も違います。  
そのため、マニュアルも以下の3区分で分けるのがよいです。

- `共通`
- `管理者向け`
- `参加者向け`

### 画面単位ではなく業務フロー単位でまとめる

実装上は画面が分かれていても、利用者が知りたいのは「何をするか」です。  
たとえば `サービス作成`、`単発枠作成`、`定期スケジュール作成` は画面が別でも、利用者から見ると「予約を公開する準備」です。

そのため、マニュアルは次の粒度を基本にします。

- 1ページ1目的
- 必要なら複数画面をまたいで説明する
- 画面一覧ではなく、操作手順として読める構成にする

### 先に「最短導線」を作る

最初から全画面を網羅するより、まずは問い合わせが多くなりやすい導線から書くべきです。

- 管理者の初期設定
- 公開イベントからの予約
- 参加者の予約確認
- 管理者の予約運用

## 4. 推奨ディレクトリ構成

```text
apps/docs/src/routes/manuals/
├── +page.md
├── design-proposal/
│   └── +page.md
├── common/
│   ├── glossary/
│   │   └── +page.md
│   └── account-and-login/
│       └── +page.md
├── admin/
│   ├── getting-started/
│   │   └── +page.md
│   ├── organization-and-classroom/
│   │   └── +page.md
│   ├── services/
│   │   └── +page.md
│   ├── one-time-slots/
│   │   └── +page.md
│   ├── recurring-schedules/
│   │   └── +page.md
│   ├── booking-operations/
│   │   └── +page.md
│   ├── participants-and-tickets/
│   │   └── +page.md
│   ├── admin-invitations/
│   │   └── +page.md
│   └── contracts-and-premium/
│       └── +page.md
└── participant/
    ├── getting-started/
    │   └── +page.md
    ├── browse-and-book-events/
    │   └── +page.md
    ├── bookings/
    │   └── +page.md
    ├── ticket-packs/
    │   └── +page.md
    └── invitations/
        └── +page.md
```

スクリーンショットは次のように対応づけます。

```text
apps/docs/static/manuals/
├── admin-getting-started/
├── admin-booking-operations/
├── participant-browse-and-book-events/
└── participant-bookings/
```

## 5. ページ設計案

### 共通

| ページ                              | 目的                                               | 主な実装導線                              |
| ----------------------------------- | -------------------------------------------------- | ----------------------------------------- |
| `/manuals/common/glossary`          | 組織、教室、参加者、管理者、回数券などの用語整理   | 全体                                      |
| `/manuals/common/account-and-login` | 管理者ログインと参加者ログインの違い、入口の選び方 | `/`, `/admin/login`, `/participant/login` |

### 管理者向け

| ページ                                      | 目的                                                             | 主な実装導線                                            |
| ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| `/manuals/admin/getting-started`            | 初回セットアップから管理画面に入るまで                           | `/admin/onboarding`, `/admin/login`, `/admin/dashboard` |
| `/manuals/admin/organization-and-classroom` | 組織切替、組織作成、教室作成・編集                               | `/admin/settings`, `/admin/classrooms`                  |
| `/manuals/admin/services`                   | サービス作成、編集、停止・再開                                   | `/admin/services`, `/admin/services/new`                |
| `/manuals/admin/one-time-slots`             | 単発枠の作成、一覧確認、停止                                     | `/admin/schedules/slots`                                |
| `/manuals/admin/recurring-schedules`        | 定期スケジュール作成、更新、例外登録、枠再生成                   | `/admin/schedules/recurring`                            |
| `/manuals/admin/booking-operations`         | 予約承認、却下、運営キャンセル、No-show                          | `/admin/bookings`                                       |
| `/manuals/admin/participants-and-tickets`   | 参加者一覧、参加者招待、回数券種別作成、回数券付与、購入申請承認 | `/admin/participants`                                   |
| `/manuals/admin/admin-invitations`          | 管理者招待の送信、再送、取消                                     | `/admin/invitations`                                    |
| `/manuals/admin/contracts-and-premium`      | Free / Premium の違い、トライアル、支払い方法、契約確認          | `/admin/contracts`                                      |

### 参加者向け

| ページ                                        | 目的                                         | 主な実装導線                                                 |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `/manuals/participant/getting-started`        | ログイン、ホーム画面、どこから操作するか     | `/participant/login`, `/participant/home`                    |
| `/manuals/participant/browse-and-book-events` | 公開イベントの見方、詳細確認、予約申込       | `/events`, `/events/[slotId]`                                |
| `/manuals/participant/bookings`               | 予約カレンダー、日程表、予約確認、キャンセル | `/participant/bookings`                                      |
| `/manuals/participant/ticket-packs`           | 回数券購入、マイ回数券確認                   | `/participant/bookings`                                      |
| `/manuals/participant/invitations`            | 参加者招待と管理者招待の承諾・辞退           | `/participant/invitations`, `/participant/admin-invitations` |

## 6. 優先執筆順

### 優先度A

すぐに書く価値が高いページです。

1. `/manuals/admin/getting-started`
2. `/manuals/participant/browse-and-book-events`
3. `/manuals/participant/bookings`
4. `/manuals/admin/booking-operations`

### 優先度B

初期運用が始まった後に必要になりやすいページです。

1. `/manuals/admin/services`
2. `/manuals/admin/one-time-slots`
3. `/manuals/admin/recurring-schedules`
4. `/manuals/admin/participants-and-tickets`
5. `/manuals/participant/invitations`

### 優先度C

権限や契約条件に依存しやすく、利用者が限定されるページです。

1. `/manuals/admin/organization-and-classroom`
2. `/manuals/admin/admin-invitations`
3. `/manuals/admin/contracts-and-premium`
4. `/manuals/common/glossary`

## 7. スクリーンショット設計方針

この設計案の段階では、次の方針で十分です。

- 1ページあたり 3〜8 枚程度を目安にする
- すべてのクリックを撮らない
- `開始画面`
- `入力または選択が必要な画面`
- `完了または結果確認の画面`

特に画像が必要なページは次のとおりです。

- 管理者向け初回セットアップ
- 公開イベントからの予約申込
- 参加者の予約確認
- 管理者の予約運用
- 回数券の購入 / 確認

## 8. マニュアル本文のテンプレート方針

各ページは、次の順番を基本にします。

1. 概要
2. このページでできること
3. 利用前に確認すること
4. 手順
5. よくあるつまずき
6. 関連ページ

実装上の権限制約が強いページでは、冒頭で次を明記します。

- `owner のみ`
- `admin / owner のみ`
- `参加者として所属が必要`
- `Premium 利用時のみ`

## 9. この設計案で意図的に外しているもの

- `apps/mobile` の操作説明
- API 仕様や内部実装説明
- 開発者向け設定手順
- スクリーンショット付きの完成版本文

## 10. 実装反映の進め方

おすすめの進め方は次の順です。

1. `優先度A` の4ページを先に書く
2. 実画面でスクリーンショットを撮る
3. 用語を統一する
4. `優先度B` と `優先度C` を段階追加する

まずは、`管理者の初回設定` と `参加者の予約導線` の2本を作ると、プロダクト全体の理解が進みやすいです。
