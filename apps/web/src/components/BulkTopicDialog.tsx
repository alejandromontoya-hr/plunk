import {Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label} from '@plunk/ui';
import {AlertTriangle, CheckCircle, Loader2} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {useTranslation} from '../lib/i18n';
import {network} from '../lib/network';
import {topicLabel} from '../lib/topics';

export type BulkSelector =
  | {mode: 'ids'; contactIds: string[]}
  | {mode: 'query'; filter: {search?: string; subscribed?: boolean}; excludeIds: string[]};

interface Topic {
  id: string;
  key: string;
  name: string;
  description: string | null;
  transactional: boolean;
  position: number;
}

interface BulkResult {
  successCount: number;
}

interface BulkJobStatus {
  id: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | string;
  progress: number;
  result: BulkResult | null;
  failedReason?: string;
}

interface BulkTopicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selector: BulkSelector;
  targetCount: number;
  onSuccess: () => void;
}

/**
 * Subscribe/unsubscribe the selected contacts to a specific topic in bulk.
 * Mirrors AddToSegmentDialog: queues a background job and polls for progress.
 */
export function BulkTopicDialog({open, onOpenChange, selector, targetCount, onSuccess}: BulkTopicDialogProps) {
  const {t} = useTranslation();

  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const [topicId, setTopicId] = useState<string>('');
  const [action, setAction] = useState<'subscribe' | 'unsubscribe'>('subscribe');

  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'failed'>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const loadTopics = async () => {
      setIsLoadingTopics(true);
      try {
        const data = await network.fetch<{topics: Topic[]}>('GET', '/contacts/topics');
        if (cancelled) return;
        setTopics(data.topics);
        setTopicId(data.topics[0]?.id ?? '');
      } catch (error) {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : t('contacts.bulkTopicDialog.error'));
        setTopics([]);
      } finally {
        if (!cancelled) setIsLoadingTopics(false);
      }
    };

    void loadTopics();
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  useEffect(() => {
    if (!open) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setTimeout(() => {
        setTopics([]);
        setTopicId('');
        setAction('subscribe');
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
          toast.success(t('contacts.bulkTopicDialog.successBody', {count: response.result.successCount.toLocaleString()}));
        }
        onSuccess();
      } else if (response.state === 'failed') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        const message = response.failedReason || t('contacts.bulkTopicDialog.error');
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
      const message = error instanceof Error ? error.message : t('contacts.bulkTopicDialog.error');
      setStatus('failed');
      setErrorMessage(message);
      toast.error(message);
    }
  };

  const handleApply = async () => {
    if (!topicId) return;
    setIsSubmitting(true);
    setStatus('processing');
    setErrorMessage(null);

    try {
      const endpoint = action === 'subscribe' ? '/contacts/bulk-subscribe-topic' : '/contacts/bulk-unsubscribe-topic';
      const data = await network.fetch<{jobId: string}>('POST', endpoint, {topicId, ...selector} as never);

      pollIntervalRef.current = setInterval(() => {
        void pollJobStatus(data.jobId);
      }, 1000);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('contacts.bulkTopicDialog.error');
      setStatus('failed');
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isQueueing = status === 'processing' && progress === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="transition-colors">{t('contacts.bulkTopicDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {status === 'idle' && (
            <div className="space-y-3 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
              <p className="text-sm text-neutral-700 leading-relaxed">
                {t('contacts.bulkTopicDialog.description', {count: targetCount.toLocaleString()})}
              </p>

              {isLoadingTopics ? (
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                  <span>{t('contacts.addToSegment.loading')}</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="topic-select">{t('contacts.topics.selectTopic')}</Label>
                    <select
                      id="topic-select"
                      value={topicId}
                      onChange={event => setTopicId(event.target.value)}
                      className="flex h-9 w-full rounded-md border border-neutral-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {topics.map(topic => (
                        <option key={topic.id} value={topic.id}>
                          {topicLabel(t, topic)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="topic-action">{t('contacts.bulkTopicDialog.action')}</Label>
                    <select
                      id="topic-action"
                      value={action}
                      onChange={event => setAction(event.target.value as 'subscribe' | 'unsubscribe')}
                      className="flex h-9 w-full rounded-md border border-neutral-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="subscribe">{t('contacts.bulkTopicDialog.subscribe')}</option>
                      <option value="unsubscribe">{t('contacts.bulkTopicDialog.unsubscribe')}</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {status === 'processing' && (
            <div className="space-y-3 py-1 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
              <div className="flex items-baseline justify-between text-sm">
                <span className="flex items-center gap-2 text-neutral-600">
                  {isQueueing && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
                  <span>{isQueueing ? t('contacts.bulkTopicDialog.queued') : t('contacts.bulkTopicDialog.applying')}</span>
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
                {t('contacts.bulkTopicDialog.successBody', {count: (result?.successCount ?? 0).toLocaleString()})}
              </p>
            </div>
          )}

          {status === 'failed' && (
            <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.25} />
              <p className="leading-relaxed">{errorMessage || t('contacts.bulkTopicDialog.error')}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {status === 'idle' ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" onClick={handleApply} disabled={!topicId || isSubmitting || isLoadingTopics}>
                {isSubmitting ? t('contacts.bulkTopicDialog.applying') : t('contacts.bulkTopicDialog.confirm')}
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
