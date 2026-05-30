import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRpc } from '$lib/rpc-client';
import { parseResponseBody } from './auth-session.svelte';
import { createBooking } from './bookings.svelte';
import { ensureParticipantSelfEnrollment, reservePublicEvent } from './events.svelte';

vi.mock('$lib/rpc-client', () => ({
	authRpc: {
		selfEnrollParticipant: vi.fn(),
		selfEnrollParticipantScoped: vi.fn()
	}
}));

vi.mock('./auth-session.svelte', () => ({
	parseResponseBody: vi.fn(),
	toErrorMessage: (payload: unknown, fallback: string) =>
		typeof payload === 'object' &&
		payload !== null &&
		'message' in payload &&
		typeof (payload as { message?: unknown }).message === 'string'
			? ((payload as { message: string }).message ?? fallback)
			: fallback
}));

vi.mock('./bookings.svelte', () => ({
	createBooking: vi.fn()
}));

describe('イベント機能', () => {
	const mockedSelfEnrollParticipant = vi.mocked(authRpc.selfEnrollParticipant);
	const mockedSelfEnrollParticipantScoped = vi.mocked(authRpc.selfEnrollParticipantScoped);
	const mockedParseResponseBody = vi.mocked(parseResponseBody);
	const mockedCreateBooking = vi.mocked(createBooking);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('予約前に自己登録を呼び出し予約結果を返す', async () => {
		mockedSelfEnrollParticipant.mockResolvedValueOnce(
			new Response(JSON.stringify({ created: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		mockedParseResponseBody.mockResolvedValueOnce({ created: true });
		mockedCreateBooking.mockResolvedValueOnce({
			ok: true,
			message: '予約を申し込みました。'
		});

		const result = await reservePublicEvent({
			organizationId: 'org-public',
			storeId: 'store-public',
			slotId: 'slot-public'
		});

		expect(mockedSelfEnrollParticipant).toHaveBeenCalledWith({
			organizationId: 'org-public',
			storeId: 'store-public'
		});
		expect(mockedSelfEnrollParticipantScoped).not.toHaveBeenCalled();
		expect(mockedCreateBooking).toHaveBeenCalledWith('slot-public');
		expect(mockedSelfEnrollParticipant.mock.invocationCallOrder[0]).toBeLessThan(
			mockedCreateBooking.mock.invocationCallOrder[0]
		);
		expect(result).toEqual({
			ok: true,
			createdParticipant: true,
			message: '予約を申し込みました。'
		});
	});

	it('自己登録が失敗した場合は予約を呼び出さない', async () => {
		mockedSelfEnrollParticipant.mockResolvedValueOnce(
			new Response(JSON.stringify({ message: 'プロフィールを確認してください。' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			})
		);
		mockedParseResponseBody.mockResolvedValueOnce({
			message: 'プロフィールを確認してください。'
		});

		const result = await reservePublicEvent({
			organizationId: 'org-public',
			slotId: 'slot-public'
		});

		expect(mockedCreateBooking).not.toHaveBeenCalled();
		expect(result).toEqual({
			ok: false,
			createdParticipant: false,
			message: 'プロフィールを確認してください。'
		});
	});

	it('参加者がすでに存在する場合は created false を返す', async () => {
		mockedSelfEnrollParticipant.mockResolvedValueOnce(
			new Response(JSON.stringify({ created: false }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		mockedParseResponseBody.mockResolvedValueOnce({ created: false });

		const result = await ensureParticipantSelfEnrollment({ organizationId: 'org-public' });

		expect(result).toEqual({
			ok: true,
			created: false,
			message: '参加登録は完了済みです。'
		});
	});
});
