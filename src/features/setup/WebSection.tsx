import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, CheckCircle2, GripVertical, Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { SchemaSnapshot } from '../../services/schema-snapshot'
import {
  parseSectionOrder,
  serializeSectionOrder,
  WEB_SECTIONS,
  type WebSectionDef,
  type WebSectionId,
} from '../../web-sections'

interface SectionValue {
  name: string
  fold: boolean
  // Highlights has no capture key, so its enable is pinned true.
  capture: boolean
}

// Seed the per-section template state from the live store, falling back to each
// section's default (which matches what settings.ts seeds on a fresh install).
const readSections = (): Record<WebSectionId, SectionValue> => {
  const s = logseq.settings as Record<string, unknown> | undefined
  const out = {} as Record<WebSectionId, SectionValue>
  for (const def of Object.values(WEB_SECTIONS)) {
    out[def.id] = {
      name: (s?.[def.nameKey] as string) ?? def.defaultName,
      fold: (s?.[def.foldKey] as boolean) ?? def.defaultFold,
      capture: def.captureKey
        ? ((s?.[def.captureKey] as boolean) ?? true)
        : true,
    }
  }
  return out
}

// One row in the Page template list — a draggable card for a single section
// block. The grip is the only drag activator (pointer + keyboard), so the name
// input and toggles stay directly interactive. An optional section that's
// switched off dims its name/fold but keeps its place in the order.
const SortableSectionCard = ({
  def,
  value,
  onChange,
}: {
  def: WebSectionDef
  value: SectionValue
  onChange: (patch: Partial<SectionValue>) => void
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: def.id })

  const enabled = value.capture

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`web-section-card${isDragging ? ' is-dragging' : ''}${
        enabled ? '' : ' is-off'
      }`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="web-section-grip"
        aria-label={`Reorder ${def.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden />
      </button>

      {def.captureKey ? (
        <input
          type="checkbox"
          className="web-section-enable"
          checked={enabled}
          aria-label={`Include ${def.label}`}
          onChange={(e) => onChange({ capture: e.target.checked })}
        />
      ) : (
        <span className="web-section-enable-spacer" aria-hidden />
      )}

      <span className="web-section-label">{def.label}</span>

      <input
        className="tagrule-input web-section-name"
        value={value.name}
        placeholder={def.defaultName}
        disabled={!enabled}
        aria-label={`${def.label} heading name`}
        onChange={(e) => onChange({ name: e.target.value })}
      />

      <label className="checkbox-label web-section-fold">
        <input
          type="checkbox"
          checked={value.fold}
          disabled={!enabled}
          onChange={(e) => onChange({ fold: e.target.checked })}
        />
        Fold
      </label>
    </div>
  )
}

// The Web references section. Unlike the Zotero sections, the plugin doesn't do
// the work here — the companion web-clipper browser extension does. The
// extension reads these values over Logseq's HTTP API (it can read the plugin's
// live settings but cannot write them), tags each clipped page with the Web
// tag, and uses the rest to shape the page. So this section is a settings form
// for a *consumer that lives in another process*, plus a button to wire the Web
// tag into the shared schema. The keys are a contract — see settings.md.
export const WebSection = ({
  webTag,
  baseTag,
  baseReady,
  webDirty,
  webApplied,
  linking,
  onConfigChange,
  onSetUpWebTag,
  onGoToSchema,
}: {
  // The Web tag is the one schema-relevant control here (it extends the base),
  // so it's owned by the lifted schema state: `webTag` is the controlled value,
  // `webDirty` is a real diff against the last-wired tag (so re-typing it back
  // disables the button), and `onSetUpWebTag` does the wiring. The page-template
  // controls below are consumed by the extension at clip time, not schema, so
  // they stay self-persisted local state.
  webTag: string
  baseTag: string
  // Is the base schema applied? Wiring the Web tag needs the base class to exist.
  baseReady: boolean | null
  webDirty: boolean
  // Has a web tag ever been wired (distinguishes "set it up" from "changed")?
  webApplied: boolean
  linking: boolean
  onConfigChange: (patch: Partial<SchemaSnapshot>) => void
  onSetUpWebTag: () => void
  // Jump to the Schema section — used by the "base schema not set up" gate so
  // the user can fix the precondition without hunting for the right nav item.
  onGoToSchema?: () => void
}) => {
  // Page-template state: each section's heading name / fold / enable, plus the
  // order the extension writes them in.
  const [sections, setSections] =
    useState<Record<WebSectionId, SectionValue>>(readSections)
  const [order, setOrder] = useState<WebSectionId[]>(() =>
    parseSectionOrder(logseq.settings?.webSectionOrder),
  )

  const [headingMarkers, setHeadingMarkers] = useState<boolean>(
    (logseq.settings?.webUseHeadingMarkers as boolean) ?? false,
  )
  const [pageTags, setPageTags] = useState<boolean>(
    (logseq.settings?.webPopulatePageTags as boolean) ?? false,
  )

  // If the stored order was missing or malformed, write the normalised value
  // back so the extension always reads a complete, valid list.
  useEffect(() => {
    const normalized = parseSectionOrder(logseq.settings?.webSectionOrder)
    const canonical = serializeSectionOrder(normalized)
    if (
      (logseq.settings?.webSectionOrder as string | undefined) !== canonical
    ) {
      void logseq.updateSettings({ webSectionOrder: canonical })
    }
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const onWebTag = (v: string) => onConfigChange({ webTag: v })
  const onHeadingMarkers = (v: boolean) => {
    setHeadingMarkers(v)
    void logseq.updateSettings({ webUseHeadingMarkers: v })
  }
  const onPageTags = (v: boolean) => {
    setPageTags(v)
    void logseq.updateSettings({ webPopulatePageTags: v })
  }

  const updateSection = (id: WebSectionId, patch: Partial<SectionValue>) => {
    setSections((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    const def = WEB_SECTIONS[id]
    const next: Record<string, unknown> = {}
    if (patch.name !== undefined) next[def.nameKey] = patch.name
    if (patch.fold !== undefined) next[def.foldKey] = patch.fold
    if (patch.capture !== undefined && def.captureKey)
      next[def.captureKey] = patch.capture
    if (Object.keys(next).length) void logseq.updateSettings(next)
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const from = prev.indexOf(active.id as WebSectionId)
      const to = prev.indexOf(over.id as WebSectionId)
      if (from === -1 || to === -1) return prev
      const reordered = arrayMove(prev, from, to)
      void logseq.updateSettings({
        webSectionOrder: serializeSectionOrder(reordered),
      })
      return reordered
    })
  }

  // Derived entirely from the lifted state — no session-only "linked" flag.
  // `!webDirty` (with the base applied) means the live tag matches the one
  // currently wired to extend the base, so it's set up.
  const isSetUp = baseReady === true && !webDirty
  const status =
    baseReady === false
      ? 'Apply the shared schema first (Schema section), then set up the web tag.'
      : isSetUp
        ? `“#${webTag.trim()}” extends “${baseTag.trim()}”.`
        : webApplied
          ? 'Web tag changed — set it up so clips inherit the schema.'
          : 'Set up the web tag so clipped pages inherit the shared schema.'

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Web references</h3>
        <p className="setup-section-desc">
          Settings for the companion web-clipper browser extension. It reads
          these over Logseq’s API — it can’t edit them, so this is the only
          place they’re set. Clipped pages are tagged with the Web tag and
          inherit the same schema as Zotero imports.
        </p>
      </div>

      <div className="setup-section-body">
        {baseReady === false && (
          <div className="setup-status is-warn">
            <AlertTriangle size={16} aria-hidden />
            <div className="setup-status-text">
              Shared schema not set up yet
              <span className="setup-status-sub">
                The Web tag inherits the shared schema — and the web clipper
                refuses to clip until it exists. Apply it in the Schema section
                first, then set up the Web tag here.
              </span>
            </div>
            {onGoToSchema && (
              <button
                type="button"
                className="btn btn-white setup-gate-action"
                onClick={onGoToSchema}
              >
                Go to Schema
              </button>
            )}
          </div>
        )}

        <div className="setup-field">
          <label className="setup-field-label" htmlFor="web-tag">
            Web tag
          </label>
          <p className="setup-field-hint">
            The tag every clipped page carries. Extends “{baseTag}”, so it
            inherits the shared schema.
          </p>
          <input
            id="web-tag"
            className="tagrule-input setup-control"
            value={webTag}
            placeholder="Web"
            onChange={(e) => onWebTag(e.target.value)}
          />
        </div>

        <div className="setup-field">
          <div className="web-template-head">
            <span className="setup-field-label">Page template</span>
            <p className="setup-field-hint">
              The sections each clipped page is built from. Drag to set the
              order they appear, rename a heading, or fold one on import.
            </p>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={order}
              strategy={verticalListSortingStrategy}
            >
              <div className="web-section-list">
                {order.map((id) => (
                  <SortableSectionCard
                    key={id}
                    def={WEB_SECTIONS[id]}
                    value={sections[id]}
                    onChange={(patch) => updateSection(id, patch)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={headingMarkers}
              onChange={(e) => onHeadingMarkers(e.target.checked)}
            />
            Keep heading markers
          </label>
          <p className="setup-field-hint">
            Keep Markdown <code className="inline-code">#</code> markers on
            headings.
          </p>
        </div>

        <div className="setup-field">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={pageTags}
              onChange={(e) => onPageTags(e.target.checked)}
            />
            Populate page tags
          </label>
          <p className="setup-field-hint">
            Pre-fill the page’s tags from the clipped page’s own keywords.
          </p>
        </div>
      </div>

      <div className="setup-section-footer">
        <span className="setup-footer-status">
          {isSetUp ? (
            <span className="setup-status is-ok">
              <CheckCircle2 size={15} aria-hidden /> {status}
            </span>
          ) : (
            status
          )}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSetUpWebTag}
          disabled={linking || baseReady !== true || !webDirty}
        >
          <Link2 size={14} aria-hidden />
          {linking ? 'Setting up…' : 'Set up web tag'}
        </button>
      </div>
    </>
  )
}
