import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'exports/**', '**/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Gmail SDK imports are confined to packages/gmail; everything else must
      // go through the @echoloop/gmail provider abstraction (docs/ARCHITECTURE.md).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['googleapis', 'googleapis/*', 'googleapis-common', '@googleapis/*'],
              message:
                'Direct Gmail SDK imports are only allowed inside packages/gmail. Use the @echoloop/gmail provider abstraction.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/gmail/src/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
