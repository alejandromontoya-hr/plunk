import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Progress,
  RadioGroup,
  RadioGroupItem,
} from '@plunk/ui';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  FileUp,
  History,
  Loader2,
  Undo2,
  XCircle,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {useTranslation} from '../lib/i18n';
import {network} from '../lib/network';

type MappingField = 'email' | 'subscribed' | 'data' | 'ignore';
type ImportMode = 'CREATE' | 'UPDATE' | 'UPSERT';
type ImportStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'UNDOING' | 'UNDONE';

interface ColumnMapping {
  field: MappingField;
  key?: string;
}

interface ImportPreview {
  importId: string;
  filename: string;
  fileType: 'CSV' | 'XLSX';
  columns: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
  suggestedMapping: Record<string, ColumnMapping>;
  duplicateCount: number;
  inFileDuplicateCount: number;
}

interface ImportError {
  row: number;
  email: string;
  error: string;
}

interface ImportRecord {
  id: string;
  filename: string;
  fileType: 'CSV' | 'XLSX';
  mode: ImportMode;
  status: ImportStatus;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failureCount: number;
  undoable: boolean;
  createdAt: string;
  completedAt: string | null;
  undoneAt: string | null;
  errors?: ImportError[];
}

interface JobStatus {
  state: string;
  progress: number;
  result: {
    totalRows: number;
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    failureCount: number;
    errors: ImportError[];
  } | null;
  failedReason?: string;
}

interface ImportStatusResponse {
  import: ImportRecord;
  job: JobStatus | null;
}

interface ImportConfirmResponse {
  importId: string;
  jobId: string;
}

type WizardStep = 'upload' | 'map' | 'mode' | 'progress' | 'result' | 'history';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAPPING_FIELDS: MappingField[] = ['email', 'subscribed', 'data', 'ignore'];

interface ImportContactsWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ImportContactsWizard({open, onOpenChange, onSuccess}: ImportContactsWizardProps) {
  const {t} = useTranslation();

  const [step, setStep] = useState<WizardStep>('upload');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, ColumnMapping>>({});
  const [mode, setMode] = useState<ImportMode>('UPSERT');
  const [isConfirming, setIsConfirming] = useState(false);

