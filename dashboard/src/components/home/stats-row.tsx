import { useEffect, useState } from "react";
import SpeedingText from "@/components/react-bits/speeding-text";
import { formatDuration, type ManifestStats } from "@/lib/manifest";
import { useReducedMotion } from "./use-reduced-motion";

const COUNT_UP_MS = 1400;

/** Animate 0 → target over COUNT_UP_MS with easeOutQuint; instant when !animate. */
function useCountUp(target: number, animate: boolean): number {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / COUNT_UP_MS, 1);
      // easeOutQuint: 1 - (1 - p)^5
      setAnimated(Math.round(target * (1 - (1 - progress) ** 5)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);

  return animate ? animated : target;
}

function NumericStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        {/* SpeedingText honors prefers-reduced-motion internally (paints the
            final value instantly), so no external gating is needed. Colors
            come from the theme tokens via CSS var references. */}
        <SpeedingText
          value={value}
          duration={COUNT_UP_MS}
          fontSize={30}
          fontWeight={600}
          italic={false}
          textColor="var(--foreground)"
          align="left"
          height={40}
        />
      </dd>
    </div>
  );
}

/** Run time is a duration ("15h 16m"), not a plain number — SpeedingText
    only counts Intl-formatted numerals, so this stat keeps the count-up. */
function DurationStat({ label, valueMs }: { label: string; valueMs: number }) {
  const reduced = useReducedMotion();
  const current = useCountUp(valueMs, !reduced);
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex h-10 items-center text-3xl font-semibold tabular-nums">
        {formatDuration(current)}
      </dd>
    </div>
  );
}

/** Hero statistics: counts race in with SpeedingText, run time counts up. */
export function StatsRow({ stats }: { stats: ManifestStats }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-10">
      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <NumericStat label="Questions" value={stats.questionCount} />
        <NumericStat label="Models" value={stats.modelCount} />
        <NumericStat label="Sessions" value={stats.sessionCount} />
        <DurationStat label="Total run time" valueMs={stats.totalDurationMs} />
      </dl>
    </section>
  );
}
