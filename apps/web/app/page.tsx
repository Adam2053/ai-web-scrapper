"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

const API_URL = "http://localhost:4000";

export default function Home() {
  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);

  const createTask = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, question }),
      });

      if (!res.ok) throw new Error("Failed to create task");
      return res.json();
    },
    onSuccess: (data) => {
      setTaskId(data.taskId);
    },
  });

  const { data } = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/tasks/${taskId}`);
      if (!res.ok) throw new Error("Failed to fetch task");
      return res.json();
    },
    enabled: !!taskId,
    refetchInterval: (query) =>
      query.state.data?.status === "completed" ||
      query.state.data?.status === "failed"
        ? false
        : 2000,
  });

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col">
      
      {/* Header */}
      <header className="border-b border-gray-700 p-4 text-center text-lg font-semibold">
        AI Website Analyzer
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-4 py-8 flex justify-center">
        <div className="w-full max-w-3xl space-y-6">

          {/* User Message */}
          {question && (
            <div className="flex justify-end">
              <div className="bg-blue-600 px-4 py-3 rounded-2xl max-w-lg shadow-lg">
                <p className="text-sm opacity-70 mb-1">You asked:</p>
                <p>{question}</p>
                <p className="text-xs mt-2 opacity-50 break-all">
                  {url}
                </p>
              </div>
            </div>
          )}

          {/* AI Response */}
          {taskId && (
            <div className="flex justify-start">
              <div className="bg-gray-800 px-4 py-3 rounded-2xl max-w-lg shadow-lg border border-gray-700">
                <p className="text-sm opacity-70 mb-1">
                  {data?.status === "completed"
                    ? "AI Response"
                    : `Status: ${data?.status || "queued..."}`}
                </p>

                {data?.status === "completed" && (
                  <p className="whitespace-pre-line">
                    {data.answer}
                  </p>
                )}

                {data?.status === "processing" && (
                  <p className="animate-pulse opacity-70">
                    Analyzing website...
                  </p>
                )}

                {data?.status === "queued" && (
                  <p className="animate-pulse opacity-70">
                    Added to processing queue...
                  </p>
                )}

                {data?.status === "failed" && (
                  <p className="text-red-400">
                    {data.error}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-700 p-4 bg-[#0f172a]">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">

          <input
            type="text"
            placeholder="Enter website URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full p-3 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Ask a question about the website..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="flex-1 p-3 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <button
              onClick={() => createTask.mutate()}
              disabled={createTask.isPending || !url || !question}
              className="bg-blue-600 hover:bg-blue-700 transition px-6 py-3 rounded-lg font-medium disabled:opacity-50"
            >
              {createTask.isPending ? "..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}