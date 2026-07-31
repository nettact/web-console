import { computed, reactive } from 'vue'
import { api, type UpdateInfo } from './api'
import { ensureServerInfo, refreshServerInfo, serverInfo } from './serverInfo'

// Shared state for the "a newer NetTact is available" banner. The *fact* of an
// update lives on server-info (see serverInfo.update); what lives here is the
// user's answer to it, held in two server settings so it follows the account
// rather than one browser:
//
//   update_notice_disabled  — the permanent off switch. Absent means enabled.
//     It is SHARED with the desktop app's tray balloon: switching notices off in
//     the console silences the desktop notification too.
//   update_dismissed_version — the version whose banner was dismissed. Storing
//     the version (rather than a bare flag) is what makes the next release show
//     its banner again without the user re-enabling anything.
export const updateNotice = reactive<{
  loaded: boolean
  dismissedVersion: string
  noticeDisabled: boolean
}>({
  loaded: false,
  dismissedVersion: '',
  noticeDisabled: false,
})

export const SETTING_NOTICE_DISABLED = 'update_notice_disabled'
export const SETTING_DISMISSED_VERSION = 'update_dismissed_version'

// A Store install can report an update it cannot name. Dismissal still has to
// work, so the empty version collapses to this sentinel — a value no real
// release tag can collide with, so a later named version is not silently
// treated as already dismissed.
export const UNKNOWN_VERSION = 'unknown'

// dismissalKey is the value stored (and compared) for one update.
export function dismissalKey(latestVersion: string): string {
  return latestVersion.trim() || UNKNOWN_VERSION
}

// shouldShowBanner is the whole visibility decision, kept pure so it can be
// tested without the API: the stored preferences have to be loaded, an update has
// to exist and be available, notices must not be switched off, and this
// particular version must not already be dismissed.
//
// The `loaded` guard is what keeps a dismissed or silenced banner from flashing
// up before the preferences arrive. serverInfo is shared and several other views
// load it, so `update` is routinely populated well before this module has read
// the settings — and if that read fails, the defaults (notices on, nothing
// dismissed) would otherwise leave the banner up indefinitely.
export function shouldShowBanner(
  update: UpdateInfo | null,
  loaded: boolean,
  noticeDisabled: boolean,
  dismissedVersion: string,
): boolean {
  if (!loaded) return false
  if (!update?.update_available) return false
  if (noticeDisabled) return false
  return dismissalKey(update.latest_version) !== dismissedVersion
}

export const showUpdateBanner = computed(() =>
  shouldShowBanner(
    serverInfo.update,
    updateNotice.loaded,
    updateNotice.noticeDisabled,
    updateNotice.dismissedVersion,
  ),
)

let inflight: Promise<void> | null = null

// ensureUpdateNotice loads server-info and the two settings (concurrent callers
// share the in-flight request). A failure leaves the safe defaults — notices
// enabled, nothing dismissed — and never throws into the caller, which is
// typically a lifecycle hook; the banner stays hidden until the preferences are
// known, so a failed load can only hide the notice, never show a stale one.
//
// It is not a one-shot. Two things can legitimately be missing on the first
// attempt and arrive later, and both would otherwise be latched away for the
// life of the tab:
//
//   - the settings request can fail on its own while server-info succeeds;
//   - server-info can arrive without an `update` block at all, because the
//     server publishes one only after its first check succeeds — which is
//     exactly what a console opened right after the server started will see.
//
// App.vue calls this on sign-in and on every tab focus, so retrying costs
// nothing once both are in hand and needs no timer of its own.
export function ensureUpdateNotice(): Promise<void> {
  if (updateNotice.loaded && serverInfo.update) return Promise.resolve()
  if (inflight) return inflight
  // Wrap the calls so a synchronous throw (e.g. a stubbed api in tests) becomes a
  // rejection the catch below swallows, rather than escaping a lifecycle hook.
  inflight = Promise.resolve()
    .then(() =>
      Promise.all([
        // ensureServerInfo short-circuits once loaded, so a cached load that came
        // back without an update block needs the forced re-read.
        serverInfo.loaded && !serverInfo.update ? refreshServerInfo() : ensureServerInfo(),
        updateNotice.loaded ? Promise.resolve(null) : api.settings(),
      ]),
    )
    .then(([, s]) => {
      if (!s) return // settings already loaded; this pass was only chasing server-info
      updateNotice.noticeDisabled = s[SETTING_NOTICE_DISABLED] === '1'
      updateNotice.dismissedVersion = s[SETTING_DISMISSED_VERSION] || ''
      updateNotice.loaded = true
    })
    .catch(() => {
      /* keep the defaults: notices on, nothing dismissed, banner hidden */
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

// dismissUpdateBanner hides the banner for the current version only. Local state
// is updated first so the banner disappears on click; a failed write just means
// it comes back on the next load.
export async function dismissUpdateBanner(): Promise<void> {
  const key = dismissalKey(serverInfo.update?.latest_version ?? '')
  updateNotice.dismissedVersion = key
  await api.updateSettings({ [SETTING_DISMISSED_VERSION]: key })
}

// setUpdateNoticeDisabled flips the permanent off switch. Turning notices back on
// also clears the dismissal, so the pending update reappears immediately instead
// of staying hidden behind a stale dismissed-version.
export async function setUpdateNoticeDisabled(v: boolean): Promise<void> {
  updateNotice.noticeDisabled = v
  const patch: Record<string, string> = { [SETTING_NOTICE_DISABLED]: v ? '1' : '0' }
  if (!v) {
    updateNotice.dismissedVersion = ''
    patch[SETTING_DISMISSED_VERSION] = ''
  }
  await api.updateSettings(patch)
}
