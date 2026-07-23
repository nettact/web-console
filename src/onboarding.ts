import { computed, reactive } from 'vue'
import { api, type OnboardingState } from './api'

// Global onboarding state, loaded once and shared across the router guard, the
// shell banner, and the wizard (mirrors the auth.ts singleton pattern).
//
//   loaded  — the GET has completed (success or failure)
//   failed  — the GET errored; the console must not block entry or nag on error
//   state   — null means never started (the auto-open signal); otherwise the
//             persisted progress
export const onboarding = reactive<{
  loaded: boolean
  failed: boolean
  state: OnboardingState | null
}>({
  loaded: false,
  failed: false,
  state: null,
})

// loadOnboarding fetches the persisted state once. On error it flags `failed` so
// the guard falls through to the console (never trap the user behind a wizard
// because a read failed).
export async function loadOnboarding(): Promise<void> {
  try {
    onboarding.state = await api.onboardingState()
    onboarding.failed = false
  } catch {
    onboarding.state = null
    onboarding.failed = true
  } finally {
    onboarding.loaded = true
  }
}

function freshState(): OnboardingState {
  return { version: 1, status: 'in_progress', step: 'welcome', regions: [], banner_dismissed: false }
}

// saveOnboarding merges a patch over the current state (seeding a fresh
// in_progress state if none exists) and persists it. The local copy is updated
// OPTIMISTICALLY before the PUT so that even if persistence fails the state is
// never left null — otherwise the router guard would read a still-null state as
// "never started" and bounce a first-run user straight back into the wizard,
// trapping them on Skip/Finish. On success the server echo replaces the optimistic
// copy; on failure the optimistic copy stays and the error is re-thrown for the
// caller to surface if it wants.
export async function saveOnboarding(patch: Partial<Omit<OnboardingState, 'version'>>): Promise<void> {
  const base = onboarding.state ?? freshState()
  const next: OnboardingState = { ...base, ...patch, version: 1 }
  onboarding.state = next
  onboarding.loaded = true
  const echo = await api.updateOnboardingState(next)
  onboarding.state = echo
  onboarding.failed = false
}

// showResumeBanner is true while onboarding is started-but-incomplete and the
// user has not dismissed the banner this run.
export const showResumeBanner = computed(
  () =>
    onboarding.loaded &&
    !onboarding.failed &&
    onboarding.state?.status === 'in_progress' &&
    !onboarding.state.banner_dismissed,
)
