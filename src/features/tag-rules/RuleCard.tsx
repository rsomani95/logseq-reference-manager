import { Plus, Trash2 } from 'lucide-react'

import {
  type DraftCondition,
  type DraftRule,
  emptyDraftCondition,
  type RuleErrors,
} from '../../extended-tags'
import { ConditionRow } from './ConditionRow'

interface RuleCardProps {
  rule: DraftRule
  index: number
  errors?: RuleErrors
  disabled: boolean
  onChange: (next: DraftRule) => void
  onRemove: () => void
}

const MATCH_MODES = ['any', 'all'] as const

export const RuleCard = ({
  rule,
  index,
  errors,
  disabled,
  onChange,
  onRemove,
}: RuleCardProps) => {
  const update = (patch: Partial<DraftRule>) => onChange({ ...rule, ...patch })

  const updateCondition = (id: string, patch: Partial<DraftCondition>) =>
    update({
      when: rule.when.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })

  const addCondition = () =>
    update({ when: [...rule.when, emptyDraftCondition()] })

  const removeCondition = (id: string) =>
    update({ when: rule.when.filter((c) => c.id !== id) })

  return (
    <div className="tagrule-card">
      <div className="tagrule-card-head">
        <label className="tagrule-tag-label">
          <span className="tagrule-label-text">Apply tag</span>
          <input
            type="text"
            className={`tagrule-input tagrule-tag${
              errors?.tag ? ' is-invalid' : ''
            }`}
            value={rule.tag}
            placeholder="e.g. MLPaper"
            aria-label="Tag to apply"
            disabled={disabled}
            onChange={(e) => update({ tag: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="tagrule-icon-btn tagrule-delete-rule"
          aria-label={`Delete rule ${index + 1}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </div>
      {errors?.tag && <div className="tagrule-error">{errors.tag}</div>}

      <div className="tagrule-match" role="radiogroup" aria-label="Match mode">
        <span className="tagrule-label-text">Match</span>
        {MATCH_MODES.map((mode) => (
          <label key={mode} className="tagrule-seg">
            <input
              type="radio"
              name={`match-${rule.id}`}
              checked={rule.match === mode}
              disabled={disabled}
              onChange={() => update({ match: mode })}
            />
            <span>{mode}</span>
          </label>
        ))}
        <span className="tagrule-match-suffix">of the following:</span>
      </div>

      <div className="tagrule-conditions">
        {rule.when.map((cond) => (
          <ConditionRow
            key={cond.id}
            condition={cond}
            errors={errors?.when[cond.id]}
            canRemove={rule.when.length > 1}
            disabled={disabled}
            onChange={(patch) => updateCondition(cond.id, patch)}
            onRemove={() => removeCondition(cond.id)}
          />
        ))}
      </div>

      <button
        type="button"
        className="tagrule-add"
        disabled={disabled}
        onClick={addCondition}
      >
        <Plus size={14} aria-hidden /> Add condition
      </button>
    </div>
  )
}
