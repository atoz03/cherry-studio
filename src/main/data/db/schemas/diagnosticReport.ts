import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Upload history for the removed upstream diagnostics service. Kept only because the
// shipped migration chain created it; nothing reads or writes it any more.
export const diagnosticReportTable = sqliteTable(
  'diagnostic_report',
  {
    reportId: text().primaryKey(),
    submittedAt: integer().notNull(),
    processingStatus: text().$type<'pending' | 'unprocessed' | 'investigating' | 'resolved' | 'closed'>(),
    lastCheckedAt: integer()
  },
  (table) => [
    index('diagnostic_report_submitted_at_idx').on(table.submittedAt, table.reportId),
    check(
      'diagnostic_report_processing_status_check',
      sql`${table.processingStatus} IN ('pending', 'unprocessed', 'investigating', 'resolved', 'closed')`
    )
  ]
)
