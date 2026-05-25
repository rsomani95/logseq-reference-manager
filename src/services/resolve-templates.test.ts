import {
  applyCreatorTemplate,
  applyPageNameTemplate,
  hasCiteKeyToken,
} from './resolve-templates'
import { describe, expect, test } from 'bun:test'

const PAGE = { title: 'Attention Is All You Need', citeKey: 'vaswani2017' }

describe('applyPageNameTemplate', () => {
  test('fills the canonical citeKey default', () => {
    expect(applyPageNameTemplate('@<% citeKey %>', PAGE)).toBe('@vaswani2017')
  })

  test('fills title and combined templates', () => {
    expect(applyPageNameTemplate('<% title %>', PAGE)).toBe(
      'Attention Is All You Need',
    )
    expect(applyPageNameTemplate('<% citeKey %> — <% title %>', PAGE)).toBe(
      'vaswani2017 — Attention Is All You Need',
    )
  })

  test('tolerates missing/extra whitespace in placeholders', () => {
    expect(applyPageNameTemplate('@<%citeKey%>', PAGE)).toBe('@vaswani2017')
    expect(applyPageNameTemplate('@<%   citeKey   %>', PAGE)).toBe(
      '@vaswani2017',
    )
  })

  test('tolerates placeholder case', () => {
    expect(applyPageNameTemplate('@<% CITEKEY %>', PAGE)).toBe('@vaswani2017')
  })

  test('strips an unknown leftover token rather than emitting it literally', () => {
    expect(applyPageNameTemplate('@<% citeKey %> <% year %>', PAGE)).toBe(
      '@vaswani2017',
    )
  })

  test('a placeholder-free (constant) template falls back to the citeKey default — no collisions', () => {
    expect(applyPageNameTemplate('MyPaper', PAGE)).toBe('@vaswani2017')
    expect(applyPageNameTemplate('', PAGE)).toBe('@vaswani2017')
    expect(applyPageNameTemplate(undefined, PAGE)).toBe('@vaswani2017')
  })

  test('falls back to title when citeKey is unavailable and not templated', () => {
    expect(
      applyPageNameTemplate('<% title %>', { title: 'X', citeKey: 'N/A' }),
    ).toBe('X')
    expect(
      applyPageNameTemplate('MyPaper', { title: 'X', citeKey: 'N/A' }),
    ).toBe('X')
  })
})

describe('applyCreatorTemplate', () => {
  const ada = { firstName: 'Ada', lastName: 'Lovelace', name: undefined }

  test('renders "First Last" and "Last, First"', () => {
    expect(applyCreatorTemplate('<% firstName %> <% lastName %>', ada)).toBe(
      'Ada Lovelace',
    )
    expect(applyCreatorTemplate('<% lastName %>, <% firstName %>', ada)).toBe(
      'Lovelace, Ada',
    )
  })

  test('single-field (institutional) creators use their name verbatim', () => {
    expect(
      applyCreatorTemplate('<% firstName %> <% lastName %>', {
        name: 'OpenAI',
      }),
    ).toBe('OpenAI')
  })

  test('collapses the gap when only one name part is present', () => {
    expect(
      applyCreatorTemplate('<% firstName %> <% lastName %>', {
        lastName: 'Knuth',
      }),
    ).toBe('Knuth')
  })

  test('a placeholder-free template falls back to "First Last"', () => {
    expect(applyCreatorTemplate('Anonymous', ada)).toBe('Ada Lovelace')
    expect(applyCreatorTemplate(undefined, ada)).toBe('Ada Lovelace')
  })
})

describe('hasCiteKeyToken', () => {
  test('detects the token tolerantly, ignores absence', () => {
    expect(hasCiteKeyToken('@<% citeKey %>')).toBe(true)
    expect(hasCiteKeyToken('@<%citekey%>')).toBe(true)
    expect(hasCiteKeyToken('<% title %>')).toBe(false)
    expect(hasCiteKeyToken(undefined)).toBe(false)
  })
})
