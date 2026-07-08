// Shared icon set — 16px stroke icons on currentColor, plus the filled brand mark.
// Keep icons here so every surface draws from one visual vocabulary (no emoji in chrome).

interface IconProps {
  size?: number
  className?: string
}

/** Brand mark: copper folder with a "mind" pulse dot. */
export function FolderMark({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M3 6.5C3 5.12 4.12 4 5.5 4h4.05c.73 0 1.42.32 1.9.87l.9 1.06c.28.34.71.53 1.15.53h5A2.5 2.5 0 0 1 21 8.96v8.54A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11Z"
        fill="var(--accent, #d08954)"
      />
      <circle cx="12" cy="13.5" r="2.4" fill="var(--accent-fg, #1c1208)" opacity="0.9" />
    </svg>
  )
}

/** Outline folder for lists and badges. */
export function FolderIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 6.5c0-1.1.9-2 2-2h3.9c.6 0 1.17.27 1.55.73l.8.94c.38.46.95.73 1.55.73h5.2c1.1 0 2 .9 2 2v8.6c0 1.1-.9 2-2 2h-13c-1.1 0-2-.9-2-2v-11Z" />
    </svg>
  )
}

export function ChatBubbleIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11.6c0 4-3.6 7.2-8 7.2-.9 0-1.77-.13-2.57-.38L5 20l1.02-3.06A6.8 6.8 0 0 1 4 11.6c0-4 3.6-7.2 8-7.2s8 3.2 8 7.2Z" />
    </svg>
  )
}

export function MicIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </svg>
  )
}

export function StopIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  )
}

export function SpeakerIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </svg>
  )
}

export function SpeakerOffIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
      <path d="m16 9.5 5 5m0-5-5 5" />
    </svg>
  )
}

export function ArrowUpIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5m-6 6 6-6 6 6" />
    </svg>
  )
}

/** Small spinner ring for in-flight states. */
export function SpinnerIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
      style={{ animation: 'spin 0.9s linear infinite' }}
      fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 3a9 9 0 1 1-9 9" />
    </svg>
  )
}
