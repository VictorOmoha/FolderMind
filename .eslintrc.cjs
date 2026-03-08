/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    // Disallow leftover debug logs in source
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    // Catch unused variables (ignore underscore-prefixed)
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // Discourage unsafe any casts — use unknown where possible
    '@typescript-eslint/no-explicit-any': 'warn',
    // Enforce exhaustive hook dependency arrays
    'react-hooks/exhaustive-deps': 'warn',
    // Disallow empty catch blocks that swallow errors silently
    'no-empty': ['warn', { allowEmptyCatch: false }],
  },
  ignorePatterns: ['out/', 'dist/', 'release/', 'node_modules/', '*.legacy'],
}
