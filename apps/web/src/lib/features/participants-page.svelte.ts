import { getParticipantsPageData } from '$lib/remote/participants-page.remote';
import { readWindowScopedRouteContext } from './scoped-routing';

export const loadParticipantsPageData = async () => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		throw new Error('URL に組織/店舗コンテキストがありません。');
	}
	return getParticipantsPageData({
		orgSlug: context.orgSlug,
		storeSlug: context.storeSlug
	});
};
