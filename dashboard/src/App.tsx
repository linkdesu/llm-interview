import { useEffect, useState } from "react";

import { SiteHeader } from "@/components/site-header";
import { useRoute } from "@/hooks/use-route";
import type { Manifest } from "@/lib/manifest";
import { HomeView } from "@/views/home-view";
import { QuestionsView } from "@/views/questions-view";
import { QuestionView } from "@/views/question-view";
import { RunsView } from "@/views/runs-view";
import { SessionView } from "@/views/session-view";

type ManifestState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; manifest: Manifest };

async function fetchManifest(): Promise<Manifest> {
  // Relative path on purpose: the dashboard is statically hosted, possibly
  // under a sub-path, so never hard-code an absolute URL.
  const response = await fetch("manifest.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`manifest.json failed to load (HTTP ${response.status})`);
  }
  return (await response.json()) as Manifest;
}

function App() {
  const route = useRoute();
  const [state, setState] = useState<ManifestState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchManifest()
      .then((manifest) => {
        if (!cancelled) setState({ status: "loaded", manifest });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  let content;
  if (state.status === "loading") {
    content = (
      <section className="mx-auto max-w-5xl px-4 py-8">
        <p className="text-sm text-muted-foreground">Loading manifest…</p>
      </section>
    );
  } else if (state.status === "error") {
    content = (
      <section className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-destructive">
          Failed to load manifest
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
      </section>
    );
  } else {
    const { manifest } = state;
    if (route.name === "questions") {
      content = <QuestionsView />;
    } else if (route.name === "runs") {
      content = <RunsView />;
    } else if (route.name === "question") {
      const combos = manifest.combos.filter((combo) => combo.question.name === route.question);
      content = <QuestionView question={route.question} combos={combos} />;
    } else if (route.name === "session") {
      const combo = manifest.combos.find((entry) => entry.comboId === route.comboId);
      content = <SessionView combo={combo} />;
    } else {
      content = <HomeView manifest={manifest} />;
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main>{content}</main>
    </div>
  );
}

export default App;
