import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Camera, MapPin, ArrowLeft } from "lucide-react";
import { z } from "zod";

const reportSchema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(100, "Title must be less than 100 characters"),
  description: z.string().trim().min(10, "Description must be at least 10 characters").max(1000, "Description must be less than 1000 characters"),
  category: z.enum(["pothole", "streetlight", "trash", "graffiti", "sidewalk", "drainage", "other"], {
    errorMap: () => ({ message: "Please select a valid category" })
  }),
  priority: z.enum(["low", "medium", "high", "urgent"]),
});

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const ReportIssue = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("medium");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        navigate("/auth");
      } else {
        setUser(user);
      }
    });
  }, [navigate]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        toast.error("Please upload a valid image file (JPEG, PNG, or WebP)");
        e.target.value = "";
        return;
      }
      
      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        toast.error("Image size must be less than 5MB");
        e.target.value = "";
        return;
      }
      
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const getLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          toast.success("Location captured");
        },
        () => {
          toast.error("Could not get location");
        }
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    // Validate form inputs
    try {
      reportSchema.parse({
        title,
        description,
        category,
        priority,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }
    
    setLoading(true);
    try {
      let imageUrl = null;
      
      if (imageFile) {
        const fileExt = imageFile.name.split(".").pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("reports")
          .upload(fileName, imageFile);

        if (uploadError) throw uploadError;
        
        // Store only the filename - signed URLs will be generated when displaying
        imageUrl = fileName;
      }

      const { error } = await supabase.from("reports").insert({
        title,
        description,
        category: category as "pothole" | "streetlight" | "trash" | "graffiti" | "sidewalk" | "drainage" | "other",
        priority: priority as "low" | "medium" | "high" | "urgent",
        latitude: location?.lat,
        longitude: location?.lng,
        image_url: imageUrl,
        user_id: user.id,
      });

      if (error) throw error;
      
      toast.success("Report submitted successfully");
      navigate("/");
    } catch (error: any) {
      toast.error("An error occurred while submitting the report. Please try again.");
      console.error("Report submission error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted p-4">
      <div className="max-w-2xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        
        <Card>
          <CardHeader>
            <CardTitle>Report an Issue</CardTitle>
            <CardDescription>
              Help improve your community by reporting issues you encounter
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Issue Title</Label>
                <Input
                  id="title"
                  placeholder="Brief description"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select value={category} onValueChange={setCategory} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pothole">Pothole</SelectItem>
                    <SelectItem value="streetlight">Streetlight</SelectItem>
                    <SelectItem value="trash">Trash/Litter</SelectItem>
                    <SelectItem value="graffiti">Graffiti</SelectItem>
                    <SelectItem value="sidewalk">Sidewalk</SelectItem>
                    <SelectItem value="drainage">Drainage</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Provide details about the issue"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label>Photo</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById("image-upload")?.click()}
                    className="flex-1"
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    {imageFile ? "Change Photo" : "Add Photo"}
                  </Button>
                  <input
                    id="image-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </div>
                {imagePreview && (
                  <img src={imagePreview} alt="Preview" className="mt-2 rounded-lg w-full max-h-64 object-cover" />
                )}
              </div>

              <div className="space-y-2">
                <Label>Location</Label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={getLocation}
                  className="w-full"
                >
                  <MapPin className="mr-2 h-4 w-4" />
                  {location ? "Location Captured" : "Capture Location"}
                </Button>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Submitting..." : "Submit Report"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ReportIssue;