/**
 * @file AIPromptTemplateRepository.ts
 * @description Domain port interface for AIPromptTemplate persistence.
 *   Defines the contract that infrastructure adapters must fulfill.
 * @layer domain
 */

// ---------------------------------------------------------------------------
// Data shapes used by this port (technology-free)
// ---------------------------------------------------------------------------

export interface AIPromptTemplateData {
  id: string;
  accountId: string | null;
  name: string;
  category: string;
  platforms: string[];
  prompt: string;
  variables: unknown; // serialised JSON — callers cast to TemplateVariableDto[]
  tone: string[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAIPromptTemplateData {
  accountId: string | null;
  name: string;
  category: string;
  platforms: string[];
  prompt: string;
  variables: unknown;
  tone: string[];
  isSystem: boolean;
}

export interface UpdateAIPromptTemplateData {
  name?: string;
  category?: string;
  platforms?: string[];
  prompt?: string;
  variables?: unknown;
  tone?: string[];
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface AIPromptTemplateRepository {
  /**
   * Find all system templates plus (optionally) all templates for an account.
   */
  findAll(accountId?: string): Promise<AIPromptTemplateData[]>;

  /**
   * Find a single template by primary key.
   */
  findById(id: string): Promise<AIPromptTemplateData | null>;

  /**
   * Persist a new template record. Returns the created record with generated id.
   */
  create(data: CreateAIPromptTemplateData): Promise<AIPromptTemplateData>;

  /**
   * Partially update an existing template.
   */
  update(id: string, data: UpdateAIPromptTemplateData): Promise<AIPromptTemplateData>;

  /**
   * Delete a template by id.
   */
  delete(id: string): Promise<void>;
}
