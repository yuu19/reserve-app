import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DatePicker from './date-picker.svelte';

describe('日付選択コンポーネント', () => {
	it('ラベルに必須マークを表示し常時表示ヘルパーは表示しない', async () => {
		render(DatePicker, {
			id: 'required-date',
			name: 'required_date',
			label: '日付',
			value: '',
			placeholder: '日付を選択',
			required: true
		});

		expect(document.body.textContent ?? '').toContain('日付*');
		expect(document.body.textContent ?? '').not.toContain('日付の選択が必要です。');
	});

	it('ポップオーバートリガーに全幅クラスを適用する', async () => {
		render(DatePicker, {
			id: 'test-date',
			name: 'test_date',
			label: '開始日',
			value: '',
			placeholder: '日付を選択'
		});

		const popoverTrigger = document.querySelector('[data-slot="popover-trigger"]');
		expect(popoverTrigger).toBeTruthy();
		expect(popoverTrigger?.className ?? '').toContain('w-full');
		expect(document.body.textContent ?? '').toContain('日付を選択');
	});
});
