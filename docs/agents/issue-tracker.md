# Issue tracker: GitHub (via gh-axi)

Issues and PRDs for this repo live as GitHub issues. All operations go through **gh-axi**, an agent-ergonomic wrapper around the `gh` CLI — prefer it over raw `gh` and other methods (TOON-encoded token-efficient output, contextual `help:` next-step hints, idempotent mutations).

Invoke it as `npx -y gh-axi <command>` (no global install needed). It requires `gh` to be installed and authenticated. Every response ends with a `help:` section of suggested next commands — follow it. If output shows a follow-up command starting with `gh-axi`, run it as `npx -y gh-axi ...`.

## Conventions

- **Create an issue**: `npx -y gh-axi issue create --title "..." --body-file <path>`. Write multi-line bodies to a UTF-8 file and pass `--body-file`.
- **Read an issue**: `npx -y gh-axi issue view <number>` (includes labels and comments).
- **List issues**: `npx -y gh-axi issue list` (add `--state` / `--label` filters as needed).
- **Comment on an issue**: `npx -y gh-axi issue comment <number> --body-file <path>`.
- **Apply / remove labels**: `npx -y gh-axi issue edit <number> --add-label "..."` / `--remove-label "..."`; manage the label vocabulary itself with `npx -y gh-axi label ...`.
- **Close**: `npx -y gh-axi issue close <number>`.

The repo is inferred from `git remote -v`. To target another repository, place `--repo owner/name` (or `-R owner/name`) **after** the command, e.g. `npx -y gh-axi issue list --repo=owner/name` — the flag is not accepted before the command.

Never pass secrets via `--body`/`-b` (visible in process argv); Actions secrets are stdin-only: `echo -n "<value>" | npx -y gh-axi secret set <name>`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `pr` command equivalents:

- **Read a PR**: `npx -y gh-axi pr view <number>` and `npx -y gh-axi pr diff <number>`.
- **List external PRs for triage**: `npx -y gh-axi pr list --state open`, then keep only external contributors (drop OWNER/MEMBER/COLLABORATOR).
- **Comment / label / close**: `npx -y gh-axi pr comment`, `npx -y gh-axi pr edit --add-label`/`--remove-label`, `npx -y gh-axi pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `npx -y gh-axi pr view 42` and fall back to `npx -y gh-axi issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue via `npx -y gh-axi issue create`.

## When a skill says "fetch the relevant ticket"

Run `npx -y gh-axi issue view <number>`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body: `npx -y gh-axi issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`npx -y gh-axi api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). **Known gh-axi pitfalls**: its `api` command is NOT gh-flag-compatible — the method is positional (`api POST <path>`) and fields use `--field k=v`; gh-style `--method`/`-F` are silently ignored and the call degrades to a GET (a mutating intent silently becomes a read). It also strips server error details (a 422's real message is lost). For dependency edges, use raw `gh api` as shown above. Verify edges with `gh api repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by --jq '[.[].number]'` (the `issue_dependencies_summary` field is cached and lags; the list endpoint is authoritative). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`npx -y gh-axi issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `npx -y gh-axi issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `npx -y gh-axi issue comment <n> --body-file <path>`, then `npx -y gh-axi issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
