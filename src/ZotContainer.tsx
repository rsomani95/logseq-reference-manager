import './styles/bg.css'
import './styles/components.css'

import { SearchItem } from './features/search-item'

export const ZotContainer = ({
  uuid,
  rect,
}: {
  uuid?: string
  rect?: { x: number; y: number }
}) => {
  return (
    <div className="zot-backdrop">
      {rect && uuid && <SearchItem rect={rect} uuid={uuid} />}
    </div>
  )
}
