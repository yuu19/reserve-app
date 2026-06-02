# Playwright Report の R2 公開構成

最終更新: 2026-05-31

## 目的

`main` で実行された Playwright の HTML レポートは、GitHub Pages ではなく Cloudflare R2 に公開する。
レポートは失敗時の調査に使う運用資料であり、アプリ利用者向けの公開ページではない。

公開先は Custom Domain に接続した R2 bucket を使う。
関係者だけが参照する前提では、Custom Domain の前段に Cloudflare Access を置く。

この文書では、次を扱う。

- R2 に公開するレポートの構成
- GitHub Actions から R2 へアップロードする仕組み
- Cloudflare R2、Custom Domain、Cloudflare Access の設定方法
- レポートと Trace Viewer の閲覧方法
- 失敗時に確認する項目

## 公開されるレポート

次の workflow が Playwright report artifact を作る。

- `CI Tests`: docs E2E の `playwright-report-docs`
- `CI Tests`: web E2E の `playwright-report-web`
- `Stripe Billing E2E`: Stripe 課金 E2E の `playwright-report-stripe-billing`

`Publish Playwright Reports` は、これらの artifact を `.pages` に集約する。
集約後、`.pages` を R2 に `aws s3 sync` で同期する。

公開対象は `main` の実行結果だけである。
pull request の実行結果は R2 に公開しない。
pull request の失敗は GitHub Actions の artifact から確認する。

公開 URL の構造は次のとおり。

- `index.html`: レポート一覧
- `docs/index.html`: docs Playwright E2E
- `web/index.html`: web Playwright E2E
- `stripe-billing/index.html`: Stripe 課金 Playwright E2E

たとえば `PLAYWRIGHT_REPORT_BASE_URL=https://reports.example.com`、`PLAYWRIGHT_REPORT_PREFIX=reserve-app/playwright/latest` の場合、一覧は次の URL になる。

```text
https://reports.example.com/reserve-app/playwright/latest/index.html
```

各レポートは、この URL の配下に置かれる。

```text
https://reports.example.com/reserve-app/playwright/latest/docs/index.html
https://reports.example.com/reserve-app/playwright/latest/web/index.html
https://reports.example.com/reserve-app/playwright/latest/stripe-billing/index.html
```

R2 Custom Domain は directory index を自動解決しない。
GitHub Actions の environment URL と step summary では `index.html` まで含む URL を表示する。
既存リンクや手入力に備え、workflow は `latest/`、`latest/docs/` などの trailing slash key にも同じ HTML を置く。

## GitHub Actions の構成

`.github/workflows/ci-tests.yml` は、docs と web の Playwright report を artifact として保存する。
`.github/workflows/stripe-billing-e2e.yml` は、Stripe 課金 E2E の Playwright report を artifact として保存する。

`.github/workflows/publish-playwright-reports.yml` は、`CI Tests` または `Stripe Billing E2E` の完了後に動く。
対象は `main` の実行結果だけで、pull request の実行結果は公開しない。
手動実行にも対応する。

集約 workflow は、起動元 workflow の run id を優先して artifact を取得する。
起動元ではないレポートは、直近の `main` 実行から利用可能な artifact を探す。
artifact が見つからない場合は、そのレポート用の placeholder を作る。

`.pages` には次の内容が入る。

```text
.pages/
  index.html
  docs/
  web/
  stripe-billing/
```

各ディレクトリには Playwright HTML report の内容を配置する。
失敗時の trace が含まれる場合、HTML report には Trace Viewer 用の静的ファイルと trace attachment も含まれる。
そのため、R2 には report 本体とあわせて Trace Viewer で必要なファイルも同期される。

最後に、次の設定で R2 に同期する。

```bash
aws s3 sync .pages "${s3_uri}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --delete \
  --cache-control "no-store"
```

実際の workflow では prefix の前後の `/` を取り除いてから同期先を組み立てる。
`PLAYWRIGHT_REPORT_PREFIX` が空の場合は bucket root に同期される。
他用途の object を誤って消さないため、専用 bucket でない限り prefix を設定する。

## Cloudflare R2 の設定

### 現行設定

