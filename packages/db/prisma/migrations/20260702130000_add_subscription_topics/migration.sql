-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED');

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "transactional" BOOLEAN NOT NULL DEFAULT false,
    "defaultSubscribed" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_subscriptions" (
    "contactId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "source" TEXT,
    "subscribedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_subscriptions_pkey" PRIMARY KEY ("contactId","topicId")
);

-- CreateIndex
CREATE INDEX "topics_projectId_idx" ON "topics"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "topics_projectId_key_key" ON "topics"("projectId", "key");

-- CreateIndex
CREATE INDEX "contact_subscriptions_topicId_status_idx" ON "contact_subscriptions"("topicId", "status");

-- CreateIndex
CREATE INDEX "contact_subscriptions_contactId_idx" ON "contact_subscriptions"("contactId");

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_subscriptions" ADD CONSTRAINT "contact_subscriptions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_subscriptions" ADD CONSTRAINT "contact_subscriptions_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Data backfill
-- ============================================================================
-- Keep these values in sync with DEFAULT_TOPICS in @plunk/shared.

-- Seed the default subscription topics for every existing project.
INSERT INTO "topics" ("id", "key", "name", "description", "transactional", "defaultSubscribed", "position", "projectId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t.key, t.name, t.description, t.transactional, true, t.position, p.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "projects" p
CROSS JOIN (
    VALUES
        ('transactional', 'Transactional', 'Receipts, security alerts and account notifications', true, 0),
        ('product_updates', 'Product updates', 'News about new features and product changes', false, 1),
        ('marketing', 'Marketing', 'Newsletters, offers and promotions', false, 2)
) AS t("key", "name", "description", "transactional", "position");

-- Backfill opt-outs. Contacts that are currently unsubscribed get an explicit
-- UNSUBSCRIBED row on every non-transactional (marketing) topic of their project,
-- so their materialized `contacts.subscribed = false` stays consistent with the
-- new deviation-based model. Currently-subscribed contacts need no rows: they
-- inherit each topic's `defaultSubscribed = true`. The transactional topic is
-- left at its default (everyone stays on it, matching pre-migration behaviour).
INSERT INTO "contact_subscriptions" ("contactId", "topicId", "status", "source", "unsubscribedAt", "createdAt", "updatedAt")
SELECT c.id, t.id, 'UNSUBSCRIBED'::"SubscriptionStatus", 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "contacts" c
JOIN "topics" t ON t."projectId" = c."projectId" AND t."transactional" = false
WHERE c."subscribed" = false;
