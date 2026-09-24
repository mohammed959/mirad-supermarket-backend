-- Cloudinary image audit for the admin "missing images" export.
--
-- NOTE: the auto-generated diff also proposed
-- `DROP INDEX users_mobileActive_key ON users;` — a false positive
-- (users.mobileActive is `Unsupported` in schema.prisma, so the differ can't
-- see it). Deliberately NOT included: dropping it would allow duplicate
-- active accounts per phone number again.

-- AlterTable
ALTER TABLE `products` ADD COLUMN `imageCheckedAt` DATETIME(3) NULL,
    ADD COLUMN `imageFound` BOOLEAN NULL;
