import { Table } from '@tanstack/react-table'
import {
  Ban,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { ZotData } from '../interfaces'
import { isSchemaAdded } from '../services/is-schema-added'
import { setLogseqDbSchema } from '../services/set-logseqdb-schema'

interface FormValues {
  pageSize: string
  colVisibility: any
}

export const ButtonContainer = ({
  table,
  insertAll,
}: {
  table: Table<ZotData>
  insertAll: () => void
}) => {
  const { control, watch } = useForm<FormValues>({
    defaultValues: {
      pageSize: table.getState().pagination.pageSize.toString(),
      colVisibility: table.getState().columnVisibility,
    },
  })
  const [showColumnChooser, setShowColumnChooser] = useState(false)
  const [userConfirmation, setUserConfirmation] = useState(false)
  const [settingSchema, setSettingSchema] = useState(false)
  const pageSize = watch('pageSize')

  useEffect(() => {
    table.setPageSize(Number(pageSize))
  }, [pageSize])

  const ColumnVisibilityChooser = () => (
    <>
      {table.getAllLeafColumns().map((column) => (
        <Controller
          key={column.id}
          control={control}
          name={`colVisibility.${column.id}`}
          render={({ field }) => (
            <label className="checkbox-label">
              <input
                type="checkbox"
                {...field}
                checked={column.getIsVisible()}
                onChange={column.getToggleVisibilityHandler()}
              />
              {column.id}
            </label>
          )}
        />
      ))}
    </>
  )

  const setupSchemaForZoteroProps = useCallback(async () => {
    setSettingSchema(true)
    const isDb = await logseq.App.checkCurrentIsDbGraph()
    const schemaAdded = await isSchemaAdded()
    if (isDb && !schemaAdded) {
      await setLogseqDbSchema()
      setSettingSchema(false)
    }
  }, [pageSize])

  return (
    <div className="btn-stack">
      <div className="alert-box">
        <div className="alert-title">For Logseq DB users only</div>
        <div className="alert-body">
          <span className="alert-text">
            To start using this plugin, the schema for all the Zotero item
            properties (120 properties) will need to be defined first. You will
            see these 120 properties within your{' '}
            <code className="inline-code">#Property</code> tag.
          </span>
          <button
            className="btn btn-danger-outline"
            onClick={setupSchemaForZoteroProps}
            disabled={settingSchema}
          >
            Proceed to setup schema for Zotero properties
          </button>
        </div>
      </div>

      <div className="btn-group">
        <button
          className="btn btn-primary"
          onClick={() => setShowColumnChooser(!showColumnChooser)}
        >
          {showColumnChooser ? 'Close' : 'Choose Columns'}
        </button>
        {showColumnChooser && <ColumnVisibilityChooser />}
      </div>

      <div className="btn-group">
        {userConfirmation && (
          <button
            className="btn btn-danger"
            style={{ width: '11rem' }}
            onClick={insertAll}
          >
            Click to Proceed (re-index is recommended after completion)
          </button>
        )}
        {userConfirmation && (
          <button
            className="btn btn-gray"
            onClick={() => setUserConfirmation(false)}
          >
            <Ban size="1rem" />
          </button>
        )}
        {!userConfirmation && (
          <div className="tooltip-wrapper">
            <button
              className="btn btn-primary"
              style={{ width: '11rem' }}
              disabled={table.getRowCount() > 100}
              onClick={() => setUserConfirmation(true)}
            >
              Insert {table.getRowCount().toLocaleString()} items
            </button>
            <span className="tooltip-text">
              There may be an issue inserting more than 100 items
            </span>
          </div>
        )}
        {!userConfirmation && (
          <>
            <button
              className="btn btn-primary"
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronFirst size="1rem" />
            </button>
            <button
              className="btn btn-primary"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft size="1rem" />
            </button>
            <button
              className="btn btn-primary"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight size="1rem" />
            </button>
            <button
              className="btn btn-primary"
              onClick={() => table.lastPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronLast size="1rem" />
            </button>

            <Controller
              control={control}
              name="pageSize"
              render={({ field }) => (
                <select className="select-input" {...field}>
                  <option value="10">10 results</option>
                  <option value="20">20 results</option>
                  <option value="30">30 results</option>
                  <option value="50">50 results</option>
                  <option value="100">100 results</option>
                </select>
              )}
            />
          </>
        )}
      </div>
    </div>
  )
}
