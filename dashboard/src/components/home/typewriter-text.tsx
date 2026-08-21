import { useEffect, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

const TYPE_MS = 30;
const DELETE_MS = 14;
const HOLD_MS = 2200;

/**
 * Rotating lede: type → hold → delete → next phrase, looping. Under
 * prefers-reduced-motion the first phrase is shown statically.
 */
export function TypewriterText({ phrases }: { phrases: string[] }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const phrase = phrases[index % phrases.length];

  useEffect(() => {
    if (reduced) return;
    const atEnd = count === phrase.length;
    const delay = deleting ? DELETE_MS : atEnd ? HOLD_MS : TYPE_MS;
    const timer = window.setTimeout(() => {
      if (deleting) {
        if (count === 0) {
          setDeleting(false);
          setIndex((index + 1) % phrases.length);
        } else {
          setCount(count - 1);
        }
      } else if (atEnd) {
        setDeleting(true);
      } else {
        setCount(count + 1);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [reduced, deleting, count, index, phrase, phrases.length]);

  if (reduced) {
    return <p className="text-base text-muted-foreground sm:text-lg">{phrases[0]}</p>;
  }
  return (
    <p aria-label={phrase} className="text-base text-muted-foreground sm:text-lg">
      <span aria-hidden>{phrase.slice(0, count)}</span>
      <span aria-hidden className="animate-pulse text-foreground">▍</span>
    </p>
  );
}
