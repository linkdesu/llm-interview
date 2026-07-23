# AI output is streamed via pi JSON mode with custom event rendering

pi's `--mode json` emits each session event (thinking delta, text delta, tool use, tool execution, compaction, retry, queue update) as a JSON line on stdout. The Runner pipes this stream through a custom renderer (`renderJsonEvent` in `pi-runner.ts`) that parses each line and writes human-readable text to the terminal. This replaces pi's built-in `--mode text` output, which only prints the final assistant response and reveals nothing about intermediate tool calls or model thinking.

Runner operational logs (`[pi]`, `[matrix]` prefixes) go to stderr, keeping stdout reserved for the rendered AI event stream. Ansi dim/bold/yellow codes are used sparingly to distinguish metadata from model-generated content.

This approach was chosen over a TUI library (zero dependencies) and over raw passthrough (would show raw JSON fragments).
