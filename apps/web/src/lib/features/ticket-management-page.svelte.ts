import { getTicketManagementPageData } from '$lib/remote/ticket-management-page.remote';
import { readWindowScopedRouteContext } from './scoped-routing';

export const loadTicketManagementPageData = async () => {
	const context = readWindowScopedRouteContext();
	if (!context) {
		throw new Error('URL に組織/店舗コンテキストがありません。');
	}
	return getTicketManagementPageData({
		orgSlug: context.orgSlug,
		storeSlug: context.storeSlug
	});
};
