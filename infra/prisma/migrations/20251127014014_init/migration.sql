/*
  Warnings:

  - Changed the type of `oldRole` on the `AdminRoleHistory` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `newRole` on the `AdminRoleHistory` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "public"."AdminRoleHistory" DROP COLUMN "oldRole",
ADD COLUMN     "oldRole" "public"."AdminRole" NOT NULL,
DROP COLUMN "newRole",
ADD COLUMN     "newRole" "public"."AdminRole" NOT NULL;