  const [importId, setImportId] = useState<string | null>(null);
  const [record, setRecord] = useState<ImportRecord | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Clean up polling on unmount or dialog close, and reset state when closed.
  useEffect(() => {
    if (!open) {
      clearPolling();
      const timeout = setTimeout(() => {
        setStep('upload');
        setIsAnalyzing(false);
        setPreview(null);
        setMapping({});
        setMode('UPSERT');
        setIsConfirming(false);
        setImportId(null);
        setRecord(null);
        setJob(null);
        setErrorMessage(null);
        setIsUndoing(false);
        setHistory([]);
        setIsLoadingHistory(false);
      }, 300);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [open, clearPolling]);

  useEffect(() => clearPolling, [clearPolling]);

  const emailColumnCount = Object.values(mapping).filter((m) => m.field === 'email').length;

  const analyzeFile = async (file: File) => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await network.upload<ImportPreview>('POST', '/contacts/import/analyze', formData);
      setPreview(data);
      setMapping({...data.suggestedMapping});
      setStep('map');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('contacts.import.upload.analyzeError');
      toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileSelected = (file: File | undefined) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
      toast.error(t('contacts.import.upload.invalidType'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t('contacts.import.upload.tooLarge'));
      return;
    }
    void analyzeFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleFileSelected(e.dataTransfer.files?.[0]);
  };

  const setColumnField = (column: string, field: MappingField) => {
    setMapping((prev) => ({
      ...prev,
      [column]: field === 'data' ? {field, key: prev[column]?.key ?? column} : {field},
    }));
  };

  const setColumnKey = (column: string, key: string) => {
    setMapping((prev) => ({...prev, [column]: {field: 'data', key}}));
  };

  const pollStatus = useCallback(
    async (id: string) => {
      try {
        const response = await network.fetch<ImportStatusResponse>('GET', `/contacts/import/${id}`);
        setRecord(response.import);
        setJob(response.job);

        const status = response.import.status;
        if (status === 'COMPLETED') {
          clearPolling();
          setStep('result');
          onSuccess();
        } else if (status === 'FAILED') {
          clearPolling();
          setErrorMessage(response.job?.failedReason ?? t('contacts.import.progress.failedError'));
          setStep('result');
        } else if (status === 'UNDONE') {
          clearPolling();
          setIsUndoing(false);
          // Refresh the contacts list/count now that the import was rolled back.
          onSuccess();
        }
      } catch (error) {
        clearPolling();
        const message = error instanceof Error ? error.message : t('contacts.import.progress.failedError');
        setErrorMessage(message);
        toast.error(message);
      }
    },
    [clearPolling, onSuccess, t],
  );

  const startPolling = useCallback(
    (id: string) => {
      clearPolling();
      pollIntervalRef.current = setInterval(() => {
        void pollStatus(id);
      }, 1000);
    },
    [clearPolling, pollStatus],
  );

  const handleConfirm = async () => {
    if (!preview || emailColumnCount !== 1) return;
    setIsConfirming(true);
    setErrorMessage(null);
    try {
      const response = await network.fetch<ImportConfirmResponse>(
        'POST',
        `/contacts/import/${preview.importId}/confirm`,
        {mode, mapping} as never,
      );
      setImportId(response.importId);
      setStep('progress');
      startPolling(response.importId);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('contacts.import.progress.failedError');
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleUndo = async (id: string) => {
    setIsUndoing(true);
    try {
      await network.fetch('POST', `/contacts/import/${id}/undo`);
      startPolling(id);
    } catch (error) {
      setIsUndoing(false);
      const message = error instanceof Error ? error.message : t('contacts.import.result.undoError');
      toast.error(message);
    }
  };

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const data = await network.fetch<ImportRecord[]>('GET', '/contacts/imports');
      setHistory(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('contacts.import.history.loadError');
      toast.error(message);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const goToHistory = () => {
    setStep('history');
    void loadHistory();
  };

  const resetToUpload = () => {
    clearPolling();
    setStep('upload');
    setPreview(null);
    setMapping({});
    setMode('UPSERT');
    setImportId(null);
    setRecord(null);
    setJob(null);
    setErrorMessage(null);
    setIsUndoing(false);
  };

  const statusLabel = (status: ImportStatus) => {
    switch (status) {
      case 'PROCESSING':
        return t('contacts.import.status.processing');
      case 'COMPLETED':
        return t('contacts.import.status.completed');
      case 'FAILED':
        return t('contacts.import.status.failed');
      case 'UNDOING':
        return t('contacts.import.status.undoing');
      case 'UNDONE':
        return t('contacts.import.status.undone');
      default:
        return status;
    }
  };

  const statusVariant = (status: ImportStatus): 'success' | 'destructive' | 'warning' | 'neutral' => {
    switch (status) {
      case 'COMPLETED':
        return 'success';
      case 'FAILED':
        return 'destructive';
      case 'PROCESSING':
      case 'UNDOING':
        return 'warning';
      default:
        return 'neutral';
    }
  };

  const fieldLabel = (field: MappingField) => {
    switch (field) {
      case 'email':
        return t('contacts.import.map.fieldEmail');
      case 'subscribed':
        return t('contacts.import.map.fieldSubscribed');
      case 'data':
        return t('contacts.import.map.fieldData');
      case 'ignore':
        return t('contacts.import.map.fieldIgnore');
    }
  };

  const formatDate = (value: string | null) => {
    if (!value) return '—';
    return new Date(value).toLocaleString();
  };

  const liveCounts = job?.result ?? record;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('contacts.import.title')}</DialogTitle>
        </DialogHeader>

        {/* UPLOAD */}
        {step === 'upload' && (
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
              className="hidden"
            />
            {isAnalyzing ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 py-12 text-sm text-neutral-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{t('contacts.import.upload.analyzing')}</span>
              </div>
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-neutral-300 py-12 transition-colors hover:border-neutral-400"
              >
                <FileUp className="h-6 w-6 text-neutral-400" />
                <p className="text-sm text-neutral-500">{t('contacts.import.upload.dropHint')}</p>
                <Button type="button" variant="outline">
                  {t('contacts.import.upload.choose')}
                </Button>
              </div>
            )}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={goToHistory}
                className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"
              >
                <History className="h-3.5 w-3.5" />
                {t('contacts.import.upload.viewHistory')}
              </button>
            </div>
          </div>
        )}

        {/* MAP */}
        {step === 'map' && preview && (
          <div className="space-y-4">
            {preview.duplicateCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{t('contacts.import.map.dupExisting', {count: preview.duplicateCount})}</span>
              </div>
            )}
            {preview.inFileDuplicateCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{t('contacts.import.map.dupInFile', {count: preview.inFileDuplicateCount})}</span>
              </div>
            )}

            <p className="text-sm text-neutral-500">{t('contacts.import.map.title')}</p>

            <div className="max-h-80 overflow-y-auto rounded-md border border-neutral-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('contacts.import.map.column')}</th>
                    <th className="px-3 py-2 font-medium">{t('contacts.import.map.sample')}</th>
                    <th className="px-3 py-2 font-medium">{t('contacts.import.map.mapTo')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.columns.map((column) => {
                    const current = mapping[column] ?? {field: 'ignore'};
                    const samples = preview.sampleRows
                      .slice(0, 3)
                      .map((r) => r[column])
                      .filter((v) => v !== undefined && v !== '');
                    return (
                      <tr key={column} className="border-t border-neutral-100 align-top">
                        <td className="px-3 py-2 font-medium text-neutral-900">{column}</td>
                        <td className="px-3 py-2 text-neutral-500">
                          <div className="space-y-0.5">
                            {samples.length > 0 ? (
                              samples.map((value, idx) => (
                                <div key={idx} className="truncate font-mono text-xs">
                                  {value}
                                </div>
                              ))
                            ) : (
                              <span className="text-neutral-400">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-2">
                            <select
                              value={current.field}
                              onChange={(e) => setColumnField(column, e.target.value as MappingField)}
                              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm focus:border-neutral-400 focus:outline-none"
                            >
                              {MAPPING_FIELDS.map((field) => (
                                <option key={field} value={field}>
                                  {fieldLabel(field)}
                                </option>
                              ))}
                            </select>
                            {current.field === 'data' && (
                              <Input
                                value={current.key ?? column}
                                onChange={(e) => setColumnKey(column, e.target.value)}
                                placeholder={t('contacts.import.map.customKey')}
                                className="h-8 text-sm"
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {emailColumnCount !== 1 && (
              <p className="flex items-center gap-1.5 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                {t('contacts.import.map.emailRequired')}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetToUpload}>
                {t('common.back')}
              </Button>
              <Button type="button" onClick={() => setStep('mode')} disabled={emailColumnCount !== 1}>
                {t('common.next')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* MODE */}
        {step === 'mode' && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-500">{t('contacts.import.mode.title')}</p>
            <RadioGroup value={mode} onValueChange={(value) => setMode(value as ImportMode)} className="gap-3">
              {(
                [
                  ['UPSERT', 'upsert', 'upsertHelp'],
                  ['CREATE', 'create', 'createHelp'],
                  ['UPDATE', 'update', 'updateHelp'],
                ] as const
              ).map(([value, labelKey, helpKey]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-neutral-200 p-3 hover:border-neutral-300"
                >
                  <RadioGroupItem value={value} className="mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-neutral-900">
                      {t(`contacts.import.mode.${labelKey}`)}
                    </div>
                    <div className="text-xs text-neutral-500">{t(`contacts.import.mode.${helpKey}`)}</div>
                  </div>
                </label>
              ))}
            </RadioGroup>

            {errorMessage && (
              <div className="flex items-start gap-2 text-sm text-red-600">
                <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>{errorMessage}</p>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep('map')} disabled={isConfirming}>
                {t('common.back')}
              </Button>
              <Button type="button" onClick={handleConfirm} disabled={isConfirming}>
                {isConfirming ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t('contacts.import.mode.confirm')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* PROGRESS */}
        {step === 'progress' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">{t('contacts.import.progress.processing')}</span>
              <span className="font-medium text-neutral-900">{job?.progress ?? 0}%</span>
            </div>
            <Progress value={job?.progress ?? 0} />
            {liveCounts && (
              <div className="grid grid-cols-2 gap-2 text-sm text-neutral-600 sm:grid-cols-4">
                <div>
                  <div className="font-medium text-neutral-900">{liveCounts.createdCount}</div>
                  <div className="text-xs">{t('contacts.import.progress.created')}</div>
                </div>
                <div>
                  <div className="font-medium text-neutral-900">{liveCounts.updatedCount}</div>
                  <div className="text-xs">{t('contacts.import.progress.updated')}</div>
                </div>
                <div>
                  <div className="font-medium text-neutral-900">{liveCounts.skippedCount}</div>
                  <div className="text-xs">{t('contacts.import.progress.skipped')}</div>
                </div>
                <div>
                  <div className="font-medium text-neutral-900">{liveCounts.failureCount}</div>
                  <div className="text-xs">{t('contacts.import.progress.failed')}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* RESULT */}
        {step === 'result' && (
          <div className="space-y-4">
            {record?.status === 'FAILED' || errorMessage ? (
              <div className="flex items-start gap-2 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                <p className="text-red-600">{errorMessage ?? t('contacts.import.progress.failedError')}</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-neutral-700">
                {record?.status === 'UNDONE' ? (
                  <>
                    <Undo2 className="h-4 w-4 text-neutral-500" />
                    <span>{t('contacts.import.result.undone')}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-600" />
                    <span>{t('contacts.import.result.summary')}</span>
                  </>
                )}
              </div>
            )}

            {record && (
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-lg font-semibold text-neutral-900">{record.createdCount}</div>
                  <div className="text-xs text-neutral-500">
                    {t('contacts.import.result.created', {count: record.createdCount})}
                  </div>
                </div>
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-lg font-semibold text-neutral-900">{record.updatedCount}</div>
                  <div className="text-xs text-neutral-500">
                    {t('contacts.import.result.updated', {count: record.updatedCount})}
                  </div>
                </div>
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-lg font-semibold text-neutral-900">{record.skippedCount}</div>
                  <div className="text-xs text-neutral-500">
                    {t('contacts.import.result.skipped', {count: record.skippedCount})}
                  </div>
                </div>
                <div className="rounded-md border border-neutral-200 p-3">
                  <div className="text-lg font-semibold text-neutral-900">{record.failureCount}</div>
                  <div className="text-xs text-neutral-500">
                    {t('contacts.import.result.failed', {count: record.failureCount})}
                  </div>
                </div>
              </div>
            )}

            {record?.errors && record.errors.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium text-neutral-700">
                  {t('contacts.import.result.errorsTitle')}
                </p>
                <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-200 text-xs text-neutral-600">
                  {record.errors.slice(0, 10).map((error, idx) => (
                    <div
                      key={idx}
                      className="flex gap-3 border-b border-neutral-100 px-3 py-2 last:border-0"
                    >
                      <span className="flex-shrink-0 font-mono text-neutral-400">
                        {t('contacts.importDialog.row', {row: error.row})}
                      </span>
                      <span className="text-red-600">
                        {error.email || 'N/A'} — {error.error}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="sm:justify-between">
              {record?.status === 'COMPLETED' && record.undoable ? (
                <Button type="button" variant="outline" onClick={() => handleUndo(record.id)} disabled={isUndoing}>
                  {isUndoing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('contacts.import.result.undoing')}
                    </>
                  ) : (
                    <>
                      <Undo2 className="mr-2 h-4 w-4" />
                      {t('contacts.import.result.undo')}
                    </>
                  )}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={resetToUpload}>
                  {t('contacts.import.result.importAnother')}
                </Button>
                <Button type="button" onClick={() => onOpenChange(false)}>
                  {t('common.close')}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}

        {/* HISTORY */}
        {step === 'history' && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-500">{t('contacts.import.history.title')}</p>
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-8 text-neutral-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-500">
                {t('contacts.import.history.empty')}
              </p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-neutral-900">{item.filename}</span>
                        <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-500">
                        {formatDate(item.createdAt)} · {t('contacts.import.result.created', {count: item.createdCount})},{' '}
                        {t('contacts.import.result.updated', {count: item.updatedCount})},{' '}
                        {t('contacts.import.result.skipped', {count: item.skippedCount})},{' '}
                        {t('contacts.import.result.failed', {count: item.failureCount})}
                      </div>
                    </div>
                    {item.status === 'COMPLETED' && item.undoable && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleUndo(item.id)}
                        disabled={isUndoing}
                      >
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                        {t('contacts.import.history.undo')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetToUpload}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                {t('contacts.import.history.back')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
