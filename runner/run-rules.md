# Run Rules

These rules apply to every run, regardless of the question.

- Each ticket is independently verifiable. Order is your choice — pick whichever makes sense as the next step.
- After completing each ticket, review and test your work before proceeding.
- ALWAYS use chrome-devtools-axi for pure DOM testing (layout, text, buttons, forms).
- Games/animations: no screenshots, no per-tick logs. From the start, expose game state on `window` and make the loop steppable; then verify with an in-page self-test that steps the game with scripted inputs, asserts the rules in code, and prints one PASS/FAIL summary (state samples on failure only); remove when done.
- Background processes (`&`) MUST redirect output to a file (`> out.log 2>&1 &`) — an inherited stdout pipe hangs the tool call forever.
- ONLY write less than 500 lines in a single `write` call.
- ALWAYS write skeleton (structure + function signatures + key comments + empty implementations) first for new large files, then fill sections with `edit`.
