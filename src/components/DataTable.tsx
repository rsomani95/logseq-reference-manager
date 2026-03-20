import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { format } from 'date-fns'
import { ArrowUpAZ, ArrowUpZA } from 'lucide-react'
import { memo, useState } from 'react'

import { columns } from '../features/items-table/Columns'
import { ZotData } from '../interfaces'
import { insertZotIntoGraph } from '../services/insert-zot-into-graph'
import { ButtonContainer } from './ButtonContainer'

interface TableProps {
  data: ZotData[]
}

export const DataTable = memo(({ data }: TableProps) => {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(logseq.settings!.columnVisibility as Record<string, boolean>)

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
    },
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
    onColumnVisibilityChange: setColumnVisibility,
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: 10,
      },
    },
  })

  // Save column visibility to settings for persistence
  logseq.updateSettings({ columnVisibility })

  const insertAll = async () => {
    // Get todays page to insert references to
    const { preferredDateFormat } = await logseq.App.getUserConfigs()
    const todayDate = format(new Date(), preferredDateFormat)
    const page = await logseq.Editor.getPage(todayDate)
    if (!page) {
      logseq.UI.showMsg(
        'Error getting todays date. No Zotero items have been inserted',
        'error',
      )
      return
    }

    try {
      await Promise.all(data.map((item) => insertZotIntoGraph(item)))
    } catch (error) {
      logseq.UI.showMsg(
        'Error inserting items. You may wish to go to your file explorer to check which ZotItems have been inserted',
      )
      console.error(error)
    }
  }

  return (
    <div className="data-table-wrapper">
      <ButtonContainer table={table} insertAll={insertAll} />
      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                  {{
                    asc: (
                      <ArrowUpAZ
                        size="1rem"
                        style={{ marginLeft: '0.2rem' }}
                        color="#333"
                      />
                    ),
                    desc: (
                      <ArrowUpZA
                        size="1rem"
                        style={{ marginLeft: '0.2rem' }}
                        color="#333"
                      />
                    ),
                  }[header.column.getIsSorted() as string] ?? null}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})
