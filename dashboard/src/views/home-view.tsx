import { useMemo } from "react";
import { motion, type Variants } from "motion/react";
import BlinkingSquares from "@/components/react-bits/blinking-squares";
import { ModelWordmarks } from "@/components/home/model-wordmarks";
import { QuestionIndex } from "@/components/home/question-index";
import { StatsRow } from "@/components/home/stats-row";
import { TypewriterText } from "@/components/home/typewriter-text";
import { useReducedMotion } from "@/components/home/use-reduced-motion";
import { useThemeColors } from "@/components/home/use-theme-colors";
import { Button } from "@/components/ui/button";
import { summarizeManifest, type Manifest } from "@/lib/manifest";

const LEDES = [
  "pi.dev builds small web projects under different Question × Model combos. Every run is fully archived — transcript, parameters, artifact — and rendered here for side-by-side comparison.",
  "Same intent, different models. Watch how each one plans, codes and ships — every step captured in the transcript.",
  "No cherry-picked demos. Full session archives: the artifact each model produced, and the complete transcript of how it got there.",
  "Compare agent output like for like — identical questions, isolated runs, every artifact rendered side by side.",
] as const;

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Hero-20 style entrance: the title blurs in, the rest staggers up. */
const HEADLINE: Variants = {
  hidden: { opacity: 0, y: 28, filter: "blur(10px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.8, ease: EASE },
  },
};

const HERO_CONTAINER: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const ITEM: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE },
  },
};

export function HomeView({ manifest }: { manifest: Manifest }) {
  const reduced = useReducedMotion();
  const colors = useThemeColors();
  const stats = useMemo(() => summarizeManifest(manifest.combos), [manifest]);

  const scrollToQuestions = () => {
    document.getElementById("questions")?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
    });
  };

  return (
    <>
      <section aria-labelledby="home-title" className="relative">
        {/* Canvas layer: the R3F wrapper inside BlinkingSquares stays
            in-flow, so the whole field is parked in an absolute layer
            and can never push or clip the hero content. */}
        <div aria-hidden className="absolute inset-0">
          <BlinkingSquares
            width="100%"
            height="100%"
            direction="top"
            gridSize={64}
            squareColor={colors.square}
            backgroundColor={colors.background}
            squareSize={0.64}
            minBrightness={0.3}
            twinkleSpeed={1.4}
            twinkleStrength={0.94}
            fadeStart={0.5}
            fadeEnd={0.8}
            // dpr={2}
          />
        </div>
        <motion.div
          variants={HERO_CONTAINER}
          initial={reduced ? false : "hidden"}
          animate="show"
          className="relative z-10 flex flex-col items-center gap-6 px-4 py-20 text-center sm:py-24"
        >
          <motion.h1
            variants={HEADLINE}
            id="home-title"
            className="rounded-2xl bg-background/70 px-8 py-3 text-5xl font-semibold tracking-tight sm:text-6xl"
          >
            LLM Interview
          </motion.h1>
          <motion.div
            variants={ITEM}
            className="min-h-[4.5rem] max-w-2xl rounded-2xl bg-background/70 px-6 py-3"
          >
            <TypewriterText phrases={[...LEDES]} />
          </motion.div>
          <motion.div variants={ITEM}>
            <Button onClick={scrollToQuestions}>Browse questions</Button>
          </motion.div>
          <ModelWordmarks names={stats.modelNames} />
        </motion.div>
      </section>
      <StatsRow stats={stats} />
      <QuestionIndex combos={manifest.combos} />
    </>
  );
}
