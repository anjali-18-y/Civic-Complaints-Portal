import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Calendar } from "lucide-react";

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => {
    checkAuth();
    fetchReports();
    
    const channel = supabase
      .channel("reports-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reports" },
        () => {
          fetchReports();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }
    setUser(user);
    
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    
    setIsAdmin(roles?.some(r => r.role === "admin" || r.role === "staff") || false);
  };

  const fetchReports = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch reports");
    } else {
      // Generate signed URLs for private images
      const reportsWithSignedUrls = await Promise.all(
        (data || []).map(async (report) => {
          if (report.image_url) {
            const fileName = report.image_url.split('/').pop();
            const { data: signedUrlData } = await supabase.storage
              .from('reports')
              .createSignedUrl(fileName, 3600); // 1 hour expiry
            
            return {
              ...report,
              image_url: signedUrlData?.signedUrl || report.image_url
            };
          }
          return report;
        })
      );
      setReports(reportsWithSignedUrls);
    }
    setLoading(false);
  };

  const updateReportStatus = async (reportId: string, newStatus: "pending" | "in_progress" | "resolved" | "rejected") => {
    const { error } = await supabase
      .from("reports")
      .update({ status: newStatus })
      .eq("id", reportId);

    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success("Status updated");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-warning";
      case "in_progress": return "bg-info";
      case "resolved": return "bg-success";
      case "rejected": return "bg-destructive";
      default: return "bg-muted";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "low": return "bg-muted";
      case "medium": return "bg-info";
      case "high": return "bg-warning";
      case "urgent": return "bg-accent";
      default: return "bg-muted";
    }
  };

  const filteredReports = filterStatus === "all" 
    ? reports 
    : reports.filter(r => r.status === filterStatus);

  return (
    <div className="min-h-screen bg-muted">
      <div className="bg-primary text-primary-foreground p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="text-primary-foreground hover:bg-primary/90"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          </div>
          {isAdmin && (
            <Badge variant="secondary">Admin</Badge>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>All Reports</CardTitle>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-center text-muted-foreground">Loading...</p>
            ) : filteredReports.length === 0 ? (
              <p className="text-center text-muted-foreground">No reports found</p>
            ) : (
              <div className="space-y-4">
                {filteredReports.map((report) => (
                  <Card key={report.id}>
                    <CardContent className="p-4">
                      <div className="flex gap-4">
                        {report.image_url && (
                          <img
                            src={report.image_url}
                            alt={report.title}
                            className="w-32 h-32 object-cover rounded-lg"
                          />
                        )}
                        <div className="flex-1 space-y-2">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-semibold text-lg">{report.title}</h3>
                              <p className="text-sm text-muted-foreground">{report.description}</p>
                            </div>
                            <div className="flex gap-2">
                              <Badge className={getStatusColor(report.status)}>
                                {report.status}
                              </Badge>
                              <Badge className={getPriorityColor(report.priority)}>
                                {report.priority}
                              </Badge>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <span className="capitalize font-medium">{report.category}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              <span>{new Date(report.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                          
                          {report.address && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <MapPin className="h-4 w-4" />
                              <span>{report.address}</span>
                            </div>
                          )}
                          
                          {(report.latitude && report.longitude) && (
                            <div className="text-xs text-muted-foreground">
                              Coordinates: {Number(report.latitude).toFixed(6)}, {Number(report.longitude).toFixed(6)}
                            </div>
                          )}

                          {isAdmin && (
                            <div className="flex gap-2 pt-2">
                              <Select
                                value={report.status}
                                onValueChange={(value) => updateReportStatus(report.id, value as "pending" | "in_progress" | "resolved" | "rejected")}
                              >
                                <SelectTrigger className="w-40">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="pending">Pending</SelectItem>
                                  <SelectItem value="in_progress">In Progress</SelectItem>
                                  <SelectItem value="resolved">Resolved</SelectItem>
                                  <SelectItem value="rejected">Rejected</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;