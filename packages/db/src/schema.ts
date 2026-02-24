import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

export const taskStatusEnum = pgEnum("task_status", [
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),

  url: text("url").notNull(),
  question: text("question").notNull(),

  status: taskStatusEnum("status").default("queued").notNull(),

  answer: text("answer"),
  error: text("error"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});