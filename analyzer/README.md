# Analyzer

Operator-facing companion to the [Dashboard](../dashboard/): lists every
archived Session and renders a selected Session's transcript as a trajectory.
See `CONTEXT.md` at the repo root for the domain model.

## Status

A Vue 3 + TypeScript + Vite SPA served by a single Bun process with the JSON
API (session listing + verbatim transcripts). Selecting a run in the sidebar
renders its trajectory: invocations with their root prompts, turns, and the
tool-call / result ledger. Token usage and thinking render is a later ticket.

## Commands

- `bun install` — install dependencies
- `bun run dev` — Vite dev server (HMR) for the frontend
- `bun run build` — type-check (`vue-tsc -b`) and build to `dist/`
- `bun run serve` — serve `dist/` with the Bun server (default port 3090,
  override with `PORT`)
- `bun run lint` — ESLint
- `bun run test` — vitest
