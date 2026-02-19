import dayjs from 'dayjs';
import 'dayjs/locale/ja';

const toDayjsInput = (value: unknown): string | number | Date | null | undefined => {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
		return value;
	}
	return undefined;
};

const formatWithFallback = (value: unknown, pattern: string, fallback: string): string => {
	const parsed = dayjs(toDayjsInput(value));
	if (!parsed.isValid()) {
		return fallback;
	}
	return parsed.locale('ja').format(pattern);
};

export const formatJaDate = (value: unknown, fallback = '-'): string =>
	formatWithFallback(value, 'YYYY/MM/DD', fallback);

export const formatJaDateTime = (value: unknown, fallback = '-'): string =>
	formatWithFallback(value, 'YYYY/MM/DD HH:mm', fallback);

export const formatJaTime = (value: unknown, fallback = '--:--'): string =>
	formatWithFallback(value, 'HH:mm', fallback);

export const formatJaMonth = (value: Date | string, fallback = ''): string =>
	formatWithFallback(value, 'YYYY年M月', fallback);