2026-05-25 時点の設定は次のとおり。
API token、R2 Access Key ID、R2 Secret Access Key は機密情報としてこの文書には記載しない。

| 項目                             | 値                                              |
| -------------------------------- | ----------------------------------------------- |
| Cloudflare account ID            | `d8ee18029fb3e06794971d45b9c4a67d`              |
| Zone                             | `wakureserve.com`                               |
| Zone ID                          | `331e6ef7d4fd07515ce80befb058a31c`              |
| R2 bucket                        | `reserve-app-playwright-reports`                |
| Custom Domain                    | `https://playwright-reports.wakureserve.com`    |
| Cloudflare Access application    | `Reserve App Playwright Reports`                |
| Cloudflare Access application ID | `e99822c8-cc0e-4dd5-93af-ac707995cc23`          |
| Cloudflare Access policy         | `Reserve App Playwright Reports - Allow yusuke` |
| Cloudflare Access policy ID      | `eeb54c19-f5a6-4550-b9f3-e30cce72efa6`          |
| 許可ユーザー                     | `yusuke.kusi1028@gmail.com`                     |
| Public Development URL           | 無効                                            |

### Bucket を作成する

Playwright レポート専用の R2 bucket を作る。
他用途の object と混ぜない方が、`aws s3 sync --delete` の影響範囲を読みやすい。

推奨名の例:

```text
reserve-app-playwright-reports
```

既存 bucket を使う場合は、必ず `PLAYWRIGHT_REPORT_PREFIX` を設定する。
この workflow は prefix 配下を latest として扱い、同期先に存在して `.pages` に存在しない object を削除する。

### R2 API token を発行する

GitHub Actions から R2 にアップロードするため、R2 の S3 互換 API credentials を作成する。
権限は対象 bucket の object read/write に限定する。

Cloudflare Dashboard での流れ:

1. `Storage & databases` から `R2` を開く。
2. `Overview` の API token 管理を開く。
3. R2 用の token を作成する。
4. 権限は `Object Read & Write` を選ぶ。
5. 対象 bucket は Playwright レポート用 bucket だけに絞る。
6. 発行後に `Access Key ID` と `Secret Access Key` を控える。

`Secret Access Key` は再表示できない。
発行直後に GitHub Secrets へ登録する。

R2 の S3 endpoint は次の形式になる。

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

AWS CLI / S3 API では region に `auto` を使う。

### Custom Domain を接続する

ブラウザから HTML レポートを開くには、R2 bucket を公開 URL に接続する必要がある。
本番運用では Custom Domain を使う。

Cloudflare Dashboard での流れ:

1. R2 bucket の `Settings` を開く。
2. `Public access` の `Custom Domains` で domain を接続する。
3. レポート用の subdomain を指定する。
4. 作成される DNS record を確認して接続する。
5. domain の状態が `Active` になるまで待つ。

このリポジトリでは次の domain を使う。

```text
playwright-reports.wakureserve.com
```

関係者だけが閲覧する場合は、Custom Domain を接続する前に Cloudflare Access application を作成する。
Access application の domain と R2 に接続する Custom Domain は同じ値にする。
Access を設定せずに Custom Domain を接続すると、その domain から bucket 内の object を参照できる状態になる。

### Cloudflare Access を設定する

Playwright レポートには画面の状態、URL、console 出力、network 情報、trace が含まれることがある。
関係者だけが見る前提では、Cloudflare Access で閲覧者を制限する。

推奨設定:

- Application type: Self-hosted
- Application domain: R2 に接続する Custom Domain
- Policy: 開発者または運用者のメール domain / group のみ許可
- Session duration: 組織の運用基準に合わせる

Access を使う場合、R2 の Public Development URL は有効にしない。
`r2.dev` が有効なままだと、Access を通らない公開経路が残る。

### Public Development URL を扱う方針

`r2.dev` の Public Development URL は開発用途として扱う。
本番運用の CI レポート共有には使わない。

理由:

- Access、WAF、cache、bot management の制御対象にしにくい
- Cloudflare が非本番用途として案内している
- Custom Domain と並行して有効にすると、意図しない公開経路になる

## GitHub Actions の設定

### GitHub Secrets

