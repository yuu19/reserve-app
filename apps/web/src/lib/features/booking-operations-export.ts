export type BookingOperationsExportRow = {
	reservationId: string;
	startAt: string;
	endAt: string;
	serviceName: string;
	customerName: string;
	participantsCount: number;
	customerPhone: string;
	customerEmail: string;
	note: string;
	sourceLabel: string;
	statusLabel: string;
	createdAt: string;
};

export const bookingOperationsCsvHeaders = [
	'予約番号',
	'開始日時',
	'終了時刻',
	'サービス',
	'予約者名',
	'人数',
	'電話番号',
	'メール',
	'備考',
	'予約経路',
	'予約状態',
	'予約作成日時'
] as const;

const toCsvCell = (value: string | number): string => {
	const normalized = String(value).replace(/\r\n|\r|\n/gu, '\n');
	return `"${normalized.replace(/"/gu, '""')}"`;
};

export const buildBookingOperationsCsv = (rows: BookingOperationsExportRow[]): string => {
	const lines = [
		bookingOperationsCsvHeaders.map(toCsvCell),
		...rows.map((row) =>
			[
				row.reservationId,
				row.startAt,
				row.endAt,
				row.serviceName,
				row.customerName,
				row.participantsCount,
				row.customerPhone,
				row.customerEmail,
				row.note,
				row.sourceLabel,
				row.statusLabel,
				row.createdAt
			].map(toCsvCell)
		)
	];
	return `${lines.map((line) => line.join(',')).join('\r\n')}\r\n`;
};

const sanitizeFilenamePart = (value: string): string =>
	value
		.trim()
		.replace(/[^0-9A-Za-z_-]+/gu, '-')
		.replace(/^-+|-+$/gu, '') || 'bookings';

export const createBookingOperationsExportFilename = ({
	selectedDate,
	fromDate,
	toDate
}: {
	selectedDate: string;
	fromDate: string;
	toDate: string;
}): string => {
	const range = selectedDate || [fromDate, toDate].filter(Boolean).join('_') || 'bookings';
	return `booking-operations-${sanitizeFilenamePart(range)}.csv`;
};
