import { defineConfig } from 'vitest/config';
import path from 'node:path';

// tsconfig.json sets `jsx: "react-jsx"`, so Vite/Vitest's default automatic
// JSX transform handles .tsx files without needing @vitejs/plugin-react —
// this isn't a Vite app, just borrowing Vitest as the test runner, so no
// React Fast Refresh/HMR concerns apply.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
