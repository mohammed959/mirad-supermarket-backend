-- Admin-configured contact numbers (phone + WhatsApp), surfaced publicly
-- via GET /contact-us.
--
-- NOTE: the auto-generated diff for this change also proposed
-- `DROP INDEX users_mobileActive_key ON users;` — that index is the
-- active-account partial-uniqueness constraint from a prior migration
-- (users.mobileActive is declared `Unsupported` in schema.prisma, so the
-- differ can't see it and thinks it's stray). That line is deliberately
-- NOT included here — dropping it would silently allow duplicate active
-- accounts per phone number again.

-- CreateTable
CREATE TABLE `contact_settings` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `whatsapp` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
