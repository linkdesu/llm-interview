import { motion, useReducedMotion, type Variants } from "motion/react";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Cycling wordmark styles — the hero-20 "Trusted by" row, project-flavored:
 * the names are the actual models that have run, so each gets one of a few
 * typographic voices (serif-free: Geist only, weight/tracking variants).
 * Kept at module level so prop identity is stable across renders.
 */
const MARK_STYLES = [
  "text-base font-semibold tracking-[0.2em]",
  "font-mono text-base tracking-tight",
  "text-lg font-medium tracking-tight",
  "text-base font-medium tracking-widest",
] as const;

const group: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05 },
  },
};

const groupItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE },
  },
};

/**
 * Hero wordmark row: distinct model names rendered as quiet typographic
 * marks with an edge fade, filling the lower half of the hero (adapted
 * from the React Bits Pro "Hero 20" trust row). Uses --foreground-faint
 * for the marks — theme tokens only, no raw grays.
 */
export function ModelWordmarks({ names }: { names: string[] }) {
  const reduceMotion = useReducedMotion();
  if (names.length === 0) return null;

  return (
    <motion.div
      variants={group}
      initial={reduceMotion ? false : "hidden"}
      animate="show"
      className="w-full"
    >
      <motion.p
        variants={groupItem}
        className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground-faint"
      >
        On the stand
      </motion.p>
      <div className="mx-auto mt-6 flex max-w-4xl flex-wrap items-baseline justify-center gap-x-10 gap-y-3 px-4 [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]">
        {names.map((name, index) => (
          <motion.span
            key={name}
            variants={groupItem}
            className={`select-none whitespace-nowrap text-foreground-faint ${MARK_STYLES[index % MARK_STYLES.length]}`}
          >
            {name}
          </motion.span>
        ))}
      </div>
    </motion.div>
  );
}
