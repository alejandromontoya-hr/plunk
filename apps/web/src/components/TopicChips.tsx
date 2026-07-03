import type {TopicSubscriptionSummary} from '@plunk/types';

import {useTranslation} from '../lib/i18n';
import {topicLabel} from '../lib/topics';

/**
 * Read-only topic chips for a contact. Subscribed topics render as a soft chip
 * with a dot (green for marketing, gray for transactional — which doesn't count
 * toward the marketing "Subscribed" status); topics the contact has opted out of
 * render muted and struck through. Used in the contacts table.
 */
export function TopicChips({subscriptions}: {subscriptions: TopicSubscriptionSummary[]}) {
  const {t} = useTranslation();

  if (!subscriptions || subscriptions.length === 0) {
    return <span className="text-xs text-neutral-400">{t('contacts.topics.empty')}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {subscriptions.map(({topic, status}) => {
        const label = topicLabel(t, topic);

        if (status !== 'SUBSCRIBED') {
          return (
            <span
              key={topic.id}
              className="inline-flex items-center rounded-full border border-dashed border-neutral-200 px-2.5 py-0.5 text-xs font-medium text-neutral-400 line-through"
            >
              {label}
            </span>
          );
        }

        return (
          <span
            key={topic.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-xs font-medium text-neutral-700"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${topic.transactional ? 'bg-neutral-400' : 'bg-emerald-500'}`}
              aria-hidden="true"
            />
            {label}
          </span>
        );
      })}
    </div>
  );
}
