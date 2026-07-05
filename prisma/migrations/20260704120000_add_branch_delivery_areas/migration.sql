-- Replace the single `deliveryPolygon` ring with an array of NAMED coverage
-- areas (`deliveryAreas`). Each entry: { name, nameAr, polygon: [{lat,lng}] }.

-- 1. Add the new column.
ALTER TABLE `branches` ADD COLUMN `deliveryAreas` JSON NULL;

-- 2. Migrate any existing single polygon into a one-element named-area array
--    so no coverage is lost. Untitled areas get a sensible default label.
UPDATE `branches`
SET `deliveryAreas` = JSON_ARRAY(
  JSON_OBJECT('name', 'Main area', 'nameAr', 'المنطقة الرئيسية', 'polygon', `deliveryPolygon`)
)
WHERE `deliveryPolygon` IS NOT NULL;

-- 3. Drop the old column.
ALTER TABLE `branches` DROP COLUMN `deliveryPolygon`;
