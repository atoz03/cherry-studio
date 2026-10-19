import { afterEach, describe, expect, it, vi } from 'vitest'

import { scrollRangeIntoView, sortRangesByVisualPosition } from '../searchRangePosition'

const rect = (top: number, left: number, height = 20, width = 40): DOMRect =>
  ({ top, left, height, width, bottom: top + height, right: left + width, x: left, y: top }) as DOMRect

/** A range over the first character of a fresh text node inside `parent`, drawn at `drawn`. */
const rangeAt = (parent: HTMLElement, drawn: DOMRect | null): Range => {
  const text = document.createTextNode('match')
  parent.appendChild(text)
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 1)
  const rects = drawn ? [drawn] : []
  range.getClientRects = () => rects as unknown as DOMRectList
  range.getBoundingClientRect = () => drawn ?? rect(0, 0, 0, 0)
  return range
}

interface ScrollBox {
  top: number
  left?: number
  clientHeight?: number
  scrollHeight?: number
  clientWidth?: number
  scrollWidth?: number
  scrollTop?: number
  overflowY?: string
  overflowX?: string
}

const scrollBox = (box: ScrollBox) => {
  const element = document.createElement('div')
  element.style.overflowY = box.overflowY ?? 'auto'
  element.style.overflowX = box.overflowX ?? 'hidden'
  for (const key of ['clientHeight', 'scrollHeight', 'clientWidth', 'scrollWidth'] as const) {
    Object.defineProperty(element, key, { value: box[key] ?? 0, configurable: true })
  }
  element.scrollTop = box.scrollTop ?? 0
  element.getBoundingClientRect = () => rect(box.top, box.left ?? 0, box.clientHeight ?? 0, box.clientWidth ?? 0)
  return Object.assign(element, { scrollTo: vi.fn() })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('sortRangesByVisualPosition', () => {
  it('orders matches top-to-bottom, then left-to-right within a line', () => {
    const host = document.body.appendChild(document.createElement('div'))
    const lower = rangeAt(host, rect(300, 10))
    // Inline code / bold box: starts two pixels higher than plain text on the same line.
    const lineRight = rangeAt(host, rect(98, 200, 24))
    const lineLeft = rangeAt(host, rect(100, 20))
    const input = [lower, lineRight, lineLeft]

    expect(sortRangesByVisualPosition(input)).toEqual([lineLeft, lineRight, lower])
    expect(input).toEqual([lower, lineRight, lineLeft])
  })

  it('places matches that are not drawn last, keeping their DOM order', () => {
    const host = document.body.appendChild(document.createElement('div'))
    const hiddenFirst = rangeAt(host, null)
    const drawn = rangeAt(host, rect(500, 0))
    const hiddenSecond = rangeAt(host, rect(0, 0, 0, 0))

    expect(sortRangesByVisualPosition([hiddenFirst, drawn, hiddenSecond])).toEqual([drawn, hiddenFirst, hiddenSecond])
  })

  it('keeps DOM order when there are more matches than it may measure', () => {
    const host = document.body.appendChild(document.createElement('div'))
    const ranges = [rangeAt(host, rect(300, 0)), rangeAt(host, rect(100, 0)), rangeAt(host, rect(200, 0))]

    expect(sortRangesByVisualPosition(ranges, 2)).toEqual(ranges)
  })
})

describe('scrollRangeIntoView', () => {
  it('centers the matched line, not the block that contains it', () => {
    const container = document.body.appendChild(scrollBox({ top: 100, clientHeight: 100, scrollHeight: 2000 }))
    const paragraph = container.appendChild(document.createElement('p'))
    paragraph.getBoundingClientRect = () => rect(120, 0, 1500)
    // Match line centre 660; container viewport centre 150 -> scroll down by 510.
    const range = rangeAt(paragraph, rect(650, 30))

    expect(scrollRangeIntoView(range, container, 'auto')).toBe(true)
    expect(container.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 510, behavior: 'auto' })
  })

  it('reveals a match inside a nested scroll area and scrolls the outer area by what is left', () => {
    const outer = document.body.appendChild(scrollBox({ top: 100, clientHeight: 100, scrollHeight: 2000 }))
    // Inner viewport 600..700 (centre 650) with 300px of scroll range.
    const inner = outer.appendChild(scrollBox({ top: 600, clientHeight: 100, scrollHeight: 400 }))
    const range = rangeAt(inner, rect(900, 0))

    expect(scrollRangeIntoView(range, outer, 'auto')).toBe(true)
    // Inner moves the match up by 260 (centre 910 -> 650); outer then centres 650 at 150.
    expect(inner.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 260, behavior: 'auto' })
    expect(outer.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 500, behavior: 'auto' })
  })

  it('clamps to the scroll range and skips scrolling that would not move', () => {
    const outer = document.body.appendChild(scrollBox({ top: 0, clientHeight: 100, scrollHeight: 400, scrollTop: 250 }))
    const inner = outer.appendChild(scrollBox({ top: 0, clientHeight: 100, scrollHeight: 300, scrollTop: 200 }))
    // Inner is already at its bottom (max 200); outer can only move 50 more (max 300).
    const range = rangeAt(inner, rect(900, 0))

    scrollRangeIntoView(range, outer, 'auto')

    expect(inner.scrollTo).not.toHaveBeenCalled()
    expect(outer.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 300, behavior: 'auto' })
  })

  it('scrolls a wide area horizontally only as far as needed to show the match', () => {
    const container = document.body.appendChild(scrollBox({ top: 0, clientHeight: 100, scrollHeight: 100 }))
    const table = container.appendChild(
      scrollBox({ top: 0, left: 0, overflowX: 'auto', clientWidth: 300, scrollWidth: 1000 })
    )
    const range = rangeAt(table, rect(40, 500, 20, 40))

    scrollRangeIntoView(range, container, 'auto')

    // Right edge 540 brought to the viewport's right edge 300.
    expect(table.scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 240, behavior: 'auto' })
  })

  it('never scrolls past the boundary', () => {
    const page = document.body.appendChild(scrollBox({ top: 0, clientHeight: 100, scrollHeight: 2000 }))
    const editor = page.appendChild(document.createElement('div'))
    const range = rangeAt(editor, rect(900, 0))

    expect(scrollRangeIntoView(range, editor, 'auto')).toBe(false)
    expect(page.scrollTo).not.toHaveBeenCalled()
  })

  it('reports false for a match that is not drawn so the caller can fall back', () => {
    const container = document.body.appendChild(scrollBox({ top: 0, clientHeight: 100, scrollHeight: 2000 }))
    const range = rangeAt(container, null)

    expect(scrollRangeIntoView(range, container, 'auto')).toBe(false)
    expect(container.scrollTo).not.toHaveBeenCalled()
  })
})
