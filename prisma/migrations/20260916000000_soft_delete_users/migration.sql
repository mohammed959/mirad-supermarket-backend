-- Soft-delete support for customer accounts + active-only phone uniqueness.
--
-- MySQL has no native partial/filtered unique index, so `mobileActive` is a
-- STORED generated column that collapses to NULL once `deletedAt` is set.
-- MySQL's UNIQUE index treats multiple NULLs as distinct rows, so any number
-- of soft-deleted accounts may keep sharing the same `mobile`, while at most
-- one row with `deletedAt IS NULL` may ever hold a given `mobile` value.

-- DropIndex
DROP INDEX `users_mobile_key` ON `users`;

-- AlterTable
ALTER TABLE `users`
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `mobileActive` VARCHAR(191)
    GENERATED ALWAYS AS (CASE WHEN `deletedAt` IS NULL THEN `mobile` ELSE NULL END) STORED;

-- CreateIndex (composite — fast "active account by mobile" lookups)
CREATE INDEX `users_mobile_deletedAt_idx` ON `users`(`mobile`, `deletedAt`);

-- CreateIndex (the actual uniqueness enforcement — active accounts only)
CREATE UNIQUE INDEX `users_mobileActive_key` ON `users`(`mobileActive`);
