export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_PATTERN_ATTRIBUTE = '[a-z0-9]+(-[a-z0-9]+)*';
export const SLUG_INPUT_HINT = '英小文字・数字・ハイフンのみ。URL に使われます。';

const MAX_SLUG_LENGTH = 120;

const createFallbackSlug = (value: string, fallback: string): string => {
	const source = value.trim();
	if (!source) {
		return '';
	}
	const hash = Array.from(source)
		.reduce((current, character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return (current * 31 + codePoint) >>> 0;
		}, 0)
		.toString(36)
		.slice(0, 6);
	return `${fallback}-${hash || '1'}`;
};

export const normalizeSlug = (value: string): string =>
	value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/-+$/g, '');

export const createSlugCandidate = (value: string, fallback: string): string =>
	normalizeSlug(value) || createFallbackSlug(value, fallback);

export const createUniqueSlugCandidate = ({
	value,
	fallback,
	existingSlugs,
	currentSlug
}: {
	value: string;
	fallback: string;
	existingSlugs: string[];
	currentSlug?: string | null;
}): string => {
	const base = createSlugCandidate(value, fallback);
	const reserved = new Set(
		existingSlugs.filter((slug) => slug !== currentSlug).map((slug) => normalizeSlug(slug))
	);
	if (!reserved.has(base)) {
		return base;
	}

	for (let index = 2; index < 1000; index += 1) {
		const suffix = `-${index}`;
		const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
		if (!reserved.has(candidate)) {
			return candidate;
		}
	}

	return `${base.slice(0, MAX_SLUG_LENGTH - 13)}-${Date.now()}`;
};
