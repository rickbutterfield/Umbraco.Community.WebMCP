import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import wcPlugin from 'eslint-plugin-wc';
import litPlugin from 'eslint-plugin-lit';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

// Follows the Umbraco DXP product configs (for example Umbraco.Forms.StaticAssets), minus their local rules.
export default [
	// Recommended config applied to all files
	js.configs.recommended,
	...tseslint.configs.recommended,
	wcPlugin.configs['flat/recommended'],
	litPlugin.configs['flat/recommended'],
	eslintPluginPrettierRecommended,

	// Global ignores
	{
		ignores: ['**/eslint.config.mjs', '**/vite.config.ts', '**/web-test-runner.config.mjs', 'wwwroot/**', 'src/**/*.test.ts'],
	},

	// Global config
	{
		languageOptions: {
			parserOptions: {
				project: true,
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.browser,
			},
		},
		plugins: {
			import: importPlugin,
		},
		rules: {
			semi: ['warn', 'always'],
			'prettier/prettier': ['warn', { endOfLine: 'auto' }],
			'no-unused-vars': 'off', // Let '@typescript-eslint/no-unused-vars' catch the errors to allow unused function parameters (ex: in interfaces)
			'no-var': 'error',
			...importPlugin.configs.recommended.rules,
			'import/namespace': 'off',
			'import/no-unresolved': 'off',
			'import/order': ['warn', { groups: ['builtin', 'parent', 'sibling', 'index', 'external'] }],
			'import/no-self-import': 'error',
			'import/no-cycle': ['error', { maxDepth: 6, allowUnsafeDynamicCyclicDependency: true }],
			'import/no-named-as-default': 'off', // Does not work with eslint 9
			'import/no-named-as-default-member': 'off', // Does not work with eslint 9
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': 'error',
			'@typescript-eslint/consistent-type-exports': 'error',
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-import-type-side-effects': 'warn',
			'@typescript-eslint/no-deprecated': 'warn',
		},
	},
];
