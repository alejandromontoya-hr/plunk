/**
 * Import and bulk operation queue job data types
 */

/**
 * How an import treats rows whose email already exists as a contact.
 * - CREATE: only create new contacts, skip existing emails
 * - UPDATE: only update existing contacts, skip new emails
 * - UPSERT: create new and update existing (both)
 */
export type ImportMode = 'CREATE' | 'UPDATE' | 'UPSERT';

/** Supported import file formats. */
export type ImportFileType = 'CSV' | 'XLSX';

/**
 * Where a source column is routed:
 * - email: the contact email (required, exactly one column)
 * - subscribed: the subscription boolean
 * - data: a custom field on Contact.data (uses `key` for the field name)
 * - ignore: skip this column entirely
 */
export type ColumnMappingField = 'email' | 'subscribed' | 'data' | 'ignore';

export interface ColumnMappingEntry {
  field: ColumnMappingField;
  /** Custom field name, only used when `field` is 'data'. Defaults to the column header. */
  key?: string;
}

/** Column header → mapping entry. */
export type ColumnMapping = Record<string, ColumnMappingEntry>;

/**
 * Preview returned by POST /contacts/import/analyze. Lets the UI render a
 * mapping table and warn about duplicates before the user confirms.
 */
export interface ImportPreview {
  importId: string;
  filename: string;
  fileType: ImportFileType;
  columns: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
  suggestedMapping: ColumnMapping;
  /** Rows whose email already exists as a contact in the project. */
  duplicateCount: number;
  /** Emails that appear more than once within the uploaded file itself. */
  inFileDuplicateCount: number;
}

/** A single row-level error collected during processing. */
export interface ImportRowError {
  row: number;
  email: string;
  error: string;
}

/** Outcome of an import job. */
export interface ImportResult {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failureCount: number;
  errors: ImportRowError[];
}

/**
 * Job data for processing a confirmed contact import.
 * The worker loads the stored file, mapping and mode from the ContactImport row.
 * Used by: importQueue worker
 */
export interface ContactImportJobData {
  projectId: string;
  importId: string;
}

/**
 * Job data for rolling back a completed import.
 * Used by: importUndoQueue worker
 */
export interface ContactImportUndoJobData {
  projectId: string;
  importId: string;
}

/**
 * Selector describing which contacts a bulk action should target.
 * - `ids`: explicit list, hard-capped at 1000.
 * - `query`: every contact matching the filter, optionally excluding specific ids.
 *   Snapshot semantics: the worker iterates current matches at execution time, so
 *   contacts created after the job is queued may or may not be included.
 */
export type BulkContactActionSelector =
  | {mode: 'ids'; contactIds: string[]}
  | {mode: 'query'; filter: {search?: string; subscribed?: boolean}; excludeIds?: string[]};

/** Operations supported by the bulk contact action queue. */
export type BulkContactOperation =
  | 'subscribe'
  | 'unsubscribe'
  | 'delete'
  | 'add-to-segment'
  | 'subscribe-topic'
  | 'unsubscribe-topic';

/**
 * Job data for bulk contact actions (subscribe, unsubscribe, delete,
 * add-to-segment, subscribe-topic, unsubscribe-topic).
 * Used by: bulkContactQueue worker
 */
export interface BulkContactActionJobData {
  projectId: string;
  operation: BulkContactOperation;
  selector: BulkContactActionSelector;
  /** Target static segment id, required when operation is 'add-to-segment'. */
  segmentId?: string;
  /** Target topic id, required when operation is 'subscribe-topic' or 'unsubscribe-topic'. */
  topicId?: string;
}
