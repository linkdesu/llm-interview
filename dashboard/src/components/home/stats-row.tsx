import SpeedingText from "@/components/react-bits/speeding-text";
import type { ManifestStats } from "@/lib/manifest";

const COUNT_UP_MS = 1400;

function NumericStat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4">
      <dd>
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
          height={40}
          suffix={suffix}
        />
      </dd>
      <dt className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </dt>
    </div>
  );
}

/** Hero statistics as an editorial bordered metric strip (adapted from the
    React Bits Pro "Hero 20" metric row): hairline border-y rule, four
    divided columns on ≥768px, single column below. Values race in with
    SpeedingText; run time counts in whole seconds so every stat shares the
    same numeric animation. */
export function StatsRow({ stats }: { stats: ManifestStats }) {
  return (
    <section className="border-y border-border">
      <dl className="mx-auto grid max-w-5xl grid-cols-1 gap-y-8 px-4 py-10 md:grid-cols-4 md:gap-y-0 md:divide-x md:divide-border">
        <NumericStat label="Questions" value={stats.questionCount} />
        <NumericStat label="Models" value={stats.modelCount} />
        <NumericStat label="Sessions" value={stats.sessionCount} />
        <NumericStat
          label="Total run time"
          value={Math.round(stats.totalDurationMs / 1000)}
          suffix="s"
        />
      </dl>
    </section>
  );
}
