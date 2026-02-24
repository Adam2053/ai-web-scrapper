import { Worker } from "bullmq";
import { redis } from "../redis";
import { processTask } from "../services/task.processor";

export const taskWorker = new Worker(
  "task-queue",
  async (job) => {
    await processTask(job.data);
  },
  {
    connection: redis,
  },
);

taskWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

taskWorker.on("failed", (job, err) => {
  console.log(`Job ${job?.id} failed due to ${err}`);
});
