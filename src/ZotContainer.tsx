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
  // Inline, in-flow popup: no dim, and a click anywhere outside it (i.e. on the
  // layer itself, not the popup) dismisses — restoring the cursor — like Logseq's
  // own autocomplete. Escape is handled globally in handle-popup.ts.
  return (
    <div
      className="zot-popup-layer"
      onClick={(e) => {
        if (e.target === e.currentTarget)
          logseq.hideMainUI({ restoreEditingCursor: true })
      }}
    >
      {rect && uuid && (
        <SearchItem rect={rect} uuid={uuid} openedAt={openedAt} />
      )}
    </div>
  )
}
