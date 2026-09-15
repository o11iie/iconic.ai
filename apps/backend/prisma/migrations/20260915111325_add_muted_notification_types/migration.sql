-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mutedNotificationTypes" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[];
