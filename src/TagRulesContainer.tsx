import './styles/bg.css'
import './styles/components.css'

import { TagRulesEditor } from './features/tag-rules'

export const TagRulesContainer = () => {
  return (
    <div className="zot-backdrop">
      <TagRulesEditor />
    </div>
  )
}
