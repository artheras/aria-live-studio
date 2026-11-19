import type { AgentSnippet } from "../lib/agents";

export type ClientIconId = AgentSnippet["id"] | "chatgpt" | "claude";

/**
 * Crisp inline brand SVG icons for supported desktop, CLI, and mobile MCP
 * clients so no external icon CDN is needed on stream.
 */
export function ClientIcon({ id, size = 18 }: { id: ClientIconId; size?: number }) {
  switch (id) {
    case "claude-code":
    case "claude-desktop":
    case "claude":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#D97757" />
          <path
            d="M12 4.5v4.2m0 6.6v4.2M4.5 12h4.2m6.6 0h4.2M6.7 6.7l3 3m4.6 4.6l3 3m0-10.6l-3 3m-4.6 4.6l-3 3"
            stroke="#FFF"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "codex":
    case "chatgpt":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#10A37F" />
          <path
            d="M12 6.2a3.3 3.3 0 0 1 2.9 1.7l2.5 1.4a3.3 3.3 0 0 1 .4 5.5 3.3 3.3 0 0 1-2.9 3H12a3.3 3.3 0 0 1-2.9-1.7l-2.5-1.4a3.3 3.3 0 0 1-.4-5.5 3.3 3.3 0 0 1 2.9-3H12Zm0 3.1-2.3 1.3v2.8L12 14.7l2.3-1.3v-2.8L12 9.3Z"
            stroke="#FFF"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "cursor":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#18181B" />
          <path d="M12 4.5 18.5 8.2v7.6L12 19.5l-6.5-3.7V8.2L12 4.5Z" stroke="#FFF" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M12 4.5v7.5l6.5 3.8M12 12l-6.5 3.8" stroke="#A1A1AA" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M12 12 18.5 8.2" stroke="#FFF" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "gemini-cli":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="gemini-bg" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4285F4" />
              <stop offset="1" stopColor="#9B72CB" />
            </linearGradient>
          </defs>
          <rect width="24" height="24" rx="6" fill="url(#gemini-bg)" />
          <path
            d="M12 4.8c.5 4 3.2 6.7 7.2 7.2-4 .5-6.7 3.2-7.2 7.2-.5-4-3.2-6.7-7.2-7.2 4-.5 6.7-3.2 7.2-7.2Z"
            fill="#FFF"
          />
        </svg>
      );
    case "aria-code":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#7C3AED" />
          <path d="M12 5 18 8.5v7L12 19l-6-3.5v-7L12 5Z" stroke="#FFF" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="m9.5 13 2.5-4.5L14.5 13h-5Z" fill="#FFF" />
        </svg>
      );
  }
}
