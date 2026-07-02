/**
 * Background Job: Contact Import Undo Processor
 *
 * Rolls back a completed import using the per-row snapshots recorded during the
 * import: CREATED contacts are deleted, UPDATED contacts are restored to their
 * previous data/subscription state.
 */

import {Prisma} from '@plunk/db';
import type {ContactImportUndoJobData} from '@plunk/types';
import {type Job, Worker} from 'bullmq';
import signale from 'signale';

import {prisma} from '../database/prisma.js';
import {importUndoQueue} from '../services/QueueService.js';

const PAGE_SIZE = 500;

export function createImportUndoWorker() {
  const worker = new Worker<ContactImportUndoJobData>(
    importUndoQueue.name,
    async (job: Job<ContactImportUndoJobData>) => {
      const {projectId, importId} = job.data;

      const record = await prisma.contactImport.findFirst({where: {id: importId, projectId}});
      if (!record) {
        throw new Error(`Import ${importId} not found for project ${projectId}`);
      }
      if (record.status !== 'COMPLETED') {
        throw new Error(`Import ${importId} cannot be undone (status ${record.status})`);
      }
      if (!record.undoable) {
        throw new Error(`Import ${importId} is not undoable`);
      }

      await prisma.contactImport.update({where: {id: importId}, data: {status: 'UNDOING'}});

      signale.info(`[IMPORT-UNDO] Rolling back import ${importId}`);

      let deleted = 0;
      let restored = 0;
      let processed = 0;
      const total = await prisma.contactImportChange.count({where: {importId}});

      // Page through the change log by id (stable keyset pagination).
      let cursor: string | undefined;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const changes = await prisma.contactImportChange.findMany({
          where: {importId},
          orderBy: {id: 'asc'},
          take: PAGE_SIZE,
          ...(cursor ? {skip: 1, cursor: {id: cursor}} : {}),
        });
        if (changes.length === 0) break;
        cursor = changes[changes.length - 1]!.id;

        // Delete all CREATED contacts in this page in one query.
        const createdIds = changes.filter(c => c.action === 'CREATED').map(c => c.contactId);
        if (createdIds.length > 0) {
          const res = await prisma.contact.deleteMany({where: {projectId, id: {in: createdIds}}});
          deleted += res.count;
        }

        // Restore each UPDATED contact to its pre-import snapshot.
        for (const change of changes) {
          if (change.action !== 'UPDATED') continue;
          try {
            await prisma.contact.update({
              where: {id: change.contactId},
              data: {
                data: change.previousData === null ? Prisma.JsonNull : (change.previousData as Prisma.InputJsonValue),
                ...(change.previousSubscribed !== null ? {subscribed: change.previousSubscribed} : {}),
              },
            });
            restored++;
          } catch {
            // Contact may have been deleted after the import; nothing to restore.
          }
        }

        processed += changes.length;
        await job.updateProgress(total > 0 ? Math.round((processed / total) * 100) : 100);
      }

      await prisma.contactImport.update({
        where: {id: importId},
        data: {status: 'UNDONE', undoneAt: new Date()},
      });
      // Snapshots are consumed by the rollback; drop them to reclaim space.
      await prisma.contactImportChange.deleteMany({where: {importId}});

      signale.info(`[IMPORT-UNDO] Import ${importId} undone: ${deleted} deleted, ${restored} restored`);
      return {deleted, restored};
    },
    {
      connection: importUndoQueue.opts.connection,
      concurrency: 2,
    },
  );

  worker.on('completed', job => signale.info(`[IMPORT-UNDO] Job ${job.id} completed`));
  worker.on('failed', (job, err) => signale.error(`[IMPORT-UNDO] Job ${job?.id} failed:`, err.message));
  worker.on('error', err => signale.error('[IMPORT-UNDO] Worker error:', err));

  return worker;
}
