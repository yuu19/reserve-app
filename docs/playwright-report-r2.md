# Playwright Report の R2 公開構成

最終更新: 2026-05-20

## 目的

`main` で実行された Playwright の HTML レポートは、GitHub Pages ではなく Cloudflare R2 に公開する。
レポートは失敗時の調査に使う運用資料であり、アプリ利用者向けの公開ページではない。

公開先は Custom Domain に接続した R2 bucket を使う。
関係者だけが参照する前提では、Custom Domain の前段に Cloudflare Access を置く。

## 公開されるレポート

次の workflow が Playwright report artifact を作る。

- `CI Tests`: docs E2E の `playwright-report-docs`
- `CI Tests`: web E2E の `playwright-report-web`
- `Stripe Billing E2E`: Stripe 課金 E2E の `playwright-report-stripe-billing`

`Publish Playwright Reports` は、これらの artifact を `.pages` に集約する。
集約後、`.pages` を R2 に `aws s3 sync` で同期する。

公開 URL の構造は次のとおり。

- `index.html`: レポート一覧
- `docs/`: docs Playwright E2E
- `web/`: web Playwright E2E
- `stripe-billing/`: Stripe 課金 Playwright E2E

たとえば `PLAYWRIGHT_REPORT_BASE_URL=https://reports.example.com`、`PLAYWRIGHT_REPORT_PREFIX=reserve-app/playwright/latest` の場合、一覧は次の URL になる。

```text
https://reports.example.com/reserve-app/playwright/latest/
```

各レポートは、この URL の配下に置かれる。

```text
https://reports.example.com/reserve-app/playwright/latest/docs/
https://reports.example.com/reserve-app/playwright/latest/web/
https://reports.example.com/reserve-app/playwright/latest/stripe-billing/
```

## GitHub Actions の構成

`.github/workflows/ci-tests.yml` は、docs と web の Playwright report を artifact として保存する。
`.github/workflows/stripe-billing-e2e.yml` は、Stripe 課金 E2E の Playwright report を artifact として保存する。

`.github/workflows/publish-playwright-reports.yml` は、`CI Tests` または `Stripe Billing E2E` の完了後に動く。
対象は `main` の実行結果だけで、pull request の実行結果は公開しない。
手動実行にも対応する。

集約 workflow は、起動元 workflow の run id を優先して artifact を取得する。
起動元ではないレポートは、直近の `main` 実行から利用可能な artifact を探す。
artifact が見つからない場合は、そのレポート用の placeholder を作る。

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

## 必須設定

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

## 公開範囲

R2 bucket は、初期状態では public access が無効になっている。
HTML レポートをブラウザから参照するには、Custom Domain または `r2.dev` の public development URL を有効にする必要がある。

本番運用では Custom Domain を使う。
Cloudflare Access、WAF、cache、bot management などを使うには Custom Domain が必要になる。

関係者だけに公開する場合は、Custom Domain に Cloudflare Access を設定する。
その場合、`r2.dev` の public development URL は有効にしない。
`r2.dev` が有効なままだと、Access を通らない公開経路が残る。

`r2.dev` は開発用途の URL として扱う。
本番運用の公開先や CI レポートの恒常的な共有先には使わない。

## 保持方針

現行 workflow は `PLAYWRIGHT_REPORT_PREFIX` 配下を latest として扱う。
`aws s3 sync --delete` により、`.pages` に存在しない object は同期先から削除される。
そのため、現在の構成では基本的に最新の一覧と各レポートだけが残る。

GitHub Actions artifact 側の保持期間は workflow の `retention-days` に従う。
R2 側の保持期間とは別の設定である。

R2 の Object Lifecycle は bucket 単位で設定する。
rule ごとに prefix を指定できるため、履歴保存を始めた場合は履歴用 prefix だけに削除期限を設定できる。

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
- [Cloudflare R2: Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
