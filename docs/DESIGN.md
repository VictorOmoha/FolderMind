# FolderMind Design Guidelines

Benchmarked against best-in-class AI assistant and agent products on Mobbin
(Claude, ChatGPT, Microsoft Copilot, WRITER, Manus, Relevance AI, ClickUp Brain).
All UI work should follow this document; the source of truth for values is
[`src/renderer/src/theme.css`](../src/renderer/src/theme.css).

## Principles

1. **Refined dark, solid surfaces.** No glassmorphism, no translucent panels,
   no glows or lift-on-hover shadows. Depth comes from the four-step surface
   ladder (`--bg → --surface → --surface2 → --surface3`) and hairline borders.
2. **One flat accent, used sparingly.** Signature copper (`--accent`, drawn
   from manila-folder warmth) marks the primary action, the active state, and
   AI/tool activity — nothing else. Text on accent fills uses `--accent-fg`
   (dark), never white. Status uses the green/yellow/red trio, always as a
   `-soft` fill + `-line` border pair with the full-strength color reserved
   for text/icons.
3. **Everything comes from tokens.** No hardcoded hex/rgba in component CSS.
   Radii: `--radius-sm` (inputs, small buttons), `--radius` (code blocks,
   list items), `--radius-lg` (cards, modals' inner elements), `--radius-xl`
   (composer, large modals), `--radius-pill` (badges, chips, icon buttons).
4. **Hover = border/background shift, never motion.** Transitions are
   0.14–0.15s ease on `background`, `border-color`, `color` only.
5. **Icons, not emoji, in app chrome.** All chrome iconography comes from
   [`components/Icons.tsx`](../src/renderer/src/components/Icons.tsx) —
   16px stroke SVGs on `currentColor`, plus the filled `FolderMark` brand
   glyph. Emoji may still appear inside user/assistant message content.
6. **Display serif for hero headlines only.** `--font-display` (ui-serif /
   New York) is reserved for the big greeting moments: welcome h1, chat
   empty-state h2, auth title. Section headings and UI text stay on
   `--font-body`.

## Patterns (with references)

### Composer (Claude, ChatGPT, WRITER)
One rounded card (`--radius-xl`, `--surface2`) containing the borderless
textarea plus a control row: quiet actions on the left (`.btn-ghost`),
keyboard hint and a 30px circular accent send button (`↑`) on the right.
Focus ring on the card via `:focus-within`, not on the textarea.
Ref: https://mobbin.com/screens/2dc3199a-081d-425c-9005-2abf22c4dbd2 (Claude),
https://mobbin.com/screens/9652aa1a-2aeb-469c-8a84-12d4d01c788c (WRITER).

### Chat empty state (Claude, Copilot)
Vertically centered hero: folder badge pill → short headline → one-line
capability description → centered quick-prompt chips. The greeting sells the
next action, not the product.
Ref: https://mobbin.com/screens/38fddb11-e03c-4f6c-8c08-1c8bb698864d (Copilot).

### Messages (ChatGPT, Claude)
User messages sit right-aligned in a quiet `--surface3` bubble; assistant
replies render as plain text on the canvas (no bubble) so long answers stay
scannable. Tool calls are accent-tinted pill badges with monospace result
blocks on `--bg`.

### Agent/task progress (Manus, Relevance AI)
Steps use a 15px circular marker: hollow border (pending) → accent spinner
(active) → green check (done). Run cards carry a 3px status-colored left
border and a status badge pill.
Ref: https://mobbin.com/screens/7cca0201-52d3-4e26-a065-b78a2f865ea6 (Manus).

### Status pills & badges
Always the pair: `background: var(--x-soft); border: 1px solid var(--x-line);
color: var(--x)`. Uppercase 10–11px, weight 600, letter-spacing 0.05–0.08em.

### Modals
Solid `--surface`, `--shadow-pop`, `modal-in` scale animation. Overlay scrim
`rgba(0,0,0,0.85)` with light blur is the only permitted backdrop-filter.

## Adding new UI

- Start from an existing component's CSS module; copy its token usage.
- If a color/radius/shadow you need doesn't exist as a token, add it to
  `theme.css` first, then use it.
- Section labels: 10.5–11px uppercase `--text-muted`, weight 600.
- Body text 13–14px, line-height 1.5–1.6; hints/meta 11–12px `--text-dim`.
