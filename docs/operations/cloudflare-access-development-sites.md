# 開発中公開面の Cloudflare Access 制限

`web.wakureserve.com` と `docs.wakureserve.com` は開発中の公開面として扱います。
関係者だけが閲覧できるように、Cloudflare Access で入口を制限します。

この制限は Web アプリとドキュメントの閲覧面に掛けます。
`api.wakureserve.com` は予約、認証、Webhook の入口を持つため、この手順の対象外です。

## 対象

| 対象         | 公開 URL                       | Worker             | Access application 名          |
| ------------ | ------------------------------ | ------------------ | ------------------------------ |
| Web アプリ   | `https://web.wakureserve.com`  | `reserve-app-web`  | `Reserve App Web Development`  |
| ドキュメント | `https://docs.wakureserve.com` | `reserve-app-docs` | `Reserve App Docs Development` |

Playwright レポートでは、`playwright-reports.wakureserve.com` に Cloudflare Access を設定済みです。
同じ考え方で、Web アプリとドキュメントにも self-hosted application を作成します。

## 迂回経路を残さない

Access は custom domain の前段で認証します。
別の公開 URL が有効なままだと、Access を通らずに閲覧できる経路が残ります。

Web アプリとドキュメントの Wrangler 設定では、次の値を無効にします。

```json
"workers_dev": false,
"preview_urls": false
```

対象ファイル:

- `apps/web/wrangler.jsonc`
- `apps/docs/wrangler.jsonc`

この変更は、次回の Worker デプロイで Cloudflare 側に反映されます。

## Cloudflare Access の設定

Cloudflare Dashboard で次の application を作成します。

1. `Zero Trust` から `Access controls`、`Applications` を開く。
2. `Create new application` を選ぶ。
3. `Self-hosted and private` を選ぶ。
4. public hostname に対象 URL を設定する。
5. 許可 policy を作成する。
6. Identity provider は Playwright レポートと同じものを使う。
7. `Bypass` policy は追加しない。
8. 保存後、未認証アクセスが Access の認証画面へ進むことを確認する。

推奨 policy:

| 項目             | Web アプリ                                   | ドキュメント                                  |
| ---------------- | -------------------------------------------- | --------------------------------------------- |
| Policy 名        | `Reserve App Web Development - Allow yusuke` | `Reserve App Docs Development - Allow yusuke` |
| Action           | `Allow`                                      | `Allow`                                       |
| Include          | `Emails`                                     | `Emails`                                      |
| 許可メール       | `yusuke.kusi1028@gmail.com`                  | `yusuke.kusi1028@gmail.com`                   |
| Session duration | Playwright レポートと同じ                    | Playwright レポートと同じ                     |

既存の Playwright レポート用 policy は名前がレポート専用です。
Web アプリとドキュメントでは、条件だけを同じにして別名の policy を作ります。

## API で設定する場合

API で作成する場合は、Cloudflare API token に次の権限が必要です。

- Account: `Access: Apps and Policies Write`

この権限を持つ token を `CLOUDFLARE_API_TOKEN` に設定してから、Zero Trust Access application API を使います。
対象 account は次の値です。

```text
d8ee18029fb3e06794971d45b9c4a67d
```

Wrangler の通常 OAuth token は Worker デプロイ用です。
Access application を作る権限が含まれない場合があります。

## 確認

未認証の端末から確認します。

```bash
curl -I -sS https://web.wakureserve.com/
curl -I -sS https://docs.wakureserve.com/
```

期待結果:

- `200 OK` ではなく、Cloudflare Access の認証画面へ進む応答になる。
- ブラウザでは Access のログイン画面が表示される。
- 許可メールでログイン後、Web アプリとドキュメントを閲覧できる。

Access 制限後のデプロイ確認では、Web アプリとドキュメントの未認証 `curl` が `200 OK` でないことを正常として扱います。
API の疎通確認は、引き続き `https://api.wakureserve.com/api/health` の `200 OK` を確認します。
