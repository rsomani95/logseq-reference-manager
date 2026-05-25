import { listNavIntent, type NavKeyEvent } from './keyboard'
import { describe, expect, test } from 'bun:test'

const ev = (over: Partial<NavKeyEvent> & { key: string }): NavKeyEvent => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...over,
})

describe('listNavIntent', () => {
  test('arrow keys map to down/up', () => {
    expect(listNavIntent(ev({ key: 'ArrowDown' }))).toBe('down')
    expect(listNavIntent(ev({ key: 'ArrowUp' }))).toBe('up')
  })

  test('emacs Ctrl-N/Ctrl-P map to down/up', () => {
    expect(listNavIntent(ev({ key: 'n', ctrlKey: true }))).toBe('down')
    expect(listNavIntent(ev({ key: 'p', ctrlKey: true }))).toBe('up')
  })

  test('Ctrl-N/Ctrl-P are case-insensitive (e.g. with Shift/CapsLock)', () => {
    expect(listNavIntent(ev({ key: 'N', ctrlKey: true }))).toBe('down')
    expect(listNavIntent(ev({ key: 'P', ctrlKey: true }))).toBe('up')
  })

  test('n/p without Ctrl are plain characters, not navigation', () => {
    expect(listNavIntent(ev({ key: 'n' }))).toBeNull()
    expect(listNavIntent(ev({ key: 'p' }))).toBeNull()
  })

  test('Cmd-N and Alt-N are left to the host, not hijacked', () => {
    expect(
      listNavIntent(ev({ key: 'n', ctrlKey: true, metaKey: true })),
    ).toBeNull()
    expect(
      listNavIntent(ev({ key: 'n', ctrlKey: true, altKey: true })),
    ).toBeNull()
  })

  test('unrelated keys return null', () => {
    expect(listNavIntent(ev({ key: 'Enter' }))).toBeNull()
    expect(listNavIntent(ev({ key: ' ' }))).toBeNull()
    expect(listNavIntent(ev({ key: 'a', ctrlKey: true }))).toBeNull()
  })
})
