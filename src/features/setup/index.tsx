import {
  Check,
  Database,
  Globe,
  Highlighter,
  Link2,
  type LucideIcon,
  Paperclip,
  Tags,
  Type,
  Users,
  X,
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'

import { useFocusTrap } from '../../hooks/use-focus-trap'
import { testZotConnection } from '../../services/get-zot-items'
import { testLogseqApi } from '../../services/logseq-import-edn'
import { AnnotationsSection } from './AnnotationsSection'
import { AttachmentsSection } from './AttachmentsSection'
import { AuthorsSection } from './AuthorsSection'
import { ConnectSection } from './ConnectSection'
import { FormatsSection } from './FormatsSection'
import { SchemaSection } from './SchemaSection'
import { TagRulesSection } from './TagRulesSection'
import { useSchemaState } from './use-schema-state'
import { WebSection } from './WebSection'

export type SetupSection =
  | 'schema'
  | 'authors'
  | 'connect'
  | 'formats'
  | 'attachments'
  | 'annotations'
  | 'tagRules'
  | 'web'

export interface ConnResult {
  code: 'success' | 'error'
  msg: string
}

export interface LogseqConnResult {
  ok: boolean
  msg: string
}

interface NavItem {
  id: SetupSection
  label: string
  icon: LucideIcon
  group: string
}

// Three top-level groups. "General" holds what both sources share — the Schema
// (base tag + properties) and Authors (creator formatting + the node/default
// creators type the Web tag inherits); "Zotero" is the source the plugin
// imports itself; "Web references" configures the companion browser extension.
const NAV: NavItem[] = [
  { id: 'schema', label: 'Schema', icon: Database, group: 'General' },
  { id: 'authors', label: 'Authors', icon: Users, group: 'General' },
  { id: 'connect', label: 'Connections', icon: Link2, group: 'Zotero' },
  { id: 'formats', label: 'Import Formats', icon: Type, group: 'Zotero' },
  {
    id: 'attachments',
    label: 'Attachments',
    icon: Paperclip,
    group: 'Zotero',
  },
  {
    id: 'annotations',
    label: 'Annotations',
    icon: Highlighter,
    group: 'Zotero',
  },
  { id: 'tagRules', label: 'Tag Rules', icon: Tags, group: 'Zotero' },
  { id: 'web', label: 'Web Clipper', icon: Globe, group: 'Web references' },
]

// Only these two gate the "first incomplete → land here" logic and show a
// completion tick. Authors / Formats / Tag rules / Web always have valid
// defaults (or are optional), so none can be "incomplete".
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
  const [logseqConn, setLogseqConn] = useState<LogseqConnResult | null>(null)
  // All schema state (live config, applied snapshot, dirty flags, the apply /
  // delete / web-setup handlers, and the one isSchemaAdded probe) lives here.
  const schema = useSchemaState()

  // Trap Tab within the dialog: it floats over the app inside an iframe, so
  // Tab would otherwise escape into the obscured graph behind it.
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef)

  // Connection probes on open — the schema probe runs inside useSchemaState. A
  // thrown probe falls back to "error"/"not ok" so the hub can't strand on its
  // spinner. Both run so the Connections tick reflects Zotero + Logseq at once.
  useEffect(() => {
    let alive = true
    void testZotConnection()
      .then((c) => alive && setConn(c))
      .catch(() => alive && setConn({ code: 'error', msg: '' }))
    void testLogseqApi()
      .then((r) => alive && setLogseqConn(r))
      .catch(() => alive && setLogseqConn({ ok: false, msg: '' }))
    return () => {
      alive = false
    }
  }, [])

  // Land on the first incomplete step once the probes resolve. A deep-link
  // (initialSection) sets `active` up front, so this no-ops then.
  useEffect(() => {
    if (active !== null) return
    if (conn === null || logseqConn === null || schema.schemaReady === null)
      return
    // Land on Schema only when both connections are live but the schema isn't
    // applied yet; otherwise start on Connections (the first thing to fix, or
    // the default home).
    const bothConnected = conn.code === 'success' && logseqConn.ok
    if (bothConnected && !schema.schemaReady) setActive('schema')
    else setActive('connect')
  }, [active, conn, logseqConn, schema.schemaReady])

  const complete: Record<SetupSection, boolean | null> = {
    schema: schema.schemaReady,
    authors: true,
    // Both connections must be live — the tick (and the "Next:" nudge) reflect
    // Zotero *and* Logseq's HTTP API together.
    connect:
      conn === null || logseqConn === null
        ? null
        : conn.code === 'success' && logseqConn.ok,
    formats: true,
    attachments: true,
    annotations: true,
    tagRules: true,
    web: true,
  }

  const nextIncomplete = GATING.find((id) => complete[id] === false)

  const renderSection = () => {
    switch (active) {
      case 'schema':
        return (
          <SchemaSection
            config={schema.config}
            schemaReady={schema.schemaReady}
            baseDirty={schema.baseDirty}
            applying={schema.applying}
            deleting={schema.deleting}
            onConfigChange={schema.updateConfig}
            onApply={schema.applySchema}
            onDelete={schema.deleteSchema}
          />
        )
      case 'authors':
        return (
          <AuthorsSection
            creatorsAsNodes={schema.config.creatorsAsNodes}
            schemaReady={schema.schemaReady}
            baseDirty={schema.baseDirty}
            applying={schema.applying}
            onConfigChange={schema.updateConfig}
            onApply={schema.applySchema}
          />
        )
      case 'connect':
        return (
          <ConnectSection
            zot={conn}
            logseqConn={logseqConn}
            onZotResult={setConn}
            onLogseqResult={setLogseqConn}
          />
        )
      case 'formats':
        return <FormatsSection />
      case 'attachments':
        return <AttachmentsSection />
      case 'annotations':
        return (
          <AnnotationsSection onGoToConnections={() => setActive('connect')} />
        )
      case 'tagRules':
        return <TagRulesSection />
      case 'web':
        return (
          <WebSection
            webTag={schema.config.webTag}
            baseTag={schema.config.zotTag}
            baseReady={schema.schemaReady}
            webDirty={schema.webDirty}
            webLinked={schema.webLinked}
            webApplied={schema.webApplied}
            linking={schema.linking}
            onConfigChange={schema.updateConfig}
            onSetUpWebTag={schema.setUpWebTag}
            onGoToSchema={() => setActive('schema')}
          />
        )
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
      ref={containerRef}
      className="setup-container"
      role="dialog"
      aria-modal="true"
      aria-label="Reference Manager settings"
      tabIndex={-1}
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
