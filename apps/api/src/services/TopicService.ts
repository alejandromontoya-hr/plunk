import {Prisma, type Topic, SubscriptionStatus} from '@plunk/db';
import {DEFAULT_TOPICS} from '@plunk/shared';

import {prisma} from '../database/prisma.js';
import {HttpException} from '../exceptions/index.js';
import {EventService} from './EventService.js';

/** A topic paired with a contact's effective subscription status. */
export interface ContactTopicSubscription {
  topic: Pick<Topic, 'id' | 'key' | 'name' | 'description' | 'transactional' | 'position'>;
  status: SubscriptionStatus;
}

const TOPIC_PUBLIC_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  transactional: true,
  position: true,
} as const;

/**
 * Manages subscription topics and per-contact topic subscriptions.
 *
 * Storage model is deviation-based: a `ContactSubscription` row only exists when a
 * contact's status differs from (or is explicitly set against) the topic's
 * `defaultSubscribed`. Absence of a row therefore means "topic default". This keeps
 * writes and backfill cheap at scale — only opt-outs create rows for default-on
 * topics. Per-contact history lives in the event stream, not in these rows.
 *
 * `Contact.subscribed` is a MATERIALIZED marketing flag kept in sync here: it is
 * true when the contact is effectively subscribed to at least one non-transactional
 * topic. It is recomputed with a single set-based UPDATE whenever subscriptions
 * change, so the campaign recipient filter and the (projectId, subscribed) index
 * stay cheap.
 */
export class TopicService {
  /**
   * Seed the default topic set for a project. Idempotent — safe to call on every
   * project creation thanks to the (projectId, key) unique constraint.
   */
  public static async seedDefaults(projectId: string): Promise<void> {
    await prisma.topic.createMany({
      data: DEFAULT_TOPICS.map(t => ({
        projectId,
        key: t.key,
        name: t.name,
        description: t.description,
        transactional: t.transactional,
        defaultSubscribed: t.defaultSubscribed,
        position: t.position,
      })),
      skipDuplicates: true,
    });
  }

  /** List a project's topics ordered for display. */
  public static async list(projectId: string): Promise<Topic[]> {
    return prisma.topic.findMany({
      where: {projectId},
      orderBy: {position: 'asc'},
    });
  }

  /**
   * Resolve the effective subscription status for every topic of the project a
   * contact belongs to. Topics with no explicit row fall back to their default.
   */
  public static async getContactSubscriptions(
    projectId: string,
    contactId: string,
  ): Promise<ContactTopicSubscription[]> {
    const topics = await prisma.topic.findMany({
      where: {projectId},
      orderBy: {position: 'asc'},
      select: {...TOPIC_PUBLIC_SELECT, defaultSubscribed: true},
    });

    if (topics.length === 0) {
      return [];
    }

    const rows = await prisma.contactSubscription.findMany({
      where: {contactId, topicId: {in: topics.map(t => t.id)}},
      select: {topicId: true, status: true},
    });
    const byTopic = new Map(rows.map(r => [r.topicId, r.status]));

    return topics.map(({defaultSubscribed, ...topic}) => ({
      topic,
      status: byTopic.get(topic.id) ?? (defaultSubscribed ? SubscriptionStatus.SUBSCRIBED : SubscriptionStatus.UNSUBSCRIBED),
    }));
  }

