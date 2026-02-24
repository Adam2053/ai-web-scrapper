import { Router } from "express";
import { db } from "../lib/db";
import { tasks } from "@internship-project-sbl/db/src/schema";
import { taskQueue } from "../queue/task.queue";
import { eq } from "drizzle-orm";


const router = Router();

router.post("/", async (req, res) => {
  try {
    const { url, question } = req.body;

    if (!url || !question) {
      return res.status(400).json({ error: "URL and question are required" });
    }

    // Inserting in Database
    const [newTask] = await db
      .insert(tasks)
      .values({
        url,
        question,
        status: "queued",
      })
      .returning();

    // Adding job to the queue
    await taskQueue.add("process-task", {
      taskId: newTask.id,
      url,
      question,
    });

    return res.status(201).json({ taskId: newTask.id, status: newTask.status });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, id),
    });

    if (!task) {
        return res.status(404).json({ error: "Task not found" });
    }

    return res.json({
        id: task.id,
        status: task.status,
        answer: task.answer,
        error: task.error, 
    })
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
