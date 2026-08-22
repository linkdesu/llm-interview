import { Home } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "motion/react";

const tickRotations = [
  "rotate-0",
  "rotate-[30deg]",
  "rotate-[60deg]",
  "rotate-[90deg]",
  "rotate-[120deg]",
  "rotate-[150deg]",
  "rotate-[180deg]",
  "rotate-[210deg]",
  "rotate-[240deg]",
  "rotate-[270deg]",
  "rotate-[300deg]",
  "rotate-[330deg]",
];

const blips = [
  { position: "left-[81%] top-[40%]", delay: 1.2 },
  { position: "left-[61%] top-[69%]", delay: 2.5 },
  { position: "left-[15%] top-[56%]", delay: 4.33 },
];

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * 404 view for unknown routes (adapted from the React Bits Pro "404 7"
 * block: radar sweep with pulsing contact blips and an outline-mixed
 * numeral). The inline search and contact-support elements from the
 * block are dropped — the only action is "Back home", square-cornered
 * to match the project's right-angle design language.
 *
 * Themed to the project palette: sweep, blips and the CTA use --primary
 * (accent blue), hairlines use --border, micro-readouts use
 * --muted-foreground — no raw black/white values.
 */
export function NotFoundView({ path }: { path: string }) {
  const reduceMotion = useReducedMotion();

  const container: Variants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.09, delayChildren: 0.1 },
    },
  };

  const item: Variants = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 18 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.7, ease: EASE },
    },
  };

  const readout =
    "font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground";

  return (
    <section className="w-full px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
          className="relative order-2 flex flex-col rounded-none border border-border bg-card p-6 [background-image:radial-gradient(color-mix(in_srgb,var(--foreground)_6%,transparent)_1px,transparent_1px)] [background-size:22px_22px] sm:p-8 lg:order-1 lg:p-10"
        >
          <div className="flex items-center justify-between">
            <span className={readout}>Sweep 06.0s</span>
            <span className={readout}>Sector NE-04</span>
          </div>

          <div className="relative mx-auto my-8 aspect-square w-full max-w-[300px] sm:my-10 sm:max-w-[380px] lg:max-w-[430px]">
            <div className="absolute inset-0 rounded-full border border-border" />
            <div className="absolute inset-[16%] rounded-full border border-border" />
            <div className="absolute inset-[32%] rounded-full border border-border" />
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/70" />
            <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border/70" />
            {tickRotations.map((rotation) => (
              <div key={rotation} aria-hidden="true" className={`absolute inset-0 ${rotation}`}>
                <span className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-foreground/30" />
              </div>
            ))}

            <motion.div
              animate={reduceMotion ? undefined : { rotate: 360 }}
              transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 overflow-hidden rounded-full"
            >
              <div className="absolute inset-0 [background:conic-gradient(from_0deg,transparent_0deg,transparent_282deg,color-mix(in_srgb,var(--primary)_16%,transparent)_360deg)]" />
              <div className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 origin-bottom bg-primary/50" />
            </motion.div>

            {blips.map((blip) => (
              <div
                key={blip.position}
                aria-hidden="true"
                className={`absolute -translate-x-1/2 -translate-y-1/2 ${blip.position}`}
              >
                <span className="block size-1.5 rounded-full bg-primary/60" />
                {!reduceMotion && (
                  <>
                    <motion.span
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{
                        duration: 1.6,
                        delay: blip.delay,
                        repeat: Infinity,
                        repeatDelay: 4.4,
                        ease: "easeOut",
                      }}
                      className="absolute inset-0 rounded-full bg-primary/20"
                    />
                    <motion.span
                      animate={{ opacity: [0.6, 0], scale: [0.5, 2.8] }}
                      transition={{
                        duration: 1.6,
                        delay: blip.delay,
                        repeat: Infinity,
                        repeatDelay: 4.4,
                        ease: "easeOut",
                      }}
                      className="absolute -inset-1.5 rounded-full border border-primary/50"
                    />
                  </>
                )}
              </div>
            ))}

            <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className={`${readout} truncate`}>Target: /{path}</span>
            <span className={readout}>Signal: lost</span>
          </div>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          animate="visible"
          className="order-1 max-w-xl lg:order-2"
        >
          <motion.h1 variants={item}>
            <span className="block select-none text-[5.5rem] font-black leading-none tracking-[-0.05em] text-foreground sm:text-[7.5rem] lg:text-[9rem]">
              4
              <span className="text-transparent [-webkit-text-stroke:2.5px_var(--foreground)]">
                0
              </span>
              4
            </span>
            <span className="mt-5 block text-2xl font-semibold tracking-tight text-foreground text-balance sm:text-3xl md:text-4xl">
              Nothing on the scope.
            </span>
          </motion.h1>

          <motion.p
            variants={item}
            className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground text-pretty sm:text-lg"
          >
            We swept every route twice and this page isn&apos;t broadcasting anymore. Head
            back to base and try again.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex">
            <motion.a
              href="#/"
              whileHover={reduceMotion ? undefined : { y: -2 }}
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-none bg-primary px-8 py-3.5 text-base font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Home className="size-4" />
              Back home
            </motion.a>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
