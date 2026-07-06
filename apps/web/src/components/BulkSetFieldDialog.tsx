import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@plunk/ui';
import {AlertTriangle, CheckCircle, Loader2} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {useTranslation} from '../lib/i18n';
import {network} from '../lib/network';

export type BulkSelector =
  | {mode: 'ids'; contactIds: string[]}
  | {mode: 'query'; filter: {search?: string; subscribed?: boolean}; excludeIds: string[]};

interface BulkSetFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selector: BulkSelector;
  targetCount: number;
  onSuccess: () => void;
}

interface FieldsResponse {
  fields: Array<{field: string; type: string; coverage: number}>;
}

interface FieldValuesResponse {
  values: Array<string | number | boolean>;
}

interface BulkResult {
  operation: string;
  totalRequested: number;
  successCount: number;
  unchangedCount: number;
  failureCount: number;
}

interface BulkJobStatus {
  id: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | string;
  progress: number;
  result: BulkResult | null;
  failedReason?: string;
}

const CREATE_NEW_VALUE = '__create_new__';

export function BulkSetFieldDialog({open, onOpenChange, selector, targetCount, onSuccess}: BulkSetFieldDialogProps) {
  const {t} = useTranslation();

  const [fields, setFields] = useState<string[]>([]); // custom field keys (without the data. prefix)
  const [selectedField, setSelectedField] = useState<string>('');
  const [newFieldName, setNewFieldName] = useState('');
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'failed'>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const isCreatingNew = selectedField === CREATE_NEW_VALUE;
  const effectiveField = (isCreatingNew ? newFieldName : selectedField).trim();

  // Load existing custom fields when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      try {
        const data = await network.fetch<FieldsResponse>('GET', '/contacts/fields');
        if (cancelled) return;
        const keys = data.fields.filter(f => f.field.startsWith('data.')).map(f => f.field.slice(5));
        setFields(keys);
        setSelectedField(keys.length === 0 ? CREATE_NEW_VALUE : '');
      } catch {
        if (cancelled) return;
        setFields([]);
        setSelectedField(CREATE_NEW_VALUE);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Suggest existing values for the chosen field (autocomplete).
  useEffect(() => {
    if (!open || isCreatingNew || !selectedField) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await network.fetch<FieldValuesResponse>(
          'GET',
          `/contacts/fields/${encodeURIComponent(`data.${selectedField}`)}/values`,
        );
        if (!cancelled) setSuggestions(data.values.map(String).filter(Boolean));
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedField, isCreatingNew]);

  // Reset + stop polling on close.
  useEffect(() => {
    if (!open) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setTimeout(() => {
        setFields([]);
        setSelectedField('');
        setNewFieldName('');
        setValue('');
        setSuggestions([]);
        setStatus('idle');
        setIsSubmitting(false);
        setProgress(0);
        setResult(null);
        setErrorMessage(null);
      }, 300);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const pollJobStatus = async (jobId: string) => {
    try {
      const response = await network.fetch<BulkJobStatus>('GET', `/contacts/bulk/${jobId}`);
      setProgress(response.progress || 0);

      if (response.state === 'completed') {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        setStatus('completed');
        setResult(response.result);
        if (response.result) {
          toast.success(t('contacts.setField.successBody', {count: response.result.successCount.toLocaleString()}));
        }
        onSuccess();
      } else if (response.state === 'failed') {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        const message = response.failedReason || t('contacts.setField.errorTitle');
        setStatus('failed');
        setErrorMessage(message);
        toast.error(message);
      } else if (response.state === 'active') {
        setStatus('processing');
      }
    } catch (error) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      const message = error instanceof Error ? error.message : t('contacts.setField.errorTitle');
      setStatus('failed');
      setErrorMessage(message);
      toast.error(message);
    }
  };

  const handleApply = async () => {
    setIsSubmitting(true);
    setStatus('processing');
    setErrorMessage(null);

    try {
      const data = await network.fetch<{jobId: string}>('POST', '/contacts/bulk-set-data', {
        field: effectiveField,
        value,
        ...selector,
      } as never);

      pollIntervalRef.current = setInterval(() => {
        void pollJobStatus(data.jobId);
      }, 1000);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('contacts.setField.errorTitle');
      setStatus('failed');
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = effectiveField.length > 0 && value.trim().length > 0;
  const isQueueing = status === 'processing' && progress === 0;

  const dialogTitle =
    status === 'completed'
      ? t('contacts.setField.successTitle')
      : status === 'failed'
      ? t('contacts.setField.errorTitle')
      : t('contacts.setField.title');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {status === 'idle' && (
            <div className="space-y-3">
              <p className="text-sm text-neutral-700 leading-relaxed">
                {t('contacts.setField.description', {count: targetCount.toLocaleString()})}
              </p>

              <div className="space-y-2">
                <Label htmlFor="field-select">{t('contacts.setField.fieldLabel')}</Label>
                <select
                  id="field-select"
                  value={selectedField}
                  onChange={e => setSelectedField(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-neutral-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950"
                >
                  <option value="" disabled>
                    {t('contacts.setField.selectField')}
                  </option>
                  {fields.map(f => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                  <option value={CREATE_NEW_VALUE}>{t('contacts.setField.createNew')}</option>
                </select>

                {isCreatingNew && (
                  <Input
                    value={newFieldName}
                    onChange={e => setNewFieldName(e.target.value)}
                    placeholder={t('contacts.setField.newFieldPlaceholder')}
                    autoFocus
                    maxLength={100}
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="field-value">{t('contacts.setField.valueLabel')}</Label>
                <Input
                  id="field-value"
                  list="bulk-field-values"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={t('contacts.setField.valuePlaceholder')}
                  maxLength={500}
                />
                <datalist id="bulk-field-values">
                  {suggestions.map(s => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              <p className="text-xs text-neutral-500 leading-relaxed">{t('contacts.setField.overwriteHint')}</p>
            </div>
          )}

          {status === 'processing' && (
            <div className="space-y-3 py-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="flex items-center gap-2 text-neutral-600">
                  {isQueueing && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
                  <span>{isQueueing ? t('contacts.setField.applying') : t('contacts.setField.processing')}</span>
                </span>
                <span className={`tabular-nums font-medium ${isQueueing ? 'text-neutral-400' : 'text-neutral-900'}`}>
                  {progress}%
                </span>
              </div>
              <div className="relative w-full bg-neutral-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-neutral-900 h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{width: `${progress}%`}}
                />
              </div>
            </div>
          )}

          {status === 'completed' && (
            <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.25} />
              <p className="leading-relaxed">
                {t('contacts.setField.successBody', {count: (result?.successCount ?? 0).toLocaleString()})}
              </p>
            </div>
          )}

          {status === 'failed' && (
            <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.25} />
              <p className="leading-relaxed">{errorMessage || t('contacts.setField.errorTitle')}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {status === 'idle' ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" onClick={handleApply} disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? t('contacts.setField.applying') : t('contacts.setField.apply')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant={status === 'completed' ? 'default' : 'outline'}
              onClick={() => onOpenChange(false)}
              disabled={status === 'processing'}
            >
              {t('common.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
