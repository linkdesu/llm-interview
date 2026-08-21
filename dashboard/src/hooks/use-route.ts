import { useEffect, useState } from "react";

import { parseHash, type Route } from "@/lib/router";

/**
 * Current Route, re-parsed on every hashchange and scrolling the window back
 * to the top on navigation (mirrors the legacy App.vue behavior).
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}
