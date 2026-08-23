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
import type { Route } from "@/lib/router";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const REPO_URL = "https://github.com/linkdesu/llm-interview";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const NAV_LINKS = [
  { label: "Home", hash: "#/" },
  { label: "Questions", hash: "#/questions" },
  { label: "Runs", hash: "#/runs" },
] as const;

function activeLabel(route: Route): string | null {
  if (route.name === "home") return "Home";
  if (route.name === "questions" || route.name === "question") return "Questions";
  if (route.name === "runs" || route.name === "session") return "Runs";
  return null;
}

/**
 * App header (adapted from the React Bits Pro "Navigation 15" block:
 * hairline navbar with a traveling underline + slide-in mobile drawer).
 *
 * Themed to the project palette: the traveling underline and the brand
 * mark use --primary (accent blue), hover washes use --accent-soft,
 * borders use --border — no raw neutral-950/white values.
 */
export function SiteHeader() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const route = useRoute();
  const { theme, toggleTheme } = useTheme();

  const active = activeLabel(route);
  const current = hovered ?? active;

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
            {NAV_LINKS.map((link) => (
              <a
                key={link.hash}
                href={link.hash}
                onMouseEnter={() => setHovered(link.label)}
                onFocus={() => setHovered(link.label)}
                onBlur={() => setHovered(null)}
                aria-current={active === link.label ? "page" : undefined}
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

          <div className="hidden items-center gap-3 md:flex">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
              className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-200 hover:bg-accent-soft hover:text-foreground ${focusRing}`}
            >
              <GithubMark className="h-5 w-5" />
            </a>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>

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
                {NAV_LINKS.map((link) => (
                  <motion.a
                    key={link.hash}
                    href={link.hash}
                    variants={drawerItem}
                    onClick={() => setOpen(false)}
                    className={`group flex items-center justify-between border-b border-border py-4 ${focusRing}`}
                  >
                    <span
                      className={`text-2xl font-semibold tracking-tight transition-colors duration-200 group-hover:text-primary ${
                        active === link.label ? "text-primary" : "text-foreground"
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

/**
 * GitHub mark: the pinned lucide-react ships no brand icons, so the
 * octocat glyph is inlined here as a plain SVG (currentColor).
 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
