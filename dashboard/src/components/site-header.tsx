import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";

import { useTheme } from "@/components/use-theme";
import { useRoute } from "@/hooks/use-route";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function titleCase(question: string): string {
  return question
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface NavLink {
  label: string;
  hash: string;
  /** Matches Route#question; Home is null. */
  question: string | null;
}

/**
 * App header (adapted from the React Bits Pro "Navigation 15" block:
 * hairline navbar with a traveling underline + slide-in mobile drawer).
 *
 * Themed to the project palette: the traveling underline and the brand
 * mark use --primary (accent blue), hover washes use --accent-soft,
 * borders use --border — no raw neutral-950/white values.
 */
export function SiteHeader({ questions }: { questions: string[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const route = useRoute();
  const { theme, toggleTheme } = useTheme();

  const links: NavLink[] = [
    { label: "Home", hash: "#/", question: null },
    ...questions.map((question): NavLink => ({
      label: titleCase(question),
      hash: `#/q/${question}`,
      question,
    })),
  ];

  const activeLabel =
    route.name === "question"
      ? (links.find((link) => link.question === route.question)?.label ?? null)
      : "Home";
  const current = hovered ?? activeLabel;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const drawerStagger: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.06,
        delayChildren: shouldReduceMotion ? 0 : 0.2,
      },
    },
  };

  const drawerItem: Variants = {
    hidden: { opacity: 0, x: shouldReduceMotion ? 0 : 20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.45, ease: EASE } },
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        aria-label="Primary"
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <a
            href="#/"
            className={`flex items-center gap-2.5 text-base font-semibold tracking-tight text-foreground ${focusRing}`}
          >
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-primary" />
            LLM Interview
          </a>

          <div
            className="hidden items-center gap-8 md:flex"
            onMouseLeave={() => setHovered(null)}
          >
            {links.map((link) => (
              <a
                key={link.hash}
                href={link.hash}
                onMouseEnter={() => setHovered(link.label)}
                onFocus={() => setHovered(link.label)}
                onBlur={() => setHovered(null)}
                aria-current={activeLabel === link.label ? "page" : undefined}
                className={`relative rounded-sm py-2 text-sm font-medium transition-colors duration-200 ${focusRing} ${
                  current === link.label
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {link.label}
                {current === link.label && (
                  <motion.span
                    layoutId="site-header-line"
                    className="absolute inset-x-0 bottom-0 h-px bg-primary"
                    transition={{ duration: 0.3, ease: EASE }}
                  />
                )}
              </a>
            ))}
          </div>

          <ThemeToggle theme={theme} onToggle={toggleTheme} className="hidden md:inline-flex" />

          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="site-header-drawer"
            aria-label="Open menu"
            className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border text-foreground transition-colors duration-200 hover:bg-accent-soft md:hidden ${focusRing}`}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </motion.nav>

      {createPortal(
        <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[2px] md:hidden"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              id="site-header-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              initial={shouldReduceMotion ? { opacity: 0 } : { x: "100%" }}
              animate={shouldReduceMotion ? { opacity: 1 } : { x: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { x: "100%" }}
              transition={{
                duration: shouldReduceMotion ? 0.2 : 0.5,
                ease: EASE,
              }}
              className="fixed inset-0 z-50 flex w-full flex-col overflow-y-auto bg-background px-6 pb-8 pt-5 md:hidden"
            >
              <div className="flex items-center justify-between border-b border-border pb-5">
                <span className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-foreground">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-primary" />
                  LLM Interview
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border text-foreground transition-colors duration-200 hover:bg-accent-soft ${focusRing}`}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <motion.nav
                initial="hidden"
                animate="visible"
                variants={drawerStagger}
                className="mt-8 flex flex-col"
                aria-label="Menu links"
              >
                <motion.p
                  variants={drawerItem}
                  className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                >
                  Menu
                </motion.p>
                {links.map((link) => (
                  <motion.a
                    key={link.hash}
                    href={link.hash}
                    variants={drawerItem}
                    onClick={() => setOpen(false)}
                    className={`group flex items-center justify-between border-b border-border py-4 ${focusRing}`}
                  >
                    <span
                      className={`text-2xl font-semibold tracking-tight transition-colors duration-200 group-hover:text-primary ${
                        activeLabel === link.label ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {link.label}
                    </span>
                    <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-colors duration-200 group-hover:text-primary" />
                  </motion.a>
                ))}
              </motion.nav>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: 0.5,
                  delay: shouldReduceMotion ? 0.1 : 0.5,
                  ease: EASE,
                }}
                className="mt-auto pt-10"
              >
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Appearance
                </p>
                <ThemeToggle
                  theme={theme}
                  onToggle={toggleTheme}
                  className="mt-2 w-full justify-center"
                />
              </motion.div>
            </motion.aside>
          </>
        )}
        </AnimatePresence>,
        document.body,
      )}
    </header>
  );
}

function ThemeToggle({
  theme,
  onToggle,
  className,
}: {
  theme: "light" | "dark";
  onToggle: () => void;
  className?: string;
}) {
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-primary/40 px-4 py-2 text-sm font-medium text-primary transition-colors duration-200 hover:bg-accent-soft ${focusRing} ${className ?? ""}`}
    >
      <Icon className="h-4 w-4" />
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
