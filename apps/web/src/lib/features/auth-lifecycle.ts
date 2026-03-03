export const AUTH_SESSION_UPDATED_EVENT = 'reserve-app:auth-session-updated';

type AuthSessionUpdatedHandler = () => void;

export const emitAuthSessionUpdated = () => {
	if (typeof window === 'undefined') {
		return;
	}
	window.dispatchEvent(new CustomEvent(AUTH_SESSION_UPDATED_EVENT));
};

export const onAuthSessionUpdated = (handler: AuthSessionUpdatedHandler): (() => void) => {
	if (typeof window === 'undefined') {
		return () => {};
	}

	const listener = () => {
		handler();
	};

	window.addEventListener(AUTH_SESSION_UPDATED_EVENT, listener);
	return () => {
		window.removeEventListener(AUTH_SESSION_UPDATED_EVENT, listener);
	};
};
