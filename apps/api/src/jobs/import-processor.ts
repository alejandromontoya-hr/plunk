/**
 * Background Job: Contact Import Processor
 *
 * Processes a confirmed CSV/XLSX import. Loads the stored file, applies the
 * user-chosen column mapping and mode (create / update / both), records a
 * per-row change snapshot for undo, and writes the result back to the
 * ContactImport row.
 */

import type {ColumnMapping, ContactImportJobData, ImportMode, ImportResult, ImportRowError} from '@plunk/types';
import {type Job, Worker} from 'bullmq';
import signale from 'signale';

import {prisma} from '../database/prisma.js';
import {ContactService} from '../services/ContactService.js';
import {ImportService} from '../services/ImportService.js';
import {NtfyService} from '../services/NtfyService.js';
import {importQueue} from '../services/QueueService.js';

const BATCH_SIZE = 100; // Rows processed before reporting progress
const CHANGE_FLUSH_SIZE = 1000; // Change snapshots buffered before a createMany
// Imports larger than this are not undoable (snapshotting every row would be
// too expensive). The UI warns the user when an import is not undoable.
const UNDO_MAX_ROWS = 100_000;

interface PendingChange {
  importId: string;
  contactId: string;
  email: string;
  action: 'CREATED' | 'UPDATED';
  previousData: unknown;
  previousSubscribed: boolean | null;
}

