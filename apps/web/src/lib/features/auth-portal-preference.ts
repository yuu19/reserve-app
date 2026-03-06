import type { AuthPortal } from './auth-portal';

const LAST_AUTH_PORTAL_STORAGE_KEY = 'reserve-app:last-auth-portal';

const isBrowser = (): boolean => typeof window !== 'undefined';

const isAuthPortal = (value: unknown): value is AuthPortal =>
	value === 'admin' || value === 'participant';

export const readLastAuthPortal = (): AuthPortal | null => {
	if (!isBrowser()) {
		return null;
	}

	try {
		const value = window.localStorage.getItem(LAST_AUTH_PORTAL_STORAGE_KEY);
		if (!isAuthPortal(value)) {
			return null;
		}
		return value;
	} catch {
		return null;
	}
};

export const writeLastAuthPortal = (portal: AuthPortal | null): void => {
	if (!isBrowser()) {
		return;
	}

	try {
		if (!portal) {
			window.localStorage.removeItem(LAST_AUTH_PORTAL_STORAGE_KEY);
			return;
		}
		window.localStorage.setItem(LAST_AUTH_PORTAL_STORAGE_KEY, portal);
	} catch {
		// localStorage が利用できない環境では保存をスキップする
	}
};

export const clearLastAuthPortal = (): void => {
	writeLastAuthPortal(null);
};
