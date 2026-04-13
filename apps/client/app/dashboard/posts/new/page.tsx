"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useProjects } from "@/lib/api/hooks";
import { ClientContentEditor } from "@/components/editor/ClientContentEditor";
import { PublishDialog } from "@/components/publishing/PublishDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Input } from "@packages/ui";
import { Label } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import { ArrowLeft, Save, Send } from "lucide-react";

/**
 * @component NewPostPage
 * @description Post creation page with content editor, project selection, provider targeting, and publish dialog.
 */
export default function NewPostPage() {
  const router = useRouter();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [locale, setLocale] = useState<"en" | "es">("en");
  const [tags, setTags] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);

  const { data: projectsData } = useProjects();

  const projects = useMemo(() => projectsData?.data || [], [projectsData]);

  // Helper functions
  const handleContentChange = (newContent: string, _charCount: number) => {
    setContent(newContent);
  };

  const handleMediaAdd = (files: File[]) => {
    setMediaFiles((prev) => [...prev, ...files]);
  };

  const parseTagsInput = (tagsString: string): string[] => {
    return tagsString
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  };

  const handlePublishSuccess = (_results: any[]) => {
    router.push("/dashboard/posts");
  };

  const handlePublishError = (_error: Error) => {
    // Error is shown by the PublishingInterface component itself
  };

  // Auto-select first project if only one exists
  useEffect(() => {
    const firstProject = projects[0];
    if (projects.length === 1 && !selectedProject && firstProject) {
      setSelectedProject(firstProject.id);
    }
  }, [projects, selectedProject]);

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <Button variant="ghost" onClick={() => router.back()} className="p-2">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Create New Post</h1>
          <p className="text-muted-foreground">Create content for your social media channels</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          {/* Project Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Post Settings</CardTitle>
              <CardDescription>Configure the basic settings for your post</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project">Project</Label>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {projects.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No projects found. Create a project first to post content.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="locale">Language</Label>
                  <Select value={locale} onValueChange={(value: "en" | "es") => setLocale(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tags">Tags</Label>
                  <Input
                    id="tags"
                    placeholder="tag1, tag2, tag3"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Separate tags with commas</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Content Editor */}
          {selectedProject && (
            <ClientContentEditor
              onContentChange={handleContentChange}
              onMediaAdd={handleMediaAdd}
              projectId={selectedProject}
              locale={locale}
              initialTags={parseTagsInput(tags)}
              showPreview={true}
            />
          )}

          {!selectedProject && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <div className="text-muted-foreground mb-4">
                    Please select a project to start creating your post.
                  </div>
                  {projects.length === 0 && (
                    <Button onClick={() => router.push("/dashboard/projects/new")}>
                      Create New Project
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Publishing Options */}
          <Card>
            <CardHeader>
              <CardTitle>Publishing</CardTitle>
              <CardDescription>Choose how to publish your content</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <PublishDialog
                content={content}
                mediaFiles={mediaFiles}
                selectedProviders={selectedProviders}
                onProvidersChange={setSelectedProviders}
                onPublishSuccess={handlePublishSuccess}
                onPublishError={handlePublishError}
                trigger={
                  <Button className="w-full" disabled={!selectedProject || !content.trim()}>
                    <Send className="mr-2 h-4 w-4" />
                    Publish Now
                  </Button>
                }
              />
              <Button variant="outline" className="w-full" disabled={!selectedProject}>
                <Save className="mr-2 h-4 w-4" />
                Save as Draft
              </Button>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card>
            <CardHeader>
              <CardTitle>Tips for Better Content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm space-y-2">
                <div className="flex items-start space-x-2">
                  <div className="w-1.5 h-1.5 bg-primary rounded-full mt-2 shrink-0"></div>
                  <p>Use engaging visuals to increase engagement</p>
                </div>
                <div className="flex items-start space-x-2">
                  <div className="w-1.5 h-1.5 bg-primary rounded-full mt-2 shrink-0"></div>
                  <p>Ask questions to encourage interaction</p>
                </div>
                <div className="flex items-start space-x-2">
                  <div className="w-1.5 h-1.5 bg-primary rounded-full mt-2 shrink-0"></div>
                  <p>Use relevant hashtags for discoverability</p>
                </div>
                <div className="flex items-start space-x-2">
                  <div className="w-1.5 h-1.5 bg-primary rounded-full mt-2 shrink-0"></div>
                  <p>Post consistently to build your audience</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Analytics Preview */}
          <Card>
            <CardHeader>
              <CardTitle>Expected Performance</CardTitle>
              <CardDescription>Based on your historical data</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Estimated Reach</span>
                  <span className="font-medium text-muted-foreground">Not available</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Expected Engagement</span>
                  <span className="font-medium text-muted-foreground">Not available</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Best Time to Post</span>
                  <span className="font-medium text-muted-foreground">Not available</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
