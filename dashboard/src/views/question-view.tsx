import { useMemo, useState } from "react";

import { ComboCard } from "@/components/combo-card";
import { filterCombos, type ComboEntry } from "@/lib/manifest";

export interface QuestionViewProps {
  question: string;
  combos: ComboEntry[];
}

/**
 * Question detail: all combos for the question rendered side by side, each
 * with a live artifact preview. Mirrors the legacy QuestionView (back link,
 * keyword filter, responsive card grid).
 */
export function QuestionView({ question, combos }: QuestionViewProps) {
  const [query, setQuery] = useState("");

  const visibleCombos = useMemo(
    () => filterCombos(combos, query),
    [combos, query],
  );

  const latestEndedAt = useMemo(
    () =>
      combos.reduce(
        (max, combo) => (combo.endedAt > max ? combo.endedAt : max),
        "",
      ),
    [combos],
  );

  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <a
        href="#/"
        className="text-sm text-primary underline-offset-2 hover:underline"
      >
        ← All questions
      </a>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
        {question}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {combos.length} {combos.length === 1 ? "model" : "models"} · latest run{" "}
        {latestEndedAt.slice(0, 10)}
      </p>
      <input
        type="search"
        name="model-filter"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter models ⌕"
        aria-label="Filter models"
        className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-72"
      />
      {combos.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Unknown question — no sessions recorded.
        </p>
      ) : visibleCombos.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No matching combos</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
          {visibleCombos.map((combo) => (
            <ComboCard key={combo.comboId} combo={combo} />
          ))}
        </div>
      )}
    </section>
  );
}
