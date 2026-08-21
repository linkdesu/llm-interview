import { useEffect, useState } from "react";

import ParticleText from "@/components/react-bits/particle-text";
import { TranscriptTimeline } from "@/components/transcript-timeline";
import { useReducedMotion } from "@/components/home/use-reduced-motion";
import { Button } from "@/components/ui/button";
import {
  comboLabel,
  formatDuration,
  formatParam,
  type ComboEntry,
} from "@/lib/manifest";
import { parseTranscript, type TranscriptItem } from "@/lib/transcript";
import { routeHash } from "@/lib/router";
import { cn } from "@/lib/utils";

type TranscriptState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; items: TranscriptItem[] }
  | { status: "missing" };

export interface SessionViewProps {
  combo?: ComboEntry;
}

const panelHeading =
  "font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground";

/**
 * Mid-zinc palette for the ParticleText title band: the canvas samples
 * white glyphs and repaints them with these colors, so mid-tone grays read
 * on both the light and the dark background. Kept at module level so the
 * prop identity is stable across renders (the component re-seeds on any
 * dep change).
 */
const PARTICLE_COLORS = ["#a1a1aa", "#71717a", "#52525b"];

/**
 * Session fullscreen view for #/s/<comboId>: ParticleText title band,
 * large artifact stage, run metadata panel and the full transcript
 * timeline. Port of the legacy SessionView.
 */
export function SessionView({ combo }: SessionViewProps) {
  const closeHash = combo
    ? routeHash({ name: "question", question: combo.question.name })
    : routeHash({ name: "home" });

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") window.location.hash = closeHash;
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [closeHash]);

  if (!combo) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            window.location.hash = closeHash;
          }}
        >
          ✕ Close
        </Button>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          Session not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No combo matches this link. Press Esc to go back.
        </p>
      </section>
    );
  }

  return <SessionContent combo={combo} />;
}

function SessionContent({ combo }: { combo: ComboEntry }) {
  const reducedMotion = useReducedMotion();
  const [transcript, setTranscript] = useState<TranscriptState>({
    status: "loading",
  });
  const label = comboLabel(combo);
  const closeHash = routeHash({ name: "question", question: combo.question.name });

  useEffect(() => {
    const transcriptPath = combo.files.transcript;
    if (!transcriptPath) {
      setTranscript({ status: "missing" });
      return;
    }
    let cancelled = false;
    setTranscript({ status: "loading" });
    (async () => {
      try {
        // Paths in the Manifest are relative to the app base.
        const response = await fetch(transcriptPath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const jsonl = await response.text();
        if (!cancelled) {
          setTranscript({ status: "loaded", items: parseTranscript(jsonl) });
        }
      } catch (error) {
        if (!cancelled) {
          setTranscript({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [combo.files.transcript]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4">
      <header>
        <div className="flex items-center justify-between gap-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              window.location.hash = closeHash;
            }}
          >
            ✕ Close
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              esc
            </span>
          </Button>
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                data-status={combo.status}
                aria-label={`Status: ${combo.status}`}
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full bg-destructive",
                  "data-[status=ok]:bg-emerald-600 dark:data-[status=ok]:bg-emerald-400",
                )}
              />
              {combo.status}
            </span>
            <span>{combo.startedAt.slice(0, 10)}</span>
            <span>{formatDuration(combo.durationMs)}</span>
          </div>
        </div>

        <div className="h-40 overflow-hidden border-b border-border md:h-[300px]">
          {reducedMotion ? (
            <div className="flex h-full items-center justify-center">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {label}
              </h1>
            </div>
          ) : (
            <>
              <h1 className="sr-only">{label}</h1>
              <ParticleText
                text={label}
                colors={PARTICLE_COLORS}
                fontSize={64}
                fontWeight="600"
                fontFamily="'Geist Variable', sans-serif"
                particleSize={2}
                particleGap={2}
              />
            </>
          )}
        </div>
      </header>

      <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ADR 0008: on mobile the session stage is hidden (display: none);
            the transcript below is the primary content. */}
        <section aria-label="Artifact" className="hidden md:block">
          {/* allow-same-origin is required: without it the iframe gets an opaque
              origin and <script type="module"> artifacts fail their CORS check.
              The sandbox still blocks top navigation, popups, forms, etc. */}
          {combo.files.artifact ? (
            <iframe
              className="block h-[65vh] min-h-[420px] w-full rounded-lg border border-border bg-white"
              src={combo.files.artifact}
              title={label}
              sandbox="allow-scripts allow-same-origin"
            />
          ) : (
            <div className="flex h-[65vh] min-h-[420px] items-center justify-center rounded-lg border border-dashed border-border bg-white text-sm text-muted-foreground">
              No artifact for this run
            </div>
          )}
        </section>

        <aside className="h-fit rounded-lg border border-border bg-card p-4">
          <section>
            <h2 className={panelHeading}>Run parameters</h2>
            <dl>
              <ParamRow label="Model" value={combo.model.name} />
              <ParamRow label="Provider" value={combo.model.provider} />
              <ParamRow label="Model ID" value={combo.model.modelId} />
              <ParamRow label="pi version" value={combo.piVersion} />
              {Object.entries(combo.params).map(([key, value]) => (
                <ParamRow key={key} label={key} value={formatParam(value)} />
              ))}
              <ParamRow
                label="Started"
                value={new Date(combo.startedAt).toLocaleString()}
              />
              <ParamRow
                label="Duration"
                value={formatDuration(combo.durationMs)}
              />
              <ParamRow label="Status" value={combo.status} />
              {combo.maxTurns !== undefined && (
                <ParamRow
                  label="Max turns"
                  value={`${combo.maxTurns}${combo.maxTurnsExceeded ? " (exceeded)" : ""}`}
                  warning={combo.maxTurnsExceeded}
                />
              )}
              {combo.loopDetected && (
                <ParamRow
                  label="Loop detected"
                  value={`confidence ${combo.loopConfidence ?? "?"}${combo.loopReason ? ` — ${combo.loopReason}` : ""}`}
                  warning
                />
              )}
            </dl>
          </section>

          <section className="mt-4">
            <h2 className={panelHeading}>Contract</h2>
            {combo.contractViolations.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                violations: none
              </p>
            ) : (
              <p className="mt-1 text-sm text-destructive">
                {combo.contractViolations.join("; ")}
              </p>
            )}
          </section>
        </aside>
        <section className="order-first rounded-lg border border-border bg-card p-4 md:order-none lg:col-span-2">
          <h2 className={panelHeading}>
            Transcript
            {combo.files.transcript && (
              <span className="ml-2 font-mono text-[10px] tracking-normal text-muted-foreground normal-case">
                {combo.files.transcript}
              </span>
            )}
          </h2>
          {transcript.status === "loading" && (
            <p className="mt-2 text-sm text-muted-foreground">
              Loading transcript…
            </p>
          )}
          {transcript.status === "missing" && (
            <p className="mt-2 text-sm text-muted-foreground">
              No transcript for this run
            </p>
          )}
          {transcript.status === "error" && (
            <p className="mt-2 text-sm text-destructive">
              Failed to load transcript: {transcript.message}
            </p>
          )}
          {transcript.status === "loaded" && (
            <TranscriptTimeline items={transcript.items} />
          )}
        </section>
      </div>


      <footer className="py-4 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        sessions/{combo.comboId}/ · status: {combo.status}
      </footer>
    </div>
  );
}

function ParamRow({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border/60 py-1.5 text-sm first:border-t-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate font-mono text-xs",
          warning ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
