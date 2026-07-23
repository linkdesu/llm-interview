# llm-interview

## Rules

- Regardless of the language used in conversation, all documents and code comments in this repository must be written in English for internationalization.
- Commits made by an AI agent must explicitly bypass commit signing (`git -c commit.gpgsign=false commit ...`), since the 1Password SSH signer requires interactive authorization that an agent cannot provide.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (linkdesu/llm-interview), managed via gh-axi (`npx -y gh-axi ...`). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
