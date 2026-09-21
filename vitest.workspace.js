import { defineWorkspace } from 'vitest/config';

// Two independent projects, run together under a single `vitest run` / `npm test`:
//  - vitest.config.js: backend API/lib tests, running inside the Cloudflare
//    Workers pool (workerd/miniflare), with a real D1 binding.
//  - vitest.frontend.config.js: DOM-level tests for plain <script>-tag files
//    (js/**), running in Node with happy-dom, since the workers pool has no
//    `document`/`window`.
export default defineWorkspace(['./vitest.config.js', './vitest.frontend.config.js']);
