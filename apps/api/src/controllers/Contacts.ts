import {Controller, Delete, Get, Middleware, Patch, Post} from '@overnightjs/core';
import type {NextFunction, Request, Response} from 'express';
import multer from 'multer';
import {ContactSchemas, ImportSchemas} from '@plunk/shared';
import type {BulkContactActionSelector} from '@plunk/types';
import signale from 'signale';
import {prisma} from '../database/prisma.js';
import {requireAuth, requireEmailVerified} from '../middleware/auth.js';
import {ContactService} from '../services/ContactService.js';
import {ImportService} from '../services/ImportService.js';
import {QueueService} from '../services/QueueService.js';
import {CatchAsync} from '../utils/asyncHandler.js';

// Fields returned for import history rows (excludes the large rawData blob).
const IMPORT_SUMMARY_SELECT = {
  id: true,
  filename: true,
  fileType: true,
  mode: true,
  status: true,
  totalRows: true,
  createdCount: true,
  updatedCount: true,
  skippedCount: true,
  failureCount: true,
  undoable: true,
  createdAt: true,
  completedAt: true,
  undoneAt: true,
} as const;

// Configure multer for file uploads (memory storage). Accepts CSV and XLSX.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const allowed =
      name.endsWith('.csv') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (allowed) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV or XLSX files are allowed'));
    }
  },
});

@Controller('contacts')
export class Contacts {
  /**
   * GET /contacts
   * List all contacts for the authenticated project with cursor-based pagination
   */
  @Get('')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async list(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const cursor = req.query.cursor as string | undefined;
    const search = req.query.search as string | undefined;

    // Optional status facet (?subscribed=true|false) and column sort
    // (?sort=email|createdAt&dir=asc|desc). Anything else falls back to the
    // default newest-first ordering with no status filter.
    const subscribedParam = req.query.subscribed as string | undefined;
    const subscribed = subscribedParam === 'true' ? true : subscribedParam === 'false' ? false : undefined;
    const sortParam = req.query.sort as string | undefined;
    const sort = sortParam === 'email' || sortParam === 'createdAt' ? sortParam : undefined;
    const dirParam = req.query.dir as string | undefined;
    const dir = dirParam === 'asc' ? 'asc' : dirParam === 'desc' ? 'desc' : undefined;

    const result = await ContactService.list(auth.projectId!, limit, cursor, search, {subscribed, sort, dir});

    return res.status(200).json(result);
  }

