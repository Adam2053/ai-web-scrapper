CREATE TYPE "public"."task_status" AS ENUM('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"question" text NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"answer" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
