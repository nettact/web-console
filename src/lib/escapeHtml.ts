// escapeHtml makes a value safe to interpolate into an HTML string.
//
// It exists for ECharts tooltips. A tooltip `formatter` that returns a string
// has that string assigned to innerHTML, so any value reaching one has to be
// escaped first — and the values that reach ours include Agent display names and
// hostnames, which are set by whoever administers or enrolls the machine. An
// unescaped hostname of `<img src=x onerror=...>` would then run script in the
// console's own origin the moment someone hovered the chart.
//
// Prefer not needing this: axis labels, legends and series names that ECharts
// draws itself go through canvas/SVG text and are never HTML. Only hand-built
// formatter strings need escaping.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
