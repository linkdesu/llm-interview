import { defineConfig } from 'vitest/config'

// The Bun package cache lives inside the workspace (see README) because the
// sandbox cannot write to ~/.bun; vitest must not discover test files there.
// The default excludes are restated because setting "exclude" replaces them.
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '**/.bun-cache/**',
      '**/.bun-tmp/**',
    ],
  },
})
