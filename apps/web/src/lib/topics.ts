import type {TranslateFn} from './i18n';

/**
 * Resolve a topic's display label. Prefers a translation keyed by the topic's
 * machine key (contacts.topics.<key>.name); falls back to the stored name for
 * custom topics that have no translation. `t` returns the key path verbatim when
 * a translation is missing, which is how we detect the fallback.
 */
export function topicLabel(t: TranslateFn, topic: {key: string; name: string}): string {
  const key = `contacts.topics.${topic.key}.name`;
  const translated = t(key);
  return translated === key ? topic.name : translated;
}

/** Same as {@link topicLabel} for the topic description. */
export function topicDescription(
  t: TranslateFn,
  topic: {key: string; description: string | null},
): string | null {
  const key = `contacts.topics.${topic.key}.description`;
  const translated = t(key);
  return translated === key ? topic.description : translated;
}
