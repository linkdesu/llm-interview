# Spec: LLM Interview — AI Agent Generation Showcase

## Problem Statement

The user runs several open-weight models locally behind a llama.cpp router and wants to know which model (under which parameters) is best at generating small web projects in their preferred style. There is currently no practical way to compare: each agent run lives and dies in the terminal, the full process is never preserved, and outputs from different models can never be inspected side by side. The user needs a system that accumulates tasks, executes them in bulk, archives everything, and presents the results as a static site.

## Solution

A three-part system:

1. **Question library**: tasks accumulate as directories under `question/` (`intent.md` + optional `spec.md`/`tickets.md`), mirroring the user's everyday grilling → spec → tickets workflow.
2. **Runner**: a Bun script that drives a pristine, project-local deployment of pi (version-pinned, no global config pollution) through the Question × Model matrix. Each Run's transcript (JSONL) and Artifact (index.html / style.css / script.js) are archived together as an inseparable Session under `session/`.
3. **Dashboard**: a static site (GitHub Pages). At build time, Session data is flattened and a Manifest is generated. Viewers browse via a sidebar (question → model, two levels, with keyword filter); the main area renders each matching Combo's Artifact live in iframes for direct comparison, with the transcript expandable.

## User Stories

1. As a task author, I want to add a task as a directory under `question/` (the directory name serves as the Question's unique name), so that I can accumulate test tasks over time.
2. As a task author, I want to write only `intent.md` in a Question, so that I can test the model's own planning ability.
3. As a task author, I want to attach `spec.md`/`tickets.md` to a Question, so that I can test execution ability given a detailed spec.
4. As a task author, I want spec/tickets handed to the model as file paths that it reads itself, so that the run mirrors how I actually talk to agents day to day.
5. As an operator, I want to run the whole matrix (all Questions × all Models) with one command, so that I don't trigger runs one by one.
6. As an operator, I want the runner to execute in model-major order (one model finishes all Questions before switching), so that llama.cpp router's JIT loading is not thrashed by repeated model swaps.
7. As an operator, I want to filter the run scope with `--question` and `--model`, so that I can only run newly added tasks or newly added models.
8. As an operator, I want the test pi fully isolated from the global install (independent version, independent config dir, all extensions/skills/context files disabled), so that every Run has a pristine, reproducible context.
9. As an operator, I want the Model Registry to manually record each model's server-side sampling parameters (thinking/temp/top_k/top_p etc.), so that this snapshot is archived with each Run and shown to viewers.
10. As an operator, I want the runner to append a uniform artifact contract to every prompt, so that Question files focus on the task itself.
11. As an operator, I want the artifact contract to require exactly `index.html`, `style.css`, `script.js` — no extra files, CSS/JS not inlined, not minified/obfuscated, kept readable — so that I can directly read the code quality a model produces.
12. As an operator, I want every Run to execute in an isolated working directory outside the repo, where the model cannot see the project's AGENTS.md, other Sessions' artifacts, or any project file, so that "copying homework" and environment pollution are impossible.
13. As an operator, I want every Run archived in a fixed structure: `session/<question>/<model>/<datetime>/` (session.jsonl, the three artifact files, run.json), so that browsing the filesystem directly also makes sense.
14. As an operator, I want repeated Runs of the same Combo all kept by datetime in the repo, so that experiment history is preserved.
15. As an operator, I want run.json to record the Combo's full metadata (question, model, parameter snapshot, comboId, pi version, duration, status), so that builds and debugging have a single source of truth.
16. As a viewer, I want to browse all published Combos in a two-level sidebar (question → model), so that I can quickly find the result I'm looking for.
17. As a viewer, I want to filter the sidebar by keyword (e.g. a model name), so that I can see one model's results across all Questions.
18. As a viewer, I want the main area to render the matching Combos' Artifacts side by side (live iframe previews) after selecting a question, so that I can compare outcomes at a glance.
19. As a viewer, I want each Combo labeled with its model and parameter snapshot, so that I understand where differences come from.
20. As a viewer, I want to expand a Combo's full transcript (messages, thinking, tool calls), so that I can judge how a model works, not just what it produced.
21. As a publisher, I want push-to-GitHub to trigger the full build and release pipeline (manifest generation + dashboard build + Pages deploy), so that publishing is zero-touch.
22. As a publisher, I want only the latest Run of each Combo published at build time (comboId = hash(question+model+parameters)), so that the site shows only the current best state while the repo keeps full history.
23. As a maintainer, I want a unified glossary (CONTEXT.md) and ADRs for key architectural constraints, so that future-me and AI agents don't repeat old mistakes.
24. As an operator, I want a Question with a `tickets.md` executed one ticket per pi invocation, each ticket in a fresh context, so that long ticket lists don't degrade under repeated context compaction.
25. As an operator, I want a dirty pi invocation arbitrated by a same-model evaluation invocation with an explicit verdict marker, so that recoverable stumbles don't waste the Run and genuinely incomplete tickets don't cascade into later ones.

## Implementation Decisions

- **Top-level layout**: `question/` (task library), `session/` (archive), `dashboard/` (existing Vite + Vue 3 + TS site), plus new `runner/` (Bun project) and `docs/` (spec/adr).
- **Runner stack**: Bun + TypeScript; pi installed as a local npm dependency of the runner (version pinned in the lockfile), invoked via `node_modules/.bin/pi`.
- **Pristine execution environment**: `PI_CODING_AGENT_DIR` points to a project-local config directory containing only the two required hand-copied files `models.json` and `auth.json`; every invocation adds `--no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files`. This directory is not committed to git.
- **Matrix definition**: cartesian product of all Questions × all Models in the registry, executed model-major; the only filters are `--question` and `--model`.
- **Prompt assembly**: `intent.md` content + relative-path pointers to spec/tickets (these files are copied into the isolated working directory; the model reads them with its read tool; missing files are simply not mentioned) + the runner-appended artifact contract. In per-ticket runs (see below) each invocation's prompt instead points at exactly one ticket ("complete ONLY ticket k of N: `<title>`"), notes that the working directory already holds previous invocations' work, and asks the model to mark the ticket `[x]` in `tickets.md` when done; the ticket body itself is never inlined — locating and reading the documents is part of what the Question tests.
- **Artifact contract**: exactly three files `index.html` / `style.css` / `script.js`; CSS/JS not inlined, not minified/obfuscated, kept readable; no other files. The runner validates the file list at collection time and flags violations in run.json (without blocking archival).
- **Run isolation**: pi's cwd is a temp working directory outside the repo (a dedicated path under the system temp area); the Question's spec/tickets are copied in. Together with `--no-context-files`, the model cannot touch the project's AGENTS.md, other Sessions' artifacts under `session/`, or any project file. After the Run, the runner collects the transcript and the three artifact files into `session/<question>/<model>/<datetime>/`, then cleans up the temp directory.
- **tickets.md format**: tickets are top-level ordered-list items (`[ ]1. Title` — the checkbox prefix is conventional, parsing is lenient), each followed by nested unordered-list subtasks. The model marks a finished ticket `[x]` in the workdir copy as its own progress tracking; the source file always stays all-unchecked. The Runner never consumes the marks for control flow — orchestration is strictly by document order.
- **One pi invocation per ticket** (ADR 0007): with ≥ 2 parseable tickets the Runner makes one pi invocation per ticket in document order — each with a fresh session and context, all sharing the one isolated workdir. `maxTurns` counts pi's internal turns and bounds each invocation independently (total budget N × maxTurns). An invocation that ends dirty (a failed write-side tool result — `isError: true` from edit/write/bash/unknown tools, while read-only tool failures are ignored — non-zero exit, or max-turns kill) triggers an **evaluation invocation**: a fresh same-model invocation that inspects the workdir read-only and ends with `<verdict>COMPLETE</verdict>` / `<verdict>INCOMPLETE</verdict>`; COMPLETE continues, while INCOMPLETE, a missing verdict, or a crashed/killed evaluation aborts the Run conservatively (failed tool results inside the evaluation do not invalidate an explicit verdict).
- **Terminal API failure handling**: pi exits 0 even when every request failed (e.g. a network outage), so the Runner detects terminal API failures from the event stream (a final `auto_retry_end` with `success: false`), backstopped by the transcript (last assistant message with `stopReason: "error"`, which covers retry-disabled configurations; earlier error messages are ignored since retries may have succeeded). An infrastructure failure is not a model failure — every subsequent invocation would fail the same way — so the Runner skips evaluation, fails the current Run, records the reason as `apiError` in run.json (run-level and per-invocation), and aborts the **whole matrix** with a non-zero exit, waiting for manual recovery. The remaining combos are re-run afterwards via the `--question`/`--model` filters.
- **Session persistence**: pi is invoked with the isolated working directory as cwd, but `--session-dir` points at a sibling directory (`<run>/sessions/`, next to `<run>/work/`) OUTSIDE the agent's cwd, together with the captured `pi-output-*.log` files. This separation is load-bearing: a real run showed an agent `rm`-ing every `*.jsonl`/`pi-output-*.log` in its workdir (including pi's own live session file) so the directory would match the three-file artifact contract — destroying the runner's transcripts and crashing the archive step. Runner bookkeeping must never live where the artifact contract tells the agent to keep clean. At collection time the invocations' JSONL files (evaluation included) are concatenated in order into one `session.jsonl`, keeping the Session contract and dashboard unchanged.
- **Model Registry**: a config file inside the runner project, manually maintained; fields include name (unique kebab-case identifier), provider, modelId, parameter snapshot (free-form keys such as thinking/temp/top_k/top_p), and notes. The registry both documents the pi model configuration and feeds run.json.
- **run.json**: records question name, model name, parameter snapshot, comboId (hash(question+model+parameters)), pi version, start/end time, and exit status. Per-ticket runs add an `invocations` array — one entry per invocation with ticket index/title, status, exit code, duration, and max-turns flag; evaluation invocations carry `evaluation: true` and the parsed `verdict`. Top-level fields stay run-level aggregates (`status` is ok only if no invocation failed, `maxTurnsExceeded` if any invocation hit the internal-turn limit), so the manifest and dashboard keep working unchanged.
- **No sampling-parameter automation**: per ADR 0001 — parameters are server-side; the runner records but never controls them. thinking on/off comparison and other parameter dimensions are out of scope for now.
- **Manifest build**: a standalone Bun script that scans the full `session/` history, groups by comboId, takes the latest Run per group, copies its session.jsonl / three artifact files / run.json into a flat directory inside the dashboard build output, and generates the Manifest (comboId → metadata + file paths).
- **Dashboard information architecture**: two-level sidebar (question → model) + keyword filter; the main area shows matching Combos as side-by-side iframe previews (artifact-first), each labeled with model + parameter snapshot, with the transcript (JSONL rendered as a message timeline, thinking collapsed by default) expandable.
- **Publishing**: GitHub Actions — on push, run manifest build + `vite build` + Pages deploy; `session/` is fully committed to git; size optimization is deferred.

