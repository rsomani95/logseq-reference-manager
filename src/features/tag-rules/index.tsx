import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  type DraftRule,
  emptyDraftRule,
  getConfiguredTagRules,
  rulesToDrafts,
  serializeRules,
  validateDraftRules,
} from '../../extended-tags'
import { RuleCard } from './RuleCard'

export const TagRulesEditor = () => {
  // Seed from the current setting on each open (the container remounts per
  // invocation), so external edits and prior saves are reflected.
  const [drafts, setDrafts] = useState<DraftRule[]>(() =>
    rulesToDrafts(getConfiguredTagRules()),
  )
  // Errors stay hidden until the first Save attempt — calmer than flagging
  // every half-typed field. After that, validation is live, so each fix clears
  // its own error as the user types.
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)

  const validation = useMemo(() => validateDraftRules(drafts), [drafts])

  const updateRule = (next: DraftRule) =>
    setDrafts((prev) => prev.map((r) => (r.id === next.id ? next : r)))
  const removeRule = (id: string) =>
    setDrafts((prev) => prev.filter((r) => r.id !== id))
  const addRule = () => setDrafts((prev) => [...prev, emptyDraftRule()])

  const close = () => logseq.hideMainUI()

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
      await logseq.UI.showMsg('Tag rules saved', 'success')
      logseq.hideMainUI()
    } catch (e) {
      setSaving(false)
      await logseq.UI.showMsg(
        `Couldn't save tag rules: ${
          e instanceof Error ? e.message : String(e)
        }`,
        'error',
      )
    }
  }

  const errorCount = Object.keys(validation.errors).length
  const status =
    showErrors && validation.hasErrors
      ? `Fix ${errorCount} ${errorCount === 1 ? 'rule' : 'rules'} to save`
      : `${drafts.length} ${drafts.length === 1 ? 'rule' : 'rules'}`

  return (
    <div className="batch-container tagrule-container">
      <div className="tagrule-header">
        <div className="tagrule-header-text">
          <h2 className="tagrule-title">Tag rules</h2>
          <p className="tagrule-subtitle">
            Add extra Logseq tags to imported items that match your conditions.
            The base Zotero tag is always applied on top.
          </p>
        </div>
        <button
          type="button"
          className="tagrule-icon-btn"
          aria-label="Close"
          onClick={close}
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="tagrule-body">
        {drafts.length === 0 ? (
          <div className="tagrule-empty">
            <p>No tag rules yet.</p>
            <p className="tagrule-empty-sub">
              Add a rule to automatically tag matching imports — for example,
              tag anything from arxiv.org as MLPaper.
            </p>
          </div>
        ) : (
          drafts.map((rule, i) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={i}
              errors={showErrors ? validation.errors[rule.id] : undefined}
              disabled={saving}
              onChange={updateRule}
              onRemove={() => removeRule(rule.id)}
            />
          ))
        )}
        <button
          type="button"
          className="tagrule-add tagrule-add-rule"
          disabled={saving}
          onClick={addRule}
        >
          <Plus size={15} aria-hidden /> Add rule
        </button>
      </div>

      <div className="batch-footer">
        <div className="batch-footer-row">
          <span className="batch-footer-status">{status}</span>
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-white"
              disabled={saving}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
