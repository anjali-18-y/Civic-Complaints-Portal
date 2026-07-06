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
  name: "create_report",
  title: "Submit a civic report",
  description:
    "Submit a new civic issue report (pothole, streetlight, trash, etc.) as the signed-in user. Optionally include latitude/longitude and an address.",
  inputSchema: {
    title: z.string().trim().min(5).max(100).describe("Short title for the issue."),
    description: z.string().trim().min(10).max(1000).describe("Details about the issue."),
    category: z
      .enum(["pothole", "streetlight", "trash", "graffiti", "sidewalk", "drainage", "other"])
      .describe("Issue category."),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority (default medium)."),
    latitude: z.number().min(-90).max(90).optional().describe("Latitude of the issue location."),
    longitude: z.number().min(-180).max(180).optional().describe("Longitude of the issue location."),
    address: z.string().trim().max(300).optional().describe("Human-readable address."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ title, description, category, priority, latitude, longitude, address }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("reports")
      .insert({
        user_id: ctx.getUserId(),
        title,
        description,
        category,
        priority: priority ?? "medium",
        latitude,
        longitude,
        address,
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Report created (id ${data.id}).` }],
      structuredContent: { report: data },
    };
  },
});