-- Fixed custom fields applied to every row of an import (the "valor fijo para todo
-- el archivo" step). Nullable JSON, no backfill needed.
ALTER TABLE "contact_imports" ADD COLUMN "constants" JSONB;
