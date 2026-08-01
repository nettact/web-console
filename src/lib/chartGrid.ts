// Plot geometry shared by the charts that have to be read against each other.
//
// Pinning two charts to the same time window is not enough to line them up.
// ECharts maps the axis onto the grid rectangle, so a chart with `right: 22` and
// one with `right: 72` (the room a second Y axis needs) put the same timestamp at
// two different x pixels — and a reader comparing a frame-time spike against an
// RTT spike compares by x position. Charts in an aligned stack therefore adopt
// one geometry, sized for the widest case so no axis is clipped, rather than each
// sizing itself to its own contents.
//
// This applies ONLY when a caller pins the window; unpinned charts keep their own
// tighter default margins.
export const ALIGNED_GRID_LEFT = 58
export const ALIGNED_GRID_RIGHT = 72
