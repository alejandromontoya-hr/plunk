import {Card, CardContent, CardHeader, CardTitle, IconSpinner, Switch} from '@plunk/ui';
import type {TopicSubscriptionSummary} from '@plunk/types';
import {useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';

import {useTranslation} from '../lib/i18n';
import {network} from '../lib/network';
import {topicDescription, topicLabel} from '../lib/topics';

interface SubscriptionsResponse {
  subscriptions: TopicSubscriptionSummary[];
}

/**
 * Per-topic subscription card on the contact detail page. One row per topic with
 * a toggle; flipping it calls the per-topic endpoint and re-renders from the
 * server's recomputed state.
 */
export function ContactTopicSubscriptions({
  contactId,
  onChanged,
}: {
  contactId: string;
  /** Called after a successful toggle so the parent can refresh derived state (e.g. the status badge). */
  onChanged?: () => void;
}) {
  const {t} = useTranslation();
  const {data, mutate, isLoading} = useSWR<SubscriptionsResponse>(
    contactId ? `/contacts/${contactId}/subscriptions` : null,
  );
  const [pendingTopicId, setPendingTopicId] = useState<string | null>(null);

  const toggle = async (topicId: string, next: boolean) => {
    setPendingTopicId(topicId);
    try {
      const response = await network.fetch<SubscriptionsResponse>(
        'PUT',
        `/contacts/${contactId}/subscriptions/${topicId}`,
        {subscribed: next} as never,
      );
      await mutate(response, {revalidate: false});
      onChanged?.();
      toast.success(t('contacts.detail.topicUpdated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contacts.detail.topicUpdateFailed'));
      void mutate();
    } finally {
      setPendingTopicId(null);
    }
  };

  const subscriptions = data?.subscriptions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('contacts.detail.subscriptionsTitle')}</CardTitle>
        <p className="text-xs text-neutral-500">{t('contacts.detail.subscriptionsSubtitle')}</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <IconSpinner />
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {subscriptions.map(({topic, status}) => {
              const subscribed = status === 'SUBSCRIBED';
              const note = !subscribed
                ? t('contacts.topics.unsubscribedFromEmail')
                : topic.transactional
                  ? t('contacts.topics.transactionalHint')
                  : topicDescription(t, topic);

              return (
                <div
                  key={topic.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${subscribed ? 'text-neutral-900' : 'text-neutral-500'}`}>
                      {topicLabel(t, topic)}
                    </p>
                    <p className={`mt-0.5 text-xs ${subscribed ? 'text-neutral-500' : 'text-red-600'}`}>{note}</p>
                  </div>
                  <Switch
                    checked={subscribed}
                    disabled={pendingTopicId === topic.id}
                    onCheckedChange={next => toggle(topic.id, next)}
                    aria-label={topicLabel(t, topic)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
