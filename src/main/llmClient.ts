import { OpenAI } from 'openai'

/**
 * Central resolver for the LLM client used by every agent (planner/coder/executor,
 * memory, briefings). Implements the hybrid model:
 *
 *  - BYO mode:    the user supplied their own OpenAI key (Settings or .env) → call
 *                 OpenAI directly. Free, unlimited, key never leaves their machine.
 *  - Hosted mode: no personal key, but the user is signed in → route through our
 *                 authenticated gateway Cloud Function, which holds the server key,
 *                 enforces plan quotas, and meters usage. Requires a Pro plan beyond
 *                 the free monthly allowance.
 *
 * Tool execution (file writes, commands) always happens locally in the main process;
 * only LLM inference is ever remote. That is the safety split for a dev tool.
 */

type PlanTier = 'free' | 'pro' | 'business'
export type LlmMode = 'byo' | 'hosted' | 'none'

let userKey: string | null = null
let firebaseIdToken: string | null = null
let planTier: PlanTier = 'free'

// Gateway base URL, e.g. https://us-central1-<project>.cloudfunctions.net/chatGateway
// Set after deploying functions. Without it, hosted mode is unavailable.
const GATEWAY_URL = (process.env.FOLDERMIND_GATEWAY_URL || process.env.VITE_FOLDERMIND_GATEWAY_URL || '').replace(/\/+$/, '')

function envKey(): string | null {
  return process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || null
}

/** Personal key from Settings (session-only) or .env. */
export function setUserKey(key: string) {
  userKey = key?.trim() || null
}

/** Auth context forwarded from the renderer (Firebase ID token + current plan). */
export function setAuthContext(token: string | null, plan: PlanTier) {
  firebaseIdToken = token || null
  planTier = plan
}

export function getMode(): LlmMode {
  if (userKey || envKey()) return 'byo'
  if (firebaseIdToken && GATEWAY_URL) return 'hosted'
  return 'none'
}

export function hasLLM(): boolean {
  return getMode() !== 'none'
}

export function getStatus() {
  return { mode: getMode(), planTier, gatewayConfigured: Boolean(GATEWAY_URL), hasKey: hasLLM() }
}

export function getLLM(): OpenAI {
  const mode = getMode()
  if (mode === 'byo') {
    return new OpenAI({ apiKey: (userKey || envKey())! })
  }
  if (mode === 'hosted') {
    // The OpenAI SDK appends /chat/completions to baseURL; the gateway is compatible.
    // The Firebase token travels in a distinct header the gateway verifies.
    return new OpenAI({
      baseURL: `${GATEWAY_URL}/v1`,
      apiKey: 'hosted',
      defaultHeaders: { 'X-Firebase-Token': firebaseIdToken! },
    })
  }
  throw new Error('No AI configured. Add your OpenAI key in Settings, or sign in and upgrade to use hosted AI.')
}
