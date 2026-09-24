import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";

type Report = {
  id: string; title: string; category: string; priority: string; status: string;
  assigned_department: string | null; created_at: string; resolved_at: string | null;
  first_response_at: string | null; quality_flags: string[]; is_duplicate: boolean;
};
type History = { report_id: string; old_status: string | null; new_status: string; changed_at: string };
type EtlRun = {
  id: string; started_at: string; rows_read: number; rows_loaded: number;
  rows_rejected: number; rows_flagged: number;
};

const FLAG_LABELS: Record<string, string> = {
  duplicate: "Duplicate complaint",
  invalid_location: "Invalid location",
  missing_location: "Missing location",
  location_outside_india: "Location outside India",
  invalid_date: "Invalid date",
  missing_category: "Missing category",
  missing_priority: "Missing priority",
  priority_escalated: "Priority auto-escalated",
};

const hours = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 36e5;
const fmtH = (h: number | null) => (h == null ? "—" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 12 };

const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <Card>
    <CardContent className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </CardContent>
  </Card>
);

const Analytics = () => {
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [runs, setRuns] = useState<EtlRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return navigate("/auth");
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      if (!roles?.some((r) => r.role === "admin" || r.role === "staff")) {
        setDenied(true); setLoading(false); return;
      }
      const [r, h, e] = await Promise.all([
        supabase.from("reports").select("id,title,category,priority,status,assigned_department,created_at,resolved_at,first_response_at,quality_flags,is_duplicate").order("created_at", { ascending: false }),
        supabase.from("report_status_history").select("report_id,old_status,new_status,changed_at").order("changed_at", { ascending: false }).limit(200),
        supabase.from("etl_runs").select("id,started_at,rows_read,rows_loaded,rows_rejected,rows_flagged").order("started_at", { ascending: false }).limit(10),
      ]);
      setReports((r.data as Report[]) ?? []);
      setHistory((h.data as History[]) ?? []);
      setRuns((e.data as EtlRun[]) ?? []);
      setLoading(false);
    })();
  }, [navigate]);

  const m = useMemo(() => {
    const total = reports.length;
    const flagged = reports.filter((r) => r.quality_flags?.length).length;
    const dups = reports.filter((r) => r.is_duplicate).length;
    const flagCounts: Record<string, number> = {};
    reports.forEach((r) => r.quality_flags?.forEach((f) => (flagCounts[f] = (flagCounts[f] ?? 0) + 1)));

    const resolved = reports.filter((r) => r.resolved_at && r.status === "resolved");
    const avgResolve = avg(resolved.map((r) => hours(r.created_at, r.resolved_at!)));
    const avgResponse = avg(reports.filter((r) => r.first_response_at).map((r) => hours(r.created_at, r.first_response_at!)));

    const depts: Record<string, { name: string; total: number; open: number; resolved: number; times: number[] }> = {};
    reports.forEach((r) => {
      const k = r.assigned_department ?? "Unassigned";
      depts[k] ??= { name: k, total: 0, open: 0, resolved: 0, times: [] };
      depts[k].total++;
      if (r.status === "pending" || r.status === "in_progress") depts[k].open++;
      if (r.status === "resolved") {
        depts[k].resolved++;
        if (r.resolved_at) depts[k].times.push(hours(r.created_at, r.resolved_at));
      }
    });
    const deptRows = Object.values(depts)
      .map((d) => ({ ...d, avgHours: avg(d.times), rate: d.total ? Math.round((d.resolved / d.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);

    const days: Record<string, { day: string; reports: number; resolved: number }> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      days[d] = { day: d.slice(5), reports: 0, resolved: 0 };
    }
    reports.forEach((r) => {
      const d = r.created_at.slice(0, 10);
      if (days[d]) days[d].reports++;
      const rd = r.resolved_at?.slice(0, 10);
      if (rd && days[rd] && r.status === "resolved") days[rd].resolved++;
    });

    const cats: Record<string, Record<string, number | string>> = {};
    reports.forEach((r) => {
      cats[r.category] ??= { category: r.category, low: 0, medium: 0, high: 0, urgent: 0 };
      (cats[r.category][r.priority] as number)++;
    });

    return {
      total, flagged, dups, flagCounts, avgResolve, avgResponse, deptRows,
      daily: Object.values(days), byCategory: Object.values(cats),
      open: reports.filter((r) => r.status === "pending" || r.status === "in_progress").length,
      quality: total ? Math.round(((total - flagged) / total) * 100) : 100,
    };
  }, [reports]);

  const titleById = useMemo(() => Object.fromEntries(reports.map((r) => [r.id, r.title])), [reports]);

  return (
    <div className="min-h-screen bg-muted">
      <div className="bg-primary text-primary-foreground p-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/dashboard")} className="text-primary-foreground hover:bg-primary/90">
            <ArrowLeft className="mr-2 h-4 w-4" /> Dashboard
          </Button>
          <h1 className="text-2xl font-bold">Analytics &amp; Data Quality</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-6">
        {loading ? (
          <p className="text-center text-muted-foreground">Loading…</p>
        ) : denied ? (
          <p className="text-center text-muted-foreground">Analytics are available to admin and staff accounts only.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Total complaints" value={m.total} hint={`${m.open} open`} />
              <Stat label="Data quality score" value={`${m.quality}%`} hint={`${m.flagged} flagged records`} />
              <Stat label="Avg. first response" value={fmtH(m.avgResponse)} />
              <Stat label="Avg. resolution time" value={fmtH(m.avgResolve)} />
            </div>

            <Tabs defaultValue="trends">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="trends">Trends</TabsTrigger>
                <TabsTrigger value="departments">Departments</TabsTrigger>
                <TabsTrigger value="quality">Data quality</TabsTrigger>
                <TabsTrigger value="resolution">Resolution tracking</TabsTrigger>
              </TabsList>

              <TabsContent value="trends" className="space-y-4">
                <Card>
                  <CardHeader><CardTitle>Complaints vs. resolutions (last 30 days)</CardTitle></CardHeader>
                  <CardContent className="h-72">
                    <ResponsiveContainer>
                      <LineChart data={m.daily}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="day" {...axis} />
                        <YAxis allowDecimals={false} {...axis} />
                        <Tooltip /><Legend />
                        <Line type="monotone" dataKey="reports" name="New" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="resolved" name="Resolved" stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Category by priority</CardTitle></CardHeader>
                  <CardContent className="h-72">
                    <ResponsiveContainer>
                      <BarChart data={m.byCategory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="category" {...axis} />
                        <YAxis allowDecimals={false} {...axis} />
                        <Tooltip /><Legend />
                        <Bar dataKey="low" stackId="p" fill="hsl(var(--muted-foreground))" />
                        <Bar dataKey="medium" stackId="p" fill="hsl(var(--primary))" />
                        <Bar dataKey="high" stackId="p" fill="hsl(var(--secondary))" />
                        <Bar dataKey="urgent" stackId="p" fill="hsl(var(--accent))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="departments">
                <Card>
                  <CardHeader>
                    <CardTitle>Department performance</CardTitle>
                    <CardDescription>Complaints are routed automatically by category on ingestion.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Department</TableHead><TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Open</TableHead><TableHead className="text-right">Resolved</TableHead>
                          <TableHead className="text-right">Resolution rate</TableHead><TableHead className="text-right">Avg. time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {m.deptRows.map((d) => (
                          <TableRow key={d.name}>
                            <TableCell className="font-medium">{d.name}</TableCell>
                            <TableCell className="text-right">{d.total}</TableCell>
                            <TableCell className="text-right">{d.open}</TableCell>
                            <TableCell className="text-right">{d.resolved}</TableCell>
                            <TableCell className="text-right">{d.rate}%</TableCell>
                            <TableCell className="text-right">{fmtH(d.avgHours)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="quality" className="space-y-4">
                <div className="grid md:grid-cols-3 gap-4">
                  <Stat label="Clean records" value={m.total - m.flagged} />
                  <Stat label="Flagged records" value={m.flagged} />
                  <Stat label="Duplicates detected" value={m.dups} />
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Validation issues found on ingestion</CardTitle>
                    <CardDescription>Complaints with a missing or too-short description are rejected before they are saved.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {Object.keys(m.flagCounts).length === 0 ? (
                      <p className="text-muted-foreground text-sm">No issues found.</p>
                    ) : (
                      Object.entries(m.flagCounts).sort((a, b) => b[1] - a[1]).map(([f, n]) => (
                        <div key={f} className="flex justify-between border-b border-border py-2 text-sm">
                          <span>{FLAG_LABELS[f] ?? f}</span><Badge variant="secondary">{n}</Badge>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Python ETL runs</CardTitle></CardHeader>
                  <CardContent>
                    {runs.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No ETL batch runs yet.</p>
                    ) : (
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Run</TableHead><TableHead className="text-right">Read</TableHead>
                          <TableHead className="text-right">Loaded</TableHead><TableHead className="text-right">Rejected</TableHead>
                          <TableHead className="text-right">Flagged</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {runs.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell>{new Date(r.started_at).toLocaleString()}</TableCell>
                              <TableCell className="text-right">{r.rows_read}</TableCell>
                              <TableCell className="text-right">{r.rows_loaded}</TableCell>
                              <TableCell className="text-right">{r.rows_rejected}</TableCell>
                              <TableCell className="text-right">{r.rows_flagged}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="resolution">
                <Card>
                  <CardHeader><CardTitle>Recent status changes</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Complaint</TableHead><TableHead>Change</TableHead><TableHead>When</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {history.map((h, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{titleById[h.report_id] ?? "—"}</TableCell>
                            <TableCell>{h.old_status ? `${h.old_status} → ${h.new_status}` : `submitted (${h.new_status})`}</TableCell>
                            <TableCell>{new Date(h.changed_at).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
};

export default Analytics;
