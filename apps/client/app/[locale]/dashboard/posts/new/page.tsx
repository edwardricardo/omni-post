"use client";

/**
 * @file page.tsx
 * @description New post page. Hosts the canonical `ClientContentEditor`
 *              which integrates compose, autosave, channel selection,
 *              schedule, and publish in one editor — no separate publish
 *              dialog needed.
 * @component NewPostPage
 * @layer infrastructure
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useProjects } from "@/lib/api/hooks";
import { ClientContentEditor } from "@/components/editor/ClientContentEditor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Input } from "@packages/ui";
import { Label } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import { ArrowLeft } from "lucide-react";

/**
 * @component NewPostPage
 * @description Post creation page with project selection and the
 *   canonical content editor.
 */
export default function NewPostPage() {
  const router = useRouter();
  const t = useTranslations("posts");
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [locale, setLocale] = useState<"en" | "es">("en");
  const [tags, setTags] = useState<string>("");

  const { data: projectsData } = useProjects();
  const projects = useMemo(() => projectsData?.data || [], [projectsData]);

  const parseTagsInput = (tagsString: string): string[] =>
    tagsString
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

  // Auto-select first project if only one exists
  useEffect(() => {
    const firstProject = projects[0];
    if (projects.length === 1 && !selectedProject && firstProject) {
      setSelectedProject(firstProject.id);
    }
  }, [projects, selectedProject]);

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center space-x-4">
        <Button variant="ghost" onClick={() => router.back()} className="p-2">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{t("new.title")}</h1>
          <p className="text-muted-foreground">{t("new.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("new.settingsTitle")}</CardTitle>
          <CardDescription>{t("new.settingsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project">{t("fields.project")}</Label>
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger>
                <SelectValue placeholder={t("fields.projectPlaceholder")} />
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
              <p className="text-sm text-muted-foreground">{t("new.noProjects")}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="locale">{t("fields.language")}</Label>
              <Select value={locale} onValueChange={(value: "en" | "es") => setLocale(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t("language.en")}</SelectItem>
                  <SelectItem value="es">{t("language.es")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">{t("fields.tags")}</Label>
              <Input
                id="tags"
                placeholder={t("fields.tagsPlaceholder")}
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("fields.tagsHint")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedProject ? (
        <ClientContentEditor
          projectId={selectedProject}
          locale={locale}
          initialTags={parseTagsInput(tags)}
          showPreview={true}
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <div className="text-muted-foreground mb-4">{t("new.selectProjectPrompt")}</div>
              {projects.length === 0 && (
                <Button onClick={() => router.push("/dashboard/projects/new")}>
                  {t("new.createProject")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
