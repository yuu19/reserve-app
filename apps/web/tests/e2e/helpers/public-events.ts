import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { expectOkJson } from './assertions';
import { backendUrl } from './env';

type PublicEventDetail = {
	remainingCount: number;
	capacity: number;
};

export const expectPublicEventCapacity = async ({
	request,
	orgSlug,
	classroomSlug,
	slotId,
	remainingCount,
	capacity
}: {
	request: APIRequestContext;
	orgSlug: string;
	classroomSlug: string;
	slotId: string;
	remainingCount: number;
	capacity: number;
}) => {
	const response = await request.get(
		`${backendUrl}/api/v1/public/orgs/${encodeURIComponent(
			orgSlug
		)}/classrooms/${encodeURIComponent(classroomSlug)}/events/${encodeURIComponent(slotId)}`
	);
	const payload = await expectOkJson<PublicEventDetail>(response, `read public event ${slotId}`);
	expect(payload).toMatchObject({ remainingCount, capacity });
};
