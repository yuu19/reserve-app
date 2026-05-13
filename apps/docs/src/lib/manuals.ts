export type ManualCategory = {
	id: string;
	title: string;
	description: string;
	plannedTopics: string[];
	items: Array<{
		href: string;
		title: string;
		summary: string;
		updatedAt: string;
		audience: string;
		featured?: boolean;
	}>;
};

export type ManualItem = ManualCategory['items'][number] & {
	categoryId: string;
	categoryTitle: string;
};

export const manualCategories: ManualCategory[] = [
	{
		id: 'guide',
		title: 'はじめに',
		description: 'WakuReserve のマニュアル構成や導入の前提を確認するための案内です。',
		plannedTopics: ['ログイン導線の整理', '用語集'],
		items: [
			{
				href: '/manuals/design-proposal',
				title: 'ユーザーマニュアル設計案',
				summary: '現在の実装をもとに、どの順番でマニュアルを整備するかを整理した設計ページです。',
				updatedAt: '2026-04-23',
				audience: 'ドキュメント担当者',
				featured: true
			}
		]
	},
	{
		id: 'common',
		title: '共通機能',
		description: 'ログイン済み利用者が共通して使う機能の案内です。',
		plannedTopics: ['アカウントとログイン', '用語集'],
		items: [
			{
				href: '/manuals/common/ai-chatbot',
				title: 'AI チャットの使い方',
				summary:
					'AI チャットに質問できる内容、根拠付き回答、権限による表示範囲、フィードバックの扱いを案内します。',
				updatedAt: '2026-05-13',
				audience: 'ログイン済み利用者',
				featured: true
			}
		]
	},
	{
		id: 'admin',
		title: '管理者向け',
		description: '教室やサービスの運用を始める管理者向けガイドです。',
		plannedTopics: ['サービス作成', '予約運用', '教室管理'],
		items: [
			{
				href: '/manuals/admin/getting-started',
				title: '初回セットアップ',
				summary: '新規登録から最初の組織作成、ダッシュボード到達までを画像付きで案内します。',
				updatedAt: '2026-04-23',
				audience: '管理者',
				featured: true
			},
			{
				href: '/manuals/admin/contracts-and-premium',
				title: '契約と Premium',
				summary:
					'現在プラン、Premium トライアル、支払い方法、請求書・領収書の確認方法を画像付きで案内します。',
				updatedAt: '2026-05-04',
				audience: 'organization owner'
			}
		]
	},
	{
		id: 'participant',
		title: '参加者向け',
		description: '予約をする参加者が迷いやすい導線を順次追加していく予定です。',
		plannedTopics: ['公開イベントから予約する', '予約の確認とキャンセル', '招待への対応'],
		items: []
	}
];

export const manualItems: ManualItem[] = manualCategories.flatMap((category) =>
	category.items.map((item) => ({
		...item,
		categoryId: category.id,
		categoryTitle: category.title
	}))
);

export const manualLookup = new Map(manualItems.map((item) => [item.href, item]));

export const featuredManuals = manualItems.filter((item) => item.featured);
