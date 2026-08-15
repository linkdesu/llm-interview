# Analyzer is a Bun-served dynamic SPA, not a static build-time manifest

The Dashboard is a statically built site: a build-time Manifest flattens the session archive into the published bundle, and the SPA only fetches `manifest.json`. It has no runtime server, and it can only show the latest Run per Combo.

The Analyzer has the opposite need: it must list the full session history and serve an arbitrary archived `session.jsonl` on demand, so an operator can pick any historical Session and inspect its trajectory. A static manifest cannot enumerate an ever-growing archive without a re-build, and copying every historical transcript into a static bundle would grow without bound.

Therefore the Analyzer is a Bun-served dynamic SPA: one Bun process serves a read-only JSON API over the on-disk `session/` tree (`GET /sessions`, `GET /session/…/session.jsonl`) and also serves the built SPA. The frontend stays a Vue 3 + Vite SPA with the Dashboard's exact dependency set, and it keeps all `session.jsonl` derivation — turn reconstruction, tool call↔result pairing, timestamp normalization — in a unit-testable frontend library, so the backend stays a thin passthrough.

This reintroduces a runtime process where the Dashboard has none, in exchange for (1) a sidebar that always reflects the archive without a re-build and (2) reachability of every Session, not just the latest per Combo. The trade-off is accepted because the Analyzer is an operator tool run locally, not a public static artifact, so it does not need the Dashboard's zero-process deployment.
