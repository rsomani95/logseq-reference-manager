import './styles/bg.css'
import './styles/components.css'

import { SearchItem } from './features/search-item'

export const ZotContainer = ({
  uuid,
  rect,
  openedAt,
}: {
  uuid?: string
  rect?: { x: number; y: number }
  openedAt?: number
}) => {
  return (
    <div className="zot-backdrop">
      {rect && uuid && (
        <SearchItem rect={rect} uuid={uuid} openedAt={openedAt} />
      )}
    </div>
  )
}
