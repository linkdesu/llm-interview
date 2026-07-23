# Image base64 data is stripped from archived session.jsonl

pi's `read` tool on image files (screenshots, screenshots taken by Chrome etc.) stores the full base64 payload in the session transcript under `{"type":"image","data":"..."}`. A single screenshot can exceed 150 KB, making session files balloon past 1 MB and inflating the git archive.

After copying artifacts into the session archive directory, `runMatrix` calls `stripSessionImageData()` which reads the archived `session.jsonl`, finds every `content` item where `type === "image"`, replaces its `data` value with the literal string `"[stripped]"`, and writes the file back. Malformed lines (JSON parse failures) pass through unchanged. The function is a no-op if the session file is absent.
