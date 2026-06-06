# WYSIWYG エディタ導入案

## 位置づけ

この文書は、予約サイト作成の説明欄に WYSIWYG エディタを導入するための検討案です。
現行仕様の正本ではありません。

導入対象は、予約者に見せる説明文を読みやすくする用途に限定します。
予約者が入力する回答欄や、住所・電話番号のような構造化された項目は対象外にします。

## 結論

最初の導入対象は、予約サイト作成の「説明」だけにします。

予約サイトの説明は、店舗の特徴、参加前の注意、持ち物、外部リンクを含むことがあります。
太字、リンク、箇条書き、改行を使えると、予約者が内容を読み取りやすくなります。

同意事項の本文は第2弾の候補にします。
第1弾では実装しません。

予約フォームの回答欄は WYSIWYG 化しません。
回答欄は、テキスト、選択肢、日付、同意チェックのような型を持つ入力として保存します。
この構造を保つことで、必須チェック、選択肢検証、管理画面での回答確認が単純になります。

## 導入範囲

### 第1弾: 予約サイト作成の説明

予約サイト作成画面では、店舗ごとの公開サイトに表示する説明文を編集します。
ここに軽量な WYSIWYG エディタを導入します。

許可する装飾は、以下に限定します。

- 段落
- 改行
- 太字
- 斜体
- 箇条書き
- 番号付きリスト
- リンク

画像、動画、埋め込み、見出し、引用、区切り線、コードブロック、表、任意の文字色、任意のフォントサイズ、独自 HTML は扱いません。
予約サイトの見た目はプロダクト側のデザインシステムで制御します。

### 第2弾: 同意事項の本文

フォーム管理では、同意事項の本文だけを次の候補にします。
キャンセルポリシー、利用上の注意、外部規約リンクを読みやすくするためです。

第1弾では同意事項を変更しません。
予約サイト説明で安全化と表示が安定した後に、同じ保存形式と表示部品を使って展開します。

事前アンケートや追加質問の回答欄は対象外です。
回答欄は構造化されたフォーム項目として扱います。

### 対象外

住所、電話番号、営業時間は WYSIWYG 化しません。

住所と電話番号は、装飾よりも正確な文字列として扱うことが重要です。
営業時間は、将来的には曜日ごとの構造化入力を検討します。
当面は複数行テキストのままにします。

メイン画像も WYSIWYG エディタでは扱いません。
画像はアップロード専用の導線で扱います。
URL 手入力や本文への画像埋め込みは、表示崩れと外部画像依存を増やすため避けます。

## 現行挙動

予約サイト作成画面では、説明と営業時間を複数行テキストで入力します。
公開側では、説明と営業時間を通常のテキストとして表示し、改行だけを維持します。

管理 API は、説明を文字列として受け取ります。
現在の上限は 2000 文字です。

実装メモ:

- 予約サイト作成画面は `apps/web/src/lib/pages/public-site-create-page.svelte` です。
- 公開トップページは `apps/web/src/routes/[orgSlug]/[storeSlug]/+page.svelte` です。
- 管理 API の入力検証は `apps/backend/src/routes/auth-routes.ts` の `publicSiteSettingBodySchema` で行います。
- 公開ページ用の取得処理は `apps/backend/src/routes/public-routes.ts` で `public_site_setting` を参照します。

## 保存形式

保存形式は、既存の説明文と新しいリッチテキストを区別できる形に固定します。
説明本文に表示形式を持たせます。

```txt
public_site_setting.description
public_site_setting.description_format
```

`description_format` は次の値だけを扱います。

```txt
plain_text
limited_html
```

既存データは `plain_text` として扱います。
`plain_text` は通常テキストです。
表示時に HTML として解釈せず、文字を escape し、改行を維持します。

WYSIWYG エディタで保存した説明だけを `limited_html` とします。
`limited_html` には、サーバーでサニタイズ済みの限定 HTML だけを保存します。
保存済み HTML であっても、表示前に同じ許可方針で再サニタイズします。

初期導入では SEO 用の plain text カラムを追加しません。
検索結果や OGP 用の説明文が必要になった時点で、リッチテキストから抽出したテキストを保存するカラムを後続追加します。

## API と型

管理 API と公開 API は、説明本文と表示形式を扱います。
Web/RPC 側の型は camelCase にします。

```ts
type PublicSiteDescriptionFormat = 'plain_text' | 'limited_html';

type PublicSiteSettingPayload = {
  description: string;
  descriptionFormat: PublicSiteDescriptionFormat;
};
```

DB カラム名は `description_format` です。
Web/RPC 型と API 入出力では `descriptionFormat` を使います。

`descriptionFormat` が省略された既存レスポンスや既存保存値は、移行互換として `plain_text` とみなします。
新規保存では `descriptionFormat` を明示します。

