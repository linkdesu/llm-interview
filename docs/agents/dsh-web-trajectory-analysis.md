# dsh web Trajectory page — implementation analysis

Status: analysis for a follow-up implementer (Vue 3 + Vite static dashboard port).
Source tree (READ-ONLY reference): /Volumes/Data/code_opensource/deepseek-harness — a pnpm TypeScript monorepo.
The web UI lives in apps/web (vite entry) plus packages/client/* (browser plugin packages).
Target of the port: the llm-interview project — a Vue 3 + Vite STATIC dashboard whose data source is a JSONL session transcript (session.jsonl, one line per message/tool event).

Every path below is relative to /Volumes/Data/code_opensource/deepseek-harness. Section 5 explicitly separates
generic concepts (port 1:1) from deepseek-harness-specific machinery (replace or drop).

---

## 1. The dsh web command: CLI entry, boot, and bootstrap injection

### 1.1 CLI entry point
- apps/cli/src/bin.ts — the dsh launcher (#!/usr/bin/env node). It only resolves an invocation
  (parseDshArgs, apps/cli/src/args.ts) and dispatches:
  - profile mode → runProfile (apps/cli/src/profile-boot.ts)
  - plugin / dump-config modes (not relevant here).
- dsh web is a `hardcoded commander alias for --profile web` — see the web subcommand in
  apps/cli/src/args.ts (lines ~156–169). Root package script: `"dsh": "node --import tsx/esm apps/cli/src/bin.ts"`.

### 1.2 Profile boot (how the server-side tree comes up)
- runProfile (apps/cli/src/profile-boot.ts) composes a `cordis plugin tree` (a small dependency-injection
  framework, @deepseek-ai/cordis) from `patch layers`: bundle layers declared by the profile's packages
  (dsh.profile.bundles in package.json), the profile's cordis.patch.yml, the home layer
  ($DSH_HOME/cordis.patch.yml), and --patch overlays. Then it calls
  boot(name, rootConfig, patches, ...) from @deepseek-ai/dsh-app-boot which mounts every row.
- The web profile is provided by the bundle package @deepseek-ai/dsh-web-app
  (packages/bundle/web-app, patch cordis.patch.yml). Its plugin (packages/bundle/web-app/src/index.ts):
  - Resolves the built frontend dist @deepseek-ai/dsh-web-frontend/dist/index.html
    (resolveDistIndex, uses createRequire — the dist is built by apps/web via vite build).
  - Mounts @deepseek-ai/dsh-host-frontend-static over the webserver and prints the URL line
    `dsh web: http://127.0.0.1:<port>` once the loader tree settles.
- Serving stack:
  - packages/host/webserver/src/index.ts — HTTP server + ctx.webServer service; supports named routes,
    a registerFallback seat, and `index taps` (webServer.tapIndex(fn) → applyIndexTaps(html)).
  - packages/host/frontend-static/src/index.ts — SPA dist server: traversal is 403, any miss falls back to
    index.html with 200, every index response runs through the registered index taps
    (renderIndex = () => ctx.webServer.applyIndexTaps(await readFile(distIndex, 'utf8'))).

### 1.3 window.__DSH_BOOT__ injection (host side)
- packages/client/modules/src/index.ts — the `host half` of the client module system
  (ClientModuleRegistry, a cordis Service):
  - Scans loader entries for package.json dsh.client declarations with platform: 'web' and an
    exports["./client"] bundle (resolveMeta / parseDshClient / clientExportOf).
  - Composes a WebBootGraph = { rev, entries: [{ id, url: '/plugins/<id>/client.js?rev=<sha1-12>', inject?, immediately? }] }
    (graphRow; rev is a content hash used for cache busting).
  - Serves each bundle under /plugins/<id>/client.js (+ .map) — serveBundle.
  - Injects the graph into the SPA index: ctx.webServer.tapIndex(html => injectBootManifest(html, this.composed));
    injectBootManifest (same file, lines ~168–175) writes
    `<script>window.__DSH_BOOT__ = <graph-json></script>` as the first script in <head>
    (it escapes '<' as '\u003c' so plugin strings cannot break out of the script element).
- Wire types + parser: packages/client/modules/src/client/manifest.ts — WebBootEntry, WebBootGraph,
  BootManifest, parseBootManifest(wire), DshWindow.

### 1.4 Browser boot (shell)
- apps/web/src/main.ts (vite entry; apps/web/index.html has #root):
  new AppWebEntry(el).run() from @deepseek-ai/dsh-client-web.
- packages/client/web/src/boot.tsx — the shell boot kernel:
  1. parseBootManifest((globalThis as DshWindow).__DSH_BOOT__).
  2. Builds a ClientModuleSystem over the manifest's module/plugin rows (module loader in
     packages/client/modules/src/client), registers two static modules (the app-shell assembly and the modules
     package itself).
  3. Renders a loading page (AppRoot with a loader-status store), prefetches the immediately tier in
     parallel with mounting the vendored cordis Loader, then creates one loader entry per plugin row +
     the app-shell entry, awaits the tree, sweeps entries for ACTIVE fibers, and flips the settled signal.
- packages/client/web/src/AppRoot.tsx + app.tsx (buildRenderApp) + app-shell.ts
  (APP_SHELL_ID, AppShellService.renderApp()) — the real UI once settled.
- Dev loop: pnpm run dev:web → scripts/dev-web.ts watch-builds every dsh.client plugin bundle with
  tsdown; the webserver stat-polls the bundles and broadcasts rebuilt frames; packages/client/hmr
  reloads the browser. (In production there is no Vite dev server — dsh web serves the built dist.)

> Port note: the entire module-graph / cordis / HMR machinery is DSH-specific. A static dashboard needs only a
> Vite build + a JSONL loader; see section 5.

---

## 2. How the Trajectory page is reached: route → view → data

There are `no URL routes` for views. The UI is a session workspace: a session header shows a ring of view tabs
(conversation.view slot, declared by the owning package packages/client/ui-conversation/src/client/contract/slots.ts
lines ~70–76: `one list entry per view tab (chat here; trajectory/waterfall from ui-trajectory), rendered
one-at-a-time by the session body via only: <active id>`).

1. `Registration` — packages/client/ui-trajectory/src/client/index.ts (the package's browser plugin entry,
   apply(ctx)):
   - Registers locale dictionaries (NS = 'trajectory', locales.ts — tab label view.trajectory = "Trajectory"/"轨迹").
   - Registers five event Definitions and the view builder (section 3).
   - Injects the tab: ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view',
     id: 'trajectory', order: 10, label: () => t('view.trajectory'), inject: (sessionId) => ... }, TrajectoryView)).
     The inject face (TrajectoryViewInjected) provides loadOlder() (wraps session.loadOlder()),
     hooks.duration (a persisted SnapshotStore<boolean>, duration-store.ts, key dsh.trajectory.duration),
     and setActualDuration.
2. `Mounting` — the session body ConversationSession (packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx,
   lines ~165–172) renders renderSlot('conversation.view', {...}, { only: active.id }) — one view at a time,
   so the Trajectory tab mounts TrajectoryView only while selected. The active id lives in the chat store
   (useStore(s => s.view)).
3. `Data source` — TrajectoryView (packages/client/ui-trajectory/src/client/TrajectoryView.tsx) reads the
   session snapshot reactively:
   const inspection = useSession(snapshot => snapshot.views.get('trajectory') ?? EMPTY_TRAJECTORY_SNAPSHOT).
   useSession is the conversation-slot runtime kit (uSES-style selector over ConversationSnapshot).
   Paging flags: openState === 'loading', loadingOlder, hasMore.

---

## 3. Data model: raw JSONL → trajectory snapshot → rows

### 3.1 Raw log format (the JSONL)
- Header line: { type: 'session', version, id, createdAt, cwd?, parentSession?, seedLength?, origin?, delegationDepth, agentPreset? }
  (packages/session/session-persistence-jsonl/src/format.ts — HeaderLine, toHeaderLine/fromHeaderLine).
- Event lines: SessionEvent (packages/core/session/src/types.ts) — a discriminated union over
  SessionEventMap keyed by type:
  { type, seq (monotonic int), time (epoch ms), data, ignorable?, surfaceOp?, sourceEventSeqs? }.
  Core event types: turn/start, turn/end (with TurnEndReason), step/start, step/end,
  user/message, assistant/chunk (raw StreamChunk), assistant/message (+ usage),
  tool/call, tool/result, request/header (EpochHeader = config + system + tools, reason),
  request/context, todo/write, session/end-seed. Plugins merge additional types
  (e.g. compaction/start|summary|end, agent/inbox/spliced, command/run|done, llm/retry).
  The schema is merge-extensible; ignorable: true marks events a reader may skip.
- Persistence: packages/session/session-persistence-jsonl (compression zstd or plaintext, suffix
  .jsonl.zstd/.jsonl); format version constant SESSION_FORMAT_VERSION = 0 in core/session/src/types.ts.

### 3.2 Runtime transform: the conversation node assembler
- packages/client/runtime/src/client/sessions/conversation-assembler.ts — ConversationNodeAssembler,
  a per-session `incremental engine over a contiguous event window`:
  - Window ops: replaceWindow(entries, hasMore) (full open/resync), append(event) (live tail),
    prepend(entries, hasMore) (older page, preserves Context/view identity), rebuildRegistry(), flush()
    (materializes dirty Contexts → view nodes → advances every registered view builder).
  - Registered ConversationNodeDefinition (packages/client/runtime/src/client/contract/conversation.ts):
    match(event) -> {id, role: 'start'|'update'} | null, start(context, match, reader), update(...),
    optional publication (none/animation-frame/immediate), optional buildLocationData (turn/step-scoped
    business values), optional buildViewNode(context) -> ConversationViewNode | null.
  - Location hierarchy: ConversationLocationIndex (conversation-location-index.ts) derives
    ConversationLocation = session | turn (TurnLocation) | step (StepLocation) | unresolved from
    turn/start|end + step/start|end.
  - View targets: ConversationViewDefinition/ConversationViewBuilder (replace/apply per transaction);
    snapshots published through ConversationViewSnapshotStore (session.getSnapshot().views.get(target)).
  - The Session wrapper: packages/client/runtime/src/client/sessions/session.ts (window lifecycle,
    open(), loadOlder() RPC paging with beforeSeq/maxMessages, gap detection, live-buffer stitching,
    snapshot assembly with openState/hasMore/loadingOlder); manager.ts (session store), provide.ts,
    conversation.ts (final node types + ConversationSnapshot).
- Node types (packages/client/runtime/src/client/sessions/conversation.ts): ConversationNode union =
  UserMessageNode, AssistantMessageNode (blocks: AssistantBlock[], usage, provenance,
  requestConfig, timing?: AssistantTiming, interrupted?), SteeringMessageNode, ContextMessageNode,
  ModelRetryNode, TurnErrorNode, TurnMaxTokensNode, ToolResultNode (call, callTime,
  content, isError, subCalls), CommandNode, CompactionSummaryNode, UnknownSurfaceNode.
  AssistantBlock = text | reasoning | image | tool-call | other (classified by toAssistantBlock).
  RunningToolCall + ToolCallBlock = RunningToolCall | ToolResultNode (recursive subCalls tree).
  PartialAssistant {turn, step, blocks} — the in-flight accumulator.
  AssistantTiming {stepStartTime, firstTokenTime, completedTime} from sessions/assistant-timing.ts
  (fold over step/start + first assistant/chunk token delta; isTokenDelta re-exported from @deepseek-ai/dsh-llm/message).

### 3.3 Trajectory-specific Definitions (event → contribution)
All in packages/client/ui-trajectory/src/client/; each is a ConversationNodeDefinition with
target: 'trajectory' producing a TrajectoryConversationViewNode
(trajectory-contract.ts: {key, kind, id, target:'trajectory', anchorSeq, location, data}; data is a
TrajectoryContribution discriminated union: node | assistant | tool | request-header | compaction |
session-end | turn-end). The envelope helper is trajectoryNode(...) in trajectory-definition-common.ts.

- trajectory-message-definitions.ts — trajectory-input-message matches user/message and emits
  user / steering / context nodes (inbox classification via trajectory-inbox-next-step which
  folds agent/inbox/spliced events into pending/claimed sets).
- trajectory-request-header-definition.ts — trajectory-request-header matches request/header and
  builds TrajectoryRequestHeaderState {seq, time, prompt: ConversationPromptSnapshot, change?, location}
  where change is a RequestPromptChange (kind initial|system|tools|system-and-tools) diffed against the
  previous header.
- trajectory-assistant-definition.ts — folds step/start, assistant/chunk (block-start/text-delta/
  reasoning-delta/tool-call/usage/finish), assistant/message, step/end, turn/end into an
  AssistantMessageNode + an AssistantRequestView (see 3.4); interruption-frozen partials and retry
  metadata are handled here.
- trajectory-tool-definition.ts — matches tool/call + tool/result and builds the ToolCallBlock
  tree (rootCall/rootResult/childCall/childResult, cycle-guarded MAX_DEPTH = 256); sub-calls
  arrive via nested dispatch events.
- trajectory-compaction-definition.ts — trajectory-compaction matches compaction/start|summary|end
  (plus the user/message checkpoint whose source is plugin: 'compact') and assembles a
  CompactionRequestView; trajectory-session-end matches session/end-seed (used to interrupt
  running compactions).

### 3.4 Request inspection (request → usage/timing/provenance)
packages/client/runtime/src/client/sessions/request-inspection.ts:
- ConversationPromptSnapshot {config: AssistantRequestConfig, system: string, tools: ToolSchema[]}.
- RequestView = AssistantRequestView | CompactionRequestView, both extending RequestViewBase
  {startSeq, startedAt, completedAt, status: running|complete|error, error?, provenance?, requestConfig?, usage?, resultSeq?}.
  Assistant requests add turn, step, prompt, promptChange, retry, maxRetries, retryDelayMs.
  Compaction requests add turn: number | null (null = standalone between turns), replacementSeq, summary, rawOutput.
- RequestInspectionSnapshot {requests, callSchemas}.

### 3.5 The trajectory snapshot (the view's data source)
packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts:
- TrajectorySnapshotBuilder implements ConversationViewBuilder<TrajectoryConversationViewNode, TrajectorySnapshot>.
  snapshot() (lines ~175–256) walks sorted contributions and produces
  TrajectorySnapshot {eventNodes, eventLocations, requests, callSchemas, partial, runningCalls}
  (trajectory-contract.ts), including:
  - interruptCompactions — a compaction still running when a session-end boundary passes becomes error.
  - applyTurnErrors — a turn/end with an error marks the turn's last assistant request error.
  - headerFor/applyHeader — inherit the effective prompt header per assistant request; promptChange
    attached once (dedup via consumedPromptChanges).
- trajectoryViewDefinition = {target: 'trajectory', create: () => new TrajectorySnapshotBuilder()};
  registered by registerTrajectoryConversationView(ctx) → ctx.conversationViews.register(...).
- EMPTY_TRAJECTORY_SNAPSHOT — stable empty value before a session assembles records.

### 3.6 The layout fold (snapshot → visible rows)
packages/client/ui-trajectory/src/client/layout.ts — deriveTrajectoryLayout(input: TrajectoryLayoutInput)
is the pure fold from TrajectorySnapshot to:
- TrajectoryTurnModel {turn: number | null, groups: TrajectoryGroupModel[]}
  (null turn = standalone compaction section "between turns");
- TrajectoryGroupModel {title, description?, cells: TrajectoryCellProps[]} — title is Message or
  Step N (or Compaction <seq>);
- TrajectoryCellProps (trajectory-record.ts) — the closed record model: kind (system|user|context|
  compacted|message|tool|subtool), index (#N), text, previewMarkdown, opensTurn, sourceSeq,
  requestOnly, inputDetail/outputDetail/thinkingDetail, sourceBlocks/outputBlocks,
  promptDetail/previousPromptDetail, schemaDetail, assistantMetrics, result, callId,
  isError, timeSeconds, startedAt, token counts input/cacheRead/cacheWrite/output/think,
  selected. Identity: trajectoryRecordId(cell) — recordId ?? kind\0call\0<callId> ?? kind\0seq\0<seq> ?? index.
- Key behaviors of the fold (lines ~138–523):
  - Interleaves nodes + compaction requests + system prompt-change entries + request-only entries into one
    OrderedLayoutEntry list sorted by seq (initial system header sorts first).
  - pushMessage / pushStep / pushStepInput bucket cells into per-turn groups; an assistant with
    step > 0 becomes Step N; step-0 assistants go into Message.
  - User/context nodes have no turn on the wire; they are enclosed by the `following` assistant
    (enclosingUserTurn, followingAssistants), steering messages placed into their step.
  - expandAssistant splits blocks into message (text joined), thinking (reasoning joined), and tool rows;
    tool rows are paired with results (indexResults) and sub-calls (expandSubCalls), durations from
    callTime→result time, schemas attached (attachToolSchema, callSchemas).
  - compaction entries become a compacted cell with summary/output/source blocks; standalone compactions
    (turn === null) become separate TrajectoryTurnModel with turn: null.
  - In-flight data: partial (streaming assistant) appended via appendTrajectoryPartialLayout;
    runningCalls appended as tool cells when not already represented.
  - Orphan turn-0 cells fold into Turn 1 (prologue handling).
  - groupDescription — per-group wall-span duration + tool histogram text (e.g. `1.5 s bash×6`).
- timeline.ts — the overview projection: deriveTrajectoryTimeline(turns, mode) produces
  TrajectoryTimelineModel {start, end, spans, turnBoundaries} with 3 lanes (0 system/user/context,
  1 message/compacted, 2 tool/subtool); modes sequence (equal-width), duration (recorded durations,
  idle compressed), time (real clock, idle kept), actual (recorded durations, idle kept);
  trajectoryTimelineFocusIndexes(turns, range, mode) maps a selected interval back to record indexes.

---

## 4. Key UI mechanics worth noting for a port

All in packages/client/ui-trajectory/src/client/; components are React (with *.module.css).

### 4.1 TrajectoryView (state owner) — TrajectoryView.tsx
- Owns: collapsedTurns/collapsedAssistants (Set state), timelineSelection (range), search query,
  actualDuration/actualTime toggles, selection/focus of timeline records.
- Computes requestNumbers (TrajectoryRequestNumber[]): per-request numbering across the whole ledger —
  each assistant request (or compaction) gets #N, carries status/startedAt/completedAt/error/retry/
  resultSeq/provider/model/requestConfig/usage/cumulativeUsage. This is the data behind the table's request
  header rows and the inspector's request summary.
- Derives the finalized layout once (deriveTrajectoryLayout) and a `streaming` overlay
  (appendTrajectoryPartialLayout); search index updated throttled (3 s) over both.

### 4.2 Toolbar — TrajectoryToolbar.tsx
Sticky toolbar: Duration toggle (actual durations vs equal-width), actual-time switch (hidden), "Collapse
turns" / "Collapse calls" (whole-list fold), and a search box feeding TrajectorySearchIndex.

### 4.3 Overview timeline — TrajectoryTimeline.tsx + timeline.ts
Chrome-Network-style overview above the ledger:
- Renders spans per record in the active mode; turn boundaries drawn as markers.
- Wheel zoom (MINIMUM_ZOOM_OPERATIONS = 4), drag-to-select an interval, edge pan; selecting an interval
  focuses the ledger on all records active in the range (trajectoryTimelineFocusIndexes) and clears on
  escape/outside click.
- 500 ms hover tooltip: TTFT (firstTokenTime − stepStartTime) and decode (completedTime − firstTokenTime)
  for assistant records (assistantTimingDetail), start→end clock range.
- If older history is unloaded and the loaded domain start is visible, an ellipsis control loads one earlier
  page (onLoadEarlier → loadOlder) without fabricating durations for unknown history.

### 4.4 Ledger table + virtualization — TrajectoryTable.tsx (largest file, ~3.1k lines)
- Flattens TrajectoryTurnModel → TableRecord {turn, section, group, groupStart, turnStart, cell, turnEnd,
  collapsedSummary?, collapsedSummaryKind?} (section = virtual row section id used for sticky headers).
- `Virtualization`: @tanstack/react-virtual useVirtualizer (lines ~1774–1809):
  - Enabled when records.length > VIRTUALIZATION_THRESHOLD (100) `or` hasOlderRecords.
  - count = projected virtual row count; estimateSize from a `stable structure cache`
    (useStableVirtualRowStructure — reuses previous {key, height}[] when row keys/heights are unchanged, so
    the virtualizer's scroll offsets survive prepends), getItemKey = trajectoryVirtualRecordKey,
    getScrollElement = the [data-trajectory-scroll] pane, initialRect height 600,
    anchorTo: 'end' (opens at the tail), overscan: 12, scrollEndThreshold: 2 (bottom-follow),
    scrollMargin = history-load-row height when older history exists.
  - Row projection: groupTrajectoryVirtualRows(records) (trajectory-virtual-rows.ts) — measurable rows of
    fixed heights (content 30 px, collapsed summary 20 px, terminal request boundary 9 px); `request-only
    separators (zero-height logical records) are attached to the next content row` so the virtualizer never
    owns a zero-height item; semantic keys use encodeURIComponent(trajectoryRecordId) (+ \0summary\0<kind>).
  - Rendering: only rowVirtualizer.getVirtualItems() are mounted; virtualTop/virtualBottom padding
    divs preserve scroll height; rows carry data-trajectory-row-key, aria-rowcount = logical record count.
  - History paging: when hasOlderRecords, a first-row "load older" control precedes the loaded records
    (HISTORY_LOAD_ROW_HEIGHT_PX = 30), turns into a disabled loading row while pending; hitting the top
    scroll edge (OLDER_LOAD_THRESHOLD_PX = 48) also triggers onLoadOlder.
- Collapse/fold: collapseTurnRecords/collapseAssistantRecords produce summary rows
  (collapsedSummary = "N items"); a message whose next cell is tool/subtool is "collapsible assistant".
- Search filter: filterRecords(allRecords, searchMatchIndexes) keeps only matching records and highlights
  them (data-search-match); matches also tint the timeline spans.
- `Inspector`: selecting a record opens a local details panel with tabs system-prompt | tools | overview |
  rendered | raw | source | input | output | schema | options | usage | timing | diff; renders markdown
  (MarkdownText), JSON (JsonTree from @deepseek-ai/dsh-client-ui-primitives), prompt-change diffs
  (structuredPatch from the diff package), assistant metrics (TTFT/decode/throughput), usage incl.
  cumulative, provider/model/config/retry, and parent message/tool records.
- Sticky chrome inside the scrollport: turn headers (TrajectoryTurnHeader — "Turn N" + Input/Output/Think/Time
  column labels), group headers (TrajectoryGroupHeader — title + description), row type icons + labels
  (KIND_LABEL/KIND_ICON). TrajectoryTurn.tsx/TrajectoryCell.tsx are the small standalone
  wrappers; the table renders its own rows inline.
- Accessibility contract exercised by e2e: table[data-scroll-ready="true"], tr[data-trajectory-row-key],
  aria-rowcount = logical rows, stable first-visible-row key across prepends (geometry tolerance 2 px).

### 4.5 Search index — trajectory-search-index.ts + preview — trajectory-preview.ts
- TrajectorySearchIndex: incremental full-text index keyed by trajectoryRecordId; sources include turn
  label, group title, kind, text, previews, input/output/thinking details, schema, result, callId, source/
  output blocks, messageSource/prompt JSON; re-parses markdown previews only when sources change; query =
  space-separated terms, all must match (case-insensitive).
- trajectoryPreviewText: bounded markdown→plain-text (2 048 source chars → 512 preview chars) for one-line
  summaries.

### 4.6 Duration store — duration-store.ts
createTrajectoryDurationStore() = createSnapshotStore(false, { persist: { name: 'dsh.trajectory.duration' } })
— a browser-wide persisted boolean (actual-duration preference) shared by every session view in one plugin
lifecycle.

---

## 5. Porting map: what a Vue 3 + Vite static dashboard needs

Target: llm-interview — Vue 3 + Vite STATIC dashboard; data source = session.jsonl (each line a
message/tool event, mirroring the DSH log; verify the exact line schema against the project's own writer before
coding).

### 5.1 Generic concepts — port 1:1
| Concept | DSH reference | Port as |
|---|---|---|
| JSONL line → event | SessionEvent envelope {type, seq, time, data}, header line | A small parser module; validate envelope + seq ordering; tolerate unknown types |
| Turn/step boundaries | turn/start|end, step/start|end; ConversationLocationIndex | Fold into turn→step hierarchy; status open/closed |
| Messages | user/message, assistant/message (+ chunks) | Node model: user / context / assistant with blocks |
| Streaming chunks | assistant/chunk StreamChunk (block-start/text-delta/reasoning-delta/tool-call/usage/finish) | Accumulate into blocks; track first-token time for TTFT |
| Tool calls/results | tool/call + tool/result, subCalls | Pair by callId; build sub-call trees; running = call without result |
| Request headers | request/header {config, system, tools} | Prompt/system/tool-catalog snapshots + change diffs |
| Compaction | compaction/start|summary|end (+ checkpoint) | Compacted record with summary; standalone vs turn-owned |
| Request inspection | request-inspection.ts | Derive per-request {status, startedAt, completedAt, usage, provider/model, retry} + cumulative usage |
| Layout fold | layout.ts deriveTrajectoryLayout | Turns → Message/Step groups → cells (kind/index/text/metrics/time) |
| Sticky turn headers + group headers | TrajectoryTurnHeader/TrajectoryGroupHeader | Sticky table/section headers; Input/Output/Think/Time columns |
| Virtualization | @tanstack/react-virtual + trajectory-virtual-rows.ts | @tanstack/vue-virtual (or vue-virtual-scroller): end-anchored open, overscan ~12, stable row keys, threshold ~100 rows, load-earlier row + bottom-follow |
| Overview timeline | timeline.ts + TrajectoryTimeline.tsx | 3-lane spans, modes sequence/duration/time/actual, drag-to-focus, wheel zoom, TTFT/decode hover |
| Toolbar | TrajectoryToolbar.tsx | Duration/equal-width toggle, collapse all turns/calls, search |
| Search | TrajectorySearchIndex | Incremental full-text index over cell sources; throttled rebuild |
| Details inspector | TrajectoryTable.tsx tabs | Local panel: rendered/raw/source/input/output/schema/usage/timing/diff |
| Preview | trajectory-preview.ts | Bounded markdown→text helper |
| Record identity | trajectoryRecordId | Stable key: recordId ?? kind+callId ?? kind+seq — critical for virtualization across "load older" prepends |

### 5.2 deepseek-harness-specific machinery — replace or drop
| DSH mechanism | Why it's DSH-specific | Static-dashboard replacement |
|---|---|---|
| Cordis plugin tree, ctx.slots.inject('conversation.view'), ctx.conversationEvents/Views registries, service injection | Entire DI/composition framework | Vue components + a typed store (e.g. Pinia or a plain reactive module); register views as components, not slots |
| window.__DSH_BOOT__ module graph, ClientModuleSystem, /plugins/*/client.js bundle serving, HMR reload frames | Host-injected dynamic module loading + live bundle rebuild | Standard Vite static build / dev server; no bootstrap manifest |
| Runtime RPC/WebSocket uplink + downlink (@deepseek-ai/dsh-api-remotes, client-connection, api-gateway), history paging RPC (beforeSeq/maxMessages) | Live session transport | Synchronous JSONL loader: parse once into memory (or lazy pages for very large files); "load older" = reveal earlier parsed events, hasMore = more lines remain |
| useSession/snapshot store, ConversationSnapshot window lifecycle, live append | Live-reactive session state | Reactive store updated on load; no live events |
| Tool render intents (ToolEventView, callView/resultView, wire meta payloads) | Host-computed presentation hints per tool | Generic JSON/markdown cards; per-tool renderers optional |
| surfaceOp/sourceEventSeqs compaction surface semantics, session/end-seed seed boundary, agent/inbox/spliced queue | Harness log semantics | Simplify: a compaction marker row is enough; drop queue/seed machinery unless the project's log carries it |
| StreamChunk types from @deepseek-ai/dsh-llm, TokenUsage, ToolSchema | LLM-layer types | Define local equivalents matching session.jsonl fields |
| Plugin locale namespaces + i18n bindings | Plugin i18n plumbing | vue-i18n or a plain dictionary |
| e2e golden snapshots (apps/web/tests/snapshots/*.expected.md, aria-tree snapshots) | DSH test harness | Playwright assertions on your own DOM contract (mirror [data-trajectory-scroll], data-trajectory-row-key, aria-rowcount) |

### 5.3 Suggested port architecture (one paragraph)
A single useTrajectory(events)-style composable (or store) that: (1) parses session.jsonl into typed
events; (2) folds turns/steps and reconstructs nodes (messages, tool trees, compactions, request headers,
usage/timing); (3) runs the snapshot assembly (request inspection + compaction interruption + turn errors);
(4) runs the layout fold into {turns, groups, cells}; then the view renders a toolbar, an overview
timeline, and a virtualized ledger with sticky turn/group headers and a details inspector. Keep the pure
transform functions (parse → assemble → fold → project) framework-free and unit-testable; only the last mile
(components + virtualization + search index) is Vue.

### 5.4 Tests to mirror
- Unit: packages/client/ui-trajectory/tests/ — layout.client.spec.tsx, table.client.spec.tsx,
  cell.client.spec.tsx, snapshot-builder.client.spec.ts, virtual-rows.client.spec.ts,
  conversation-definitions.client.spec.ts, views.client.spec.tsx, client-bundle.client.spec.ts.
- E2E: apps/web/tests/trajectory-virtualization.e2e.ts (tail-paged virtualization contract: semantic row
  identity survives prepends, DOM mounting bounded, every scroll range reachable; see MAX_MOUNTED_ROWS = 160,
  geometry tolerance 2 px) and apps/web/tests/navigation-panes.e2e.ts snapshot
  tests/snapshots/navigation-panes/trajectory.expected.md.

### 5.5 Deep-dive references inside the harness repo
- Architecture notes (referenced by the code): .agents/notes/implemented/architecture/2026-08-09-client-conversation-node-assembly.md
  (event→node assembly; target-owned definitions), 2026-08-10-session-log-version-mechanism.md.
- Slot catalog: packages/extensions/cordis-client-runner/src/client/slot-catalog.ts (doc for
  conversation.view and the trajectory tab, lines ~970–1015).
- The README of the trajectory package: packages/client/ui-trajectory/README.md (behavioral spec of the
  ledger/timeline; also lists known limitations: blank in-flight time, no deep-link anchors).
