export default [{
  files: ['src/**/*.js', 'tests/**/*.mjs', '*.js'],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: {
      document: 'readonly',
      window: 'readonly',
      console: 'readonly',
      fetch: 'readonly',
      requestAnimationFrame: 'readonly',
      cancelAnimationFrame: 'readonly',
      URL: 'readonly',
      URLSearchParams: 'readonly',
      Blob: 'readonly',
      history: 'readonly',
      location: 'readonly',
      navigator: 'readonly',
      setTimeout: 'readonly',
    },
  },
  rules: {
    'no-undef': 'error',
    'no-unused-vars': 'error',
  },
}];
