/**
 * Visual-position helpers for in-page search results kept as DOM `Range`s.
 *
 * DOM order is not always reading order (flex `order`, `column-reverse`, inline boxes on one line
 * whose tops differ by a pixel), and a single element can be far taller than the viewport, so
 * search navigation orders and scrolls by where each match is actually drawn.
 */

/** Sorting reads layout once per match; beyond this many matches DOM order is kept. */
export const MAX_VISUALLY_SORTED_RANGES = 1000

type Axis = 'x' | 'y'

function getRangeRect(range: Range): DOMRect | null {
  try {
    const rects = range.getClientRects?.()
    const rect = rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect?.()
    if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.left)) return null
    // Ranges inside `display: none` content report an all-zero rect: they are not drawn anywhere.
    if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) return null
    return rect
  } catch {
    return null
  }
}

/**
 * Order ranges top-to-bottom, then left-to-right within a visual line. A range whose vertical
 * center falls inside the first box of the current line belongs to that line, so a match in bold
 * or inline code is not ordered ahead of an earlier match on the same line just because its box
 * starts a pixel higher. Ranges that are not drawn go last, in DOM order. Returns a new array.
 */
export function sortRangesByVisualPosition(ranges: Range[], maxSortable = MAX_VISUALLY_SORTED_RANGES): Range[] {
  if (ranges.length <= 1 || ranges.length > maxSortable) return [...ranges]

  type Placed = { range: Range; index: number; rect: DOMRect }
  const placed: Placed[] = []
  const unplaced: Range[] = []
  ranges.forEach((range, index) => {
    const rect = getRangeRect(range)
    if (rect) placed.push({ range, index, rect })
    else unplaced.push(range)
  })
  placed.sort((a, b) => a.rect.top - b.rect.top || a.index - b.index)

  const lines: Placed[][] = []
  for (const item of placed) {
    const line = lines.at(-1)
    const centerY = item.rect.top + item.rect.height / 2
    if (line && centerY < line[0].rect.bottom) line.push(item)
    else lines.push([item])
  }

  const byLeft = (a: Placed, b: Placed) => a.rect.left - b.rect.left || a.index - b.index
  return [...lines.flatMap((line) => line.sort(byLeft).map((item) => item.range)), ...unplaced]
}

function canScroll(element: HTMLElement, axis: Axis): boolean {
  const style = getComputedStyle(element)
  const overflow = axis === 'y' ? style.overflowY : style.overflowX
  if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') return false
  return axis === 'y' ? element.scrollHeight > element.clientHeight : element.scrollWidth > element.clientWidth
}

/** Scroll `element` by `delta` along `axis`, clamped to its range; returns the distance applied. */
function scrollAxisBy(element: HTMLElement, axis: Axis, delta: number, behavior: ScrollBehavior): number {
  const current = axis === 'y' ? element.scrollTop : element.scrollLeft
  const max = axis === 'y' ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth
  const applied = Math.min(Math.max(current + delta, 0), Math.max(max, 0)) - current
  if (Math.abs(applied) < 1) return 0
  element.scrollTo(axis === 'y' ? { top: current + applied, behavior } : { left: current + applied, behavior })
  return applied
}

/**
 * Scroll the drawn line of `range` into view: centered vertically, and horizontally only as far
 * as needed. Every scrollable ancestor from the match up to `boundary` (inclusive) is scrolled, so
 * a match inside a nested scroll area (an embedded editor, a wide table) is revealed too. Outer
 * steps subtract what inner ones moved, since smooth scrolling has not applied when they compute.
 *
 * Returns false when nothing could be scrolled this way (the range is not drawn, or no ancestor
 * up to `boundary` scrolls) so the caller can fall back to scrolling the match's element.
 */
export function scrollRangeIntoView(
  range: Range,
  boundary: HTMLElement | null,
  behavior: ScrollBehavior = 'smooth'
): boolean {
  const rect = getRangeRect(range)
  const start = range.startContainer
  const startElement = start instanceof HTMLElement ? start : start.parentElement
  if (!rect || !startElement) return false

  let centerY = rect.top + rect.height / 2
  let left = rect.left
  let right = rect.right
  let scrolled = false

  for (let element: HTMLElement | null = startElement; element; element = element.parentElement) {
    if (canScroll(element, 'y')) {
      scrolled = true
      const viewCenterY = element.getBoundingClientRect().top + element.clientTop + element.clientHeight / 2
      centerY -= scrollAxisBy(element, 'y', centerY - viewCenterY, behavior)
    }
    if (canScroll(element, 'x')) {
      scrolled = true
      const viewLeft = element.getBoundingClientRect().left + element.clientLeft
      const viewRight = viewLeft + element.clientWidth
      // Reveal the right edge without pushing the left edge out; a match wider than the view aligns left.
      const delta =
        left < viewLeft ? left - viewLeft : right > viewRight ? Math.min(right - viewRight, left - viewLeft) : 0
      const moved = scrollAxisBy(element, 'x', delta, behavior)
      left -= moved
      right -= moved
    }
    if (element === boundary) break
  }
  return scrolled
}
