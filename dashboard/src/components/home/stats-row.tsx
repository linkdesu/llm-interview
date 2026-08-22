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
          suffix={suffix}
        />
      </dd>
    </div>
  );
}

/** Hero statistics racing in with SpeedingText. Run time counts in whole
    seconds so every stat shares the same numeric animation. */
export function StatsRow({ stats }: { stats: ManifestStats }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-10">
      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
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
