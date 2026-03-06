import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRpc } from '$lib/rpc-client';
import { parseResponseBody } from './auth-session.svelte';
import { createBooking } from './bookings.svelte';
import { ensureParticipantSelfEnrollment, reservePublicEvent } from './events.svelte';

const mockReadWindowScopedRouteContext = vi.hoisted(() => vi.fn());

vi.mock('$lib/rpc-client', () => ({
	authRpc: {
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

vi.mock('./scoped-routing', () => ({
	readWindowScopedRouteContext: mockReadWindowScopedRouteContext
}));

describe('events.svelte', () => {
	const mockedSelfEnrollParticipantScoped = vi.mocked(authRpc.selfEnrollParticipantScoped);
	const mockedParseResponseBody = vi.mocked(parseResponseBody);
	const mockedCreateBooking = vi.mocked(createBooking);

	beforeEach(() => {
		vi.clearAllMocks();
		mockReadWindowScopedRouteContext.mockReturnValue({
			orgSlug: 'org-public',
			classroomSlug: 'main'
		});
	});

	it('calls self-enroll before booking and returns booking result', async () => {
		mockedSelfEnrollParticipantScoped.mockResolvedValueOnce(
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
			slotId: 'slot-public'
		});

		expect(mockedSelfEnrollParticipantScoped).toHaveBeenCalledWith({
			orgSlug: 'org-public',
			classroomSlug: 'main'
		});
		expect(mockedCreateBooking).toHaveBeenCalledWith('slot-public');
		expect(mockedSelfEnrollParticipantScoped.mock.invocationCallOrder[0]).toBeLessThan(
			mockedCreateBooking.mock.invocationCallOrder[0]
		);
		expect(result).toEqual({
			ok: true,
			createdParticipant: true,
			message: '予約を申し込みました。'
		});
	});

	it('does not call booking when self-enroll fails', async () => {
		mockedSelfEnrollParticipantScoped.mockResolvedValueOnce(
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

	it('returns created false when participant already exists', async () => {
		mockedSelfEnrollParticipantScoped.mockResolvedValueOnce(
			new Response(JSON.stringify({ created: false }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		mockedParseResponseBody.mockResolvedValueOnce({ created: false });

		const result = await ensureParticipantSelfEnrollment('org-public');

		expect(result).toEqual({
			ok: true,
			created: false,
			message: '参加登録は完了済みです。'
		});
	});
});