## Testing Decisions

- **What makes a good test**: only externally observable behavior (filesystem products, exit codes, manifest contents), never implementation details.
- **Seam one (the pi CLI boundary)**: runner tests use a stub `pi` executable (writes a canned session.jsonl and the three artifact files into its cwd, exits 0), exercising the whole runner without an LLM: matrix expansion, prompt assembly, isolated working directory, collection/archival, run.json, session file normalization.
- **Seam two (the `session/` filesystem)**: the manifest build script is tested against fixture session trees: grouping multiple historical Runs per Combo and picking the latest, flattened copying, Manifest field correctness.
- **Dashboard**: light rendering tests against a fixture Manifest (sidebar tree construction, filter logic); no pixel-level UI tests.
- **Smoke test**: one real single-Question single-Model Run in the live environment (already used to verify pi isolation and the persistence mechanism), as a manual backstop outside CI.

## Out of Scope

- Automated comparison of sampling parameters (temp/top_k/top_p, thinking on/off) — see ADR 0001.
- Session file size optimization (explicitly deferred by the user).
- Mobile adaptation, dark/light themes, and other UI polish.
- Multi-language dashboard, share links, comments, or other audience-interaction features.
- Automated scoring/grading of Artifacts (comparison judgment is done by human eyes).

## Further Notes

