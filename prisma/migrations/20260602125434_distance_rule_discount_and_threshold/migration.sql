-- AlterTable
ALTER TABLE `delivery_distance_rules` ADD COLUMN `basketThreshold` DECIMAL(10, 2) NULL,
    ADD COLUMN `discountEndDate` DATETIME(3) NULL,
    ADD COLUMN `discountPercent` DECIMAL(5, 2) NULL,
    ADD COLUMN `discountStartDate` DATETIME(3) NULL,
    ADD COLUMN `feeAboveThreshold` DECIMAL(10, 2) NULL;
