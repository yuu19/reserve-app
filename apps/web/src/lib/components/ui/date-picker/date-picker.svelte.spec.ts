import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DatePicker from './date-picker.svelte';

describe('date-picker.svelte', () => {
	it('shows required mark in label and does not show always-on helper', async () => {
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

	it('applies full width class to popover trigger', async () => {
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
