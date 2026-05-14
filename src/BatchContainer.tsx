import './styles/bg.css'
import './styles/components.css'

import { BatchView } from './features/batch-import'

export const BatchContainer = () => {
  return (
    <div style={{ background: 'none' }}>
      <BatchView />
    </div>
  )
}
