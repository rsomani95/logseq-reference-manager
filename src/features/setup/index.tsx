import {
  Check,
  Database,
  Globe,
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
import { SchemaSection } from './SchemaSection'
import { TagRulesSection } from './TagRulesSection'
import { WebSection } from './WebSection'

export type SetupSection = 'schema' | 'connect' | 'formats' | 'tagRules' | 'web'

export interface ConnResult {
  code: 'success' | 'error'
  msg: string
}

interface NavItem {
  id: SetupSection
  label: string
  icon: LucideIcon
  group: string
}

// Three top-level groups. "Schema" is the shared property schema both sources
// inherit; "Zotero" is the source the plugin imports itself; "Web references"
// configures the companion browser extension.
const NAV: NavItem[] = [
  { id: 'schema', label: 'Properties', icon: Database, group: 'Schema' },
  { id: 'connect', label: 'Connection', icon: Link2, group: 'Zotero' },
  { id: 'formats', label: 'Import Formats', icon: Type, group: 'Zotero' },
  { id: 'tagRules', label: 'Tag Rules', icon: Tags, group: 'Zotero' },
  { id: 'web', label: 'Web Clipper', icon: Globe, group: 'Web references' },
]

// Only these two gate the "first incomplete → land here" logic and show a
// completion tick. Formats / Tag rules / Web always have valid defaults (or are
// optional), so none can be "incomplete".
const GATING: SetupSection[] = ['connect', 'schema']

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
  // Lifted out of SchemaSection so a schema-affecting change made in the
  // Import-formats section (store creators as page references) still nudges
  // Schema to re-apply, and so the flag survives section navigation (which
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
        if (!s) return 'schema'
        return 'connect'
      })
    })()
    return () => {
      alive = false
    }
  }, [])

  const complete: Record<SetupSection, boolean | null> = {
    schema: schemaReady,
    connect: conn ? conn.code === 'success' : null,
    formats: true,
    tagRules: true,
    web: true,
  }

  const nextIncomplete = GATING.find((id) => complete[id] === false)

  const renderSection = () => {
    switch (active) {
      case 'schema':
        return (
          <SchemaSection
            onSchemaChange={setSchemaReady}
            schemaDirty={schemaDirty}
            onSchemaDirty={setSchemaDirty}
          />
        )
      case 'connect':
        return <ConnectSection initial={conn} onResult={setConn} />
      case 'formats':
        return <FormatsSection onSchemaDirty={() => setSchemaDirty(true)} />
      case 'tagRules':
        return <TagRulesSection />
      case 'web':
        return <WebSection onGoToSchema={() => setActive('schema')} />
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
      aria-label="Reference Manager settings"
    >
      <div className="setup-header">
        <h2 className="setup-title">Reference Manager</h2>
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
          {NAV.map((item, i) => {
            const Icon = item.icon
            const showCheck =
              GATING.includes(item.id) && complete[item.id] === true
            const showGroup = i === 0 || NAV[i - 1]?.group !== item.group
            return (
              <Fragment key={item.id}>
                {showGroup && (
                  <div className="setup-nav-group">{item.group}</div>
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
