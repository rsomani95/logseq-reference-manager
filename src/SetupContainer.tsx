import './styles/bg.css'
import './styles/components.css'

import { SetupApp, type SetupSection } from './features/setup'

export const SetupContainer = ({
  initialSection,
}: {
  initialSection?: SetupSection
}) => {
  return (
    <div className="zot-backdrop">
      <SetupApp initialSection={initialSection} />
    </div>
  )
}
