-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "slot" TEXT NOT NULL DEFAULT 'hero';

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_slot_check" CHECK ("slot" IN ('hero', 'side'));
