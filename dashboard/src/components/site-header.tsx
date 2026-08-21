import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/use-theme";

/**
 * App-wide sticky header: project name (home link) + theme toggle.
 * Thin local wrapper over ui/button — pages consume SiteHeader, never the
 * raw primitives directly.
 */
export function SiteHeader() {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <a
          href="#/"
          className="text-base font-semibold tracking-tight text-foreground hover:text-foreground/80"
        >
          LLM Interview
        </a>
        <Button variant="outline" size="sm" onClick={toggleTheme}>
          Switch to {theme === "dark" ? "light" : "dark"} mode
        </Button>
      </div>
    </header>
  );
}
