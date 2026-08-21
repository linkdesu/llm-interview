import { useMemo, useState } from "react";
import { filterCombos, summarizeQuestions, type ComboEntry } from "@/lib/manifest";
import { routeHash } from "@/lib/router";

/**
 * Home-page question index: keyword filter (filterCombos semantics) over the
 * summarizeQuestions rows; each row links to `#/q/<question>`.
 */
export function QuestionIndex({ combos }: { combos: ComboEntry[] }) {
  const [query, setQuery] = useState("");
  const summaries = useMemo(
    () => summarizeQuestions(filterCombos(combos, query)),
    [combos, query],
  );

  return (
    <section id="questions" className="mx-auto max-w-5xl px-4 pb-16">
      <h2 className="text-xl font-semibold tracking-tight">Questions</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every question has its own page with all runs side by side.
      </p>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by keyword…"
        aria-label="Filter questions"
        className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {summaries.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No questions match “{query.trim()}”.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {summaries.map((summary) => (
            <li key={summary.name}>
              <a
                href={routeHash({ name: "question", question: summary.name })}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted"
              >
                <span>
                  <span className="font-medium">{summary.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {summary.models.join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {summary.sessionCount} {summary.sessionCount === 1 ? "run" : "runs"}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
