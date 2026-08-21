import { comboLabel, type ComboEntry } from "@/lib/manifest";

export interface SessionViewProps {
  combo?: ComboEntry;
}

/**
 * Session fullscreen placeholder (slice B replaces this with the artifact +
 * run metadata).
 */
export function SessionView({ combo }: SessionViewProps) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      {combo ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {comboLabel(combo)}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Session detail content lands in the next slice.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Session not found
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">No combo matches this link.</p>
        </>
      )}
    </section>
  );
}