## 文字数上限

説明文の上限は、読みやすさと安全化後のサイズを基準に固定します。

- 抽出後の plain text は最大 4000 文字にします。
- 保存する HTML は UTF-8 で最大 12000 bytes にします。

`limited_html` は、サニタイズ後に plain text を抽出して文字数を確認します。
そのうえで、保存 HTML の byte 数も確認します。
どちらかを超える場合は保存を拒否します。

`plain_text` は、本文そのものを抽出後 plain text として扱います。
改行は文字数に含めます。

## 安全化方針

公開ページに HTML を表示するため、保存前と表示前の両方で安全化します。
バックエンドの保存処理を正本にします。
クライアント側の安全化だけには依存しません。

バックエンドの第1候補は、Cloudflare Workers で動作確認できる parser ベースの sanitizer です。
実装候補は `sanitize-html` です。
`sanitize-html` は既定の許可設定をそのまま使わず、この文書の許可方針を明示して使います。
導入直前に、Workers での bundle、実行時挙動、最新のセキュリティ情報を確認します。

DOMPurify はブラウザ側プレビューの候補に留めます。
バックエンド正本として DOMPurify + jsdom は採用しません。
Cloudflare Workers では DOM 実装を追加する構成になり、サニタイズ結果が DOM 実装の品質に依存するためです。

許可する HTML は、次の範囲に限定します。

```txt
p, br, strong, em, ul, ol, li, a
```

許可する属性は、次の範囲に限定します。

```txt
a.href
a.target
a.rel
```

リンクの URL は `https:` と `mailto:` だけを許可します。
`http:`, `javascript:`, `data:`, protocol-relative URL、相対 URL は許可しません。

`https:` のリンクには、保存時または表示前のサニタイズ時に次の属性を付けます。

```html
target="_blank"
rel="nofollow noopener noreferrer"
```

`mailto:` のリンクは `href` だけを残します。
`style`、`class`、イベント属性、任意の `data-*` 属性は保存しません。

実装メモ:

- `sanitize-html` を使う場合、`allowedTags` と `allowedAttributes` を明示します。
- URL 制約では `allowedSchemes: ['https', 'mailto']` を明示します。
- protocol-relative URL を拒否するため、`allowProtocolRelative: false` を明示します。
- `a` タグの属性付与には `transformTags` を使う候補があります。
- `href` が許可されないリンクは、リンクとして保存しないか、`href` を除去します。

## 表示コンポーネント

公開ページと管理画面プレビューは、共通の表示部品を使います。
`{@html}` は `SafeRichText.svelte` に閉じ込めます。

呼び出し側は、本文と形式だけを渡します。

```svelte
<SafeRichText value={description} format={descriptionFormat} />
```

`SafeRichText.svelte` は次の責務だけを持ちます。

- `format` が `plain_text` の場合、通常テキストとして表示し、改行を維持する。
- `format` が `limited_html` の場合、サニタイズ済み HTML だけを `{@html}` で表示する。
- 未知の `format` は `plain_text` として扱う。

呼び出し側では `{@html}` を直接使いません。
公開ページ、管理画面プレビュー、管理画面の公開情報表示は同じ部品を使います。

## エディタ候補

第1候補は Tiptap です。
Svelte 向けの公式導入ガイドがあり、ヘッドレスなエディタとしてツールバーを自前で絞り込めます。

ただし、`StarterKit` をそのまま使いません。
`StarterKit` には見出し、コードブロック、引用、区切り線、下線、取り消し線など、初期導入では不要な拡張が含まれるためです。

導入時は、必要な拡張だけを明示するか、`StarterKit.configure(...)` で不要な拡張を無効化します。
最初に許可する拡張は次の範囲に限定します。

- Paragraph
- HardBreak
- Bold
- Italic
- BulletList
- OrderedList
- ListItem
- Link

最初に入れない拡張は次の通りです。

- Heading
- CodeBlock
- Blockquote
- HorizontalRule
- Image
- Table
- Color
- TextStyle
- Underline
- Strike

導入時点で、Svelte 5 と Cloudflare Workers 向けビルドに問題がないことを確認します。

参考:

- Tiptap Svelte documentation: https://tiptap.dev/docs/editor/getting-started/install/svelte
- Tiptap StarterKit documentation: https://tiptap.dev/docs/editor/extensions/functionality/starterkit
- sanitize-html documentation: https://www.npmjs.com/package/sanitize-html
- DOMPurify README: https://github.com/cure53/DOMPurify

## 画面設計

予約サイト作成画面では、説明欄を以下の構成にします。

```txt
説明
[B] [I] [箇条書き] [番号付き] [リンク]
------------------------------------------------
本文入力エリア
------------------------------------------------
```

