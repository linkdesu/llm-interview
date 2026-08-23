# pi Runtime Environment Brief (llm-interview runner)

Handoff document for a **global environment investigation** of the local
`chrome-devtools-axi` / Chrome / npm / proxy stack used by the llm-interview
runner's interviewed model.

All paths below are absolute. The machine: macOS arm64 (Darwin 25.5.0),
Node v24.12.0 via nvm, bun as package runner.

## 1. How the runner spawns pi

Source: `runner/src/pi-runner.ts` (`runInvocation`, spawn at ~line 503),
`runner/src/run.ts`.

- **Binary**: `/Volumes/Data/code/llm-interview/runner/node_modules/.bin/pi`
  (symlink → `../@earendil-works/pi-coding-agent/dist/cli.js`), version 0.84.2.
  Do not confuse with the global `/Users/link/.bun/bin/pi` (0.81.1).
- **cwd**: the per-invocation workdir under the temp run dir (section 3).
- **Args** (fixed):
  `-p --mode json --no-extensions --no-skills --no-prompt-templates
  --no-themes --no-context-files [--thinking <level>] --model
  <provider>/<modelId> --session-dir <sessionDir> --session-id <id> <prompt>`
  Plus `--skill <workdir>/.skills/chrome-devtools-axi/SKILL.md` when the skill
  link exists (section 5).
