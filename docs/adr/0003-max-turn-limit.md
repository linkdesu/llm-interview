# A 100-turn safety limit guards against AI agent loops

pi's wall-clock `timeoutMs` cannot detect a looping agent that makes rapid, low-cost tool calls within the time budget. The Runner adds a logical turn counter: each `turn_start` JSON event (one model iteration) increments a counter; when it exceeds 100, the pi process is killed with SIGKILL and flagged as timeout. The counter resets at the start of each run. This is a last-resort guard — the intended loop prevention strategy is well-structured tickets and the chrome-devtools-axi skill for browser-based verification.

The limit is configurable: `max_turns` in `config.toml` sets the global default (100), and each `[[models]]` entry may override it with its own `max_turns` to give weaker models more attempts. A run killed this way is recorded explicitly as `maxTurnsExceeded: true` in its `run.json` (status `"error"`), since hitting the limit usually means the agent looped or could not solve the task.