export function createImportWorker() {
  const worker = new Worker<ContactImportJobData>(
    importQueue.name,
    async (job: Job<ContactImportJobData>) => {
      const {projectId, importId} = job.data;

      const record = await prisma.contactImport.findFirst({
        where: {id: importId, projectId},
      });

      if (!record) {
        throw new Error(`Import ${importId} not found for project ${projectId}`);
      }
      if (!record.rawData) {
        throw new Error(`Import ${importId} has no stored file to process`);
      }

      const project = await prisma.project.findUnique({where: {id: projectId}, select: {name: true}});
      const projectName = project?.name || projectId;

      const mode = record.mode as ImportMode;
      const mapping = (record.mapping ?? {}) as unknown as ColumnMapping;
      // Fixed custom fields applied to every row (the "valor fijo" step). Sanitized:
      // keep only well-formed {key, value} pairs with a non-empty key.
      const constants = (Array.isArray(record.constants) ? record.constants : [])
        .filter((c): c is {key: string; value: string} => Boolean(c) && typeof c === 'object' && typeof (c as {key?: unknown}).key === 'string')
        .map(c => ({key: c.key.trim(), value: typeof c.value === 'string' ? c.value : String(c.value ?? '')}))
        .filter(c => c.key.length > 0);
      const undoable = record.totalRows <= UNDO_MAX_ROWS;

      await prisma.contactImport.update({
        where: {id: importId},
        data: {status: 'PROCESSING', undoable},
      });

      const result: ImportResult = {
        totalRows: 0,
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failureCount: 0,
        errors: [],
      };
      const MAX_ERRORS = 200; // Cap stored errors to keep the row small

      // Resolve the mapping into concrete column roles.
      const emailColumn = Object.entries(mapping).find(([, entry]) => entry.field === 'email')?.[0];
      const subscribedColumn = Object.entries(mapping).find(([, entry]) => entry.field === 'subscribed')?.[0];
      const dataColumns = Object.entries(mapping)
        .filter(([, entry]) => entry.field === 'data')
        .map(([column, entry]) => ({column, key: entry.key?.trim() || column}));

      try {
        if (!emailColumn) {
          throw new Error('No column is mapped to the email field');
        }

        const buffer = Buffer.from(record.rawData, 'base64');
        const {rows} = ImportService.parseFile(buffer, record.fileType);
        result.totalRows = rows.length;

        if (rows.length === 0) {
          throw new Error('The file has no data rows');
        }

        signale.info(`[IMPORT-PROCESSOR] Processing import ${importId} (${rows.length} rows, mode=${mode})`);
        await NtfyService.notifyContactImportStarted(projectName, projectId, record.filename, result.totalRows);

        const pendingChanges: PendingChange[] = [];
        // Ensures a single change snapshot per contact even if the same email
        // appears multiple times within the file (keeps undo correct).
        const snapshotted = new Set<string>();

        const flushChanges = async () => {
          if (pendingChanges.length === 0) return;
          await prisma.contactImportChange.createMany({
            data: pendingChanges.map(change => ({
              importId: change.importId,
              contactId: change.contactId,
              email: change.email,
              action: change.action,
              previousData: change.previousData === undefined ? undefined : (change.previousData as never),
              previousSubscribed: change.previousSubscribed,
            })),
          });
          pendingChanges.length = 0;
        };

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));

          for (const [batchIndex, row] of batch.entries()) {
            const rowNumber = i + batchIndex + 2; // +2: header row + 1-based index
            const rawEmail = String(row[emailColumn] ?? '').trim();

            try {
              if (!rawEmail) {
                pushError(result, MAX_ERRORS, {row: rowNumber, email: '', error: 'Email is required'});
                result.failureCount++;
                continue;
              }
              if (!isValidEmail(rawEmail)) {
                pushError(result, MAX_ERRORS, {row: rowNumber, email: rawEmail, error: 'Invalid email format'});
                result.failureCount++;
                continue;
              }

              // Build custom data object from mapped data columns.
              const data: Record<string, unknown> = {};
              for (const {column, key} of dataColumns) {
                const value = row[column];
                if (value !== undefined && value !== '') {
                  data[key] = coerceCustomValue(value);
                }
              }
              // Apply fixed custom fields to every row (overwrites any mapped column
              // with the same key, matching "valor fijo para todo el archivo").
              for (const {key, value} of constants) {
                data[key] = coerceCustomValue(value);
              }

              // Subscription (optional column).
              let subscribed: boolean | undefined;
              if (subscribedColumn) {
                const raw = String(row[subscribedColumn] ?? '').trim().toLowerCase();
                if (raw !== '') {
                  subscribed = raw === 'true' || raw === '1' || raw === 'yes' || raw === 'si' || raw === 'sí';
                }
              }

              const existing = await ContactService.findByEmail(projectId, rawEmail);

              // Apply the selected mode.
              if (existing && mode === 'CREATE') {
                result.skippedCount++;
                continue;
              }
              if (!existing && mode === 'UPDATE') {
                result.skippedCount++;
                continue;
              }

              if (existing) {
                // UPDATE path (UPDATE or UPSERT with an existing contact).
                if (undoable && !snapshotted.has(existing.id)) {
                  snapshotted.add(existing.id);
                  pendingChanges.push({
                    importId,
                    contactId: existing.id,
                    email: existing.email,
                    action: 'UPDATED',
                    previousData: existing.data ?? undefined,
                    previousSubscribed: existing.subscribed,
                  });
                }
                await ContactService.update(projectId, existing.id, {
                  data: Object.keys(data).length > 0 ? (data as never) : undefined,
                  subscribed,
                });
                result.updatedCount++;
              } else {
                // CREATE path (CREATE or UPSERT with a new contact).
                const created = await ContactService.create(projectId, {
                  email: rawEmail,
                  data: Object.keys(data).length > 0 ? (data as never) : undefined,
                  subscribed,
                });
                if (undoable && !snapshotted.has(created.id)) {
                  snapshotted.add(created.id);
                  pendingChanges.push({
                    importId,
                    contactId: created.id,
                    email: created.email,
                    action: 'CREATED',
                    previousData: undefined,
                    previousSubscribed: null,
                  });
                }
                result.createdCount++;
              }

              if (pendingChanges.length >= CHANGE_FLUSH_SIZE) {
                await flushChanges();
              }
            } catch (error) {
              result.failureCount++;
              pushError(result, MAX_ERRORS, {
                row: rowNumber,
                email: rawEmail,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }

          await job.updateProgress(Math.round(((i + batch.length) / rows.length) * 100));
        }

        await flushChanges();

        await prisma.contactImport.update({
          where: {id: importId},
          data: {
            status: 'COMPLETED',
            createdCount: result.createdCount,
            updatedCount: result.updatedCount,
            skippedCount: result.skippedCount,
            failureCount: result.failureCount,
            errors: result.errors as never,
            undoable,
            completedAt: new Date(),
            rawData: null, // Free the stored file once processed
          },
        });

        signale.info(
          `[IMPORT-PROCESSOR] Import ${importId} completed: ${result.createdCount} created, ${result.updatedCount} updated, ${result.skippedCount} skipped, ${result.failureCount} failed`,
        );
        await NtfyService.notifyContactImportCompleted(
          projectName,
          projectId,
          record.filename,
          result.createdCount + result.updatedCount,
          result.createdCount,
          result.updatedCount,
          result.failureCount,
        );

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        signale.error(`[IMPORT-PROCESSOR] Import ${importId} failed:`, error);

        await prisma.contactImport
          .update({
            where: {id: importId},
            data: {status: 'FAILED', errors: [{row: 0, email: '', error: errorMessage}] as never, rawData: null},
          })
          .catch(() => undefined);

        await NtfyService.notifyContactImportFailed(projectName, projectId, record.filename, errorMessage);
        throw error;
      }
    },
    {
      connection: importQueue.opts.connection,
      concurrency: 2,
    },
  );

  worker.on('completed', job => signale.info(`[IMPORT-PROCESSOR] Job ${job.id} completed`));
  worker.on('failed', (job, err) => signale.error(`[IMPORT-PROCESSOR] Job ${job?.id} failed:`, err.message));
  worker.on('error', err => signale.error('[IMPORT-PROCESSOR] Worker error:', err));

  return worker;
}

function pushError(result: ImportResult, max: number, error: ImportRowError): void {
  if (result.errors.length < max) {
    result.errors.push(error);
  }
}

/**
 * Basic email validation
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Values considered as boolean during import.
const BOOLEAN_TRUE = new Set(['true', 'yes']);
const BOOLEAN_FALSE = new Set(['false', 'no']);

// Strict integer-or-decimal number detection pattern.
const NUMERIC_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Coerces a raw string into its most natural primitive type: `boolean`,
 * `number`, or `string`. Values that match neither are returned unchanged.
 */
export function coerceCustomValue(value: string): string | boolean | number {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (BOOLEAN_TRUE.has(lower)) return true;
  if (BOOLEAN_FALSE.has(lower)) return false;
  if (NUMERIC_RE.test(trimmed)) return Number(trimmed);
  return value;
}
