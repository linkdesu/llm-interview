# The wall-clock timeout is removed; only the max turn limit kills a run

The Runner's wall-clock `timeoutMs` (default 10 minutes, `--timeout-ms` CLI flag) was a leftover from before ADR 0003 and killed runs at arbitrary points — even healthy runs that were making steady progress but simply needed more time (larger questions on slower models regularly hit the 10-minute ceiling). Since ADR 0003 added the logical turn counter, the turn limit is the only signal that actually distinguishes a looping agent from a slow-but-productive one.

The wall-clock timer, the `timedOut` result flag, the `"timeout"` run status, and the `--timeout-ms` CLI option are removed. A run now ends in exactly two ways: the pi process exits on its own (status `"ok"` or `"error"` by exit code), or it is killed for exceeding `max_turns` (status `"error"` with `maxTurnsExceeded: true`). Older archives keep their `"timeout"` status untouched; the manifest passes status through as recorded.
