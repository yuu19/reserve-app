# AI agent による課金確認運用ガイド

このガイドは、課金確認を AI agent で補助するときの役割、実行順序、証跡、限界を定めます。

確認項目の正本は [決済関連動作確認チェックリスト](./billing-verification-checklist.md) です。
テストと CI の位置づけは [テスト戦略](./test-strategy.md) を参照します。

AI agent は最終判定者ではありません。
検証手順を実行し、観測した結果と証跡を整理する担当として扱います。
リリース可否は、担当者がチェックリストと証跡を確認して判断します。

Stripe secret、Webhook signing secret、カード番号、税務詳細、Stripe の raw payload は、ログ、スクリーンショット、レポートに残しません。
必要な場合は、安全な識別子、状態、時刻、実行 ID だけを記録します。

## 1. 目的

課金確認では、契約状態、支払い方法、支払い失敗、復旧、Webhook、照合、通知、owner-only 制御を確認します。
AI agent は、この確認を繰り返しやすくするために使います。

AI agent に任せる範囲は次のとおりです。

- 決められた E2E コマンドを実行する。
- 契約画面を操作し、表示差分と導線を確認する。
- read-only の CLI/API で外部サービス設定を確認する。
- スクリーンショット、ログ、実行結果を安全な形でまとめる。
- 未確認項目、外部依存、手動確認が必要な理由を分類する。

AI agent に任せない範囲は次のとおりです。

- secret やカード情報を取り扱う判断。
- production の設定変更。
- Stripe raw payload の保存。
- 税務詳細や支払い方法詳細の記録。
- リリース可否の最終判断。

## 2. 検証レイヤー

課金確認は、次の 4 レイヤーで分けて扱います。
どのレイヤーで確認したかをレポートに残します。

### Deterministic E2E

Stripe test mode と Test Clock を使って、契約状態の主要な遷移を確認します。

```bash
BILLING_E2E_ENABLED=true pnpm --filter @repo/e2e test:e2e:billing
```

このレイヤーを、契約状態遷移の自動確認の正本にします。
成功更新、支払い失敗、支払い方法の復旧、同じ Stripe event の再送は、この E2E の結果を優先します。
Billing API の Test Clock scenario だけを確認する場合は、次の dedicated spec を使います。

```bash
BILLING_E2E_ENABLED=true pnpm --filter @repo/e2e test:e2e:billing-api-clock
```

### UI agent / Webwright

契約画面で、利用者に見える表示と操作導線を確認します。
Webwright などの UI agent は、画面を操作し、スクリーンショットや操作ログを残す担当です。

主に次を確認します。

- 無料プラン、トライアル、有料契約、支払い問題の表示差分。
- owner と non-owner の操作導線の違い。
- Customer Portal、Checkout、支払い方法登録への遷移開始。
- 支払い問題や確認中表示の見え方。

UI agent は、Stripe Test Clock や Webhook replay の正本ではありません。
画面に見える結果と導線の証跡を残す用途に限定します。

### 設定確認

Cloudflare、Stripe、GitHub Actions、Resend の設定を read-only で確認します。
確認は CLI/API または管理画面の閲覧に限定します。
設定変更は、このガイドの範囲外です。

主に次を確認します。

- Cloudflare Workers の vars/secrets 名、D1 migration、scheduled trigger。
- Stripe test mode の Price、Customer Portal、Webhook endpoint。
- GitHub Actions の Stripe Billing E2E workflow と直近実行結果。
- Resend の検証用送信元と送信可能状態。

secret 値そのものは表示しません。
値の有無、対象環境、参照先、実行 ID だけを記録します。

### レポート生成

実行ごとに Markdown レポートを作成します。
レポートは、実行結果、証跡パス、未確認理由、外部依存ブロッカーをまとめます。

推奨出力先は次の形式です。

```text
reports/billing-verification/YYYY-MM-DD-<commit>.md
```

このレポートは、常に repo に commit する前提ではありません。
必要に応じて GitHub Actions artifact、PR 添付、リリース判断資料として扱います。

## 3. 実行フロー

AI agent で課金確認を行う場合は、次の順に進めます。

1. 対象 commit、対象環境、使用する agent、実行権限を確認する。
2. [決済関連動作確認チェックリスト](./billing-verification-checklist.md) から今回の対象項目を決める。
3. Deterministic E2E を実行し、終了コード、対象 spec、ログ保存先を記録する。
4. UI agent / Webwright で契約画面を確認し、スクリーンショットと操作ログを保存する。
5. read-only の範囲で外部サービス設定を確認する。
6. レポートに `pass`、`fail`、`skipped`、`manual-required` を記録する。
7. 保存禁止情報が証跡に含まれていないことを確認する。
8. 担当者がレポートとチェックリストを確認し、リリース可否を判断する。

