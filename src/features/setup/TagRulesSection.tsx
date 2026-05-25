import { Plus, Tags } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  type DraftRule,
  emptyDraftRule,
  getConfiguredTagRules,
  rulesToDrafts,
  serializeRules,
  validateDraftRules,
} from '../../extended-tags'
import { RuleCard } from '../tag-rules/RuleCard'

// The former standalone modal's logic, embedded as a hub section: the draft
// model, validation and serialize are unchanged — only the modal chrome (own
// header, close-X, and the Cancel/Save footer that called hideMainUI) is gone.
// Saving persists to the `tagRules` setting and shows an inline tick instead of
// closing the window, so the user can keep editing other sections.
export const TagRulesSection = () => {
  const [drafts, setDrafts] = useState<DraftRule[]>(() =>
    rulesToDrafts(getConfiguredTagRules()),
  )
  // Errors stay hidden until the first Save attempt, then validate live.
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)

  const validation = useMemo(() => validateDraftRules(drafts), [drafts])

  const updateRule = (next: DraftRule) =>
    setDrafts((prev) => prev.map((r) => (r.id === next.id ? next : r)))
  const removeRule = (id: string) =>
    setDrafts((prev) => prev.filter((r) => r.id !== id))
  const addRule = () => {
    setSavedTick(false)
    setDrafts((prev) => [...prev, emptyDraftRule()])
  }

  const save = async () => {
    if (validation.hasErrors) {
      setShowErrors(true)
      return
    }
    setSaving(true)
    try {
      await logseq.updateSettings({
        tagRules: serializeRules(validation.rules),
      })
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 2500)
    } catch (e) {
      await logseq.UI.showMsg(
        `Couldn't save tag rules: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    } finally {
      setSaving(false)
    }
  }

  const errorCount = Object.keys(validation.errors).length
  const status =
    showErrors && validation.hasErrors
      ? `Fix ${errorCount} ${errorCount === 1 ? 'rule' : 'rules'} to save`
      : savedTick
        ? 'Saved'
        : `${drafts.length} ${drafts.length === 1 ? 'rule' : 'rules'}`

  return (
    <>
      <div className="setup-section-head">
        <h3 className="setup-section-title">Tag rules</h3>
        <p className="setup-section-desc">
          Add extra Logseq tags to imported items that match your conditions.
          The base Zotero tag is always applied on top.
        </p>
      </div>

      <div className="setup-section-body">
        {drafts.length === 0 ? (
          <div className="tagrule-empty">
            <Tags size={30} aria-hidden className="tagrule-empty-icon" />
            <p className="tagrule-empty-title">No tag rules yet</p>
            <p className="tagrule-empty-sub">
              Add a rule to automatically tag matching imports — for example,
              tag anything from arxiv.org as MLPaper.
            </p>
            <button
              type="button"
              className="tagrule-add tagrule-add-rule"
              disabled={saving}
              onClick={addRule}
            >
              <Plus size={15} aria-hidden /> Add rule
            </button>
          </div>
        ) : (
          <>
            {drafts.map((rule, i) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                index={i}
                errors={showErrors ? validation.errors[rule.id] : undefined}
                disabled={saving}
                onChange={updateRule}
                onRemove={() => removeRule(rule.id)}
              />
            ))}
            <button
              type="button"
              className="tagrule-add tagrule-add-rule"
              disabled={saving}
              onClick={addRule}
            >
              <Plus size={15} aria-hidden /> Add rule
            </button>
          </>
        )}
      </div>

      <div className="setup-section-footer">
        <span className="setup-footer-status">{status}</span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={save}
        >
          Save rules
        </button>
      </div>
    </>
  )
}
