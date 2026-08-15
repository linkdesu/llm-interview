# Analyzer

Operator-facing companion to the [Dashboard](../dashboard/): lists every
archived Session and renders a selected Session's transcript as a trajectory.
See `CONTEXT.md` at the repo root for the domain model.

## Status

A Vue 3 + TypeScript + Vite SPA served by a single Bun process with the JSON
API (session listing + verbatim transcripts). Selecting a run in the sidebar
renders its trajectory: invocations with their root prompts, turns, the
tool-call / result ledger, and per-turn token usage and thinking.

## Commands

- `bun install` — install dependencies
- `bun run dev` — start the Bun API server + Vite dev server (HMR); open the Vite URL (port 5173), which proxies the JSON API to the Bun server
- `bun run build` — type-check (`vue-tsc -b`) and build to `dist/`
- `bun run serve` — serve `dist/` with the Bun server (default port 3090,
  override with `PORT`)
- `bun run lint` — ESLint
- `bun run test` — vitest

## Session archive

The server reads archived Sessions from the repo's `session/` directory
(`session/<question>/<model>/<datetime>/`), resolved from `SESSION_ROOT`
(default `<checkout>/session`). That directory is gitignored and only exists in
the main working tree — a worktree checkout has an empty `session/`. When
running from a worktree (or any checkout without the archive), point
`SESSION_ROOT` at the real archive, e.g.
`SESSION_ROOT=/Volumes/Data/code/llm-interview/session`. The server logs the
resolved root and the run count at startup, and warns when the archive is
empty or unreadable.
