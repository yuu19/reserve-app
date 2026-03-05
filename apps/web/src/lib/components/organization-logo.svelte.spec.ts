import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import OrganizationLogo from './organization-logo.svelte';

describe('organization-logo.svelte', () => {
	it('shows image when logo is provided', async () => {
		render(OrganizationLogo, {
			name: 'Yusuke Org',
			logo: 'https://cdn.example.com/org-logo.webp'
		});

		const image = document.querySelector(
			'img[data-slot="organization-logo-image"]'
		) as HTMLImageElement | null;
		expect(image).toBeTruthy();
		expect(image?.getAttribute('src')).toBe('https://cdn.example.com/org-logo.webp');
		expect(image?.getAttribute('alt')).toBe('Yusuke Org のロゴ');
	});

	it('shows fallback icon when logo is not provided', async () => {
		render(OrganizationLogo, {
			name: 'No Logo Org',
			logo: null
		});

		expect(document.querySelector('[data-slot="organization-logo-fallback"]')).toBeTruthy();
		expect(document.querySelector('[data-slot="organization-logo-image"]')).toBeNull();
	});

	it('falls back to icon when image load fails', async () => {
		render(OrganizationLogo, {
			name: 'Broken Logo Org',
			logo: 'https://cdn.example.com/broken.webp'
		});

		const image = document.querySelector(
			'img[data-slot="organization-logo-image"]'
		) as HTMLImageElement | null;
		expect(image).toBeTruthy();
		image?.dispatchEvent(new Event('error'));

		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="organization-logo-fallback"]')).toBeTruthy();
		});
	});
});
