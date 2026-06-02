export type PricingPlanName = 'Free' | 'Premium';

export type PricingPlan = {
	name: PricingPlanName;
	price: string;
	secondaryPrice?: string;
	trialLabel?: string;
	description: string;
	recommended?: boolean;
	highlights: readonly string[];
	ctaLabel: string;
	ctaVariant: 'default' | 'outline';
};

export type PricingComparisonRow = {
	feature: string;
	free: string;
	premium: string;
};

export const freePricingPlan = {
	name: 'Free',
	price: '¥0 / 月',
	description: '小規模運用を始めるための基本機能です。',
	highlights: ['1組織・1店舗での基本運用', '単発予約枠の公開と受付', '基本的な参加者管理'],
	ctaLabel: '無料で始める',
	ctaVariant: 'outline'
} satisfies PricingPlan;

export const premiumPricingPlan = {
	name: 'Premium',
	price: '月額 1,500円',
	secondaryPrice: '年額 15,800円',
	trialLabel: '7日間トライアル',
	description: '複数店舗、スタッフ招待、定期スケジュールまで運用したい組織向けです。',
	recommended: true,
	highlights: [
		'複数店舗・複数拠点の管理',
		'スタッフ招待と権限管理',
		'定期スケジュール運用',
		'承認制予約フロー',
		'回数券・月額課金などの継続運用',
		'契約管理と分析機能'
	],
	ctaLabel: '契約画面で確認',
	ctaVariant: 'default'
} satisfies PricingPlan;

export const pricingPlans: readonly PricingPlan[] = [freePricingPlan, premiumPricingPlan];

export const pricingComparisonRows: PricingComparisonRow[] = [
	{
		feature: '予約受付',
		free: '単発予約枠の公開と受付',
		premium: '単発予約枠と定期スケジュール運用'
	},
	{
		feature: '店舗管理',
		free: '1組織・1店舗',
		premium: '複数店舗・複数拠点'
	},
	{
		feature: 'スタッフ権限',
		free: '組織オーナー中心',
		premium: 'スタッフ招待と権限管理'
	},
	{
		feature: '参加者管理',
		free: '基本的な参加者管理',
		premium: '招待、承認、継続運用の管理'
	},
	{
		feature: '継続運用',
		free: '基本運用',
		premium: '回数券・月額課金などの継続運用'
	},
	{
		feature: '契約管理',
		free: '契約状態の確認',
		premium: '契約管理と分析機能'
	}
];

export const pricingNotes = [
	'表示価格以外に、インターネット接続料金や通信料金は利用者負担です。',
	'Premium 契約、支払い方法の登録、請求管理、解約はログイン後の契約画面と Stripe Checkout または Customer Portal で扱います。',
	'7日間トライアルは組織単位で提供され、利用済みの場合は新しいトライアルを重ねて開始できません。',
	'店舗が提供する予約サービス、イベント、回数券、現地決済、銀行振込は各店舗の取引です。'
] as const;
