import type { OrganizationBillingPayload } from '$lib/rpc-client';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export type OrganizationPremiumEntitlementReason =
	| 'organization_plan_is_free'
	| 'premium_trial_active'
	| 'premium_trial_active_with_payment_method_registered'
	| 'premium_trial_missing_end'
	| 'premium_trial_expired'
	| 'premium_paid_active'
	| 'premium_paid_grace_state'
	| 'premium_paid_state_unexpected';

export type OrganizationPremiumEntitlementState = 'free_only' | 'premium_enabled';

export type OrganizationPremiumRestrictionPayload = {
	message: 'Organization premium plan is required for this feature.';
	code: 'organization_premium_required';
	source: 'application_billing_state';
	reason: OrganizationPremiumEntitlementReason;
	entitlementState: OrganizationPremiumEntitlementState;
	planState: OrganizationBillingPayload['planState'];
	trialEndsAt: string | null;
};

export type PremiumRestrictionNoticeModel = {
	title: string;
	description: string;
	currentBillingContext: string;
	assistiveSummary: string;
	ownerGuidance: string | null;
	readOnlyGuidance: string;
	showContractsAction: boolean;
	contractsActionLabel: string;
};

export const isOrganizationPremiumRestrictionPayload = (
	value: unknown
): value is OrganizationPremiumRestrictionPayload =>
	isRecord(value) &&
	value.message === 'Organization premium plan is required for this feature.' &&
	value.code === 'organization_premium_required' &&
	value.source === 'application_billing_state' &&
	(value.reason === 'organization_plan_is_free' ||
		value.reason === 'premium_trial_active' ||
		value.reason === 'premium_trial_active_with_payment_method_registered' ||
		value.reason === 'premium_trial_missing_end' ||
		value.reason === 'premium_trial_expired' ||
		value.reason === 'premium_paid_active' ||
		value.reason === 'premium_paid_grace_state' ||
		value.reason === 'premium_paid_state_unexpected') &&
	(value.entitlementState === 'free_only' || value.entitlementState === 'premium_enabled') &&
	(value.planState === 'free' ||
		value.planState === 'premium_trial' ||
		value.planState === 'premium_paid') &&
	(typeof value.trialEndsAt === 'string' || value.trialEndsAt === null);

export const readOrganizationPremiumRestriction = (
	payload: unknown
): OrganizationPremiumRestrictionPayload | null =>
	isOrganizationPremiumRestrictionPayload(payload) ? payload : null;

const formatJaDate = (value: string | null | undefined) =>
	value ? new Date(value).toLocaleDateString('ja-JP') : null;

const resolveBillingContextLabel = (
	billing: OrganizationBillingPayload | null,
	restriction: OrganizationPremiumRestrictionPayload
) => {
	const planState = billing?.planState ?? restriction.planState;
	if (planState === 'premium_trial') {
		const trialEndsAt = formatJaDate(billing?.trialEndsAt ?? restriction.trialEndsAt);
		return trialEndsAt
			? `現在の契約状態は Premiumトライアルですが、利用条件を満たしていません。終了予定日は ${trialEndsAt} です。`
			: '現在の契約状態は Premiumトライアルですが、利用条件を満たしていません。';
	}
	if (planState === 'premium_paid') {
		return '現在の契約状態は Premiumプランですが、この機能の利用条件を満たしていません。';
	}
	return '現在の契約状態は無料プランです。';
};

const resolveRestrictionDescription = (
	featureLabel: string,
	billing: OrganizationBillingPayload | null,
	restriction: OrganizationPremiumRestrictionPayload
) => {
	switch (restriction.reason) {
		case 'premium_trial_expired': {
			const trialEndsAt = formatJaDate(billing?.trialEndsAt ?? restriction.trialEndsAt);
			return trialEndsAt
				? `${featureLabel}は Premium対象機能です。Premiumトライアルは ${trialEndsAt} に終了しており、現在は利用できません。`
				: `${featureLabel}は Premium対象機能です。Premiumトライアルが終了しており、現在は利用できません。`;
		}
		case 'premium_trial_missing_end':
			return `${featureLabel}は Premium対象機能ですが、トライアル状態の確認が完了していないため現在は利用できません。`;
		case 'premium_paid_state_unexpected':
			return `${featureLabel}は Premium対象機能ですが、契約状態の再確認が必要です。契約画面で現在の状態を確認してください。`;
		default:
			return `${featureLabel}は Premium対象機能です。現在の契約状態では利用できません。`;
	}
};

export const buildPremiumRestrictionNoticeModel = ({
	featureLabel,
	billing,
	restriction
}: {
	featureLabel: string;
	billing: OrganizationBillingPayload | null;
	restriction: OrganizationPremiumRestrictionPayload;
}): PremiumRestrictionNoticeModel => {
	const showContractsAction = Boolean(billing?.canManageBilling);
	const ownerGuidance =
		billing?.planState === 'premium_trial'
			? 'organization owner は契約画面で支払い方法登録状況と契約状態を確認できます。'
			: 'organization owner は契約画面から 7日間のPremiumトライアル開始や契約状態の確認に進めます。';
	const readOnlyGuidance =
		'契約変更と支払い設定は organization owner のみです。必要な場合は owner に契約画面の確認を依頼してください。';
	const description = resolveRestrictionDescription(featureLabel, billing, restriction);
	const currentBillingContext = resolveBillingContextLabel(billing, restriction);

	return {
		title: `${featureLabel}には Premiumプランが必要です`,
		description,
		currentBillingContext,
		assistiveSummary: `${featureLabel}は generic error ではなく Premium制限によって利用できません。${currentBillingContext}`,
		ownerGuidance: showContractsAction ? ownerGuidance : null,
		readOnlyGuidance,
		showContractsAction,
		contractsActionLabel: '契約画面を開く'
	};
};
