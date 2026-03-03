import { describe, expect, it } from 'vitest';
import { getAdminServicesPageData } from './admin-services-page.remote';

describe('admin-services-page.remote', () => {
	it('exports admin services remote query', () => {
		expect(typeof getAdminServicesPageData).toBe('function');
	});
});
