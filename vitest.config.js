import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import { configDefaults } from 'vitest/config';
import path from 'node:path';

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      name: 'workers',
      // Frontend DOM tests run under tests/frontend/** in a separate happy-dom
      // project (see vitest.frontend.config.js / vitest.workspace.js) — the
      // workerd/miniflare runtime here has no `document`/`window` or Node `vm`.
      exclude: [...configDefaults.exclude, 'tests/frontend/**'],
      setupFiles: ['./tests/apply-migrations.js'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              ADMIN_PASSWORD: 'test-admin-password',
              SESSION_SECRET: 'test-session-secret',
            },
          },
        },
      },
    },
  };
});
