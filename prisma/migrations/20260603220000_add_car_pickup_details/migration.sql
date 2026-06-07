-- AlterTable
ALTER TABLE `orders`
  ADD COLUMN `carPlateNumber`     VARCHAR(191) NULL,
  ADD COLUMN `carBrand`           VARCHAR(191) NULL,
  ADD COLUMN `carColor`           VARCHAR(191) NULL,
  ADD COLUMN `pickupCustomerNote` TEXT NULL;

-- CreateIndex
CREATE INDEX `orders_carPlateNumber_idx` ON `orders`(`carPlateNumber`);
