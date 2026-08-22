import { useMemo } from "react";
import BlinkingSquares from "@/components/react-bits/blinking-squares";
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

// Shared by the canvas layer and its overlay so the content block always
// defines (and fills) the hero height.
const HERO_HEIGHT = "min(72vh, 640px)";

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
        <div
          className="relative z-10 flex flex-col items-center justify-center gap-6 px-4 text-center"
          style={{ height: HERO_HEIGHT }}
        >
          <h1 id="home-title" className="text-5xl font-semibold tracking-tight sm:text-6xl">
            LLM Interview
          </h1>
          <div className="min-h-[4.5rem] max-w-2xl">
            <TypewriterText phrases={[...LEDES]} />
          </div>
          <Button onClick={scrollToQuestions}>Browse questions</Button>
        </div>
      </section>
      <StatsRow stats={stats} />
      <QuestionIndex combos={manifest.combos} />
    </>
  );
}
