import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AUTH_SESSION_UPDATED_EVENT,
	emitAuthSessionUpdated,
	onAuthSessionUpdated
} from './auth-lifecycle';

describe('認証ライフサイクル', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('セッション変更時に認証更新イベントを dispatch する', () => {
		const dispatchEvent = vi.fn();
		vi.stubGlobal('window', {
			dispatchEvent
		});

		emitAuthSessionUpdated();

		expect(dispatchEvent).toHaveBeenCalledTimes(1);
		const [event] = dispatchEvent.mock.calls[0] as [Event];
		expect(event.type).toBe(AUTH_SESSION_UPDATED_EVENT);
	});

	it('リスナーを購読・解除する', () => {
		const addEventListener = vi.fn();
		const removeEventListener = vi.fn();
		vi.stubGlobal('window', {
			addEventListener,
			removeEventListener
		});
		const handler = vi.fn();

		const unsubscribe = onAuthSessionUpdated(handler);
		expect(addEventListener).toHaveBeenCalledWith(AUTH_SESSION_UPDATED_EVENT, expect.any(Function));

		const [, listener] = addEventListener.mock.calls[0] as [string, EventListener];
		listener(new Event(AUTH_SESSION_UPDATED_EVENT));
		expect(handler).toHaveBeenCalledTimes(1);

		unsubscribe();
		expect(removeEventListener).toHaveBeenCalledWith(AUTH_SESSION_UPDATED_EVENT, listener);
	});
});