  /**
   * GET /contacts/fields
   * Get all available contact fields (both standard and custom fields from data JSON)
   * Returns field names with inferred types (string, number, boolean, date)
   */
  @Get('fields')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async getAvailableFields(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;

    try {
      const fieldsWithTypes = await ContactService.getAvailableFields(auth.projectId!);

      return res.status(200).json({
        fields: fieldsWithTypes,
        count: fieldsWithTypes.length,
      });
    } catch (error) {
      signale.error('[CONTACTS] Failed to get available fields:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get available fields',
      });
    }
  }

  /**
   * GET /contacts/fields/:field/values
   * Get unique values for a contact field (for workflow conditions, segment filters, etc.)
   * Example: /contacts/fields/data.plan/values or /contacts/fields/subscribed/values
   */
  @Get('fields/:field/values')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async getFieldValues(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const field = req.params.field;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);

    if (!field) {
      return res.status(400).json({error: 'Field is required'});
    }

    try {
      const values = await ContactService.getUniqueFieldValues(auth.projectId!, field, limit);

      return res.status(200).json({
        field,
        values,
        count: values.length,
        limit,
      });
    } catch (error) {
      signale.error('[CONTACTS] Failed to get field values:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get field values',
      });
    }
  }

  /**
   * GET /contacts/imports
   * List recent imports for the project (history).
   * Declared before GET /contacts/:id so the literal "imports" path is not
   * captured by the :id route.
   */
  @Get('imports')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async listImports(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;

    const imports = await prisma.contactImport.findMany({
      where: {projectId: auth.projectId!, status: {not: 'PREVIEW'}},
      orderBy: {createdAt: 'desc'},
      take: 50,
      select: IMPORT_SUMMARY_SELECT,
    });

    return res.status(200).json(imports);
  }

  /**
   * GET /contacts/:id
   * Get a specific contact by ID
   */
  @Get(':id')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async get(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const contactId = req.params.id;

    if (!contactId) {
      return res.status(400).json({error: 'Contact ID is required'});
    }

    const contact = await ContactService.get(auth.projectId!, contactId);

    return res.status(200).json(contact);
  }

  /**
   * POST /contacts
   * Create or update a contact (upsert)
   */
  @Post('')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async create(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const {email, data, subscribed} = req.body;

    if (!email) {
      return res.status(400).json({error: 'Email is required'});
    }

    // Check if contact exists before upserting
    const existingContact = await ContactService.findByEmail(auth.projectId!, email);
    const isUpdate = !!existingContact;

    const contact = await ContactService.upsert(auth.projectId!, email, data, subscribed);

    return res.status(isUpdate ? 200 : 201).json({
      ...contact,
      _meta: {
        isNew: !isUpdate,
        isUpdate,
      },
    });
  }

  /**
   * PATCH /contacts/:id
   * Update a contact
   */
  @Patch(':id')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async update(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const contactId = req.params.id;
    const {email, data, subscribed} = req.body;

    if (!contactId) {
      return res.status(400).json({error: 'Contact ID is required'});
    }

    const contact = await ContactService.update(auth.projectId!, contactId, {email, data, subscribed});

    return res.status(200).json(contact);
  }

  /**
   * DELETE /contacts/:id
   * Delete a contact
   */
  @Delete(':id')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async delete(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const contactId = req.params.id;

    if (!contactId) {
      return res.status(400).json({error: 'Contact ID is required'});
    }

    await ContactService.delete(auth.projectId!, contactId);

    return res.status(204).send();
  }

  /**
   * GET /contacts/public/:id
   * PUBLIC: Get contact information (no auth required)
   */
  @Get('public/:id')
  @CatchAsync
  public async getPublic(req: Request, res: Response, _next: NextFunction) {
    const contactId = req.params.id;

    if (!contactId) {
      return res.status(400).json({error: 'Contact ID is required'});
    }

    const contact = await ContactService.getById(contactId);

    // Fetch project to get language preference
    const project = await ContactService.getProjectByContactId(contactId);

    // Get contact-level locale (overrides project language)
    const contactLocale =
      contact.data &&
      typeof contact.data === 'object' &&
      !Array.isArray(contact.data) &&
      'locale' in contact.data &&
      typeof contact.data.locale === 'string'
        ? contact.data.locale
        : null;

    return res.status(200).json({
      id: contact.id,
      email: contact.email,
      subscribed: contact.subscribed,
      language: contactLocale || project?.language || 'en',
    });
  }

  /**
   * POST /contacts/public/:id/subscribe
   * PUBLIC: Subscribe a contact (no auth required)
   */
  @Post('public/:id/subscribe')
  @CatchAsync
  public async subscribePublic(req: Request, res: Response, _next: NextFunction) {
    const contactId = req.params.id;

    if (!contactId) {
      return res.status(400).json({error: 'Contact ID is required'});
    }

    const contact = await ContactService.subscribe(contactId);

    return res.status(200).json({
      id: contact.id,
      email: contact.email,
      subscribed: contact.subscribed,
    });
  }

  /**
   * POST /contacts/public/:id/unsubscribe
   * PUBLIC: Unsubscribe a contact (no auth required)
   */
  @Post('public/:id/unsubscribe')
  @CatchAsync
  public async unsubscribePublic(req: Request, res: Response, _next: NextFunction) {
    const contactId = req.params.id;

    if (!contactId) {
      return res.status(400).json({error: 'Contact ID is required'});
    }

    const contact = await ContactService.unsubscribe(contactId);

    return res.status(200).json({
      id: contact.id,
      email: contact.email,
      subscribed: contact.subscribed,
    });
  }

  /**
   * POST /contacts/lookup
   * Bulk-check which emails already exist in the project (max 500)
   */
  @Post('lookup')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async lookup(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const {emails} = req.body as {emails: string[]};

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({error: 'emails must be a non-empty array'});
    }

    if (emails.length > 500) {
      return res.status(400).json({error: 'Maximum 500 emails per lookup'});
    }

    const result = await ContactService.lookup(auth.projectId!, emails);

    return res.status(200).json(result);
  }

  /**
   * POST /contacts/import/analyze
   * Parse an uploaded CSV/XLSX file and return a preview (columns, sample rows,
   * suggested column mapping and duplicate counts) for the mapping wizard.
   */
  @Post('import/analyze')
  @Middleware([requireAuth, requireEmailVerified, upload.single('file')])
  @CatchAsync
  public async analyzeImport(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;

    if (!req.file) {
      return res.status(400).json({error: 'A CSV or XLSX file is required'});
    }

    const fileType = ImportService.detectFileType(req.file.originalname);
    if (!fileType) {
      return res.status(400).json({error: 'Unsupported file type. Upload a .csv or .xlsx file.'});
    }

    const preview = await ImportService.analyze(auth.projectId!, req.file.buffer, req.file.originalname, fileType);
    return res.status(200).json(preview);
  }

  /**
   * POST /contacts/import/:id/confirm
   * Confirm a previewed import with the chosen column mapping and mode, then
   * queue the import job.
   */
  @Post('import/:id/confirm')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async confirmImport(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const importId = req.params.id;
    if (!importId) {
      return res.status(400).json({error: 'Import ID is required'});
    }

    const parsed = ImportSchemas.confirm.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({error: parsed.error.errors[0]?.message ?? 'Invalid import configuration'});
    }

    const record = await prisma.contactImport.findFirst({
      where: {id: importId, projectId: auth.projectId!},
    });
    if (!record) {
      return res.status(404).json({error: 'Import not found'});
    }
    if (record.status !== 'PREVIEW') {
      return res.status(409).json({error: 'This import has already been processed'});
    }

    await prisma.contactImport.update({
      where: {id: importId},
      data: {mode: parsed.data.mode, mapping: parsed.data.mapping},
    });

    const job = await QueueService.queueImport(auth.projectId!, importId);
    return res.status(202).json({importId, jobId: job.id});
  }

  /**
   * POST /contacts/import/:id/undo
   * Roll back a completed import.
   */
  @Post('import/:id/undo')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async undoImport(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const importId = req.params.id;
    if (!importId) {
      return res.status(400).json({error: 'Import ID is required'});
    }

    const record = await prisma.contactImport.findFirst({
      where: {id: importId, projectId: auth.projectId!},
    });
    if (!record) {
      return res.status(404).json({error: 'Import not found'});
    }
    if (record.status !== 'COMPLETED') {
      return res.status(409).json({error: 'Only completed imports can be undone'});
    }
    if (!record.undoable) {
      return res.status(409).json({error: 'This import is too large to undo'});
    }

    const job = await QueueService.queueImportUndo(auth.projectId!, importId);
    return res.status(202).json({importId, jobId: job.id});
  }

  /**
   * GET /contacts/import/:id
   * Get an import's status: the persisted record plus live job progress.
   */
  @Get('import/:id')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async getImportStatus(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const importId = req.params.id;
    if (!importId) {
      return res.status(400).json({error: 'Import ID is required'});
    }

    const record = await prisma.contactImport.findFirst({
      where: {id: importId, projectId: auth.projectId!},
      select: {...IMPORT_SUMMARY_SELECT, errors: true},
    });
    if (!record) {
      return res.status(404).json({error: 'Import not found'});
    }

    const job = await QueueService.getImportJobStatus(importId, auth.projectId!);
    return res.status(200).json({import: record, job});
  }

  /**
   * GET /contacts/fields/:field/usage
   * Check if a field is used in segments/campaigns and get usage statistics
   * Returns information about where the field is used and whether it can be safely deleted
   */
  @Get('fields/:field/usage')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async getFieldUsage(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const field = req.params.field;

    if (!field) {
      return res.status(400).json({error: 'Field is required'});
    }

    try {
      const usage = await ContactService.getFieldUsage(auth.projectId!, field);
      return res.status(200).json(usage);
    } catch (error) {
      signale.error('[CONTACTS] Failed to get field usage:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get field usage',
      });
    }
  }

  /**
   * DELETE /contacts/fields/:field
   * Delete a custom field from all contacts
   * Only works if the field is not used in any segments or campaigns
   */
  @Delete('fields/:field')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async deleteField(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const field = req.params.field;

    if (!field) {
      return res.status(400).json({error: 'Field is required'});
    }

    try {
      const result = await ContactService.deleteField(auth.projectId!, field);
      return res.status(200).json(result);
    } catch (error) {
      signale.error('[CONTACTS] Failed to delete field:', error);
      return res.status(error instanceof Error && error.message.includes('Cannot delete') ? 400 : 500).json({
        error: error instanceof Error ? error.message : 'Failed to delete field',
      });
    }
  }

  /**
   * POST /contacts/bulk-subscribe
   * Queue bulk subscribe operation
   */
  @Post('bulk-subscribe')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async bulkSubscribe(req: Request, res: Response, _next: NextFunction) {
    return queueBulkAction(req, res, 'subscribe');
  }

  /**
   * POST /contacts/bulk-unsubscribe
   * Queue bulk unsubscribe operation
   */
  @Post('bulk-unsubscribe')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async bulkUnsubscribe(req: Request, res: Response, _next: NextFunction) {
    return queueBulkAction(req, res, 'unsubscribe');
  }

  /**
   * POST /contacts/bulk-delete
   * Queue bulk delete operation
   */
  @Post('bulk-delete')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async bulkDelete(req: Request, res: Response, _next: NextFunction) {
    return queueBulkAction(req, res, 'delete');
  }

  /**
   * POST /contacts/bulk-add-to-segment
   * Queue adding the selected contacts to a static segment.
   * Body: { segmentId, ...bulkAction selector (ids | query) }
   */
  @Post('bulk-add-to-segment')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async bulkAddToSegment(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;

    const segmentId = (req.body ?? {}).segmentId;
    if (!segmentId || typeof segmentId !== 'string') {
      return res.status(400).json({error: 'segmentId is required'});
    }

    const parsed = ContactSchemas.bulkAction.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({error: parsed.error.errors[0]?.message ?? 'Invalid bulk action payload'});
    }

    const segment = await prisma.segment.findFirst({
      where: {id: segmentId, projectId: auth.projectId!},
      select: {id: true, type: true},
    });
    if (!segment) {
      return res.status(404).json({error: 'Segment not found'});
    }
    if (segment.type !== 'STATIC') {
      return res.status(400).json({error: 'Contacts can only be added to static segments'});
    }

    const selector: BulkContactActionSelector =
      parsed.data.mode === 'ids'
        ? {mode: 'ids', contactIds: parsed.data.contactIds}
        : {mode: 'query', filter: parsed.data.filter, excludeIds: parsed.data.excludeIds};

    const job = await QueueService.queueBulkContactAction(auth.projectId!, selector, 'add-to-segment', segmentId);
    return res.status(202).json({message: 'Bulk add to segment queued successfully', jobId: job.id});
  }

  /**
   * GET /contacts/bulk/:jobId
   * Get bulk action job status
   */
  @Get('bulk/:jobId')
  @Middleware([requireAuth, requireEmailVerified])
  @CatchAsync
  public async getBulkActionStatus(req: Request, res: Response, _next: NextFunction) {
    const auth = res.locals.auth;
    const jobId = req.params.jobId;

    if (!jobId) {
      return res.status(400).json({error: 'Job ID is required'});
    }

    try {
      const status = await QueueService.getBulkActionJobStatus(jobId, auth.projectId!);

      if (!status) {
        return res.status(404).json({error: 'Bulk action job not found'});
      }

      return res.status(200).json(status);
    } catch (error) {
      signale.error('[CONTACTS] Failed to get bulk action status:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get bulk action status',
      });
    }
  }
}

async function queueBulkAction(
  req: Request,
  res: Response,
  operation: 'subscribe' | 'unsubscribe' | 'delete',
) {
  const auth = res.locals.auth;

  const parsed = ContactSchemas.bulkAction.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.errors[0]?.message ?? 'Invalid bulk action payload',
    });
  }

  const selector: BulkContactActionSelector =
    parsed.data.mode === 'ids'
      ? {mode: 'ids', contactIds: parsed.data.contactIds}
      : {mode: 'query', filter: parsed.data.filter, excludeIds: parsed.data.excludeIds};

  try {
    const job = await QueueService.queueBulkContactAction(auth.projectId!, selector, operation);
    return res.status(202).json({
      message: `Bulk ${operation} queued successfully`,
      jobId: job.id,
    });
  } catch (error) {
    signale.error(`[CONTACTS] Failed to queue bulk ${operation}:`, error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : `Failed to queue bulk ${operation}`,
    });
  }
}
