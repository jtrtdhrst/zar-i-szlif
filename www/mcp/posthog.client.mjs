// Ready-to-wire PostHog adapter for the mcp-docs surface.
// Install posthog-js in this surface's generated application package.
// Call initializeMcpDocsPostHog(...) once in the client entrypoint.
// Consent defaults to OFF. Do not call setMcpDocsAnalyticsConsent(true)
// before the visitor grants optional analytics consent.
import posthog from 'posthog-js'

const allowedEvents = new Set([
  'mcp_docs_opened',
  'mcp_client_selected',
  'mcp_setup_clicked',
])

let initialized = false

export function initializeMcpDocsPostHog({ projectToken, host = 'https://eu.i.posthog.com' } = {}) {
  if (typeof window === 'undefined' || !projectToken) return false
  if (initialized) return true
  posthog.init(projectToken, {
    api_host: host,
    defaults: '2026-08-30',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    opt_out_capturing_by_default: true,
    person_profiles: 'identified_only',
  })
  initialized = true
  return true
}

export function setMcpDocsAnalyticsConsent(granted) {
  if (!initialized) return false
  if (granted) {
    posthog.opt_in_capturing({ captureEventName: false })
    posthog.capture('$pageview', { $current_url: window.location.href, surface: 'mcp-docs' })
  } else {
    posthog.opt_out_capturing()
  }
  return true
}

export function captureMcpDocsEvent(event, { area } = {}) {
  if (!initialized || !allowedEvents.has(event) || !posthog.has_opted_in_capturing()) return false
  // Never pass forms, card contents, names, emails, team/child IDs, or user-generated text.
  posthog.capture(event, {
    surface: 'mcp-docs',
    ...(typeof area === 'string' ? { area: area.slice(0, 60) } : {}),
  })
  return true
}
