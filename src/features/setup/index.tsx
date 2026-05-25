import {
  Check,
  Library,
  Link2,
  type LucideIcon,
  Tags,
  Type,
  X,
} from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'

import { testZotConnection } from '../../services/get-zot-items'
import { isSchemaAdded } from '../../services/is-schema-added'
import { ConnectSection } from './ConnectSection'
import { FormatsSection } from './FormatsSection'
import { LibrarySection } from './LibrarySection'
import { TagRulesSection } from './TagRulesSection'

export type SetupSection = 'connect' | 'library' | 'formats' | 'tagRules'

export interface ConnResult {
  code: 'success' | 'error'
  msg: string
}

interface NavItem {
  id: SetupSection
  label: string
  icon: LucideIcon
  advanced?: boolean
}

const NAV: NavItem[] = [
  { id: 'connect', label: 'Connection', icon: Link2 },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'formats', label: 'Import formats', icon: Type },
  { id: 'tagRules', label: 'Tag rules', icon: Tags, advanced: true },
]

// Only these two gate the "first incomplete → land here" logic and show a
// completion tick. Formats always has valid defaults and Tag rules is optional,
// so neither can be "incomplete".
const GATING: SetupSection[] = ['connect', 'library']

export const SetupApp = ({
  initialSection,
}: {
  initialSection?: SetupSection
}) => {
  // `null` until the initial probe resolves and picks a landing section — a
  // deep-link (initialSection) skips the wait.
  const [active, setActive] = useState<SetupSection | null>(
    initialSection ?? null,
  )
  const [conn, setConn] = useState<ConnResult | null>(null)
  const [schemaReady, setSchemaReady] = useState<boolean | null>(null)
  // Lifted out of LibrarySection so a schema-affecting change made in the
  // Import-formats section (store creators as page references) still nudges
  // Library to re-apply, and so the flag survives section navigation (which
  // remounts the section components).
  const [schemaDirty, setSchemaDirty] = useState(false)

  // One probe on open: seeds the nav ticks, hands the connection result to the
  // Connect section (so it doesn't re-probe), and lands the user on the first
  // incomplete step. Fast — both calls hit local APIs.
  useEffect(() => {
    let alive = true
    void (async () => {
      // A thrown probe (e.g. getAllProperties failing) must not strand the hub
      // on its loading spinner — fall back to "not set up" so the user lands on
      // Connect and can still navigate.
      const [c, s] = await Promise.all([
        testZotConnection(),
        isSchemaAdded(),
      ]).catch((): [ConnResult, boolean] => [{ code: 'error', msg: '' }, false])
      if (!alive) return
      setConn(c)
      setSchemaReady(s)
      setActive((prev) => {
        if (prev) return prev
        if (c.code !== 'success') return 'connect'
        if (!s) return 'library'
        return 'connect'
      })
    })()
    return () => {
      alive = false
    }
  }, [])

  const complete: Record<SetupSection, boolean | null> = {
    connect: conn ? conn.code === 'success' : null,
    library: schemaReady,
    formats: true,
    tagRules: true,
  }

  const nextIncomplete = GATING.find((id) => complete[id] === false)

  const renderSection = () => {
    switch (active) {
      case 'connect':
        return <ConnectSection initial={conn} onResult={setConn} />
      case 'library':
        return (
          <LibrarySection
            onSchemaChange={setSchemaReady}
            schemaDirty={schemaDirty}
            onSchemaDirty={setSchemaDirty}
          />
        )
      case 'formats':
        return <FormatsSection onSchemaDirty={() => setSchemaDirty(true)} />
      case 'tagRules':
        return <TagRulesSection />
      default:
        return (
          <div className="setup-loading">
            <span className="spinner" />
          </div>
        )
    }
  }

  return (
    <div
      className="setup-container"
      role="dialog"
      aria-modal="true"
      aria-label="Zotero settings"
    >
      <div className="setup-header">
        <h2 className="setup-title">Zotero settings</h2>
        <button
          type="button"
          className="tagrule-icon-btn"
          aria-label="Close"
          onClick={() => logseq.hideMainUI()}
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="setup-main">
        <nav className="setup-nav" aria-label="Settings sections">
          {NAV.map((item) => {
            const Icon = item.icon
            const showCheck =
              GATING.includes(item.id) && complete[item.id] === true
            return (
              <Fragment key={item.id}>
                {item.advanced && (
                  <div className="setup-nav-divider">Advanced</div>
                )}
                <button
                  type="button"
                  className={`setup-nav-item${
                    active === item.id ? ' is-active' : ''
                  }`}
                  aria-current={active === item.id}
                  onClick={() => setActive(item.id)}
                >
                  <Icon size={15} aria-hidden className="setup-nav-icon" />
                  <span className="setup-nav-label">{item.label}</span>
                  {showCheck && (
                    <Check
                      size={14}
                      aria-label="done"
                      className="setup-nav-check"
                    />
                  )}
                </button>
              </Fragment>
            )
          })}

          {nextIncomplete && active !== nextIncomplete && (
            <button
              type="button"
              className="setup-nav-next"
              onClick={() => setActive(nextIncomplete)}
            >
              Next: {NAV.find((n) => n.id === nextIncomplete)?.label}
            </button>
          )}
        </nav>

        <div className="setup-panel">{renderSection()}</div>
      </div>
    </div>
  )
}
