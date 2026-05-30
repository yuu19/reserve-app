import { describe, it, expect } from 'vitest';
import { greet } from './greet';

describe('greet 関数', () => {
	it('挨拶文を返す', () => {
		expect(greet('Svelte')).toBe('Hello, Svelte!');
	});
});
