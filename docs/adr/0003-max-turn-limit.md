# A 100-turn safety limit guards against AI agent loops

pi's wall-clock `timeoutMs` cannot detect a looping agent that makes rapid, low-cost tool calls within the time budget. The Runner adds a logical turn counter: each `turn_start` JSON event (one model iteration) increments a counter; when it exceeds 100, the pi process is killed with SIGKILL and flagged as timeout. The counter resets at the start of each run. This is a last-resort guard — the intended loop prevention strategy is well-structured tickets and the chrome-devtools-axi skill for browser-based verification.