操作に説明文を増やしすぎません。
ボタンはアイコン中心にし、ツールチップで操作名を表示します。

保存前にプレビューを右側または下部に表示します。
プレビューは公開ページと同じ表示部品を使います。

## 実装ステップ

### Step 1: 予約サイト説明だけをリッチテキスト化する

予約サイト作成画面の説明欄に、限定ツールバー付きのエディタを追加します。

保存時は、許可した HTML だけを残します。
既存の通常テキストはそのまま表示できるようにします。

対象:

- 予約サイト作成画面
- 予約サイト管理画面の公開情報表示
- 公開トップページ
- 管理 API の入力検証
- 公開 API のレスポンス
- 共通表示部品 `SafeRichText.svelte`

### Step 2: 同意事項本文へ展開する

予約サイト説明で安全化と表示が安定した後、同意事項の本文へ展開します。
第1弾の実装対象には含めません。

同意事項では、予約者がチェックする文言を明確に表示します。
過去回答の意味が変わらないように、公開版のスナップショットにも同じ形式を保持します。

### Step 3: 営業時間の構造化を別で検討する

営業時間は WYSIWYG の対象にしません。
曜日、開始時刻、終了時刻、補足文を分ける構造化入力を別途検討します。

## 受け入れ条件

管理画面では、次を確認します。

- 説明欄で太字、斜体、リンク、箇条書き、番号付きリストを入力できる。
- 保存後に再読み込みしても表示が崩れない。
- 既存の `plain_text` 説明が、改行付きで従来通り表示される。
- `description` と `descriptionFormat` が API 入出力で扱われる。
- 抽出後 plain text が 4000 文字を超える本文は保存できない。
- 保存 HTML が 12000 bytes を超える本文は保存できない。

公開ページでは、次を確認します。

- 許可した装飾だけが表示される。
- リンクに安全な属性が付く。
- 不正な HTML が実行されない。
- メイン画像、予約ページ一覧、基本情報の表示に影響しない。

セキュリティ例として、次を確認します。

- `<script>alert(1)</script>` が保存・表示されない。
- `<img src=x onerror=alert(1)>` が保存・表示されない。
- `<a href="javascript:alert(1)">` がリンクとして保存されない。
- `<a href="http://example.com">` は拒否されるか、`href` が除去される。
- `https:` のリンクには `target="_blank"` と `rel="nofollow noopener noreferrer"` が付く。
- `style` 属性と `class` 属性が保存されない。
- 貼り付けられた余計な HTML が落ちる。

API では、次を確認します。

- 既存の `plain_text` 説明を受け付ける。
- `limited_html` の説明を受け付ける。
- 許可していないタグや属性を除去する。
- `http:`, `javascript:`, `data:`, protocol-relative URL、相対 URL をリンクとして保存しない。
- 文字数上限と byte 上限を超える本文を拒否する。

## 採用しない案

### 全項目を WYSIWYG 化する

採用しません。

予約者の回答は、管理者が一覧や詳細で確認しやすい構造を保つ必要があります。
リッチテキスト回答を許可すると、必須チェック、選択肢検証、検索、CSV 出力が複雑になります。

### HTML をそのまま保存する

採用しません。

公開ページに表示される本文は、悪意ある入力や誤ったタグの影響を受けます。
保存前と表示前に、同じ許可リストで安全化します。

### バックエンド正本に DOMPurify + jsdom を使う

採用しません。

DOMPurify はブラウザ側プレビューの候補に留めます。
バックエンドでは、Cloudflare Workers で動作する parser ベースの sanitizer を使います。

### 画像を本文に埋め込む

採用しません。

予約サイトのメイン画像は、本文ではなく画像アップロード機能で扱います。
本文中の画像埋め込みは、ページの表示品質と管理導線を不安定にします。

## 固定した方針

- 第1弾は予約サイト作成の説明だけを対象にする。
- 同意事項本文は第2弾の候補にし、第1弾には含めない。
- 保存形式は `description` と `description_format` にする。
- `plain_text` は通常テキストとして escape し、改行を維持して表示する。
- `limited_html` はサーバーでサニタイズ済みの限定 HTML だけを保存する。
- SEO 用 plain text カラムは初期導入では追加しない。
- バックエンド正本に DOMPurify + jsdom は使わない。
- `sanitize-html` を第1候補にし、導入直前に Workers 動作とセキュリティ情報を確認する。
- `{@html}` は `SafeRichText.svelte` に閉じ込める。
- 抽出後 plain text は最大 4000 文字、保存 HTML は最大 12000 bytes にする。

## 後続で検討する事項

- SEO 用説明文が必要になった場合の抽出タイミングと保存先。
- 同意事項へ展開する場合の公開版スナップショット保存形式。
- 営業時間を曜日・時刻・補足文に分ける構造化入力。
