import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listReports from "./tools/list-reports";
import getReport from "./tools/get-report";
import createReport from "./tools/create-report";
import updateReportStatus from "./tools/update-report-status";

// The OAuth issuer MUST be the direct Supabase host built from the project ref
// (VITE_SUPABASE_URL on Lovable Cloud is the .lovable.cloud proxy and would
// mismatch the discovery-document issuer). VITE_SUPABASE_PROJECT_ID is inlined
// by Vite at build time so this stays import-safe. The fallback keeps the URL
// well-formed during the throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "civic-connect-mcp",
  title: "Civic Connect",
  version: "0.1.0",
  instructions:
    "Tools for Civic Connect, a civic issue reporting platform. Use `list_reports` to browse reports the signed-in user can see, `get_report` for a single report by id, `create_report` to submit a new civic issue, and `update_report_status` (admin/staff only) to move a report through pending → in_progress → resolved/rejected.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listReports, getReport, createReport, updateReportStatus],
});