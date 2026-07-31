import { computed, reactive } from 'vue'
import { api, type UpdateInfo } from './api'
import { refreshServerInfo, serverInfo } from './serverInfo'

// Shared state for the "a newer NetTact is available" banner. The *fact* of an
// update lives on server-info (see serverInfo.update); what lives here is the
// user's answer to it, held in two server settings so it follows the account
// rather than one browser:
//
//   update_notice_disabled  — the permanent off switch. Absent means enabled.
//     It is SHARED with the desktop app's tray menu ("Notify about new
//     versions"): either side writes this one row, so switching notices off in
//     the console silences the tray balloon and unchecking the tray item clears
//     the console's switch. Neither side owns a copy, and neither hides the
//     other's UI — the console's software-update panel stays put with the switch
//     in it, which is the only way back on from the web side.
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

// writeSeq counts the writes this tab has made to the two settings. Reads carry
// the value they saw before leaving, and one whose count has moved on by the time
// it lands is dropped — it was answered before the write reached the server, so
// applying it would undo a change the user just made and watched take effect.
//
// The window is not theoretical: returning to the tab starts a refresh, and the
// banner is the first thing in view, so "dismiss it the moment you come back"
// lands squarely inside that request's flight.
//
// It is a counter rather than a flag because it must not latch: the next read
// leaves after the write and is authoritative again, which is how a switch the
// desktop tray flipped still reaches this tab.
let writeSeq = 0

// updateNoticeReadToken must be captured BEFORE issuing the /settings request
// whose result is passed to applyUpdateNoticeSettings.
export function updateNoticeReadToken(): number {
  return writeSeq
}

// applyUpdateNoticeSettings publishes an already-fetched settings map into the
// shared state, unless a local write overtook the read (see writeSeq). It exists
// so a view that reads /settings for its own reasons (Settings.vue does, on every
// load) refreshes the switch from the same response instead of racing a second
// read against it.
export function applyUpdateNoticeSettings(s: Record<string, string>, token: number): void {
  if (token !== writeSeq) return
  updateNotice.noticeDisabled = s[SETTING_NOTICE_DISABLED] === '1'
  updateNotice.dismissedVersion = s[SETTING_DISMISSED_VERSION] || ''
  updateNotice.loaded = true
}

let inflight: Promise<void> | null = null

// syncUpdateNotice re-reads both halves of the update UI's state — the server's
// last check (server-info.update) and the two settings above — with concurrent
// callers sharing one round trip.
//
// It re-reads rather than latching, because both halves change behind an open
// tab's back:
//
//   - the daily check publishes a result the console was opened too early to
//     see, so the block starts out saying only "this install checks";
//   - the desktop tray writes the same notice switch, so a tab that read it once
//     would keep drawing a silenced banner after the user re-enabled notices
//     from the tray — and offer them a checkbox that flips the wrong way.
//
// App.vue calls it on sign-in and on every tab focus, which is frequent enough
// to need no timer of its own.
//
// A failure never throws into the caller (typically a lifecycle hook) and leaves
// the last known values in place, so a dropped request cannot resurrect a banner
// the user dismissed. Until the first read lands, `loaded` keeps the banner down.
export function syncUpdateNotice(): Promise<void> {
  if (inflight) return inflight
  const token = updateNoticeReadToken()
  // Wrap the calls so a synchronous throw (e.g. a stubbed api in tests) becomes a
  // rejection the catch below swallows, rather than escaping a lifecycle hook.
  inflight = Promise.resolve()
    .then(() => Promise.all([refreshServerInfo(), api.settings()]))
    .then(([, s]) => applyUpdateNoticeSettings(s, token))
    .catch(() => {
      /* keep the last known values; before the first success that is: notices on,
         nothing dismissed, banner hidden */
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
  writeSeq++
  updateNotice.dismissedVersion = key
  await api.updateSettings({ [SETTING_DISMISSED_VERSION]: key })
}

// setUpdateNoticeDisabled flips the permanent off switch. Turning notices back on
// also clears the dismissal, so the pending update reappears immediately instead
// of staying hidden behind a stale dismissed-version.
export async function setUpdateNoticeDisabled(v: boolean): Promise<void> {
  writeSeq++
  updateNotice.noticeDisabled = v
  const patch: Record<string, string> = { [SETTING_NOTICE_DISABLED]: v ? '1' : '0' }
  if (!v) {
    updateNotice.dismissedVersion = ''
    patch[SETTING_DISMISSED_VERSION] = ''
  }
  await api.updateSettings(patch)
}
