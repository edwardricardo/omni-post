/**
 * @file projectsClient.ts
 * @description Projects domain client. Handles list, read, and create
 *              operations for `Project` aggregates.
 * @layer infrastructure
 */

import type { ApiResponse, PaginatedResponse, Project } from "../types.js";
import { request } from "./request.js";

/**
 * @class ProjectsClient
 * @description Client for `/projects` endpoints.
 */
export class ProjectsClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method getProjects
   * @description Lists all projects accessible to the current user.
   * @returns Paginated list of projects
   */
  async getProjects(): Promise<PaginatedResponse<Project>> {
    return request<PaginatedResponse<Project>>(this.baseUrl, "/projects");
  }

  /**
   * @method getProject
   * @description Fetches a single project by ID.
   * @param id - Project identifier
   * @returns Project payload
   */
  async getProject(id: string): Promise<ApiResponse<Project>> {
    return request<ApiResponse<Project>>(this.baseUrl, `/projects/${id}`);
  }

  /**
   * @method createProject
   * @description Creates a new project.
   * @param data - Project creation parameters
   * @returns Created project payload
   */
  async createProject(data: { name: string; description?: string }): Promise<ApiResponse<Project>> {
    return request<ApiResponse<Project>>(this.baseUrl, "/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}
