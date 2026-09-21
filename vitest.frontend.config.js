import { defineProject } from 'vitest/config';

// Frontend DOM tests for plain <script>-tag files under js/** (e.g. js/classes.js).
// These files are not ES modules — they're loaded via <script src="..."> in the
// browser and rely on top-level function declarations becoming globals on
// `window`. We run them in a plain Node environment (not the workers/miniflare
// pool from vitest.config.js, which has no `document`/`window`/Node `vm`) and
// use happy-dom + Node's `vm` module inside the test files themselves to
// evaluate the script the same way a browser's classic-script loader would.
export default defineProject({
  test: {
    name: 'frontend',
    environment: 'node',
    include: ['tests/frontend/**/*.test.js'],
  },
});
