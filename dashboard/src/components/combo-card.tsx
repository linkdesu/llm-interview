import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  comboLabel,
  formatDuration,
  type ComboEntry,
} from "@/lib/manifest";
import { parseTranscript, type TranscriptItem } from "@/lib/transcript";
import { routeHash } from "@/lib/router";
import { TranscriptTimeline } from "./transcript-timeline";

type TranscriptState =
  | { status: "collapsed" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; items: TranscriptItem[] };

/**
 * One combo in the question comparison grid: model header with status dot,
 * live artifact preview, and lazy transcript. Port of the legacy ComboCard.
 */
export function ComboCard({ combo }: { combo: ComboEntry }) {
  const [transcript, setTranscript] = useState<TranscriptState>({
    status: "collapsed",
  });

  const expandHash = routeHash({ name: "session", comboId: combo.comboId });

  async function toggleTranscript() {
    if (transcript.status !== "collapsed") {
      setTranscript({ status: "collapsed" });
      return;
    }
    setTranscript({ status: "loading" });
    try {
      // Paths in the Manifest are relative to the app base.
      const response = await fetch(combo.files.transcript as string);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const jsonl = await response.text();
      setTranscript({ status: "loaded", items: parseTranscript(jsonl) });
    } catch (error) {
      setTranscript({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <header>
        <div className="flex items-center gap-2">
          {/* The theme has no success token; green mirrors the legacy --ok. */}
          <span
            data-status={combo.status}
            aria-label={`Status: ${combo.status}`}
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full bg-destructive",
              "data-[status=ok]:bg-emerald-600 dark:data-[status=ok]:bg-emerald-400",
            )}
          />
          <strong className="truncate text-base font-semibold">
            {combo.model.name}
          </strong>
          <span className="truncate text-xs text-muted-foreground">
            {combo.model.provider}
          </span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatDuration(combo.durationMs)}
          </span>
        </div>
        {combo.maxTurnsExceeded && (
          <p className="mt-2 text-xs text-destructive">
            max turns ({combo.maxTurns}) exceeded
          </p>
        )}
        {combo.loopDetected && (
          <p className="mt-2 text-xs text-destructive">
            loop detected (confidence {combo.loopConfidence})
          </p>
        )}
        {combo.contractViolations.length > 0 && (
          <p className="mt-2 text-xs text-destructive">
            Contract violations: {combo.contractViolations.join("; ")}
          </p>
        )}
      </header>

      {/* allow-same-origin is required: without it the iframe gets an opaque
          origin and <script type="module"> artifacts fail their CORS check.
          The sandbox still blocks top navigation, popups, forms, etc. */}
      {combo.files.artifact ? (
        <>
          <iframe
            className="mt-3 block h-80 w-full rounded-md border border-border bg-white pointer-events-none sm:pointer-events-auto"
            src={combo.files.artifact}
            title={comboLabel(combo)}
            sandbox="allow-scripts allow-same-origin"
          />
          <p className="mt-1.5 text-xs text-muted-foreground sm:hidden">
            Live preview · interactive on desktop
          </p>
        </>
      ) : (
        <div className="mt-3 flex h-80 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          No artifact for this run
        </div>
      )}

      <div className="mt-3 flex gap-4">
        <a
          href={expandHash}
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary underline-offset-2 hover:underline"
        >
          ⛶ Expand
        </a>
        {combo.files.transcript && (
          <button
            type="button"
            onClick={toggleTranscript}
            className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary underline-offset-2 hover:underline"
          >
            {transcript.status === "collapsed"
              ? "Transcript ▸"
              : "Transcript ▾"}
          </button>
        )}
      </div>
      {transcript.status === "loading" && (
        <p className="mt-2 text-sm text-muted-foreground">
          Loading transcript…
        </p>
      )}
      {transcript.status === "error" && (
        <p className="mt-2 text-sm text-muted-foreground">
          Failed to load transcript: {transcript.message}
        </p>
      )}
      {transcript.status === "loaded" && (
        <div className="max-h-[480px] overflow-y-auto">
          <TranscriptTimeline items={transcript.items} />
        </div>
      )}
    </article>
  );
}
