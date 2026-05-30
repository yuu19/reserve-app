import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AiSourceList from './AiSourceList.svelte';

describe('AiSourceList.svelte コンポーネント', () => {
	it('安全なソースラベルを表示し利用できない制限付きパスを抑止する', async () => {
		render(AiSourceList, {
			sources: [
				{
					sourceKind: 'docs',
					title: '予約運用マニュアル',
					sourcePath: '/manuals/bookings',
					chunkId: 'chunk-a'
				},
				{
					sourceKind: 'specs',
					title: '内部仕様',
					sourcePath: null,
					chunkId: 'chunk-b'
				}
			]
		});

		await expect.element(page.getByText('ドキュメント')).toBeInTheDocument();
		await expect.element(page.getByText('予約運用マニュアル')).toBeInTheDocument();
		await expect.element(page.getByText('/manuals/bookings')).toBeInTheDocument();
		await expect.element(page.getByText('内部仕様')).toBeInTheDocument();
		expect(document.body.textContent).toContain('仕様');
		expect(document.body.textContent).not.toContain('specs/004-ai-chatbot/spec.md');
	});

	it('表示可能な許可済みソースがない場合はフォールバックを表示する', async () => {
		render(AiSourceList, { sources: [] });

		await expect.element(page.getByText('確認できる参照元は表示できません。')).toBeInTheDocument();
	});
});
