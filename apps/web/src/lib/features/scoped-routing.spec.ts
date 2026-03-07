import { describe, expect, it } from 'vitest';
import {
	buildScopedPath,
	getRoutePathFromUrlPath,
	replacePortalPathWithScopedContext,
	splitScopedPath
} from './scoped-routing';

describe('scoped-routing', () => {
	it('extracts unscoped portal path from scoped URL path', () => {
		expect(getRoutePathFromUrlPath('/org-a/room-b/admin/schedules/slots')).toBe(
			'/admin/schedules/slots'
		);
		expect(getRoutePathFromUrlPath('/org-a/room-b/events/slot-1')).toBe('/events/slot-1');
		expect(getRoutePathFromUrlPath('/login/admin')).toBe('/login/admin');
	});

	it('replaces legacy portal path with scoped context', () => {
		expect(
			replacePortalPathWithScopedContext('/admin/classrooms?tab=list', {
				orgSlug: 'org-a',
				classroomSlug: 'room-b'
			})
		).toBe('/org-a/room-b/admin/classrooms?tab=list');
	});

	it('replaces existing scoped context while preserving subpath and query', () => {
		expect(
			replacePortalPathWithScopedContext('/org-a/room-a/admin/schedules/slots?month=2026-03', {
				orgSlug: 'org-a',
				classroomSlug: 'room-b'
			})
		).toBe('/org-a/room-b/admin/schedules/slots?month=2026-03');
	});

	it('keeps already matching scoped portal paths unchanged', () => {
		expect(
			replacePortalPathWithScopedContext('/org-a/room-b/admin/dashboard', {
				orgSlug: 'org-a',
				classroomSlug: 'room-b'
			})
		).toBe('/org-a/room-b/admin/dashboard');
	});

	it('builds scoped paths and splits them back into context and remainder', () => {
		const scopedPath = buildScopedPath(
			{
				orgSlug: 'org-a',
				classroomSlug: 'room-b'
			},
			'/participant/bookings'
		);

		expect(scopedPath).toBe('/org-a/room-b/participant/bookings');
		expect(splitScopedPath(scopedPath)).toEqual({
			context: { orgSlug: 'org-a', classroomSlug: 'room-b' },
			remainderPath: '/participant/bookings'
		});
	});
});
