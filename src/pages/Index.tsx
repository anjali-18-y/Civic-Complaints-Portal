import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Clock, MapPin, LogOut, LayoutDashboard } from "lucide-react";
import heroImage from "@/assets/hero-civic.jpg";

const Index = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [userReports, setUserReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      fetchUserReports();
    }
  }, [user]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    
    if (user) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      
      setIsAdmin(roles?.some(r => r.role === "admin" || r.role === "staff") || false);
    }
    setLoading(false);
  };

  const fetchUserReports = async () => {
    if (!user) return;
    
    const { data } = await supabase
      .from("reports")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);
    
    setUserReports(data || []);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setUserReports([]);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "resolved": return <CheckCircle className="h-5 w-5 text-success" />;
      case "in_progress": return <Clock className="h-5 w-5 text-info" />;
      default: return <AlertCircle className="h-5 w-5 text-warning" />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold">Civic Connect</h1>
          <div className="flex items-center gap-4">
            {user && isAdmin && (
              <Button
                variant="secondary"
                onClick={() => navigate("/dashboard")}
              >
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Admin Dashboard
              </Button>
            )}
            {user ? (
              <Button variant="secondary" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => navigate("/auth")}>
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative h-[500px] overflow-hidden">
        <img
          src={heroImage}
          alt="Citizens engaging with civic platform"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-primary/90 to-primary/60 flex items-center">
          <div className="max-w-7xl mx-auto px-4 text-primary-foreground">
            <h2 className="text-5xl font-bold mb-4">
              Building Better Communities Together
            </h2>
            <p className="text-xl mb-8 max-w-2xl">
              Report civic issues, track their progress, and help local government respond faster to community needs
            </p>
            {user ? (
              <Button
                size="lg"
                variant="secondary"
                onClick={() => navigate("/report")}
                className="text-lg px-8"
              >
                Report an Issue
              </Button>
            ) : (
              <Button
                size="lg"
                variant="secondary"
                onClick={() => navigate("/auth")}
                className="text-lg px-8"
              >
                Get Started
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-12">
        {user ? (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-bold">Your Reports</h2>
              <Button onClick={() => navigate("/report")}>
                <MapPin className="mr-2 h-4 w-4" />
                New Report
              </Button>
            </div>

            {userReports.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <MapPin className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-xl text-muted-foreground mb-4">
                    You haven't submitted any reports yet
                  </p>
                  <Button onClick={() => navigate("/report")}>
                    Submit Your First Report
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {userReports.map((report) => (
                  <Card key={report.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-lg">{report.title}</CardTitle>
                        {getStatusIcon(report.status)}
                      </div>
                      <CardDescription className="line-clamp-2">
                        {report.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {report.category}
                          </Badge>
                          <Badge className="capitalize">
                            {report.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {new Date(report.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-3">
            <Card>
              <CardHeader>
                <AlertCircle className="h-10 w-10 mb-2 text-primary" />
                <CardTitle>Report Issues</CardTitle>
                <CardDescription>
                  Easily report potholes, broken streetlights, and other civic issues with photos and location
                </CardDescription>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader>
                <Clock className="h-10 w-10 mb-2 text-secondary" />
                <CardTitle>Track Progress</CardTitle>
                <CardDescription>
                  Follow your reports from submission to resolution with real-time status updates
                </CardDescription>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader>
                <CheckCircle className="h-10 w-10 mb-2 text-success" />
                <CardTitle>See Results</CardTitle>
                <CardDescription>
                  Watch as your community improves through collaborative civic engagement
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-primary text-primary-foreground mt-20">
        <div className="max-w-7xl mx-auto px-4 py-8 text-center">
          <p>© 2024 Civic Connect. Empowering communities through technology.</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;