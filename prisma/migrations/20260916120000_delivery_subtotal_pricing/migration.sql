-- Subtotal-based delivery pricing (replaces distance-based fee).
--
-- NOTE: the auto-generated diff for this change also proposed
-- `DROP INDEX users_mobileActive_key ON users;` — that index is the
-- active-account partial-uniqueness constraint from a prior migration
-- (users.mobileActive is declared `Unsupported` in schema.prisma, so the
-- differ can't see it and thinks it's stray). That line is deliberately
-- NOT included here — dropping it would silently allow duplicate active
-- accounts per phone number again.

-- AlterTable
ALTER TABLE `checkout_sessions` ADD COLUMN `baseDeliveryFee` DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `deliveryPricingSnapshot` JSON NULL;

-- CreateTable
CREATE TABLE `delivery_subtotal_pricing_settings` (
    `id` VARCHAR(191) NOT NULL,
    `freeDeliveryThreshold` DECIMAL(10, 2) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_subtotal_ranges` (
    `id` VARCHAR(191) NOT NULL,
    `minSubtotal` DECIMAL(10, 2) NOT NULL,
    `maxSubtotal` DECIMAL(10, 2) NOT NULL,
    `deliveryFee` DECIMAL(10, 2) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `delivery_subtotal_ranges_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
