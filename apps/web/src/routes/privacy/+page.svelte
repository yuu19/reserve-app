<script lang="ts">
	import LegalPageShell from '$lib/components/legal/LegalPageShell.svelte';

	const title = 'プライバシーポリシー';
	const description =
		'WakuReserve が取得する情報、利用目的、外部サービス、保持期間、利用者の問い合わせ方法を説明します。';
	const updatedAt = '2026年5月31日';
	const sectionClass = 'rounded-md border border-border/80 bg-card p-5 shadow-sm';
	const headingClass = 'text-lg font-bold text-foreground';
	const paragraphClass = 'mt-3 text-sm leading-relaxed text-secondary-foreground';
	const listClass =
		'mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-secondary-foreground';
	const tableClass = 'w-full min-w-[640px] text-sm';
</script>

<LegalPageShell {title} {description} {updatedAt}>
	<section class={sectionClass} aria-labelledby="operator-heading">
		<h2 id="operator-heading" class={headingClass}>1. 運営者と対象範囲</h2>
		<p class={paragraphClass}>
			本ポリシーは、WakuReserve が提供する予約管理 SaaS、公開予約ページ、管理者ポータル、
			予約者ポータル、Premium 契約、AI
			サポートに適用されます。店舗が独自に取得または管理する予約サービス、
			現地決済、銀行振込、回数券販売に関する情報の取扱いは、各店舗の責任範囲となります。
		</p>
		<p class={paragraphClass}>運営者情報と問い合わせ先は、正式公開前に TODO から差し替えます。</p>
	</section>

	<section class={sectionClass} aria-labelledby="data-heading">
		<h2 id="data-heading" class={headingClass}>2. 取得する情報</h2>
		<div class="mt-4 overflow-x-auto rounded-md border border-border/80">
			<table class={tableClass}>
				<thead class="bg-secondary text-muted-foreground">
					<tr>
						<th scope="col" class="px-3 py-2 text-left font-medium">分類</th>
						<th scope="col" class="px-3 py-2 text-left font-medium">内容</th>
					</tr>
				</thead>
				<tbody>
					<tr class="border-t border-border/70">
						<th scope="row" class="px-3 py-2 text-left font-medium text-foreground">
							アカウント、セッション
						</th>
						<td class="px-3 py-2 text-secondary-foreground">
							氏名、メールアドレス、ログイン状態、認証プロバイダー、セッション識別子
						</td>
					</tr>
					<tr class="border-t border-border/70">
						<th scope="row" class="px-3 py-2 text-left font-medium text-foreground">
							組織、店舗、権限
						</th>
						<td class="px-3 py-2 text-secondary-foreground">
							組織名、店舗名、公開 URL 用 slug、ロゴ画像、管理者・スタッフ・参加者の権限情報
						</td>
					</tr>
					<tr class="border-t border-border/70">
						<th scope="row" class="px-3 py-2 text-left font-medium text-foreground">
							公開予約、予約者情報
						</th>
						<td class="px-3 py-2 text-secondary-foreground">
							サービス、予約枠、予約状態、予約者名、メールアドレス、キャンセルや受付運用の履歴
						</td>
					</tr>
					<tr class="border-t border-border/70">
						<th scope="row" class="px-3 py-2 text-left font-medium text-foreground">
							招待、通知
						</th>
						<td class="px-3 py-2 text-secondary-foreground">
							招待先メールアドレス、招待状態、通知先、通知送信結果、リマインド設定
						</td>
					</tr>
					<tr class="border-t border-border/70">
						<th scope="row" class="px-3 py-2 text-left font-medium text-foreground"> 課金状態 </th>
						<td class="px-3 py-2 text-secondary-foreground">
							Premium 契約状態、Stripe customer・subscription・price 参照
							ID、支払い状態、請求イベントの要約
						</td>
					</tr>
					<tr class="border-t border-border/70">
						<th scope="row" class="px-3 py-2 text-left font-medium text-foreground">
							AI 会話、フィードバック
						</th>
						<td class="px-3 py-2 text-secondary-foreground">
							質問、回答、根拠参照、モデル利用メタデータ、評価、任意コメント、利用回数
						</td>
					</tr>
					<tr class="border-t border-border/70">
						<th scope="row" class="px-3 py-2 text-left font-medium text-foreground">
							画像、ログ
						</th>
						<td class="px-3 py-2 text-secondary-foreground">
							店舗ロゴ等の画像、アクセスログ、操作ログ、エラー情報、セキュリティ監査に必要な記録
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<section class={sectionClass} aria-labelledby="purpose-heading">
		<h2 id="purpose-heading" class={headingClass}>3. 利用目的</h2>
		<ul class={listClass}>
			<li>アカウント認証、セッション管理、権限判定、組織と店舗の切り替えを行うため</li>
			<li>予約枠の公開、予約受付、承認、却下、キャンセル、参加者管理を提供するため</li>
			<li>招待メール、予約通知、リマインド、運用上必要な連絡を送信するため</li>
			<li>Premium 契約、支払い状態、Customer Portal 連携、支払い失敗時の案内を管理するため</li>
			<li>AI サポートの回答生成、根拠確認、品質改善、利用制限、フィードバック集計を行うため</li>
			<li>不正利用防止、セキュリティ保全、障害調査、監査、法令対応を行うため</li>
		</ul>
	</section>

	<section class={sectionClass} aria-labelledby="payment-heading">
		<h2 id="payment-heading" class={headingClass}>4. 決済情報の取扱い</h2>
		<p class={paragraphClass}>
			Premium 契約の決済は Stripe Checkout および Customer Portal を通じて処理します。 WakuReserve
			はカード番号、支払い方法の詳細、税務詳細、Stripe raw payload を保存しません。
			契約状態を表示するために必要な Stripe customer、subscription、price 等の参照 ID
			と支払い状態の要約のみを保持します。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="external-heading">
		<h2 id="external-heading" class={headingClass}>5. 利用する外部サービス</h2>
		<ul class={listClass}>
			<li>Cloudflare: Web 配信、Workers、D1、R2、Vectorize、Workers AI、AI Gateway、ログ処理</li>
			<li>Stripe: Premium 契約、Checkout、Customer Portal、請求状態の同期</li>
			<li>Resend: 招待、予約通知、リマインド、運用メールの送信</li>
			<li>Sentry: エラー監視、障害調査、品質改善</li>
			<li>Google OIDC: Google アカウントによるログイン認証</li>
		</ul>
	</section>

	<section class={sectionClass} aria-labelledby="retention-heading">
		<h2 id="retention-heading" class={headingClass}>6. 保持期間</h2>
		<ul class={listClass}>
			<li>
				アカウント、組織、店舗、予約、招待、通知、課金状態は、サービス提供と監査に必要な期間保持します。
			</li>
			<li>AI 会話内容は 180 日を目安に匿名化します。</li>
			<li>AI の集計フィードバックは 1 年を目安に削除します。</li>
			<li>
				法令対応、紛争対応、セキュリティ調査に必要な情報は、必要な範囲で追加期間保持することがあります。
			</li>
		</ul>
	</section>

	<section class={sectionClass} aria-labelledby="sharing-heading">
		<h2 id="sharing-heading" class={headingClass}>7. 第三者提供と委託</h2>
		<p class={paragraphClass}>
			WakuReserve
			は、法令に基づく場合、本人の同意がある場合、サービス提供に必要な委託先へ処理を委託する場合を除き、
			個人情報を第三者へ提供しません。委託先には、必要な範囲の情報のみを取り扱わせます。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="rights-heading">
		<h2 id="rights-heading" class={headingClass}>8. 開示、訂正、削除、問い合わせ</h2>
		<p class={paragraphClass}>
			利用者は、法令に基づき、自己に関する個人情報の開示、訂正、利用停止、削除等を求めることができます。
			問い合わせ先は正式公開前に TODO から差し替えます。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="changes-heading">
		<h2 id="changes-heading" class={headingClass}>9. 改定</h2>
		<p class={paragraphClass}>
			WakuReserve
			は、サービス内容、法令、外部サービス、運用方針の変更に応じて本ポリシーを改定することがあります。
			重要な変更がある場合は、サービス上での掲示その他適切な方法で知らせます。
		</p>
	</section>
</LegalPageShell>
