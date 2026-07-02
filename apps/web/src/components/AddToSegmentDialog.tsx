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

interface AddToSegmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selector: BulkSelector;
  targetCount: number;
  onSuccess: () => void;
}

interface Segment {
  id: string;
  name: string;
  type: 'DYNAMIC' | 'STATIC';
  memberCount: number;
}

interface BulkAddToSegmentResult {
  operation: string;
  totalRequested: number;
  successCount: number;
  unchangedCount: number;
  failureCount: number;
  errors: Array<{contactId: string; email: string; error: string}>;
}

interface BulkJobStatus {
  id: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | string;
  progress: number;
  result: BulkAddToSegmentResult | null;
  failedReason?: string;
}

const CREATE_NEW_VALUE = '__create_new__';

export function AddToSegmentDialog({open, onOpenChange, selector, targetCount, onSuccess}: AddToSegmentDialogProps) {
  const {t} = useTranslation();

  const [segments, setSegments] = useState<Segment[]>([]);
  const [isLoadingSegments, setIsLoadingSegments] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string>('');
  const [newSegmentName, setNewSegmentName] = useState('');

  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'failed'>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BulkAddToSegmentResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const isCreatingNew = selectedValue === CREATE_NEW_VALUE;

  // Fetch static segments when the dialog opens.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const loadSegments = async () => {
      setIsLoadingSegments(true);
      try {
        const data = await network.fetch<Segment[]>('GET', '/segments');
        if (cancelled) return;
        const staticSegments = data.filter((segment) => segment.type === 'STATIC');
        setSegments(staticSegments);
        // If there are no static segments, default to the create-new flow.
        setSelectedValue(staticSegments.length === 0 ? CREATE_NEW_VALUE : '');
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : t('contacts.addToSegment.errorTitle');
        toast.error(message);
        setSegments([]);
        setSelectedValue(CREATE_NEW_VALUE);
      } finally {
        if (!cancelled) setIsLoadingSegments(false);
      }
    };

    void loadSegments();

    return () => {
      cancelled = true;
    };
  }, [open, t]);

  // Clean up polling and reset state on close.
  useEffect(() => {
    if (!open) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setTimeout(() => {
        setSegments([]);
        setSelectedValue('');
        setNewSegmentName('');
        setStatus('idle');
        setIsSubmitting(false);
        setProgress(0);
        setResult(null);
        setErrorMessage(null);
      }, 300);
    }
  }, [open]);

  // Clean up polling on unmount.
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const pollJobStatus = async (jobId: string) => {
    try {
      const response = await network.fetch<BulkJobStatus>('GET', `/contacts/bulk/${jobId}`);

      setProgress(response.progress || 0);

      if (response.state === 'completed') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setStatus('completed');
        setResult(response.result);
        if (response.result) {
          toast.success(t('contacts.addToSegment.successBody', {count: response.result.successCount.toLocaleString()}));
        }
        onSuccess();
      } else if (response.state === 'failed') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        const message = response.failedReason || t('contacts.addToSegment.errorTitle');
        setStatus('failed');
        setErrorMessage(message);
        toast.error(message);
      } else if (response.state === 'active') {
        setStatus('processing');
      }
    } catch (error) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      const message = error instanceof Error ? error.message : t('contacts.addToSegment.errorTitle');
      setStatus('failed');
      setErrorMessage(message);
      toast.error(message);
    }
  };

  const handleAdd = async () => {
    setIsSubmitting(true);
    setStatus('processing');
    setErrorMessage(null);

    try {
      let segmentId: string;

      if (isCreatingNew) {
        const created = await network.fetch<Segment>('POST', '/segments', {
          name: newSegmentName.trim(),
          type: 'STATIC',
        } as never);
        segmentId = created.id;
      } else {
        segmentId = selectedValue;
      }

      const data = await network.fetch<{jobId: string}>('POST', '/contacts/bulk-add-to-segment', {
        segmentId,
        ...selector,
      } as never);

      pollIntervalRef.current = setInterval(() => {
        void pollJobStatus(data.jobId);
      }, 1000);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('contacts.addToSegment.errorTitle');
      setStatus('failed');
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = isCreatingNew
    ? newSegmentName.trim().length > 0
    : selectedValue !== '' && selectedValue !== CREATE_NEW_VALUE;

  const dialogTitle =
    status === 'completed'
      ? t('contacts.addToSegment.successTitle')
      : status === 'failed'
      ? t('contacts.addToSegment.errorTitle')
      : t('contacts.addToSegment.title');

  const isQueueing = status === 'processing' && progress === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="transition-colors">{dialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {status === 'idle' && (
            <div className="space-y-3 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
              <p className="text-sm text-neutral-700 leading-relaxed">
                {t('contacts.addToSegment.description', {count: targetCount.toLocaleString()})}
              </p>

              {isLoadingSegments ? (
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                  <span>{t('contacts.addToSegment.loading')}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="segment-select">{t('contacts.addToSegment.selectSegment')}</Label>
                  <select
                    id="segment-select"
                    value={selectedValue}
                    onChange={(event) => setSelectedValue(event.target.value)}
                    className="flex h-9 w-full rounded-md border border-neutral-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {segments.length === 0 ? (
                      <option value="" disabled>
                        {t('contacts.addToSegment.noStaticSegments')}
                      </option>
                    ) : (
                      <option value="" disabled>
                        {t('contacts.addToSegment.selectSegment')}
                      </option>
                    )}
                    {segments.map((segment) => (
                      <option key={segment.id} value={segment.id}>
                        {segment.name} ({t('contacts.addToSegment.memberCount', {count: segment.memberCount.toLocaleString()})})
                      </option>
                    ))}
                    <option value={CREATE_NEW_VALUE}>{t('contacts.addToSegment.createNew')}</option>
                  </select>

                  {isCreatingNew && (
                    <div className="space-y-1.5 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
                      <Label htmlFor="new-segment-name">{t('contacts.addToSegment.newSegmentName')}</Label>
                      <Input
                        id="new-segment-name"
                        value={newSegmentName}
                        onChange={(event) => setNewSegmentName(event.target.value)}
                        placeholder={t('contacts.addToSegment.newSegmentPlaceholder')}
                        autoFocus
                      />
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-neutral-500 leading-relaxed">{t('contacts.addToSegment.staticOnlyHint')}</p>
            </div>
          )}

          {status === 'processing' && (
            <div className="space-y-3 py-1 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
              <div className="flex items-baseline justify-between text-sm">
                <span className="flex items-center gap-2 text-neutral-600">
                  {isQueueing && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
                  <span>
                    {isQueueing ? t('contacts.addToSegment.adding') : t('contacts.addToSegment.processing')}
                  </span>
                </span>
                <span
                  className={`tabular-nums font-medium transition-opacity ${
                    isQueueing ? 'text-neutral-400' : 'text-neutral-900'
                  }`}
                >
                  {progress}%
                </span>
              </div>
              <div className="relative w-full bg-neutral-100 rounded-full h-1.5 overflow-hidden">
                {isQueueing ? (
                  <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-neutral-300 motion-safe:animate-[indeterminate_1.4s_ease-in-out_infinite]" />
                ) : (
                  <div
                    className="bg-neutral-900 h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{width: `${progress}%`}}
                  />
                )}
              </div>
            </div>
          )}

          {status === 'completed' && (
            <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.25} />
              <p className="leading-relaxed">
                {t('contacts.addToSegment.successBody', {count: (result?.successCount ?? 0).toLocaleString()})}
              </p>
            </div>
          )}

          {status === 'failed' && (
            <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.25} />
              <p className="leading-relaxed">{errorMessage || t('contacts.addToSegment.errorTitle')}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {status === 'idle' ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" onClick={handleAdd} disabled={!canSubmit || isSubmitting || isLoadingSegments}>
                {isSubmitting ? t('contacts.addToSegment.adding') : t('contacts.addToSegment.add')}
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
