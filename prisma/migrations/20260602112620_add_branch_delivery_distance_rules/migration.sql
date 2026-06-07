-- AlterTable
ALTER TABLE `delivery_pricing_settings` ADD COLUMN `deliveryEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `distanceRulesEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `maxDeliveryKm` DECIMAL(6, 2) NULL;

-- CreateTable
CREATE TABLE `delivery_distance_rules` (
    `id` VARCHAR(191) NOT NULL,
    `minKm` DECIMAL(6, 2) NOT NULL,
    `maxKm` DECIMAL(6, 2) NULL,
    `fee` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `outOfService` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `delivery_distance_rules_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
