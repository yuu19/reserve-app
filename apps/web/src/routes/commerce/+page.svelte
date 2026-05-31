<script lang="ts">
	import LegalPageShell from '$lib/components/legal/LegalPageShell.svelte';

	const title = '特定商取引法に基づく表記';
	const description =
		'WakuReserve の Premium 契約に関する販売条件、支払方法、提供時期、解約方法を表示します。';
	const updatedAt = '2026年5月31日';
	const sectionClass = 'rounded-md border border-border/80 bg-card p-5 shadow-sm';
	const headingClass = 'text-lg font-bold text-foreground';
	const paragraphClass = 'mt-3 text-sm leading-relaxed text-secondary-foreground';
	const tableClass = 'w-full min-w-[640px] text-sm';

	const rows = [
		{ label: '販売事業者', value: 'TODO: 正式な事業者名に差し替え' },
		{ label: '運営責任者', value: 'TODO: 正式な責任者名に差し替え' },
		{ label: '所在地', value: 'TODO: 正式な所在地に差し替え' },
		{ label: '電話番号', value: 'TODO: 確実に連絡できる電話番号に差し替え' },
		{ label: 'メールアドレス', value: 'TODO: 正式な問い合わせメールアドレスに差し替え' },
		{
			label: '販売価格',
			value:
				'Premium 月額 1,500円、年額 15,800円。表示価格以外にインターネット接続料金、通信料金等は利用者負担です。'
		},
		{
			label: '支払方法',
			value:
				'Stripe Checkout または Stripe Customer Portal 経由のカード等、Stripe が提供する支払方法。'
		},
		{
			label: '支払時期',
			value:
				'Checkout または Customer Portal での申込、更新、請求周期に従い、Stripe が決済処理を行います。'
		},
		{
			label: '役務の提供時期',
			value: '決済完了、契約状態の反映、またはトライアル開始後、Premium 機能を利用できます。'
		},
		{
			label: '解約方法',
			value:
				'組織 owner が Customer Portal から解約します。解約後の利用可否は契約状態と請求周期に従います。'
		},
		{
			label: '返品、キャンセル',
			value:
				'SaaS の性質上、提供開始後の返品はありません。解約は Customer Portal から行ってください。法令上必要な場合を除き、既に発生した利用料金は返金しません。'
		},
		{
			label: '動作環境',
			value: '最新版の主要ブラウザとインターネット接続環境が必要です。'
		}
	];
</script>

<LegalPageShell {title} {description} {updatedAt}>
	<section class={sectionClass} aria-labelledby="draft-heading">
		<h2 id="draft-heading" class={headingClass}>公開前差し替え事項</h2>
		<p class={paragraphClass}>
			事業者名、責任者、所在地、電話番号、メールアドレスは TODO として配置しています。
			正式公開前に、実際の販売主体情報へ差し替えてください。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="commerce-heading">
		<h2 id="commerce-heading" class={headingClass}>販売条件</h2>
		<div class="mt-4 overflow-x-auto rounded-md border border-border/80">
			<table class={tableClass}>
				<tbody>
					{#each rows as row (row.label)}
						<tr class="border-t border-border/70 first:border-t-0">
							<th
								scope="row"
								class="w-48 bg-secondary px-3 py-3 text-left align-top font-medium text-foreground"
							>
								{row.label}
							</th>
							<td class="px-3 py-3 align-top leading-relaxed text-secondary-foreground">
								{row.value}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class={sectionClass} aria-labelledby="scope-heading">
		<h2 id="scope-heading" class={headingClass}>対象となる取引</h2>
		<p class={paragraphClass}>
			本表記は、WakuReserve が提供する予約管理 SaaS の Premium 契約のみを対象とします。
			店舗が提供する予約サービス、レッスン、イベント、回数券、現地決済、銀行振込は各店舗の取引であり、
			本表記の販売主体には含まれません。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="stripe-heading">
		<h2 id="stripe-heading" class={headingClass}>Stripe 連携</h2>
		<p class={paragraphClass}>
			Premium 契約の申込、支払い方法の登録、請求管理、解約は Stripe Checkout または Customer Portal
			で行います。 WakuReserve はカード番号、支払い方法の詳細、Stripe raw payload を保存しません。
		</p>
	</section>
</LegalPageShell>