- The local llama.cpp router is confirmed to support JIT model loading; `/v1/models` exposes all models. Model-major ordering only reduces load/unload churn. The router's address is local environment detail and intentionally not recorded in the repo — it lives only in the (git-ignored) pi config directory.
- pi's custom `--session-dir` stores files flat (no cwd subdirectory); `--session-id session` produces `*_session.jsonl`, so the runner only needs to normalize the name.
- The `pi-output-*.log` capture is filtered before writing: streaming `*_delta` events and `tool_execution_update` carry cumulative snapshots (`message`/`partial`/`partialResult`) that grow quadratically with streamed content — one visual-polish invocation produced a 181MB log, 99.9% of it these snapshots. The log keeps the deltas themselves plus all complete events; full content remains available in `message_end` / the session transcript.
- The smoke test verified the whole chain: pristine config + local model + non-interactive mode.
- Pi defaults a model's output cap (`maxTokens`) to 16384 when models.json declares none, which truncated large `write` tool calls (issue #8). Every model in the pi config's `models.json` therefore sets an explicit `"maxTokens": 32000`, and the provider sets `compat.maxTokensField: "max_tokens"` — pi's openai-completions default is `max_completion_tokens`, while llama.cpp expects `max_tokens` (as pi's own llama.cpp extension does). The cap is paired with prompt-side limits in `runner/run-rules.md` (max ~500 lines per `write`, skeleton-first for large files) so the model never needs a single huge response.
- A Question's spec.md/tickets.md are expected to be produced by the user's everyday grilling → to-spec → to-tickets workflow — the same pipeline that produced this spec.