- `R2_ACCOUNT_ID`: Cloudflare account ID
- `R2_ACCESS_KEY_ID`: R2 API token の Access Key ID
- `R2_SECRET_ACCESS_KEY`: R2 API token の Secret Access Key
- `R2_BUCKET`: 同期先 bucket 名

R2 API token は、対象 bucket への object read/write ができる権限で発行する。
Secret Access Key は再表示できないため、発行時に GitHub Secrets へ登録する。

### GitHub Variables

- `PLAYWRIGHT_REPORT_BASE_URL`: Custom Domain の公開 base URL
- `PLAYWRIGHT_REPORT_PREFIX`: bucket 内の同期 prefix

`PLAYWRIGHT_REPORT_BASE_URL` は末尾 `/` なしで登録する。
`PLAYWRIGHT_REPORT_PREFIX` は `reserve-app/playwright/latest` のように、bucket 内でこのリポジトリ用に分ける。
workflow 内では、それぞれ `REPORT_BASE_URL` と `REPORT_PREFIX` として扱う。

AWS CLI の region は R2 では `auto` を使う。
S3 endpoint は `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` を使う。

設定例:

```text
R2_ACCOUNT_ID=d8ee18029fb3e06794971d45b9c4a67d
R2_ACCESS_KEY_ID=<R2 Access Key ID>
R2_SECRET_ACCESS_KEY=<R2 Secret Access Key>
R2_BUCKET=reserve-app-playwright-reports

PLAYWRIGHT_REPORT_BASE_URL=https://playwright-reports.wakureserve.com
PLAYWRIGHT_REPORT_PREFIX=reserve-app/playwright/latest
```

`PLAYWRIGHT_REPORT_BASE_URL` は公開 URL の base であり、bucket 名ではない。
Custom Domain を使う場合は、その domain を指定する。

`PLAYWRIGHT_REPORT_PREFIX` は bucket 内の保存場所である。
空にすると bucket root に同期される。
専用 bucket でない場合は空にしない。

## 閲覧方法

`Publish Playwright Reports` が成功すると、GitHub Actions の environment URL と step summary に一覧 URL が出る。
その URL を開くと、最新の Playwright レポート一覧を確認できる。
URL は R2 object を直接指すため、`index.html` まで含む。

一覧から次のレポートに移動する。

- `Docs report`: docs Playwright E2E
- `Web report`: web Playwright E2E
- `Stripe Billing report`: Stripe 課金 Playwright E2E

各行の右側には、対象レポートを生成した元 workflow run の更新日時が表示される。
日時は GitHub Actions API の `updated_at` を JST に変換した値で、`YYYY-MM-DD HH:mm JST` の形式で表示する。
artifact が見つからず placeholder が公開される場合は、日時の代わりに `未生成` と表示する。

Cloudflare Access を設定している場合、最初に Access の認証画面が出る。
許可されたアカウントで認証すると、R2 上の HTML レポートを閲覧できる。

### Trace Viewer を開く

Playwright は失敗時に trace を残す設定になっている。
HTML レポートで失敗した test の詳細を開き、trace のリンクまたは `Traces` 表示から Trace Viewer を開く。

Trace Viewer では、画面 snapshot、操作、console、network などを確認できる。
調査では次の順に見る。

1. 失敗した assertion と直前の操作
2. 画面 snapshot
3. console error
4. request / response
5. screenshot または video

trace が表示されない場合は、次を確認する。

- Playwright が test 実行まで進まず、依存 install や dev server 起動で失敗していないか
- 対象 test が成功扱いで終わっていないか
- `playwright-report` artifact が生成されているか
- R2 に `trace/` と `data/` 配下の object が同期されているか

### pull request の失敗を見る

pull request の Playwright レポートは R2 に公開しない。
GitHub Actions の対象 run から artifact を開く。

確認する artifact:

- `playwright-report-docs`
- `playwright-report-web`
- `playwright-artifacts-web`

Stripe 課金 E2E は通常の pull request 必須 CI ではない。
手動実行または定期実行の run から次を確認する。

- `playwright-report-stripe-billing`
- `playwright-artifacts-stripe-billing`

## 保持方針

