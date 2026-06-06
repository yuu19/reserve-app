import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SafeRichText from './SafeRichText.svelte';

describe('SafeRichText.svelte コンポーネント', () => {
	it('plain text は通常テキストとして改行を維持する', async () => {
		const rendered = render(SafeRichText, {
			description: '1行目\n2行目',
			descriptionFormat: 'plain_text'
		});

		await expect.element(page.getByText('1行目\n2行目')).toBeInTheDocument();
		expect(rendered.container.querySelector('strong')).toBeNull();
	});

	it('limited HTML は安全な要素とリンク属性だけを表示する', async () => {
		const rendered = render(SafeRichText, {
			description:
				'<p>説明<strong>強調</strong><script>alert(1)</script><a href="https://example.com/path">公式</a><a href="javascript:alert(1)">危険</a></p>',
			descriptionFormat: 'limited_html'
		});

		await expect.element(page.getByText('説明')).toBeInTheDocument();
		expect(rendered.container.querySelector('script')).toBeNull();
		expect(rendered.container.querySelector('strong')?.textContent).toBe('強調');
		const link = page.getByRole('link', { name: '公式' });
		await expect.element(link).toHaveAttribute('href', 'https://example.com/path');
		await expect.element(link).toHaveAttribute('target', '_blank');
		await expect.element(link).toHaveAttribute('rel', 'nofollow noopener noreferrer');
		expect(rendered.container.querySelector('a[href^="javascript:"]')).toBeNull();
	});

	it('空の場合は指定された emptyLabel を表示する', async () => {
		render(SafeRichText, {
			description: '<p><br></p>',
			descriptionFormat: 'limited_html',
			emptyLabel: '-'
		});

		await expect.element(page.getByText('-')).toBeInTheDocument();
	});
});
