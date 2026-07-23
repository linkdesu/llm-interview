# Runner configuration uses TOML with a shared global-rules file

The per-run model registry (`models.registry.json`) was replaced by a `runner/config.toml` that holds all runner-level settings: model entries, `max_turns` (logical turn limit), and a `run_rules` path (points to `runner/run-rules.md`). The TOML format was chosen over extending JSON (`models.registry.json`) because TOML natively supports inline comments, multi-line strings for rules, and a cleaner syntax for nested model parameters.

`run-rules.md` contains instructions injected into every prompt (ticket autonomy, self-review, chrome-devtools-axi for HTML pages). This keeps global rules version-controlled, centralized, and editable without touching code. `buildPrompt()` reads the file content at run time and appends it before the artifact contract.
