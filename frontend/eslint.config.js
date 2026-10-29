import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
  },
  {
    // shadcn components and context providers legitimately export helpers (variants, hooks) next to the component.
    files: ['src/components/ui/**', 'src/hooks/useConfirm.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
]);
