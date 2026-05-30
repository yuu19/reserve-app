import { describe, expect, it } from 'vitest';
import { getAdminServicesPageData } from './admin-services-page.remote';

describe('管理サービスページ remote', () => {
	it('管理サービスの remote query を export する', () => {
		expect(typeof getAdminServicesPageData).toBe('function');
	});
});
