import { useEffect, useState } from "react";
import { formatDuration, type ManifestStats } from "@/lib/manifest";
import { useReducedMotion } from "./use-reduced-motion";

const COUNT_UP_MS = 1400;

// easeOutQuint: 1 - (1 - p)^5
function easeOutQuint(progress: number): number {
  return 1 - (1 - progress) ** 5;
}

/** Animate 0 → target over COUNT_UP_MS with easeOutQuint; instant when !animate. */
function useCountUp(target: number, animate: boolean): number {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / COUNT_UP_MS, 1);
      setAnimated(Math.round(target * easeOutQuint(progress)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);

  return animate ? animated : target;
}

function Stat({
  label,
  value,
  format,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
}) {
  const reduced = useReducedMotion();
  const current = useCountUp(value, !reduced);
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold tabular-nums">
        {format ? format(current) : current}
      </dd>
    </div>
  );
}

/** Hero statistics with count-up animation (instant under reduced motion). */
export function StatsRow({ stats }: { stats: ManifestStats }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-10">
      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label="Questions" value={stats.questionCount} />
        <Stat label="Models" value={stats.modelCount} />
        <Stat label="Sessions" value={stats.sessionCount} />
        <Stat label="Total run time" value={stats.totalDurationMs} format={formatDuration} />
      </dl>
    </section>
  );
}
