<script setup lang="ts">
// A small OS/distro icon derived from the agent's reported platform string. The
// agent sends the Linux distribution id ("ubuntu", "debian", …) when it can, else
// the OS family ("windows", "darwin", "linux"); we map that to a brand-coloured
// inline SVG. Unknown platforms fall back to a neutral device glyph. The title
// carries the raw platform so hovering still shows the exact value.
import { computed } from 'vue'

const props = withDefaults(defineProps<{ platform: string; size?: number }>(), { size: 16 })

type IconKey = 'windows' | 'apple' | 'ubuntu' | 'debian' | 'openwrt' | 'linux' | 'freebsd' | 'unknown'

const key = computed<IconKey>(() => {
  const p = (props.platform || '').toLowerCase()
  if (!p) return 'unknown'
  // Apple is tested before Windows on purpose: "darwin" contains "win", so the
  // loose Windows match below claims every Mac if it goes first.
  if (p.includes('darwin') || p.includes('mac') || p.includes('apple') || p.includes('ios')) return 'apple'
  if (p.includes('win')) return 'windows'
  if (p.includes('ubuntu')) return 'ubuntu'
  if (p.includes('debian')) return 'debian'
  // OpenWrt before the Linux group: it IS Linux, but a router is not a PC and the
  // distinction is the whole point of the icon on this list. `lede` covers the
  // fork's os-release id, which some long-lived builds still report.
  if (p.includes('openwrt') || p.includes('lede')) return 'openwrt'
  if (p.includes('freebsd') || p.includes('openbsd') || p.includes('netbsd') || p.includes('bsd')) return 'freebsd'
  // Other Linux distros (fedora, centos, rhel, arch, alpine, suse, rocky, …) and a
  // bare "linux" share the generic Tux mark.
  if (
    p.includes('linux') || p.includes('fedora') || p.includes('cent') || p.includes('rhel') ||
    p.includes('red hat') || p.includes('redhat') || p.includes('arch') || p.includes('alpine') ||
    p.includes('suse') || p.includes('rocky') || p.includes('gentoo') || p.includes('mint')
  ) {
    return 'linux'
  }
  return 'unknown'
})
</script>

<template>
  <span
    class="os-icon"
    :data-icon="key"
    :style="{ width: size + 'px', height: size + 'px' }"
    :title="platform || 'unknown'"
  >
    <!-- Windows -->
    <svg v-if="key === 'windows'" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#0078D4" d="M3 5.4 10.6 4.3v7.3H3V5.4zM11.6 4.15 21 2.8v8.8h-9.4V4.15zM3 12.6h7.6V20L3 18.9v-6.3zM11.6 12.6H21v8.6l-9.4-1.3v-7.3z" />
    </svg>
    <!-- Apple / macOS -->
    <svg v-else-if="key === 'apple'" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#A2AAAD" d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.15-.46 7.81 1.3 10.37.86 1.25 1.89 2.66 3.23 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.03 2.28-1.28 3.14-2.54.99-1.46 1.4-2.87 1.42-2.94-.03-.01-2.72-1.04-2.75-4.15zM14.6 4.7c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.14 1.14.09 2.3-.58 3.01-1.43z" />
    </svg>
    <!-- Ubuntu: circle of friends -->
    <svg v-else-if="key === 'ubuntu'" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="#E95420" stroke-width="2" />
      <circle cx="12" cy="4" r="2.2" fill="#E95420" />
      <circle cx="5.1" cy="16" r="2.2" fill="#E95420" />
      <circle cx="18.9" cy="16" r="2.2" fill="#E95420" />
      <circle cx="12" cy="12" r="2.3" fill="#E95420" />
    </svg>
    <!-- Debian: red swirl (approximated) -->
    <svg v-else-if="key === 'debian'" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#A81D33" d="M13.2 6.9c2.5.3 4.3 2.5 4 5-.3 2.6-2.6 4.5-5.2 4.2-1-.1-1.9-.5-2.6-1.1.7.4 1.5.6 2.3.7 2.2.2 4.1-1.5 4.3-3.7.2-2.1-1.4-3.9-3.5-4.1-2.7-.3-5 1.7-5.2 4.4-.2 3.2 2.2 6 5.4 6.2 3.7.3 7-2.5 7.3-6.2.04-.5.02-1-.06-1.5" />
    </svg>
    <!-- OpenWrt: router in the project blue (a device mark, not a logo trace) -->
    <svg v-else-if="key === 'openwrt'" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 11.5V6.4M16.5 11.5V6.4" fill="none" stroke="#00B5E2" stroke-width="1.7" stroke-linecap="round" />
      <circle cx="7.5" cy="5" r="1.3" fill="#00B5E2" />
      <circle cx="16.5" cy="5" r="1.3" fill="#00B5E2" />
      <rect x="3" y="11.5" width="18" height="7.5" rx="2" fill="#00B5E2" />
      <circle cx="7" cy="15.25" r="1" fill="#fff" />
      <circle cx="10.5" cy="15.25" r="1" fill="#fff" opacity=".7" />
      <circle cx="14" cy="15.25" r="1" fill="#fff" opacity=".45" />
    </svg>
    <!-- FreeBSD / BSD: red mark -->
    <svg v-else-if="key === 'freebsd'" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13" r="8" fill="#AB2B28" />
      <path fill="#fff" d="M8.2 10.2l1.6 1.6-1.6 1.6-1.2-1.2c-.3.6-.5 1.3-.5 2 0 2.5 2.4 4.4 5.5 4.4s5.5-1.9 5.5-4.4c0-2.6-2.4-4.4-5.5-4.4-1 0-1.9.2-2.7.6z" opacity=".85" />
    </svg>
    <!-- Generic Linux: Tux -->
    <svg v-else-if="key === 'linux'" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#111827" d="M12 2c-2.6 0-3.8 2.1-3.8 4.8v3.9c0 1.5-1.5 2.5-2 4-.4 1.1.1 1.9.9 2.3.5.3.3.9.3 1.5 0 .8.8 1.3 1.9 1.3h5.4c1.1 0 1.9-.5 1.9-1.3 0-.6-.2-1.2.3-1.5.8-.4 1.3-1.2.9-2.3-.5-1.5-2-2.5-2-4V6.8C15.8 4.1 14.6 2 12 2z" />
      <ellipse cx="12" cy="14.2" rx="2.5" ry="3.4" fill="#F9FAFB" />
      <circle cx="10.5" cy="7.4" r=".95" fill="#F9FAFB" />
      <circle cx="13.5" cy="7.4" r=".95" fill="#F9FAFB" />
      <circle cx="10.5" cy="7.5" r=".45" fill="#111827" />
      <circle cx="13.5" cy="7.5" r=".45" fill="#111827" />
      <path fill="#F5A623" d="M10.7 9h2.6l-1.3 1.5z" />
      <path fill="#F5A623" d="M9.4 21.3l1.4-1.5 1 1zM14.6 21.3l-1.4-1.5-1 1z" />
    </svg>
    <!-- Unknown: neutral device -->
    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M9 20h6M12 17v3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" />
    </svg>
  </span>
</template>

<style scoped>
.os-icon {
  display: inline-flex;
  flex: none;
  color: var(--text-muted);
}
.os-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
