/**
 * Default subscription topics seeded for every project.
 *
 * This is the single source of truth for the initial topic set. It is used by:
 * - `TopicService.seedDefaults` when a new project is created
 * - the `20260702130000_add_subscription_topics` migration (values duplicated in
 *   raw SQL there — keep both in sync)
 *
 * `key` is the stable machine identifier shared by the API, the dashboard UI and
 * the i18n layer (labels are rendered from translations keyed by `key`, with
 * `name`/`description` as English fallbacks). `transactional` topics are
 * mandatory-style channels: contacts can still opt out and the topic is still
 * shown, but it is excluded from the computed `Contact.subscribed` marketing flag.
 */
export interface DefaultTopic {
  key: string;
  name: string;
  description: string;
  transactional: boolean;
  defaultSubscribed: boolean;
  position: number;
}

/** Well-known keys for the seeded topics. */
export const TOPIC_KEYS = {
  TRANSACTIONAL: 'transactional',
  PRODUCT_UPDATES: 'product_updates',
  MARKETING: 'marketing',
} as const;

export type DefaultTopicKey = (typeof TOPIC_KEYS)[keyof typeof TOPIC_KEYS];

export const DEFAULT_TOPICS: readonly DefaultTopic[] = [
  {
    key: TOPIC_KEYS.TRANSACTIONAL,
    name: 'Transactional',
    description: 'Receipts, security alerts and account notifications',
    transactional: true,
    defaultSubscribed: true,
    position: 0,
  },
  {
    key: TOPIC_KEYS.PRODUCT_UPDATES,
    name: 'Product updates',
    description: 'News about new features and product changes',
    transactional: false,
    defaultSubscribed: true,
    position: 1,
  },
  {
    key: TOPIC_KEYS.MARKETING,
    name: 'Marketing',
    description: 'Newsletters, offers and promotions',
    transactional: false,
    defaultSubscribed: true,
    position: 2,
  },
] as const;
