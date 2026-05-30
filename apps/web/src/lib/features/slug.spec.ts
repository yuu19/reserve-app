import { describe, expect, it } from 'vitest';
import {
	createSlugCandidate,
	createUniqueSlugCandidate,
	normalizeSlug,
	SLUG_PATTERN
} from './slug';

describe('slug ヘルパー', () => {
	it('人が入力した文字列を URL 安全な slug に正規化する', () => {
		expect(normalizeSlug('  Shibuya School 2026! ')).toBe('shibuya-school-2026');
		expect(normalizeSlug('Cafe Étude')).toBe('cafe-etude');
	});

	it('名前を ASCII slug にできない場合はフォールバックする', () => {
		expect(createSlugCandidate('渋谷校', 'store')).toMatch(/^store-[a-z0-9]+$/);
	});

	it('既存 slug と衝突しない一意な候補を作成する', () => {
		const fallbackSlug = createSlugCandidate('渋谷校', 'store');
		expect(
			createUniqueSlugCandidate({
				value: '渋谷校',
				fallback: 'store',
				existingSlugs: [fallbackSlug, `${fallbackSlug}-2`]
			})
		).toBe(`${fallbackSlug}-3`);
	});

	it('小文字英字・数字・単一ハイフン区切りだけを受け入れる', () => {
		expect(SLUG_PATTERN.test('shibuya-school-1')).toBe(true);
		expect(SLUG_PATTERN.test('Shibuya')).toBe(false);
		expect(SLUG_PATTERN.test('shibuya_1')).toBe(false);
		expect(SLUG_PATTERN.test('-shibuya')).toBe(false);
	});
});
