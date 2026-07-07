-- Revert the per-topic subscription model back to the single `contacts.subscribed`
-- boolean. That column already holds each contact's effective marketing state
-- (it was kept materialized), so it is left untouched — only the topic tables and
-- enum are removed.

-- DropTable (child first: contact_subscriptions references topics and contacts)
DROP TABLE IF EXISTS "contact_subscriptions";

-- DropTable
DROP TABLE IF EXISTS "topics";

-- DropEnum
DROP TYPE IF EXISTS "SubscriptionStatus";
