-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "showOnShop" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT 'cobalt',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionItem" (
    "promotionId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "salePrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PromotionItem_pkey" PRIMARY KEY ("promotionId","sku")
);

-- CreateIndex
CREATE INDEX "Promotion_kind_active_endsAt_idx" ON "Promotion"("kind", "active", "endsAt");

-- CreateIndex
CREATE INDEX "PromotionItem_sku_idx" ON "PromotionItem"("sku");

-- AddForeignKey
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_sku_fkey" FOREIGN KEY ("sku") REFERENCES "InventoryItem"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A sale price is a real price, and a promotion ends after it starts
ALTER TABLE "PromotionItem" ADD CONSTRAINT "PromotionItem_salePrice_check" CHECK ("salePrice" > 0);
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_period_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_kind_check" CHECK ("kind" IN ('flash', 'banner'));
