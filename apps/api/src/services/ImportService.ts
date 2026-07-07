/**
 * ImportService
 *
 * Parses CSV/XLSX uploads and produces a preview (columns, sample rows,
 * suggested column mapping and duplicate counts) so the UI can let the user
 * review and correct the mapping before confirming an import.
 */

import type {ColumnMapping, ImportFileType, ImportPreview} from '@plunk/types';
import {toPrismaJson} from '@plunk/types';
import {parse as parseCsv} from 'csv-parse/sync';
import * as XLSX from 'xlsx';

import {prisma} from '../database/prisma.js';
import {HttpException} from '../exceptions/index.js';
import {ContactService} from './ContactService.js';

const SAMPLE_ROWS = 20;
const DUP_QUERY_BATCH = 500; // Emails per IN() query when detecting existing contacts

// Headers commonly used for the email / subscription columns (English + Spanish).
const EMAIL_HEADERS = ['email', 'e-mail', 'correo', 'correo electronico', 'correo electrónico', 'mail'];
const SUBSCRIBED_HEADERS = ['subscribed', 'subscription', 'suscrito', 'suscripcion', 'suscripción'];

export interface ParsedFile {
  columns: string[];
  rows: Record<string, string>[];
}

export class ImportService {
  /**
   * Infer the file type from the original filename. Returns null for unsupported
   * extensions.
   */
  public static detectFileType(filename: string): ImportFileType | null {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.csv')) return 'CSV';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'XLSX';
    return null;
  }

  /**
   * Parse a raw file buffer into ordered column headers and string rows.
   * Original header casing/whitespace is preserved so the mapping UI can show
   * exactly what the file contains.
   */
  public static parseFile(buffer: Buffer, fileType: ImportFileType): ParsedFile {
    if (fileType === 'CSV') {
      const text = buffer.toString('utf-8');
      const rows = parseCsv(text, {
        columns: true, // Use the first row as headers, keep original casing
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      }) as Record<string, string>[];
      const columns = rows.length > 0 && rows[0] ? Object.keys(rows[0]) : [];
      return {columns, rows};
    }

    // XLSX (also handles legacy .xls)
    const workbook = XLSX.read(buffer, {type: 'buffer'});
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return {columns: [], rows: []};
    }
    const sheet = workbook.Sheets[sheetName]!;

    // Header order comes from the first row; data rows come from sheet_to_json.
    const headerMatrix = XLSX.utils.sheet_to_json<string[]>(sheet, {header: 1, blankrows: false});
    const headerRow = (headerMatrix[0] ?? []).map(h => String(h ?? '').trim());
    const columns = headerRow.filter(h => h.length > 0);

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {defval: '', raw: false});
    const rows = rawRows.map(row => {
      const out: Record<string, string> = {};
      for (const col of columns) {
        const value = row[col];
        out[col] = value === undefined || value === null ? '' : String(value).trim();
      }
      return out;
    });

    return {columns, rows};
  }

  /**
   * Heuristic auto-mapping: match email/subscribed headers, route everything
   * else to a custom data field named after the column.
   */
  public static suggestMapping(columns: string[]): ColumnMapping {
    const mapping: ColumnMapping = {};
    let emailAssigned = false;

    for (const col of columns) {
      const norm = col.trim().toLowerCase();
      if (!emailAssigned && (EMAIL_HEADERS.includes(norm) || norm.includes('email') || norm.includes('correo'))) {
        mapping[col] = {field: 'email'};
        emailAssigned = true;
      } else if (SUBSCRIBED_HEADERS.includes(norm)) {
        mapping[col] = {field: 'subscribed'};
      } else {
        mapping[col] = {field: 'data', key: col};
      }
    }

    return mapping;
  }

  /**
   * Parse an uploaded file, persist a PREVIEW ContactImport row (storing the raw
   * file for the later confirm step) and return a preview for the UI.
   */
  public static async analyze(
    projectId: string,
    buffer: Buffer,
    filename: string,
    fileType: ImportFileType,
  ): Promise<ImportPreview> {
    const {columns, rows} = ImportService.parseFile(buffer, fileType);

    if (columns.length === 0) {
      throw new HttpException(400, 'The file has no columns');
    }
    if (rows.length === 0) {
      throw new HttpException(400, 'The file has no data rows');
    }

    const suggestedMapping = ImportService.suggestMapping(columns);
    const emailColumn = Object.entries(suggestedMapping).find(([, entry]) => entry.field === 'email')?.[0];

    const {duplicateCount, inFileDuplicateCount} = await ImportService.countDuplicates(projectId, rows, emailColumn);

    const record = await prisma.contactImport.create({
      data: {
        projectId,
        filename,
        fileType,
        rawData: buffer.toString('base64'),
        status: 'PREVIEW',
        totalRows: rows.length,
        mapping: toPrismaJson(suggestedMapping),
      },
    });

    return {
      importId: record.id,
      filename,
      fileType,
      columns,
      sampleRows: rows.slice(0, SAMPLE_ROWS),
      totalRows: rows.length,
      suggestedMapping,
      duplicateCount,
      inFileDuplicateCount,
    };
  }

  /**
   * Count how many rows collide with existing contacts (by email) and how many
   * emails are duplicated within the file itself.
   */
  public static async countDuplicates(
    projectId: string,
    rows: Record<string, string>[],
    emailColumn: string | undefined,
  ): Promise<{duplicateCount: number; inFileDuplicateCount: number}> {
    if (!emailColumn) {
      return {duplicateCount: 0, inFileDuplicateCount: 0};
    }

    const emails = rows
      .map(row => ContactService.normalizeEmail(String(row[emailColumn] ?? '')))
      .filter(email => email.length > 0);

    // Distinct emails and count of rows that repeat an earlier email in the file.
    const seen = new Set<string>();
    let inFileDuplicateCount = 0;
    for (const email of emails) {
      if (seen.has(email)) {
        inFileDuplicateCount++;
      } else {
        seen.add(email);
      }
    }

    const unique = [...seen];
    const existing = new Set<string>();
    for (let i = 0; i < unique.length; i += DUP_QUERY_BATCH) {
      const batch = unique.slice(i, i + DUP_QUERY_BATCH);
      const found = await prisma.contact.findMany({
        where: {projectId, email: {in: batch}},
        select: {email: true},
      });
      found.forEach(contact => existing.add(contact.email));
    }

    return {duplicateCount: existing.size, inFileDuplicateCount};
  }
}
