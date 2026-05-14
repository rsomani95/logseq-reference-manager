import './styles/bg.css'
import './styles/components.css'

import { BatchView } from './features/batch-import'

export const BatchContainer = () => {
  return (
    <div className="zot-backdrop">
      <BatchView />
    </div>
  )
}
