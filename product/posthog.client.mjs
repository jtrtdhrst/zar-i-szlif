// Ready-to-wire PostHog adapter for the product surface.
// Install posthog-js in this surface's generated application package.
// Call initializeProductPostHog(...) once in the client entrypoint.
// Consent defaults to OFF. Do not call setProductAnalyticsConsent(true)
// before the visitor grants optional analytics consent.
import posthog from 'posthog-js'

const allowedEvents = new Set([
  'team_created',
  'onboarding_completed',
  'meeting_planned',
  'meeting_completed',
  'improvement_recorded',
])

let initialized = false

export function initializeProductPostHog({ projectToken, host = 'https://eu.i.posthog.com' } = {}) {
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

export function setProductAnalyticsConsent(granted) {
  if (!initialized) return false
  if (granted) {
    posthog.opt_in_capturing({ captureEventName: false })
  } else {
    posthog.opt_out_capturing()
  }
  return true
}

export function captureProductEvent(event, { area } = {}) {
  if (!initialized || !allowedEvents.has(event) || !posthog.has_opted_in_capturing()) return false
  // Never pass forms, card contents, names, emails, team/child IDs, or user-generated text.
  posthog.capture(event, {
    surface: 'product',
    ...(typeof area === 'string' ? { area: area.slice(0, 60) } : {}),
  })
  return true
}

export function identifyConsentingUser(authUserId) {
  if (!initialized || !posthog.has_opted_in_capturing()) return false
  if (typeof authUserId !== 'string' || !authUserId) return false
  // Use the Supabase Auth user UUID only; never identify children or group members.
  posthog.identify(authUserId)
  return true
}

export function resetAnalyticsOnLogout() {
  if (!initialized) return
  // PostHog reset clears opt-in consent: obtain consent again before tracking.
  posthog.reset()
}
