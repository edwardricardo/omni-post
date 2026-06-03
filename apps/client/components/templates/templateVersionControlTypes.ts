/**
 * @file templateVersionControlTypes.ts
 * @description TypeScript interfaces for template versions, branches, and the TemplateVersionControl component props.
 * @layer infrastructure
 */

import { Template } from "@/lib/templates/templateEngine";

export interface TemplateVersion {
  id: string;
  templateId: string;
  version: number;
  content: string;
  variables: string[];
  platforms: string[];
  tags: string[];
  changeLog: string;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
  createdAt: Date;
  isActive: boolean;
  parentVersionId?: string;
  branchName?: string;
  commitMessage?: string;
}

export interface VersionBranch {
  name: string;
  description: string;
  latestVersion: TemplateVersion;
  versionCount: number;
  isMain: boolean;
  createdAt: Date;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
}

export interface TemplateVersionControlProps {
  template: Template;
  versions: TemplateVersion[];
  branches?: VersionBranch[];
  onVersionRestore?: (version: TemplateVersion) => Promise<void>;
  onVersionDelete?: (versionId: string) => Promise<void>;
  onVersionCreate?: (version: Omit<TemplateVersion, "id" | "createdAt">) => Promise<void>;
  onBranchCreate?: (
    branch: Omit<VersionBranch, "latestVersion" | "versionCount" | "createdAt">
  ) => Promise<void>;
  onBranchMerge?: (sourceBranch: string, targetBranch: string) => Promise<void>;
  allowVersioning?: boolean;
  allowBranching?: boolean;
  currentUser?: {
    id: string;
    name: string;
    avatar?: string;
  };
}
