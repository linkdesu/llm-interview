# Run Rules

These rules apply to every run, regardless of the question.

## Basic

- Each ticket is independently verifiable. Order is your choice — pick whichever makes sense as the next step.
- After completing each ticket, review and test your work before proceeding.

- Background processes (`&`) MUST redirect output to a file (`> out.log 2>&1 &`) — an inherited stdout pipe hangs the tool call forever.
- ONLY write less than 500 lines in a single `write` call.
- ALWAYS write skeleton (structure + function signatures + key comments + empty implementations) first for new large files, then fill sections with `edit`.

## Debugging and Testing

- Test every HTML page in a real browser with **chrome-devtools-axi** (call `chrome-devtools-axi <command>` directly — it is installed globally via bun, no npx; the run environment targets Chrome Canary and starts the bridge fast). Follow this flow:
  1. `open file://<absolute path to index.html>` to load the page. The output includes an accessibility snapshot; interactive elements carry `@uid` refs.
  2. Inspect with `snapshot` (refs are regenerated after every render) and run JS checks with `eval` (e.g. `eval "() => ({...})"` for structured state).
  3. Interact by ref: `click @<uid>`, `fill @<uid> <text>`, `press <key>`, `wait <ms>`. If an action returns `STALE_REF`, re-run `snapshot` and retry with the fresh refs.
  4. Capture pixels with `screenshot <path>` only when visual state matters; prefer snapshot/DOM assertions otherwise.
  5. Run `stop` when you are done with the page so the browser is released.
  Do NOT install or script puppeteer/playwright/raw CDP yourself — chrome-devtools-axi is provided and sufficient. Do NOT run it via npx. If `snapshot`/`eval` reports a transient "main frame too early" error, wait briefly and re-run it. If chrome-devtools-axi is unavailable or keeps failing after a couple of retries, note the failure in your final summary instead of burning turns on workarounds.
- Games/animations debugging: no screenshots, no per-tick logs. From the start, expose game state on `window` and make the loop steppable; then verify with an in-page self-test that steps the game with scripted inputs, asserts the rules in code, and prints one PASS/FAIL summary (state samples on failure only); remove when done.
- NEVER run filesystem-wide searches (`find /`, `find ~`, `locate`, `mdfind`, or recursive listings of `/` or `~`).
- ALWAYS record each artifact's path (screenshots, logs, exports) the moment the command prints it, and if a path was lost, search only the working directory (`find .`) or try the command once again with path options.
