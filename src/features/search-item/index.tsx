import { useForm } from 'react-hook-form'

import { ResultCard } from '../../components/ResultCard'
import { DEBOUNCE_DELAY } from '../../constants'
import { useDebounce } from '../../hooks/use-debounce'
import { useZotItem } from '../../hooks/use-items'
import { ZotData } from '../../interfaces'

export interface FormValues {
  search: string
}

export const SearchItem = ({
  flag,
  rect: { x, y },
  uuid,
}: {
  flag: 'full' | 'table' | 'citation'
  rect: { x: number; y: number }
  uuid: string
}) => {
  const { register, watch, reset } = useForm<FormValues>({
    defaultValues: {
      search: '',
    },
  })
  const queryString = watch('search')
  const debounceSearch = useDebounce(queryString, DEBOUNCE_DELAY)

  const { data: zotDataResult } = useZotItem(debounceSearch)

  return (
    <div className="search-container" style={{ left: x, top: y }}>
      <div className="search-input-wrapper">
        <input
          id="search-field"
          {...register('search')}
          type="text"
          placeholder="Start searching"
          className="search-input"
        />
        <span className="search-result-count">
          {zotDataResult && zotDataResult.length === 0 && 'No results'}
          {zotDataResult &&
            zotDataResult.length > 0 &&
            `${zotDataResult.length} results`}
        </span>
      </div>
      <div className="results-list">
        {zotDataResult &&
          zotDataResult.map((item: ZotData) => (
            <ResultCard
              key={item.key}
              flag={flag}
              uuid={uuid}
              item={item}
              reset={reset}
            />
          ))}
      </div>
    </div>
  )
}
