-- AlterTable
ALTER TABLE `products` ADD COLUMN `hideFromHome` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `products_hideFromHome_idx` ON `products`(`hideFromHome`);
