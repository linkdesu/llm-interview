# llm-interview

## Rules

- Regardless of the language used in conversation, all documents and code comments in this repository must be written in English for internationalization.
- Commits made by an AI agent must explicitly bypass commit signing (`git -c commit.gpgsign=false commit ...`), since the 1Password SSH signer requires interactive authorization that an agent cannot provide.
- Each JS/TS package (`runner/`, `dashboard/`) has ESLint configured; run `bun run lint` inside the package you touched and keep it clean before handing work back.
- TypeScript versions are intentionally split: `runner/` compiles with TS 7 (via the `@typescript/native` npm alias; `tsc` resolves to it) while its `typescript` dependency stays on TS 6 because typescript-eslint needs the TS 6 API (TS 7.0 ships no programmatic API). `dashboard/` stays entirely on TS 6 because vue-tsc/Volar requires it. Do not "upgrade" the `typescript` entries to 7.x — that breaks ESLint.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (linkdesu/llm-interview), managed via gh-axi (`npx -y gh-axi ...`). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
