-- Add new columns to User table
ALTER TABLE "User" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "onboarding_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint

-- Backfill: set customer_id from Customer.user_id for owners
UPDATE "User" SET "customer_id" = "Customer"."id"
  FROM "Customer"
  WHERE "User"."id" = "Customer"."user_id";--> statement-breakpoint

-- Backfill: set customer_id from CustomerMember for invited members
UPDATE "User" SET "customer_id" = "CustomerMember"."customer_id"
  FROM "CustomerMember"
  WHERE "User"."id" = "CustomerMember"."user_id"
    AND "User"."customer_id" IS NULL;--> statement-breakpoint

-- Backfill: set onboarding_completed from Customer for owners
UPDATE "User" SET
  "onboarding_completed" = "Customer"."onboarding_completed",
  "onboarding_completed_at" = "Customer"."onboarding_completed_at"
  FROM "Customer"
  WHERE "User"."id" = "Customer"."user_id";--> statement-breakpoint

-- Backfill: set onboarding_completed from CustomerMember for invited members
UPDATE "User" SET
  "onboarding_completed" = "CustomerMember"."onboarding_completed",
  "onboarding_completed_at" = "CustomerMember"."onboarding_completed_at"
  FROM "CustomerMember"
  WHERE "User"."id" = "CustomerMember"."user_id";--> statement-breakpoint

-- Add FK constraint
ALTER TABLE "User" ADD CONSTRAINT "User_customer_id_Customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."Customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Drop CustomerMember table
DROP TABLE "CustomerMember";
