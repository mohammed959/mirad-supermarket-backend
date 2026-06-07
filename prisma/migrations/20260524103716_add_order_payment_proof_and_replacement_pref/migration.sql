-- AlterTable
ALTER TABLE `orders` ADD COLUMN `paymentProofUrl` VARCHAR(191) NULL,
    ADD COLUMN `replacementPreference` TEXT NULL;
