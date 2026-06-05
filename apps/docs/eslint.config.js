import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';

export default [
	{
		ignores: [
			'.svelte-kit/**',
			'.wrangler/**',
			'build/**',
			'playwright-report/**',
			'test-results/**',
			'project.inlang/cache/**',
			'src/lib/paraglide/**'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	prettier,
	{
		files: ['**/*.{js,mjs,cjs,ts}'],
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			'no-undef': 'off'
		}
	}
];
