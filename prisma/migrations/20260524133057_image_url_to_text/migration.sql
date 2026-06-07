-- AlterTable
ALTER TABLE `banners` MODIFY `imageUrl` TEXT NOT NULL,
    MODIFY `linkValue` TEXT NULL;

-- AlterTable
ALTER TABLE `categories` MODIFY `imageUrl` TEXT NULL;

-- AlterTable
ALTER TABLE `products` MODIFY `imageUrl` TEXT NULL;

-- AlterTable
ALTER TABLE `subcategories` MODIFY `imageUrl` TEXT NULL;
