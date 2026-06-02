export type PricingPlanName = 'Free' | 'Premium';

export type PricingManualLink = {
	label: string;
	href: string;
	status: 'published' | 'preparing';
};

export type PricingFeature = {
	label: string;
	manualLinks: readonly PricingManualLink[];
};

export type PricingPlan = {
	name: PricingPlanName;
	price: string;
	secondaryPrice?: string;
	trialLabel?: string;
	description: string;
	recommended?: boolean;
	highlights: readonly PricingFeature[];
	ctaLabel: string;
	ctaVariant: 'default' | 'outline';
};

export type PricingComparisonRow = {
	feature: PricingFeature;
	free: string;
	premium: string;
};

export type PricingComparisonGroup = {
	title: string;
	rows: readonly PricingComparisonRow[];
};

const docsManualBaseUrl = 'https://docs.wakureserve.com/manuals';
const manualHref = (path: `/${string}`) => `${docsManualBaseUrl}${path}`;
const manualLink = (
	label: string,
	path: `/${string}`,
	status: PricingManualLink['status']
): PricingManualLink => ({
	label,
	href: manualHref(path),
	status
});
const feature = (label: string, manualLinks: readonly PricingManualLink[]): PricingFeature => ({
	label,
	manualLinks
});

const gettingStartedManual = manualLink('初回セットアップ', '/admin/getting-started', 'published');
const oneTimeSlotsManual = manualLink('単発予約枠', '/admin/one-time-slots', 'preparing');
const recurringSchedulesManual = manualLink(
	'定期スケジュール',
	'/admin/recurring-schedules',
	'preparing'
);
const organizationAndStoreManual = manualLink(
	'組織と店舗管理',
	'/admin/organization-and-store',
	'preparing'
);
const adminInvitationsManual = manualLink('スタッフ招待', '/admin/admin-invitations', 'preparing');
const participantsAndTicketsManual = manualLink(
	'参加者管理と回数券',
	'/admin/participants-and-tickets',
	'preparing'
);
const contractsAndPremiumManual = manualLink(
	'契約と Premium',
	'/admin/contracts-and-premium',
	'published'
);

export const freePricingPlan = {
	name: 'Free',
	price: '¥0 / 月',
	description: '小規模運用を始めるための基本機能です。',
	highlights: [
		feature('1組織・1店舗での基本運用', [gettingStartedManual]),
		feature('単発予約枠の公開と受付', [oneTimeSlotsManual]),
		feature('基本的な参加者管理', [participantsAndTicketsManual])
	],
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
		feature('複数店舗・複数拠点の管理', [organizationAndStoreManual]),
		feature('スタッフ招待と権限管理', [adminInvitationsManual]),
		feature('定期スケジュール運用', [recurringSchedulesManual]),
		feature('承認制予約フロー', [oneTimeSlotsManual]),
		feature('回数券・月額課金などの継続運用', [participantsAndTicketsManual]),
		feature('契約管理と分析機能', [contractsAndPremiumManual])
	],
	ctaLabel: '契約画面で確認',
	ctaVariant: 'default'
} satisfies PricingPlan;

export const pricingPlans: readonly PricingPlan[] = [freePricingPlan, premiumPricingPlan];

export const pricingComparisonGroups = [
	{
		title: '予約受付・管理',
		rows: [
			{
				feature: feature('予約受付', [oneTimeSlotsManual, recurringSchedulesManual]),
				free: '単発予約枠の公開と受付',
				premium: '単発予約枠と定期スケジュール運用'
			}
		]
	},
	{
		title: '店舗・スタッフ運用',
		rows: [
			{
				feature: feature('店舗管理', [organizationAndStoreManual]),
				free: '1組織・1店舗',
				premium: '複数店舗・複数拠点'
			},
			{
				feature: feature('スタッフ権限', [adminInvitationsManual]),
				free: '組織オーナー中心',
				premium: 'スタッフ招待と権限管理'
			}
		]
	},
	{
		title: '参加者・継続運用',
		rows: [
			{
				feature: feature('参加者管理', [participantsAndTicketsManual]),
				free: '基本的な参加者管理',
				premium: '招待、承認、継続運用の管理'
			},
			{
				feature: feature('継続運用', [participantsAndTicketsManual]),
				free: '基本運用',
				premium: '回数券・月額課金などの継続運用'
			}
		]
	},
	{
		title: '契約・分析',
		rows: [
			{
				feature: feature('契約管理', [contractsAndPremiumManual]),
				free: '契約状態の確認',
				premium: '契約管理と分析機能'
			}
		]
	}
] satisfies readonly PricingComparisonGroup[];

export const pricingComparisonRows: PricingComparisonRow[] = pricingComparisonGroups.flatMap(
	(group) => group.rows
);

export const pricingNotes = [
	'表示価格以外に、インターネット接続料金や通信料金は利用者負担です。',
	'Premium 契約、支払い方法の登録、請求管理、解約はログイン後の契約画面と Stripe Checkout または Customer Portal で扱います。',
	'7日間トライアルは組織単位で提供され、利用済みの場合は新しいトライアルを重ねて開始できません。',
	'店舗が提供する予約サービス、イベント、回数券、現地決済、銀行振込は各店舗の取引です。'
] as const;
