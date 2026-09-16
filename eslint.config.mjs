import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const eslintConfig = [

  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'coverage/**',
      'next-env.d.ts',
      'index.html',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // ---------------------------------------------------------------------------
  // ARCHITECTURAL BOUNDARIES (enforced, not merely documented)
  //
  // The spatial engine is domain-agnostic. It powers anatomy today and
  // chemistry / engineering / astrophysics tomorrow. It must therefore never
  // reach into a specific knowledge domain.
  // ---------------------------------------------------------------------------
  {
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/anatomy', '@/anatomy/*', '../anatomy/*', '**/anatomy/**'],
              message:
                'The spatial engine must stay domain-agnostic. Anatomy-specific code belongs in src/anatomy and must depend on the engine, never the reverse.',
            },
            {
              group: ['@/app', '@/app/*'],
              message: 'The engine must not depend on Next.js route modules.',
            },
          ],
        },
      ],
    },
  },

  // Domain layers describe knowledge, not rendering internals or UI.
  {
    files: ['src/types/**/*.ts', 'src/config/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/components/*', '@/app/*', 'three', 'three/*', '@react-three/*'],
              message:
                'Domain types and configuration must remain free of rendering and UI dependencies.',
            },
          ],
        },
      ],
    },
  },

  // Server-only secrets must never be reachable from client bundles.
  {
    files: ['src/components/**/*.tsx', 'src/store/**/*.ts', 'src/hooks/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/config/env.server', '@/lib/supabase/admin', 'openai', 'stripe'],
              message:
                'Server-only modules (secrets, privileged SDKs) must never be imported from client-side code.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },

  // Verification scripts are command-line tools; printing is their purpose.
  {
    files: ['scripts/**/*.{js,mjs,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default eslintConfig;
