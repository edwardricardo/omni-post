/**
 * @file EmailTemplateEngine.ts
 * @description The template engine of the transactional emails: the shared Handlebars
 *              `BaseTemplateEngine`, with the email layout registered as a partial and every
 *              email template compiled once, in strict mode, from an in-source catalogue.
 *              `ServerTemplateEngine` is the post-content sibling and does not fit here: it needs
 *              Prisma and runs DOMPurify over its output, which would strip the document shell
 *              and the Outlook conditional comments an email carries.
 * @layer infrastructure
 */

import { BaseTemplateEngine, err, ok, type Result, type Template } from "@shared/types";

/** The name the email templates call the layout by: `{{#> emailLayout}}…{{/emailLayout}}`. */
export const EMAIL_LAYOUT_PARTIAL = "emailLayout";

/** A compiled Handlebars template of the shared engine. */
type CompiledTemplate = ReturnType<BaseTemplateEngine["compile"]>;

/**
 * @class EmailTemplateEngine
 * @description Renders the email templates of one catalogue. Values are interpolated with
 *   `{{ }}` only, so the engine HTML-escapes each of them; strict mode turns a variable a view
 *   does not carry into a render error instead of an empty string. The catalogue is part of the
 *   source tree, so the engine reads it and never writes it.
 */
export class EmailTemplateEngine extends BaseTemplateEngine {
  private readonly compiledTemplates: ReadonlyMap<string, CompiledTemplate>;

  constructor(
    private readonly catalogue: readonly Template[],
    layout: string
  ) {
    super();
    // A partial registered as a string compiles with the options of the template that calls it,
    // so the layout runs in strict mode too.
    this.handlebars.registerPartial(EMAIL_LAYOUT_PARTIAL, layout);
    this.compiledTemplates = new Map(
      catalogue.map((template) => [
        template.id,
        this.handlebars.compile(template.content, { strict: true }),
      ])
    );
  }

  /**
   * @method renderEmail
   * @description Renders one template of the catalogue with its view.
   * @param templateId - The id of a template of the catalogue.
   * @param view - Every variable the template and the layout read, each one present.
   * @returns The rendered HTML, or an error when the id is not in the catalogue or the view
   *   lacks a variable the template reads; nothing is rendered then.
   */
  renderEmail(templateId: string, view: object): Result<string, Error> {
    const compiled = this.compiledTemplates.get(templateId);
    if (compiled === undefined) {
      return err(new Error(`Unknown email template: ${templateId}`));
    }
    try {
      return ok(compiled(view));
    } catch (error: unknown) {
      // Strict mode reports a variable the view lacks by throwing; it stays inside the engine.
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * @method loadTemplates
   * @description Lists the templates of the catalogue that match a filter.
   * @param filter - An optional category and tags; a template matches when it carries every tag.
   * @returns The matching templates.
   */
  async loadTemplates(filter?: { category?: string; tags?: string[] }): Promise<Template[]> {
    return this.catalogue.filter(
      (template) =>
        (filter?.category === undefined || template.category === filter.category) &&
        (filter?.tags ?? []).every((tag) => template.tags?.includes(tag) === true)
    );
  }

  /**
   * @method loadTemplate
   * @description Finds one template of the catalogue.
   * @param id - The template's id.
   * @returns The template, or null when the catalogue has none with that id.
   */
  async loadTemplate(id: string): Promise<Template | null> {
    return this.catalogue.find((template) => template.id === id) ?? null;
  }

  /**
   * @method saveTemplate
   * @description Refuses: an email template changes in the source tree, where it is reviewed.
   * @param template - The template a caller tried to save.
   * @returns A rejected promise naming the template.
   */
  async saveTemplate(template: Template): Promise<Template> {
    throw new Error(`Email templates are part of the source tree; ${template.id} is read-only`);
  }

  /**
   * @method deleteTemplate
   * @description Refuses: an email template is removed in the source tree, where it is reviewed.
   * @param id - The id of the template a caller tried to delete.
   * @returns A rejected promise naming the template.
   */
  async deleteTemplate(id: string): Promise<boolean> {
    throw new Error(`Email templates are part of the source tree; ${id} is read-only`);
  }
}
