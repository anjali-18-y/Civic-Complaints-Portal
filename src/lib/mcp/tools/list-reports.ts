import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_reports",
  title: "List civic reports",
  description:
    "List civic reports visible to the signed-in user. Regular users see their own reports; admins and staff see all. Optionally filter by status and category.",
  inputSchema: {
    status: z
      .enum(["pending", "in_progress", "resolved", "rejected"])
      .optional()
      .describe("Only return reports with this status."),
    category: z
      .enum(["pothole", "streetlight", "trash", "graffiti", "sidewalk", "drainage", "other"])
      .optional()
      .describe("Only return reports with this category."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, category, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const client = supabaseForUser(ctx);
    let query = client
      .from("reports")
      .select("id, title, description, category, status, priority, latitude, longitude, address, created_at, updated_at, user_id, assigned_department")
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (status) query = query.eq("status", status);
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { reports: data ?? [] },
    };
  },
});