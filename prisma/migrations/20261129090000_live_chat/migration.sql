-- Storefront live chat (person A): conversations from the chat widget and their messages. Chat is for signed-in
-- customers only. A thread starts with the assistant (status bot), is handed to staff (waiting), taken by a staff member (open) and closed.
-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'bot',
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerSeenAt" TIMESTAMP(3),
    "staffSeenAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" SERIAL NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "staffId" TEXT,
    "by" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatThread_status_updatedAt_idx" ON "ChatThread"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatThread_customerId_idx" ON "ChatThread"("customerId");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_id_idx" ON "ChatMessage"("threadId", "id");

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- New back-office menu "chat" (แชทลูกค้า) for existing Admin, Manager and Store Keeper accounts, matching ROLE_PERMS in src/lib/domain.ts.
UPDATE "User" SET "perms" = array_append("perms", 'chat')
WHERE "role" IN ('admin', 'manager', 'storekeeper') AND NOT ('chat' = ANY("perms"));
