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
  name: "update_report_status",
  title: "Update report status",
  description:
    "Update the status of a civic report. Restricted to admin/staff users; row-level security enforces this on the server.",
  inputSchema: {
    id: z.string().uuid().describe("The report id to update."),
    status: z
      .enum(["pending", "in_progress", "resolved", "rejected"])
      .describe("The new status for the report."),
    assigned_department: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe("Optional department to assign this report to."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, status, assigned_department }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const client = supabaseForUser(ctx);

    // Verify caller has admin/staff role before attempting the update.
    const { data: roles, error: rolesError } = await client
      .from("user_roles")
      .select("role")
      .eq("user_id", ctx.getUserId());
    if (rolesError) return { content: [{ type: "text", text: rolesError.message }], isError: true };
    const isAdmin = (roles ?? []).some((r) => r.role === "admin" || r.role === "staff");
    if (!isAdmin) {
      return {
        content: [{ type: "text", text: "Only admin or staff users can update report status." }],
        isError: true,
      };
    }

    const update: Record<string, unknown> = { status };
    if (assigned_department !== undefined) update.assigned_department = assigned_department;

    const { data, error } = await client
      .from("reports")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Report ${id} updated to ${status}.` }],
      structuredContent: { report: data },
    };
  },
});