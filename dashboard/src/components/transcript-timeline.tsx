import type { TranscriptItem } from "@/lib/transcript";

/** Event payloads longer than this render in a collapsed details block. */
const LONG_EVENT_TEXT = 120;

function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString();
}

const label =
  "mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground";
const messageText =
  "m-0 whitespace-pre-wrap break-words font-mono text-xs";
const collapsibleSummary =
  "cursor-pointer select-none list-none text-xs [&::-webkit-details-marker]:hidden";
const collapsibleBody =
  "mt-1 rounded-sm bg-muted p-1.5";

function AssistantParts({ item }: { item: Extract<TranscriptItem, { kind: "assistant" }> }) {
  return (
    <>
      {item.parts.map((part, partIndex) => {
        if (part.type === "text") {
          return (
            <pre key={partIndex} className={messageText}>
              {part.text}
            </pre>
          );
        }
        if (part.type === "thinking") {
          return (
            <details key={partIndex} className="mt-1">
              <summary
                className={`${collapsibleSummary} text-foreground/70 group-open:text-foreground`}
              >
                thinking
              </summary>
              <pre className={`${messageText} ${collapsibleBody}`}>{part.thinking}</pre>
            </details>
          );
        }
        if (part.type === "toolCall") {
          return (
            <details key={partIndex} className="mt-1">
              <summary
                className={`${collapsibleSummary} text-primary group-open:text-foreground`}
              >
                tool call: {part.name ?? "unknown"}
              </summary>
              <pre className={`${messageText} ${collapsibleBody}`}>
                {JSON.stringify(part.arguments ?? {}, null, 2)}
              </pre>
            </details>
          );
        }
        return (
          <span
            key={partIndex}
            className="inline-block rounded-sm border border-dashed border-border px-1.5 py-px text-[11px] text-muted-foreground"
          >
            [image]
          </span>
        );
      })}
    </>
  );
}

function EventItem({ item }: { item: Extract<TranscriptItem, { kind: "event" }> }) {
  return (
    <>
      <div className={label}>
        {item.eventType} · {formatTime(item.timestamp)}
      </div>
      {item.text.length > LONG_EVENT_TEXT ? (
        <details>
          <summary className={`${collapsibleSummary} text-primary`}>
            {item.eventType}
          </summary>
          <pre className={`${messageText} ${collapsibleBody}`}>{item.text}</pre>
        </details>
      ) : (
        <div className="flex items-baseline gap-2 border-l-2 border-primary/40 pl-2 font-mono text-xs">
          <span className="text-primary">{item.eventType}</span>
          <span className="break-words text-muted-foreground">{item.text}</span>
        </div>
      )}
    </>
  );
}

/**
 * Session transcript as a message timeline. Mirrors the legacy
 * TranscriptTimeline: user/assistant messages render their text, thinking and
 * tool calls stay collapsed in <details>, failed tool results get a
 * destructive treatment, and non-message lines render as system events.
 */
export function TranscriptTimeline({ items }: { items: TranscriptItem[] }) {
  return (
    <ol className="mt-3 list-none">
      {items.map((item, index) => (
        <li key={item.id ?? index} className="border-t border-border py-2">
          {item.kind === "user" && (
            <>
              <div className={label}>user · {formatTime(item.timestamp)}</div>
              <pre className={messageText}>{item.text}</pre>
            </>
          )}
          {item.kind === "assistant" && (
            <>
              <div className={label}>assistant · {formatTime(item.timestamp)}</div>
              <AssistantParts item={item} />
            </>
          )}
          {item.kind === "toolResult" && (
            <details
              className={
                item.isError
                  ? "border-l-2 border-destructive pl-2"
                  : undefined
              }
            >
              <summary
                className={
                  item.isError
                    ? `${collapsibleSummary} text-destructive`
                    : `${collapsibleSummary} text-foreground/70 group-open:text-foreground`
                }
              >
                tool result: {item.toolName ?? "unknown"}
                {item.isError ? " (error)" : ""}
              </summary>
              <pre
                className={`${messageText} ${collapsibleBody} ${item.isError ? "bg-destructive/10" : ""}`}
              >
                {item.text}
              </pre>
            </details>
          )}
          {item.kind === "event" && <EventItem item={item} />}
        </li>
      ))}
    </ol>
  );
}
