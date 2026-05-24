import { X } from 'lucide-react'
import type { ChangeEvent } from 'react'

import type {
  ConditionErrors,
  DraftCondition,
  RuleOp,
} from '../../extended-tags'
import { FieldSelect } from './FieldSelect'

const OP_OPTIONS: { value: RuleOp; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'regex', label: 'matches regex' },
]

interface ConditionRowProps {
  condition: DraftCondition
  errors?: ConditionErrors
  canRemove: boolean
  disabled: boolean
  onChange: (patch: Partial<DraftCondition>) => void
  onRemove: () => void
}

export const ConditionRow = ({
  condition,
  errors,
  canRemove,
  disabled,
  onChange,
  onRemove,
}: ConditionRowProps) => {
  const valuePlaceholder =
    condition.op === 'regex' ? 'regular expression' : 'value'

  return (
    <div className="tagrule-condition">
      <div className="tagrule-condition-row">
        <FieldSelect
          value={condition.field}
          invalid={!!errors?.field}
          disabled={disabled}
          onChange={(field) => onChange({ field })}
        />
        <select
          className="tagrule-select tagrule-op"
          value={condition.op}
          aria-label="Condition operator"
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onChange({ op: e.target.value as RuleOp })
          }
        >
          {OP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          className={`tagrule-input tagrule-value${
            errors?.value ? ' is-invalid' : ''
          }`}
          value={condition.value}
          placeholder={valuePlaceholder}
          aria-label="Condition value"
          disabled={disabled}
          onChange={(e) => onChange({ value: e.target.value })}
        />
        <button
          type="button"
          className="tagrule-icon-btn"
          aria-label="Remove condition"
          disabled={disabled || !canRemove}
          onClick={onRemove}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      {(errors?.field || errors?.value) && (
        <div className="tagrule-error">{errors.field ?? errors.value}</div>
      )}
    </div>
  )
}