- **Env** (pi-runner.ts:490-496):
  ```
  ...process.env                        # inherits host env, INCLUDING proxy vars (section 7)
  PI_CODING_AGENT_DIR = /Volumes/Data/code/llm-interview/.pi-home
  CHROME_DEVTOOLS_AXI_CHANNEL = canary
  CHROME_DEVTOOLS_AXI_MCP_PATH = <probe result, section 5>   # only when found
  npm_config_cache = /var/folders/b2/9__21c7903l0ymk4tnddnc_r0000gn/T/llm-interview-npm-cache
  ```
  Note: `process.env` carries `http_proxy`/`https_proxy` → `http://127.0.0.1:6152`
  and `all_proxy`/`ALL_PROXY` → `socks5://127.0.0.1:6153` (host-level proxy,
  documented in the user's AGENTS.md as a network prerequisite).

## 2. pi config directory (the "local pi environment")

`PI_CODING_AGENT_DIR` = `/Volumes/Data/code/llm-interview/.pi-home`

| File | Content |
|---|---|
| `models.json` | provider `idealsoft` (baseUrl `https://llm.idealsoft.tech/v1`, openai-completions, apiKey `sk-bZev...`), compat: `thinkingFormat: "qwen-chat-template"`, `supportsReasoningEffort: false`, `maxTokensField: "max_tokens"`. Models include `ai-01/ornith-1.5-35b` (reasoning: true) and `ai-01/qwen3.8-27b-4` (reasoning: true). |
| `settings.json` | `{ "httpIdleTimeoutMs": 600000 }` — **exactly 600 s; see the symptom below; unclear which component consumes it (pi's HTTP client for the model API? or something else).** |
| `auth.json`, `models-store.json` | 2-byte stubs (`{}`), effectively empty. |
| `sessions/` | legacy dir, contains one subfolder `--Volumes-Data-code-llm-interview--` (unused by current runs; current runs use `--session-dir` under temp). |
| `supervise/` | 5 stale `*.out` files from an earlier development phase (pilot-registry-loader … slice5-matrix-cli). |

Mirror of `models.json` at `/Users/link/.pi/agent/models.json` (global pi home,
kept in sync manually; backup `.bak-20260821-models` exists next to it).

## 3. Run/session log layout

Temp root: `/var/folders/b2/9__21c7903l0ymk4tnddnc_r0000gn/T/llm-interview-runs/`
(one subdir per run: `pi-run-<epochMs>-<rand>`):

```
pi-run-<id>/
  work/                 # model's working directory (cwd of pi)
    .skills/chrome-devtools-axi/SKILL.md   # symlink to ~/.agents/skills/...
    index.html style.css script.js spec.md tickets.md
  sessions/
    <sessionId>.jsonl        # the full pi JSONL session log (messages, tool calls/results)
    <sessionId>-eval.jsonl   # evaluation invocation (per-ticket flow)
    loop-detect.jsonl        # loop-detector bookkeeping
    pi-output-<sessionId>.log# raw stdout+stderr of pi (filtered streaming deltas)
```

Other logs:
- **Index log** (matrix-level): `runner/pi-run-<timestamp>.log` in repo cwd
  (`Combo START/END`, ticket lines, heartbeats every 60 s).
- **Resume file**: `runner/matrix-resume-<timestamp>.json` (paired with the index
  log of the same timestamp).
- **Archived sessions**: `/Volumes/Data/code/llm-interview/session/<question>/<Model>/<YYYYMMDD-HHMMSS>/`
  (`session.jsonl`, `run.json` with status + `failureReason`, workdir artifacts).
- npm cache used inside runs: `.../T/llm-interview-npm-cache` (`npm_config_cache`).

Key run to inspect for the symptom (city-time-machine, fast model + 10-min axi
hangs): archive `session/city-time-machine/Ornith-1.5-35B-A3B-oQ4e-mtp/20260822-202819/`
(or the live temp run `pi-run-1787400227247-bml83q` if still present — the run
was stopped 2026-08-22 ~21:00 local; temp dirs may already be gone).

## 4. Observed symptom (what to investigate)

From the city-time-machine session timeline (UTC times, 2026-08-22):

```
12:15:28  CALL bash (axi: open/snapshot)   10.0 min   -> page snapshot (valid)
12:25:35  CALL bash (axi: console)          9.6 min   -> console output (valid)
12:35:28  CALL bash (axi: snapshot)        10.0 min   -> page snapshot (valid)
12:45:31  CALL bash (axi: console)         10.2 min   -> console output (valid)
12:56:03  CALL bash (axi: screenshot)      10.1 min   -> screenshot path (valid)
```

- **Every chrome-devtools-axi CLI command that talks to the live page takes
  ~600 s (10.0–10.2 min) before returning a correct result.** The commands do
  succeed; they just take exactly 10 minutes.
- Model generation is **not** slow: assistant-message gaps are 0.1–1.7 min in
  the same session (server-side was fixed by the user mid-run).
- First `npx -y chrome-devtools-axi --help` in the earlier (browser-os) run
  also took ~10 min; after the npm cache warmed, `npx -y chrome-devtools-axi
  --help` completes in ~1.7 s (verified manually).
- pi's bash tool has **no default timeout** (source:
  `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js` —
  `timeout` is optional, "no default timeout"). So the 600 s is not pi killing
  or waiting on its own limit.
- The exact 600 s matches `.pi-home/settings.json` `httpIdleTimeoutMs: 600000`
  — coincidence or the actual culprit is unverified. If some component in the
  axi→bridge→CDP chain (or Chrome's network stack) uses a 10-min idle timeout
  and the "fast path" silently fails once before the timeout fallback, that
  would produce exactly this pattern.

### Environment facts a global investigation should check

1. **Proxy vars are inherited into pi and its children** (section 1). The axi
   bridge (node) and Chrome (launched by the bridge) run with
   `http(s)_proxy`/`all_proxy` set. npm respects them (a cold npx bootstrap
   that hits registry.npmjs.org through the proxy took 10 min once). Chrome on
   macOS normally ignores `http_proxy` env (uses system/settings proxy), but
   anything the bridge fetches (update checks, CDN) may not.
2. **chrome-devtools-axi installs**:
   - global bin: `/Users/link/.nvm/versions/node/v24.12.0/bin/chrome-devtools-axi`
   - npx cache copy: `~/.npm/_npx/ee29b3336674ee04/node_modules/chrome-devtools-axi`
   - run-isolated npm cache copy: `.../T/llm-interview-npm-cache/_npx/f556c77727d59f50/node_modules/chrome-devtools-axi`
   - the runner probes `npm prefix -g` for
     `<prefix>/lib/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js`
     and, if present, exports `CHROME_DEVTOOLS_AXI_MCP_PATH` so the bridge
     skips its own npx bootstrap.
3. **Channel**: `CHROME_DEVTOOLS_AXI_CHANNEL=canary` → the bridge drives
   `Google Chrome Canary` headless. Verify Canary's version, whether the
   remote-debugging/CDP handshake can hang, and whether a stale headless
   instance (orphaned bridge process — we have seen `chrome-devtools-axi-bridge.js`
   reparented to PID 1 after run kills) holds the CDP port or user-data dir.
4. **Known past npm failure**: 2026-08-21 snake run hit
   `npm error code ECOMPROMISED / Lock compromised` in the run-isolated npm
   cache when two runs used it concurrently (the user's global env note:
   concurrency was since forced to 1).
5. **User context**: outbound internet is expected to go through the local
   proxy (6152 HTTP / 6153 SOCKS5). The user "adjusted server-side processes"
   around 2026-08-22 ~19:00 local after which model latency dropped 8–10 min →
   <1 min — the fix may also have changed proxy behavior; worth checking
   whether the proxy itself has a 10-min hang mode for non-matching rules
   (e.g., SOCKS connect to a direct LAN/loopback target).

## 5. Prompt-level browser-verification wiring (why the model calls axi at all)

- `runner/run-rules.md` lines 16–22: every run is told to "Test every HTML
  page in a real browser with chrome-devtools-axi" (5-step flow, `npx -y`
  invocation). Injected into every prompt via `config.toml` `run_rules =
  "run-rules.md"`.
- `question/snake/tickets.md` line 3 also mentions the skill (browser-os's
  tickets.md does not).
- `runner/src/pi-runner.ts:241-257` symlinks
  `/Users/link/.agents/skills/chrome-devtools-axi/SKILL.md` into each workdir's
  `.skills/` and passes `--skill` to pi.
- Decision pending with the user: soften/remove the mandatory browser
  verification (in-page self-tests only) vs. keep it and fix the environment.
  The 10-min-per-axi-command cost makes keeping it expensive until fixed.

## 6. Repro recipe (manual)

```bash
# from anywhere; mirrors what the model runs inside a workdir
export CHROME_DEVTOOLS_AXI_CHANNEL=canary
export CHROME_DEVTOOLS_AXI_MCP_PATH=<output of: npm prefix -g>/lib/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js  # if exists
time chrome-devtools-axi open "file://$PWD/index.html"   # direct global binary (bun install); npx -y is banned in prompts now
time chrome-devtools-axi console
time chrome-devtools-axi stop
# watch for: orphaned chrome-devtools-axi-bridge.js, Chrome Canary processes,
# proxy env vars in their envs (`ps eww <pid>`), and the bridge's own logs in the
# temp dir / /tmp (axi writes e.g. /tmp/axi_start.log when the model redirects it).
```
