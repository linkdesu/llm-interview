import { spawn } from 'node:child_process'

// Analyzer dev orchestrator: runs the Bun API server and the Vite dev server
// together. The Vite server proxies /sessions, /session, and /health to the
// API server (see vite.config.ts), so the SPA at the Vite URL gets live data
// and hot reload in one command: "bun run dev".

const ROOT = import.meta.dir + '/..'
const API_PORT = process.env.API_PORT ?? '3090'

const children: ReturnType<typeof spawn>[] = []
let stopping = false

function stop(code: number): void {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  process.exit(code)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

function run(command: string, args: string[], env: Record<string, string>): void {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  children.push(child)
  child.on('exit', (code) => stop(code ?? 0))
}

console.log('Analyzer dev:')
console.log('  SPA (Vite): http://localhost:5173  (API is proxied here)')
console.log('  API (Bun):  http://localhost:' + API_PORT)

run('bun', ['src/server.ts'], { PORT: API_PORT })
run('bun', ['x', 'vite'], {})
