-- CreateTable
CREATE TABLE `pickup_settings` (
  `id`                  VARCHAR(191) NOT NULL,
  `futurePickupEnabled` BOOLEAN      NOT NULL DEFAULT false,
  `maxReservationDays`  INT          NOT NULL DEFAULT 0,
  `cutoffTime`          VARCHAR(191) NULL,
  `createdAt`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pickup_time_slots` (
  `id`        VARCHAR(191) NOT NULL,
  `label`     VARCHAR(191) NOT NULL,
  `startTime` VARCHAR(191) NOT NULL,
  `endTime`   VARCHAR(191) NOT NULL,
  `capacity`  INT          NOT NULL DEFAULT 20,
  `isActive`  BOOLEAN      NOT NULL DEFAULT true,
  `sortOrder` INT          NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `pickup_time_slots_isActive_idx` (`isActive`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: Order — add scheduled pickup columns
ALTER TABLE `orders`
  ADD COLUMN `pickupType`               ENUM('ASAP','SCHEDULED') NULL DEFAULT 'ASAP',
  ADD COLUMN `scheduledPickupDate`      DATETIME(3) NULL,
  ADD COLUMN `scheduledPickupStartTime` VARCHAR(191) NULL,
  ADD COLUMN `scheduledPickupEndTime`   VARCHAR(191) NULL,
  ADD COLUMN `scheduledPickupSlotId`    VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `orders`
  ADD CONSTRAINT `orders_scheduledPickupSlotId_fkey`
  FOREIGN KEY (`scheduledPickupSlotId`)
  REFERENCES `pickup_time_slots`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX `orders_scheduledPickupDate_idx`   ON `orders`(`scheduledPickupDate`);
CREATE INDEX `orders_scheduledPickupSlotId_idx` ON `orders`(`scheduledPickupSlotId`);
