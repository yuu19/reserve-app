const LAST_USED_ORGANIZATION_STORAGE_KEY = 'reserve-app:last-used-organization-id';

const isBrowser = (): boolean => typeof window !== 'undefined';

export const readLastUsedOrganizationId = (): string | null => {
	if (!isBrowser()) {
		return null;
	}
	try {
		const value = window.localStorage.getItem(LAST_USED_ORGANIZATION_STORAGE_KEY);
		if (!value || value.trim().length === 0) {
			return null;
		}
		return value;
	} catch {
		return null;
	}
};

export const writeLastUsedOrganizationId = (organizationId: string | null) => {
	if (!isBrowser()) {
		return;
	}
	try {
		if (!organizationId) {
			window.localStorage.removeItem(LAST_USED_ORGANIZATION_STORAGE_KEY);
			return;
		}
		window.localStorage.setItem(LAST_USED_ORGANIZATION_STORAGE_KEY, organizationId);
	} catch {
		// localStorage の制限環境では永続化をスキップする
	}
};