  /**
   * Batch variant of {@link getContactSubscriptions}: resolve effective per-topic
   * status for many contacts at once (topics + deviation rows in two queries).
   * Used to enrich the contacts list with topic chips without an N+1.
   */
  public static async getSubscriptionsForContacts(
    projectId: string,
    contactIds: string[],
  ): Promise<Map<string, ContactTopicSubscription[]>> {
    const result = new Map<string, ContactTopicSubscription[]>();
    if (contactIds.length === 0) {
      return result;
    }

    const topics = await prisma.topic.findMany({
      where: {projectId},
      orderBy: {position: 'asc'},
      select: {...TOPIC_PUBLIC_SELECT, defaultSubscribed: true},
    });
    if (topics.length === 0) {
      for (const id of contactIds) result.set(id, []);
      return result;
    }

    const rows = await prisma.contactSubscription.findMany({
      where: {contactId: {in: contactIds}, topicId: {in: topics.map(t => t.id)}},
      select: {contactId: true, topicId: true, status: true},
    });
    const byContact = new Map<string, Map<string, SubscriptionStatus>>();
    for (const row of rows) {
      let m = byContact.get(row.contactId);
      if (!m) {
        m = new Map();
        byContact.set(row.contactId, m);
      }
      m.set(row.topicId, row.status);
    }

    for (const id of contactIds) {
      const m = byContact.get(id);
      result.set(
        id,
        topics.map(({defaultSubscribed, ...topic}) => ({
          topic,
          status:
            m?.get(topic.id) ?? (defaultSubscribed ? SubscriptionStatus.SUBSCRIBED : SubscriptionStatus.UNSUBSCRIBED),
        })),
      );
    }
    return result;
  }

  /**
   * PUBLIC: same as {@link getContactSubscriptions} but derives the project from
   * the contact, for unauthenticated preference pages.
   */
  public static async getContactSubscriptionsPublic(contactId: string): Promise<ContactTopicSubscription[]> {
    const contact = await prisma.contact.findUnique({
      where: {id: contactId},
      select: {projectId: true},
    });
    if (!contact) {
      throw new HttpException(404, 'Contact not found');
    }
    return this.getContactSubscriptions(contact.projectId, contactId);
  }

  /**
   * Set a single contact's subscription to a topic. Writes a deviation row (or
   * removes it when returning to the topic default), recomputes the materialized
   * `subscribed` flag, and emits a subscription event when the effective status
   * actually changed.
   *
   * @returns whether the effective status changed.
   */
  public static async setSubscription(
    projectId: string,
    contactId: string,
    topicId: string,
    targetStatus: SubscriptionStatus,
    source: string,
  ): Promise<{changed: boolean; status: SubscriptionStatus; topicKey: string}> {
    const now = new Date();

    const result = await prisma.$transaction(async tx => {
      const topic = await tx.topic.findFirst({where: {id: topicId, projectId}});
      if (!topic) {
        throw new HttpException(404, 'Topic not found');
      }

      // Verify the contact belongs to the project before mutating.
      const contact = await tx.contact.findFirst({where: {id: contactId, projectId}, select: {id: true}});
      if (!contact) {
        throw new HttpException(404, 'Contact not found');
      }

      const defaultStatus = topic.defaultSubscribed ? SubscriptionStatus.SUBSCRIBED : SubscriptionStatus.UNSUBSCRIBED;
      const existing = await tx.contactSubscription.findUnique({
        where: {contactId_topicId: {contactId, topicId}},
        select: {status: true},
      });
      const priorStatus = existing?.status ?? defaultStatus;

      if (targetStatus === defaultStatus) {
        // Back to default — drop the deviation row if any.
        if (existing) {
          await tx.contactSubscription.delete({where: {contactId_topicId: {contactId, topicId}}});
        }
      } else {
        await tx.contactSubscription.upsert({
          where: {contactId_topicId: {contactId, topicId}},
          create: {
            contactId,
            topicId,
            status: targetStatus,
            source,
            subscribedAt: targetStatus === SubscriptionStatus.SUBSCRIBED ? now : null,
            unsubscribedAt: targetStatus === SubscriptionStatus.UNSUBSCRIBED ? now : null,
          },
          update: {
            status: targetStatus,
            source,
            ...(targetStatus === SubscriptionStatus.SUBSCRIBED ? {subscribedAt: now} : {unsubscribedAt: now}),
          },
        });
      }

      await TopicService.recomputeSubscribedForContacts(tx, projectId, [contactId]);

      return {changed: priorStatus !== targetStatus, topicKey: topic.key};
    });

    // Emit the subscription event after commit (it also triggers workflows, which
    // must not run inside our transaction). Event names mirror the legacy global
    // ones so existing workflow triggers keep firing; the topic key is attached
    // in the payload for per-topic analytics.
    if (result.changed) {
      const eventName =
        targetStatus === SubscriptionStatus.SUBSCRIBED ? 'contact.subscribed' : 'contact.unsubscribed';
      await EventService.trackEvent(projectId, eventName, contactId, undefined, {topic: result.topicKey});
    }

    return {changed: result.changed, status: targetStatus, topicKey: result.topicKey};
  }

