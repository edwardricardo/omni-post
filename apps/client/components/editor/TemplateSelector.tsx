"use client";

/**
 * @file TemplateSelector.tsx
 * @description Dialog for browsing, previewing, and selecting post templates with
 * category filtering, variable customization, and platform-aware content insertion.
 * @component TemplateSelector
 * @layer infrastructure
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
} from "@packages/ui";
import { Search, FileText, Plus, Eye } from "lucide-react";
import { cn as _cn } from "@packages/ui";
import {
  postTemplates,
  templateCategories,
  getTemplatesByCategory as _getTemplatesByCategory,
  fillTemplateVariables,
  type PostTemplate,
} from "@/lib/templates/postTemplates";

interface TemplateSelectorProps {
  onTemplateSelect: (content: string, title?: string, tags?: string[]) => void;
  selectedPlatforms?: string[];
  isOpen: boolean;
  onClose: () => void;
}

interface VariableModalProps {
  template: PostTemplate;
  isOpen: boolean;
  onClose: () => void;
  onApply: (content: string, title?: string, tags?: string[]) => void;
}

function VariableModal({ template, isOpen, onClose, onApply }: VariableModalProps) {
  const t = useTranslations("editor");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);

  const handleVariableChange = (key: string, value: string) => {
    const newVariables = { ...variables, [key]: value };
    setVariables(newVariables);
  };

  const handleApply = () => {
    const filledContent = fillTemplateVariables(template, variables);
    onApply(filledContent, template.name, template.tags);
    onClose();
    setVariables({});
    setPreview(false);
  };

  const getPreviewContent = () => {
    return fillTemplateVariables(template, variables);
  };

  if (!template.variables || template.variables.length === 0) {
    // No variables to fill, apply directly
    const handleApplyDirect = () => {
      onApply(template.content, template.name, template.tags);
      onClose();
    };

    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("templateSelector.useTitle", { name: template.name })}</DialogTitle>
            <DialogDescription>{t("templateSelector.readyDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <h4 className="font-medium mb-2">{t("templateSelector.previewLabel")}</h4>
              <p className="text-sm whitespace-pre-wrap">{template.content}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {t("templateSelector.cancel")}
              </Button>
              <Button onClick={handleApplyDirect}>{t("templateSelector.apply")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("templateSelector.customizeTitle", { name: template.name })}</DialogTitle>
          <DialogDescription>{t("templateSelector.customizeDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Variables Form */}
          <div className="space-y-4">
            <h4 className="font-medium">{t("templateSelector.variablesHeading")}</h4>
            {template.variables.map((variable) => (
              <div key={variable} className="space-y-2">
                <Label htmlFor={variable}>
                  {variable
                    .replace(/_/g, " ")
                    .toLowerCase()
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
                </Label>
                <Input
                  id={variable}
                  placeholder={t("templateSelector.variablePlaceholder", {
                    name: variable.toLowerCase(),
                  })}
                  value={variables[variable] || ""}
                  onChange={(e) => handleVariableChange(variable, e.target.value)}
                />
              </div>
            ))}
          </div>

          {/* Preview */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">{t("templateSelector.previewHeading")}</h4>
              <Button variant="outline" size="sm" onClick={() => setPreview(!preview)}>
                <Eye className="h-4 w-4 mr-2" />
                {preview ? t("templateSelector.hidePreview") : t("templateSelector.showPreview")}
              </Button>
            </div>
            {preview && (
              <div className="p-4 bg-muted rounded-lg min-h-[200px]">
                <p className="text-sm whitespace-pre-wrap">{getPreviewContent()}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            {t("templateSelector.cancel")}
          </Button>
          <Button onClick={handleApply}>{t("templateSelector.apply")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * @component TemplateSelector
 * @description Dialog for browsing, previewing, and selecting post templates with
 * category filtering, variable customization, and platform-aware content insertion.
 * @param props.selectedPlatforms - Filters templates compatible with these platforms
 */
export function TemplateSelector({
  onTemplateSelect,
  selectedPlatforms = [],
  isOpen,
  onClose,
}: TemplateSelectorProps) {
  const t = useTranslations("editor");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedTemplate, setSelectedTemplate] = useState<PostTemplate | null>(null);
  const [showVariableModal, setShowVariableModal] = useState(false);

  const filteredTemplates = postTemplates.filter((template) => {
    const matchesSearch =
      template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.tags.some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesCategory = selectedCategory === "all" || template.category === selectedCategory;

    const matchesPlatform =
      selectedPlatforms.length === 0 ||
      selectedPlatforms.some((platform) => template.platforms.includes(platform));

    return matchesSearch && matchesCategory && matchesPlatform;
  });

  const handleTemplateSelect = (template: PostTemplate) => {
    setSelectedTemplate(template);
    setShowVariableModal(true);
  };

  const handleApplyTemplate = (content: string, title?: string, tags?: string[]) => {
    onTemplateSelect(content, title, tags);
    onClose();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("templateSelector.chooseTitle")}
            </DialogTitle>
            <DialogDescription>{t("templateSelector.chooseDescription")}</DialogDescription>
          </DialogHeader>

          {/* Filters */}
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("templateSelector.searchPlaceholder")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t("templateSelector.allCategories")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("templateSelector.allCategories")}</SelectItem>
                  {templateCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPlatforms.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("templateSelector.filteredFor")}
                </span>
                {selectedPlatforms.map((platform) => (
                  <Badge key={platform} variant="secondary" className="text-xs">
                    {platform.charAt(0).toUpperCase() + platform.slice(1)}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Templates Grid */}
          <div className="flex-1 overflow-y-auto">
            {filteredTemplates.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">{t("templateSelector.emptyTitle")}</h3>
                <p className="text-muted-foreground mb-4">
                  {t("templateSelector.emptyDescription")}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredTemplates.map((template) => (
                  <Card
                    key={template.id}
                    className="hover:shadow-md transition-shadow cursor-pointer"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-base leading-6">{template.name}</CardTitle>
                          <CardDescription className="mt-1 text-sm">
                            {template.description}
                          </CardDescription>
                        </div>
                        <Badge variant="secondary" className="text-xs ml-2">
                          {templateCategories.find((c) => c.id === template.category)?.name}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="text-sm text-muted-foreground line-clamp-3">
                        {template.preview || template.content.substring(0, 100) + "..."}
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {template.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            #{tag}
                          </Badge>
                        ))}
                        {template.tags.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{template.tags.length - 3}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <div className="flex gap-1">
                          {template.platforms.slice(0, 3).map((platform) => (
                            <div
                              key={platform}
                              className="w-2 h-2 rounded-full bg-muted-foreground"
                              title={platform}
                            />
                          ))}
                        </div>
                        <Button onClick={() => handleTemplateSelect(template)} size="sm">
                          <Plus className="h-3 w-3 mr-1" />
                          {t("templateSelector.useButton")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Variable Modal */}
      {selectedTemplate && (
        <VariableModal
          template={selectedTemplate}
          isOpen={showVariableModal}
          onClose={() => {
            setShowVariableModal(false);
            setSelectedTemplate(null);
          }}
          onApply={handleApplyTemplate}
        />
      )}
    </>
  );
}
