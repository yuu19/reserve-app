import { describe, expect, it } from 'vitest';
import {
	buildBookingOperationsCsv,
	createBookingOperationsExportFilename
} from './booking-operations-export';

describe('日次運用ビュー出力', () => {
	it('予約一覧をCSVとしてエスケープして出力する', () => {
		const csv = buildBookingOperationsCsv([
			{
				reservationId: 'bk_001',
				startAt: '2026/06/15 10:00',
				endAt: '11:00',
				serviceName: '体験, レッスン',
				customerName: '山田 "太郎"',
				participantsCount: 2,
				customerPhone: '090-0000-0000',
				customerEmail: 'taro@example.com',
				note: '初回\n体験',
				sourceLabel: '公開予約',
				statusLabel: '予約確定',
				createdAt: '2026/06/01 09:00'
			}
		]);

		expect(csv).toContain('"予約番号","開始日時","終了時刻"');
		expect(csv).toContain('"体験, レッスン"');
		expect(csv).toContain('"山田 ""太郎"""');
		expect(csv).toContain('"初回\n体験"');
		expect(csv.endsWith('\r\n')).toBe(true);
	});

	it('選択日または表示期間からファイル名を作る', () => {
		expect(
			createBookingOperationsExportFilename({
				selectedDate: '2026-06-15',
				fromDate: '2026-06-01',
				toDate: '2026-06-30'
			})
		).toBe('booking-operations-2026-06-15.csv');

		expect(
			createBookingOperationsExportFilename({
				selectedDate: '',
				fromDate: '2026-06-01',
				toDate: '2026-06-30'
			})
		).toBe('booking-operations-2026-06-01_2026-06-30.csv');
	});
});
