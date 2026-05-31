<script lang="ts">
	import LegalPageShell from '$lib/components/legal/LegalPageShell.svelte';

	const title = '利用規約';
	const description =
		'WakuReserve の予約管理 SaaS、公開予約ページ、Premium 契約、AI サポートの利用条件を定めます。';
	const updatedAt = '2026年5月31日';
	const sectionClass = 'rounded-md border border-border/80 bg-card p-5 shadow-sm';
	const headingClass = 'text-lg font-bold text-foreground';
	const paragraphClass = 'mt-3 text-sm leading-relaxed text-secondary-foreground';
	const listClass =
		'mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-secondary-foreground';
</script>

<LegalPageShell {title} {description} {updatedAt}>
	<section class={sectionClass} aria-labelledby="scope-heading">
		<h2 id="scope-heading" class={headingClass}>第1条 適用</h2>
		<p class={paragraphClass}>
			本規約は、WakuReserve が提供する予約管理 SaaS、公開予約ページ、管理者ポータル、
			予約者ポータル、Premium 契約、AI サポートその他関連機能の利用に適用されます。
			店舗が予約者に提供するレッスン、イベント、役務、回数券、現地決済、銀行振込は各店舗の取引であり、
			WakuReserve の SaaS 課金とは区別されます。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="account-heading">
		<h2 id="account-heading" class={headingClass}>第2条 アカウントと利用者の責任</h2>
		<ul class={listClass}>
			<li>利用者は、正確な情報でアカウントを作成し、認証情報を適切に管理します。</li>
			<li>
				管理者は、組織、店舗、サービス、予約枠、参加者、招待、通知先、契約状態の管理に責任を負います。
			</li>
			<li>
				予約者は、公開予約ページまたは予約者ポータルから行う予約、キャンセル、招待対応の内容を確認して利用します。
			</li>
		</ul>
	</section>

	<section class={sectionClass} aria-labelledby="organization-heading">
		<h2 id="organization-heading" class={headingClass}>第3条 組織、店舗、権限</h2>
		<p class={paragraphClass}>
			WakuReserve は、組織と店舗を単位として予約運用を管理します。組織 owner、管理者、店舗スタッフ、
			参加者などの権限は、サービス内の設定と招待状態に基づいて判定されます。利用者は、自身に付与された権限の範囲でのみ操作できます。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="booking-heading">
		<h2 id="booking-heading" class={headingClass}>第4条 公開予約、予約変更、キャンセル</h2>
		<ul class={listClass}>
			<li>
				公開予約ページでは、店舗が公開したサービス、予約枠、残席、受付状態などを予約者に表示します。
			</li>
			<li>
				予約の承認、却下、キャンセル、受付停止、通知内容は、店舗の設定と運用判断に基づきます。
			</li>
			<li>
				予約者は、予約内容、日時、店舗が示すキャンセル条件を確認したうえで予約またはキャンセルを行います。
			</li>
		</ul>
	</section>

	<section class={sectionClass} aria-labelledby="ticket-heading">
		<h2 id="ticket-heading" class={headingClass}>第5条 回数券と店舗取引</h2>
		<p class={paragraphClass}>
			回数券購入申請は、店舗が現地決済または銀行振込などで入金確認し、WakuReserve
			上で承認するための運用フローです。
			回数券の販売主体、価格、支払方法、返金、利用条件は各店舗が定めます。WakuReserve の Premium
			契約とは別の取引です。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="invitation-heading">
		<h2 id="invitation-heading" class={headingClass}>第6条 招待と通知</h2>
		<p class={paragraphClass}>
			管理者招待、店舗招待、参加者招待、予約通知、リマインド通知は、店舗または組織の設定に基づいて送信されます。
			利用者は、招待先や通知先の入力内容を確認し、第三者のメールアドレスを扱う場合は適法かつ適切な権限に基づいて登録します。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="premium-heading">
		<h2 id="premium-heading" class={headingClass}>第7条 Premium 契約</h2>
		<ul class={listClass}>
			<li>Premium は、組織単位で提供される有料プランです。</li>
			<li>
				月額 1,500円、年額 15,800円のプランを Stripe Checkout または Customer Portal
				経由で扱います。
			</li>
			<li>契約開始、支払い方法登録、解約、請求状況の確認は、原則として組織 owner が行います。</li>
			<li>
				支払い遅延、未払い、決済未完了、未登録の Stripe price などが検出された場合、Premium
				機能を制限することがあります。
			</li>
		</ul>
	</section>

	<section class={sectionClass} aria-labelledby="ai-heading">
		<h2 id="ai-heading" class={headingClass}>第8条 AI サポート</h2>
		<p class={paragraphClass}>
			AI チャットは予約運用、契約状態、公開ページ、マニュアルに関する案内機能です。
			予約作成、予約キャンセル、請求変更、参加者登録、回数券付与などの操作を代行しません。 AI
			の回答は補助的な情報であり、最終的な操作と判断は利用者が管理画面で確認して行います。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="prohibited-heading">
		<h2 id="prohibited-heading" class={headingClass}>第9条 禁止事項</h2>
		<ul class={listClass}>
			<li>虚偽、不正確、第三者の権利を侵害する情報を登録する行為</li>
			<li>不正アクセス、認証回避、過度なリクエスト、システムの安定性を損なう行為</li>
			<li>法令、公序良俗、店舗または予約者の利益に反する運用</li>
			<li>WakuReserve、店舗、他の利用者、外部サービスの信用を害する行為</li>
		</ul>
	</section>

	<section class={sectionClass} aria-labelledby="disclaimer-heading">
		<h2 id="disclaimer-heading" class={headingClass}>第10条 免責、停止、変更</h2>
		<p class={paragraphClass}>
			WakuReserve は、合理的な範囲でサービスの安定運用に努めます。ただし、外部サービス、通信環境、
			店舗の設定、利用者の入力内容、不可抗力に起因する損害について、法令で認められる範囲で責任を負いません。
			保守、障害対応、セキュリティ対応、機能改善のため、サービス内容を変更または一時停止することがあります。
		</p>
	</section>

	<section class={sectionClass} aria-labelledby="law-heading">
		<h2 id="law-heading" class={headingClass}>第11条 準拠法、協議、問い合わせ</h2>
		<p class={paragraphClass}>
			本規約は日本法に準拠します。本規約またはサービス利用に関して疑義が生じた場合、利用者と
			WakuReserve は誠実に協議します。 問い合わせ先は、公開前に正式な連絡先へ差し替えます。
		</p>
	</section>
</LegalPageShell>