現行 workflow は `PLAYWRIGHT_REPORT_PREFIX` 配下を latest として扱う。
`aws s3 sync --delete` により、`.pages` に存在しない object は同期先から削除される。
そのため、現在の構成では基本的に最新の一覧と各レポートだけが残る。

GitHub Actions artifact 側の保持期間は workflow の `retention-days` に従う。
R2 側の保持期間とは別の設定である。

R2 の Object Lifecycle は bucket 単位で設定する。
rule ごとに prefix を指定できるため、履歴保存を始めた場合は履歴用 prefix だけに削除期限を設定できる。

現行構成では、R2 側に履歴を残さない。
履歴が必要な場合は、latest 用 prefix と run id 付き prefix を分ける。

## トラブルシュート

### R2 へのアップロードが失敗する

まず `Publish Playwright Reports` の `Upload reports to R2` step を確認する。

よくある原因:

- `R2_ACCOUNT_ID` が未設定
- `R2_ACCESS_KEY_ID` または `R2_SECRET_ACCESS_KEY` が未設定
- `R2_BUCKET` の bucket 名が違う
- R2 API token の権限が対象 bucket に付いていない
- `PLAYWRIGHT_REPORT_BASE_URL` が未設定

R2 endpoint は workflow 内で `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` として組み立てる。
`R2_ACCOUNT_ID` が空の場合、workflow は明示的に失敗する。

### レポートが placeholder になる

placeholder は、対象 artifact が見つからなかった場合に作られる。
対象 workflow の Playwright job が artifact upload まで進んでいるかを確認する。

確認する workflow:

- `CI Tests`
- `Stripe Billing E2E`

確認する artifact:

- `playwright-report-docs`
- `playwright-report-web`
- `playwright-report-stripe-billing`

### Custom Domain で開けない

Cloudflare Dashboard で次を確認する。

- R2 bucket の Custom Domain が `Active` になっているか
- DNS record が作られているか
- Cloudflare Access policy で閲覧者が許可されているか
- `PLAYWRIGHT_REPORT_BASE_URL` が Custom Domain と一致しているか
- `PLAYWRIGHT_REPORT_PREFIX` と `index.html` を含めた URL を開いているか

R2 Custom Domain は `latest/` を `latest/index.html` に自動変換しない。
workflow は trailing slash key も作成するが、確認時はまず `.../latest/index.html` を直接開く。

`r2.dev` で見えて Custom Domain で見えない場合は、Custom Domain と Access の設定を確認する。
本番運用では `r2.dev` を有効にしたままにしない。

### Trace Viewer が開けない

Trace Viewer は Playwright HTML report に含まれる静的ファイルで動く。
R2 上で開けない場合は、次を確認する。

- 対象 test が失敗して trace を残しているか
- `playwright-report` 内の `trace/` と `data/` が R2 に同期されているか
- Cloudflare Access や WAF が report 内の静的ファイル取得をブロックしていないか
- ブラウザの developer tools で 404 / 403 になっている asset がないか

Playwright 実行前の失敗では trace は生成されない。
その場合は GitHub Actions の log を確認する。

## 将来の履歴保存案

履歴を残す場合は、latest と run id 付き履歴を分ける。
現行 workflow の変更はこのドキュメントでは行わない。

推奨 prefix:

- `reserve-app/playwright/latest/`
- `reserve-app/playwright/runs/<workflow-name>/<run-id>/`

`latest/` は現在と同じく `--delete` 付きで同期する。
`runs/` は run id ごとの不変な保存先にする。
履歴用 prefix には Object Lifecycle を設定し、たとえば 30 日または 90 日で削除する。

一覧ページを拡張する場合は、latest の各レポートに加えて、直近 run の履歴リンクだけを表示する。
全履歴の列挙を R2 の公開 bucket root に頼らない。

## 参考

- [Cloudflare R2: AWS CLI](https://developers.cloudflare.com/r2/get-started/cli/#aws-cli)
- [Cloudflare R2: Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare R2: Protect an R2 Bucket with Cloudflare Access](https://developers.cloudflare.com/r2/tutorials/cloudflare-access/)
- [Cloudflare R2: Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
