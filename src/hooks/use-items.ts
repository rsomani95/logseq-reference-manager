import { useEffect, useState } from 'react'

import { ZotData } from '../interfaces'
import {
  getZotItemsFromQueryString,
  getZotItemsWithoutQueryString,
} from '../services/get-zot-items'

export const useZotItems = () => {
  const [data, setData] = useState<ZotData[] | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    getZotItemsWithoutQueryString()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err)
          setIsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { data, isLoading, isSuccess: !isLoading && !error, error }
}

export const useZotItem = (queryString: string) => {
  const [data, setData] = useState<ZotData[] | undefined>(undefined)

  useEffect(() => {
    if (!queryString || queryString.length <= 3) {
      setData(undefined)
      return
    }
    let cancelled = false
    getZotItemsFromQueryString(queryString).then((result) => {
      if (!cancelled) setData(result)
    })
    return () => {
      cancelled = true
    }
  }, [queryString])

  return { data }
}
