import type { ComboEntry } from "@/lib/manifest";

export interface QuestionViewProps {
  question: string;
  combos: ComboEntry[];
}

/**
 * Question detail placeholder (slice B replaces this with the combo
 * comparison grid).
 */
export function QuestionView({ question, combos }: QuestionViewProps) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{question}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {combos.length} session{combos.length === 1 ? "" : "s"} for this question.
      </p>
    </section>
  );
}