実行前に secret が必要なコマンドを走らせる場合は、既存の環境設定を使います。
AI agent の応答やレポートに secret 値を貼り付けません。

## 4. 証跡形式

証跡は、後から同じ commit と環境を追える粒度で残します。
ただし、秘密情報や支払い詳細は残しません。

レポートには次の項目を含めます。

| 項目                   | 内容                                                           |
| ---------------------- | -------------------------------------------------------------- |
| 対象 commit            | 確認した git commit または差分の識別子                         |
| 対象環境               | local、preview、staging など                                   |
| 実行コマンド           | 実行した安全なコマンド。secret 値は書かない                    |
| AI agent 種別          | Codex、Webwright、GitHub Actions runner など                   |
| 証跡パス               | スクリーンショット、操作ログ、E2E レポート、Actions run の場所 |
| 判定                   | `pass`、`fail`、`skipped`、`manual-required`                   |
| 未確認理由             | 確認できなかった項目と理由                                     |
| 外部依存ブロッカー     | Stripe、Cloudflare、Resend、GitHub Actions などの問題          |
| 保存禁止情報の確認結果 | secret、カード番号、税務詳細、raw payload が含まれないこと     |

判定は次の意味で使います。

| 判定              | 意味                                                   |
| ----------------- | ------------------------------------------------------ |
| `pass`            | 期待結果を観測し、証跡を残した                         |
| `fail`            | 期待結果と異なる結果を観測した                         |
| `skipped`         | 今回の対象外として明示的に実行しなかった               |
| `manual-required` | 権限、外部サービス、判断要素のため手動確認が必要だった |

### レポートテンプレート

```markdown
# 課金確認レポート

| 項目               | 記録 |
| ------------------ | ---- |
| 対象 commit        |      |
| 対象環境           |      |
| 実行日時           |      |
| AI agent 種別      |      |
| 担当者             |      |
| 総合判定           |      |
| 外部依存ブロッカー |      |

## 実行結果

| レイヤー          | コマンドまたは操作 | 判定 | 証跡パス | 未確認理由 |
| ----------------- | ------------------ | ---- | -------- | ---------- |
| Deterministic E2E |                    |      |          |            |
| UI agent          |                    |      |          |            |
| 設定確認          |                    |      |          |            |

## 保存禁止情報の確認

- [ ] Stripe secret を記録していない。
- [ ] Webhook signing secret を記録していない。
- [ ] カード番号を記録していない。
- [ ] 税務詳細を記録していない。
- [ ] Stripe raw payload を記録していない。

## 未確認項目

| 項目 | 理由 | 後続確認 |
| ---- | ---- | -------- |
|      |      |          |
```

## 5. 手動確認が残る範囲

AI agent が証跡を作成しても、人間または read-only CLI/API による確認が残る項目があります。

次の項目は、担当者が確認します。

- Stripe Dashboard 上の Price、Customer Portal、Webhook endpoint の最終確認。
- Cloudflare の production secrets の存在確認。
- Resend の送信元ドメインや検証状態の確認。
- GitHub Actions の secrets 設定状況と直近失敗時の artifact 確認。
- 税務、請求、契約条件に関わる判断。
- リリース可否の最終判断。

AI agent が管理画面を操作する場合も、設定変更は行いません。
変更が必要な場合は、レポートに `manual-required` として残します。

## 6. 失敗時の扱い

失敗は、アプリの不具合と外部依存の問題を分けて記録します。

アプリ不具合として扱う例:

- 契約状態が期待と異なる。
- Premium 利用可否が契約状態と一致しない。
- owner 以外に契約操作が表示される。
- Webhook の重複処理で通知や履歴が重複する。
- 保存禁止情報が画面、ログ、レポートに含まれる。

外部依存ブロッカーとして扱う例:

- Stripe test mode や Test Clock が一時的に利用できない。
- Stripe Dashboard の設定が検証環境と一致しない。
- Cloudflare scheduled trigger や D1 migration の確認権限がない。
- Resend の検証用送信元が未設定で通知確認ができない。
- GitHub Actions の実行基盤や artifact 取得に失敗する。

`fail` の場合は、再現手順、期待結果、実際の結果、証跡パスを残します。
`manual-required` の場合は、必要な権限、確認先、後続確認者を残します。

保存禁止情報が証跡に含まれた場合は、その証跡を共有しません。
安全な情報だけで再取得し、既存の誤った証跡は担当者に削除を依頼します。
