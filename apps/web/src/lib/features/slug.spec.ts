import { describe, expect, it } from 'vitest';
import {
	createSlugCandidate,
	createUniqueSlugCandidate,
	normalizeSlug,
	SLUG_PATTERN
} from './slug';

describe('slug helpers', () => {
	it('normalizes human input into a URL-safe slug', () => {
		expect(normalizeSlug('  Shibuya School 2026! ')).toBe('shibuya-school-2026');
		expect(normalizeSlug('Cafe Étude')).toBe('cafe-etude');
	});

	it('falls back when the name cannot become an ascii slug', () => {
		expect(createSlugCandidate('渋谷校', 'classroom')).toMatch(/^classroom-[a-z0-9]+$/);
	});

	it('creates a unique candidate against existing slugs', () => {
		const fallbackSlug = createSlugCandidate('渋谷校', 'classroom');
		expect(
			createUniqueSlugCandidate({
				value: '渋谷校',
				fallback: 'classroom',
				existingSlugs: [fallbackSlug, `${fallbackSlug}-2`]
			})
		).toBe(`${fallbackSlug}-3`);
	});

	it('accepts only lowercase letters, numbers, and single hyphen separators', () => {
		expect(SLUG_PATTERN.test('shibuya-school-1')).toBe(true);
		expect(SLUG_PATTERN.test('Shibuya')).toBe(false);
		expect(SLUG_PATTERN.test('shibuya_1')).toBe(false);
		expect(SLUG_PATTERN.test('-shibuya')).toBe(false);
	});
});