  /**
   * Bulk set a topic subscription for many contacts (used by the background bulk
   * job, in batches). Writes deviation rows in bulk, recomputes `subscribed` for
   * the whole batch in one query, and fires subscription events for the contacts
   * whose effective status changed.
   *
   * `updated` = contacts whose effective status changed; `unchanged` = contacts
   * already in the target state (no-op, not a failure).
   */
  public static async bulkSetSubscription(
    projectId: string,
    contactIds: string[],
    topicId: string,
    targetStatus: SubscriptionStatus,
    source: string,
  ): Promise<{updated: number; unchanged: number}> {
    if (contactIds.length === 0) {
      return {updated: 0, unchanged: 0};
    }

    const topic = await prisma.topic.findFirst({where: {id: topicId, projectId}});
    if (!topic) {
      throw new HttpException(404, 'Topic not found');
    }

    const now = new Date();
    const defaultStatus = topic.defaultSubscribed ? SubscriptionStatus.SUBSCRIBED : SubscriptionStatus.UNSUBSCRIBED;

    // Only operate on contacts that actually belong to the project.
    const contacts = await prisma.contact.findMany({
      where: {id: {in: contactIds}, projectId},
      select: {id: true},
    });
    const validIds = contacts.map(c => c.id);
    if (validIds.length === 0) {
      return {updated: 0, unchanged: 0};
    }

    // Existing deviation rows for this topic among the batch.
    const existingRows = await prisma.contactSubscription.findMany({
      where: {topicId, contactId: {in: validIds}},
      select: {contactId: true, status: true},
    });
    const existingStatus = new Map(existingRows.map(r => [r.contactId, r.status]));

    // A contact's prior effective status is its row status, or the topic default.
    const changedIds = validIds.filter(id => (existingStatus.get(id) ?? defaultStatus) !== targetStatus);
    const unchanged = validIds.length - changedIds.length;

    if (changedIds.length === 0) {
      return {updated: 0, unchanged};
    }

    await prisma.$transaction(async tx => {
      if (targetStatus === defaultStatus) {
        // Returning to default — remove deviation rows for the changed contacts.
        await tx.contactSubscription.deleteMany({where: {topicId, contactId: {in: changedIds}}});
      } else {
        const idsWithRow = new Set(existingStatus.keys());
        const toCreate = changedIds.filter(id => !idsWithRow.has(id));
        const toUpdate = changedIds.filter(id => idsWithRow.has(id));

        if (toCreate.length > 0) {
          await tx.contactSubscription.createMany({
            data: toCreate.map(contactId => ({
              contactId,
              topicId,
              status: targetStatus,
              source,
              subscribedAt: targetStatus === SubscriptionStatus.SUBSCRIBED ? now : null,
              unsubscribedAt: targetStatus === SubscriptionStatus.UNSUBSCRIBED ? now : null,
            })),
            skipDuplicates: true,
          });
        }
        if (toUpdate.length > 0) {
          await tx.contactSubscription.updateMany({
            where: {topicId, contactId: {in: toUpdate}},
            data: {
              status: targetStatus,
              source,
              ...(targetStatus === SubscriptionStatus.SUBSCRIBED ? {subscribedAt: now} : {unsubscribedAt: now}),
            },
          });
        }
      }

      await TopicService.recomputeSubscribedForContacts(tx, projectId, changedIds);
    });

    // Fire subscription events for changed contacts (fire-and-forget, mirrors
    // ContactService.bulkSubscribe). Non-blocking so a slow event stream doesn't
    // stall the bulk job.
    const eventName = targetStatus === SubscriptionStatus.SUBSCRIBED ? 'contact.subscribed' : 'contact.unsubscribed';
    TopicService.trackEventsSequentially(projectId, eventName, changedIds, topic.key).catch(error => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[TopicService] Failed to track bulk subscription events:', error);
      }
    });

    return {updated: changedIds.length, unchanged};
  }

  /**
   * Set every non-transactional (marketing) topic for a single contact to the
   * given status. This is the topic-aware implementation of the legacy global
   * subscribe/unsubscribe: it maps "unsubscribe" to opting out of all marketing
   * topics (leaving transactional untouched) and keeps `subscribed` materialized.
   *
   * Emits a single global `contact.subscribed`/`contact.unsubscribed` event when
   * the materialized flag flips (matching legacy semantics), unless
   * `options.emitEvent` is false — callers that emit their own richer event (e.g.
   * bounce/complaint with a reason) pass false to avoid duplicates.
   *
   * @returns whether the materialized `subscribed` flag changed.
   */
  public static async setAllMarketingSubscriptions(
    contactId: string,
    targetStatus: SubscriptionStatus,
    source: string,
    options?: {emitEvent?: boolean},
  ): Promise<{changed: boolean; subscribed: boolean}> {
    const emitEvent = options?.emitEvent ?? true;
    const now = new Date();

    const contact = await prisma.contact.findUnique({
      where: {id: contactId},
      select: {id: true, projectId: true, subscribed: true},
    });
    if (!contact) {
      throw new HttpException(404, 'Contact not found');
    }
    const {projectId} = contact;
    const wasSubscribed = contact.subscribed;

    await prisma.$transaction(async tx => {
      const topics = await tx.topic.findMany({
        where: {projectId, transactional: false},
        select: {id: true, defaultSubscribed: true},
      });

      for (const topic of topics) {
        const defaultStatus = topic.defaultSubscribed ? SubscriptionStatus.SUBSCRIBED : SubscriptionStatus.UNSUBSCRIBED;
        if (targetStatus === defaultStatus) {
          await tx.contactSubscription.deleteMany({where: {contactId, topicId: topic.id}});
        } else {
          await tx.contactSubscription.upsert({
            where: {contactId_topicId: {contactId, topicId: topic.id}},
            create: {
              contactId,
              topicId: topic.id,
              status: targetStatus,
              source,
              subscribedAt: targetStatus === SubscriptionStatus.SUBSCRIBED ? now : null,
              unsubscribedAt: targetStatus === SubscriptionStatus.UNSUBSCRIBED ? now : null,
            },
            update: {
              status: targetStatus,
              source,
              ...(targetStatus === SubscriptionStatus.SUBSCRIBED ? {subscribedAt: now} : {unsubscribedAt: now}),
            },
          });
        }
      }

      await TopicService.recomputeSubscribedForContacts(tx, projectId, [contactId]);
    });

    const isSubscribed = targetStatus === SubscriptionStatus.SUBSCRIBED;
    const changed = isSubscribed !== wasSubscribed;

    if (changed && emitEvent) {
      await EventService.trackEvent(
        projectId,
        isSubscribed ? 'contact.subscribed' : 'contact.unsubscribed',
        contactId,
      );
    }

    return {changed, subscribed: isSubscribed};
  }

  /**
   * Bulk variant of {@link setAllMarketingSubscriptions}: set every marketing
   * topic to the given status for a batch of contacts. Used by the legacy bulk
   * subscribe/unsubscribe operations ("Mark/Remove from marketing").
   *
   * `updated` = contacts whose materialized `subscribed` flag flipped;
   * `unchanged` = contacts already in the target state.
   */
  public static async bulkSetAllMarketing(
    projectId: string,
    contactIds: string[],
    targetStatus: SubscriptionStatus,
    source: string,
  ): Promise<{updated: number; unchanged: number}> {
    if (contactIds.length === 0) {
      return {updated: 0, unchanged: 0};
    }

    const now = new Date();
    const contacts = await prisma.contact.findMany({
      where: {id: {in: contactIds}, projectId},
      select: {id: true, subscribed: true},
    });
    const validIds = contacts.map(c => c.id);
    if (validIds.length === 0) {
      return {updated: 0, unchanged: 0};
    }
    const wasSubscribed = new Map(contacts.map(c => [c.id, c.subscribed]));

    const topics = await prisma.topic.findMany({
      where: {projectId, transactional: false},
      select: {id: true, defaultSubscribed: true},
    });

    await prisma.$transaction(async tx => {
      for (const topic of topics) {
        const defaultStatus = topic.defaultSubscribed ? SubscriptionStatus.SUBSCRIBED : SubscriptionStatus.UNSUBSCRIBED;
        if (targetStatus === defaultStatus) {
          await tx.contactSubscription.deleteMany({where: {topicId: topic.id, contactId: {in: validIds}}});
        } else {
          const existing = await tx.contactSubscription.findMany({
            where: {topicId: topic.id, contactId: {in: validIds}},
            select: {contactId: true},
          });
          const has = new Set(existing.map(e => e.contactId));
          const toCreate = validIds.filter(id => !has.has(id));
          if (toCreate.length > 0) {
            await tx.contactSubscription.createMany({
              data: toCreate.map(contactId => ({
                contactId,
                topicId: topic.id,
                status: targetStatus,
                source,
                subscribedAt: targetStatus === SubscriptionStatus.SUBSCRIBED ? now : null,
                unsubscribedAt: targetStatus === SubscriptionStatus.UNSUBSCRIBED ? now : null,
              })),
              skipDuplicates: true,
            });
          }
          if (has.size > 0) {
            await tx.contactSubscription.updateMany({
              where: {topicId: topic.id, contactId: {in: [...has]}},
              data: {
                status: targetStatus,
                source,
                ...(targetStatus === SubscriptionStatus.SUBSCRIBED ? {subscribedAt: now} : {unsubscribedAt: now}),
              },
            });
          }
        }
      }

      await TopicService.recomputeSubscribedForContacts(tx, projectId, validIds);
    });

    // Contacts whose flag flipped to the target state.
    const isSubscribed = targetStatus === SubscriptionStatus.SUBSCRIBED;
    const changedIds = validIds.filter(id => wasSubscribed.get(id) !== isSubscribed);
    const unchanged = validIds.length - changedIds.length;

    const eventName = isSubscribed ? 'contact.subscribed' : 'contact.unsubscribed';
    TopicService.trackEventsSequentially(projectId, eventName, changedIds).catch(error => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[TopicService] Failed to track bulk marketing events:', error);
      }
    });

    return {updated: changedIds.length, unchanged};
  }

  /**
   * Recompute and persist `Contact.subscribed` for a set of contacts in one
   * set-based UPDATE. subscribed = the contact is effectively subscribed to at
   * least one non-transactional (marketing) topic, where "effective" merges the
   * deviation row with the topic default.
   */
  private static async recomputeSubscribedForContacts(
    tx: Prisma.TransactionClient,
    projectId: string,
    contactIds: string[],
  ): Promise<void> {
    if (contactIds.length === 0) {
      return;
    }
    await tx.$executeRaw`
      UPDATE "contacts" c
      SET "subscribed" = EXISTS (
        SELECT 1
        FROM "topics" t
        LEFT JOIN "contact_subscriptions" cs
          ON cs."topicId" = t."id" AND cs."contactId" = c."id"
        WHERE t."projectId" = ${projectId}
          AND t."transactional" = false
          AND COALESCE(
                cs."status",
                CASE WHEN t."defaultSubscribed" THEN 'SUBSCRIBED'::"SubscriptionStatus" ELSE 'UNSUBSCRIBED'::"SubscriptionStatus" END
              ) = 'SUBSCRIBED'
      )
      WHERE c."projectId" = ${projectId}
        AND c."id" IN (${Prisma.join(contactIds)})
    `;
  }

  /**
   * Track events one at a time to avoid write contention, tolerating individual
   * failures. Mirrors ContactService.trackEventsSequentially.
   */
  private static async trackEventsSequentially(
    projectId: string,
    eventName: string,
    contactIds: string[],
    topicKey?: string,
  ): Promise<void> {
    for (const contactId of contactIds) {
      try {
        await EventService.trackEvent(projectId, eventName, contactId, undefined, topicKey ? {topic: topicKey} : undefined);
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error(`[TopicService] Failed to track ${eventName} for contact ${contactId}:`, error);
        }
      }
    }
  }
}
