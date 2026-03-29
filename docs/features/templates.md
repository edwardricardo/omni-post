# Enhanced Template System & Content Management

## Overview

The Enhanced Template System provides a comprehensive solution for creating, managing, and optimizing content templates with advanced features including Handlebars-based templating, A/B testing, version control, and performance analytics.

## Features

### 🎨 Advanced Template Engine

- **Handlebars Integration**: Full Handlebars.js support with custom helpers
- **Variable Substitution**: Dynamic content with `{{variable}}` syntax
- **Conditional Logic**: `{{#if}}...{{/if}}` and `{{#unless}}...{{/unless}}`
- **Loops and Iteration**: `{{#each}}...{{/each}}` for dynamic lists
- **Custom Helper Functions**: 20+ built-in helpers for common operations

### 📝 Template Editor

- **Monaco Editor**: Professional code editor with syntax highlighting
- **Live Preview**: Real-time template compilation and preview
- **Variable Auto-completion**: Intelligent variable suggestions
- **Syntax Validation**: Real-time error detection and validation
- **Multi-platform Support**: Platform-specific content optimization

### 📚 Template Library

- **Advanced Search**: Fuzzy search with Fuse.js integration
- **Category Organization**: Templates organized by purpose and type
- **Tag-based Filtering**: Multi-tag filtering and search
- **Performance Analytics**: Usage statistics and performance metrics
- **Favorites System**: Mark and organize frequently used templates

### 🧪 A/B Testing Framework

- **Variant Management**: Create and manage multiple content variants
- **Traffic Distribution**: Configurable traffic splitting
- **Statistical Analysis**: Confidence intervals and significance testing
- **Performance Tracking**: Conversion rates and engagement metrics
- **Automated Recommendations**: Rule-based optimization suggestions

### 🔄 Version Control

- **Git-like Versioning**: Branch-based development workflow
- **Change Tracking**: Detailed changelog and commit messages
- **Visual Diff Viewer**: Side-by-side content comparison
- **Rollback Support**: Easy restoration to previous versions
- **Collaboration Features**: Multi-user editing with conflict resolution

## Architecture

### Template Engine

```typescript
// Core template structure
interface Template {
  id: string;
  name: string;
  description?: string;
  category: string;
  content: string; // Handlebars template
  variables: TemplateVariable[];
  platforms: string[];
  variants?: TemplateVariant[];
  tags?: string[];
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// Variable definition
interface TemplateVariable {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "array" | "object";
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
}
```

### Database Schema

```sql
-- Templates table
CREATE TABLE "Template" (
    "id" TEXT PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "variables" JSONB DEFAULT '[]',
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    -- ... additional fields
);

-- Version control
CREATE TABLE "TemplateVersion" (
    "id" TEXT PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changeLog" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT false,
    -- ... additional fields
);

-- A/B testing
CREATE TABLE "ABTest" (
    "id" TEXT PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" "ABTestStatus" DEFAULT 'DRAFT',
    -- ... additional fields
);
```

## API Endpoints

### Templates

```typescript
// Get templates for a project
GET /api/projects/:projectId/templates
Query: category?, platform?, tags?, search?, limit?, offset?

// Create new template
POST /api/projects/:projectId/templates
Body: { name, description?, category, content, platforms, tags? }

// Update template
PUT /api/projects/:projectId/templates/:templateId
Body: { name?, description?, content?, platforms?, tags? }

// Delete template
DELETE /api/projects/:projectId/templates/:templateId

// Duplicate template
POST /api/projects/:projectId/templates/:templateId/duplicate
Body: { name? }

// Compile template with context
POST /api/projects/:projectId/templates/:templateId/compile
Body: { context: Record<string, unknown>, abTestConfig? }
```

### Version Control

```typescript
// Get template versions
GET /api/projects/:projectId/templates/:templateId/versions

// Create new version
POST /api/projects/:projectId/templates/:templateId/versions
Body: { version, content, changeLog, commitMessage?, author }

// Restore version
POST /api/projects/:projectId/templates/:templateId/versions/:versionId/restore
```

### A/B Testing

```typescript
// Get A/B tests
GET /api/projects/:projectId/templates/ab-tests
Query: status?

// Create A/B test
POST /api/projects/:projectId/templates/ab-tests
Body: { name, description?, templateId, config }

// Start/Stop test
POST /api/projects/:projectId/templates/ab-tests/:testId/start
POST /api/projects/:projectId/templates/ab-tests/:testId/stop

// Get results
GET /api/projects/:projectId/templates/ab-tests/:testId/results
```

## Template Syntax

### Basic Variables

```handlebars
Hello {{username}}! Your account status: {{accountStatus}}
```

### Conditional Logic

```handlebars
{{#if premium}}
  Welcome to our premium service!
{{else}}
  Upgrade to premium for more features.
{{/if}}

{{#unless trial}}
  Thank you for being a paying customer!
{{/unless}}
```

### Loops and Iteration

```handlebars
Your recent posts:
{{#each posts}}
  -
  {{this.title}}
  ({{this.date}})
{{/each}}

Tags:
{{#each hashtags}}#{{this}} {{/each}}
```

### Built-in Helpers

```handlebars
<!-- Date formatting -->
Published on
{{formatDate date "MMM dd, yyyy"}}

<!-- String manipulation -->
{{uppercase title}}
{{capitalize name}}
{{lowercase email}}

<!-- Array operations -->
{{join tags ", "}}
You have
{{length notifications}}
notifications

<!-- Math operations -->
Total:
{{add price tax}}
Discount:
{{subtract originalPrice salePrice}}

<!-- Social media helpers -->
{{hashtag "productivity"}}
→ #productivity
{{link website "Visit our site"}}

<!-- Platform-specific -->
Character limit:
{{characterLimit platform}}

<!-- Conditional helpers -->
{{#if (eq platform "twitter")}}
  Twitter-specific content
{{/if}}

{{#if (gt followers 1000)}}
  You're popular!
{{/if}}
```

### Advanced Features

```handlebars
<!-- Random content for A/B testing -->
{{random "Great!" "Awesome!" "Amazing!"}}

<!-- Platform optimizations -->
{{#if (eq platform "twitter")}}
  {{truncate content 280}}
{{else}}
  {{content}}
{{/if}}

<!-- Complex expressions -->
{{#if (and premium (gt usage 100))}}
  Premium heavy user content
{{/if}}
```

## Component Usage

### Template Editor

```tsx
import { TemplateEditor } from "@/components/templates";

function MyTemplateEditor() {
  const handleSave = async (template: Template) => {
    await templatesApi.create(template);
  };

  return (
    <TemplateEditor
      template={selectedTemplate}
      onSave={handleSave}
      onCancel={() => setEditing(false)}
      availablePlatforms={["twitter", "linkedin", "instagram"]}
      categories={[
        { id: "announcement", name: "Announcements", description: "Product launches" },
        { id: "promotion", name: "Promotions", description: "Sales and offers" },
      ]}
    />
  );
}
```

### Template Library

```tsx
import { TemplateLibrary } from "@/components/templates";

function MyTemplateLibrary() {
  return (
    <TemplateLibrary
      templates={templates}
      onTemplateSelect={handleSelect}
      onTemplateEdit={handleEdit}
      onTemplateDelete={handleDelete}
      onTemplateDuplicate={handleDuplicate}
      favorites={userFavorites}
      onToggleFavorite={handleToggleFavorite}
      analytics={templateAnalytics}
      showAnalytics={true}
      allowEdit={true}
      allowDelete={true}
    />
  );
}
```

### A/B Test Manager

```tsx
import { ABTestManager } from "@/components/templates";

function MyABTestManager() {
  return (
    <ABTestManager
      templates={templates}
      tests={abTests}
      onTestCreate={handleTestCreate}
      onTestUpdate={handleTestUpdate}
      onTestStart={handleTestStart}
      onTestStop={handleTestStop}
      allowManagement={true}
    />
  );
}
```

## Testing

### Unit Tests

```typescript
// Template engine tests
describe("TemplateEngine", () => {
  it("should compile basic variables", () => {
    const template = {
      content: "Hello {{username}}!",
      variables: [{ name: "username", type: "string", required: true }],
    };

    const result = templateEngine.compile(template, { username: "John" });

    expect(result.success).toBe(true);
    expect(result.content).toBe("Hello John!");
  });

  it("should handle conditional logic", () => {
    const template = {
      content: "{{#if premium}}Premium{{else}}Basic{{/if}}",
      variables: [{ name: "premium", type: "boolean", required: true }],
    };

    const result = templateEngine.compile(template, { premium: true });

    expect(result.content).toBe("Premium");
  });
});
```

### Integration Tests

```typescript
// Component integration tests
describe('TemplateEditor Integration', () => {
  it('should create and save template', async () => {
    const user = userEvent.setup();
    render(<TemplateEditor onSave={mockSave} onCancel={mockCancel} />);

    await user.type(screen.getByLabelText('Template Name'), 'Test Template');
    await user.type(screen.getByLabelText('Content'), 'Hello {{name}}!');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Template',
        content: 'Hello {{name}}!',
      })
    );
  });
});
```

## Performance Considerations

### Caching Strategy

```typescript
// Template compilation results cached
const cacheKey = `template:${templateId}:${contextHash}`;
const cached = await redis.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const result = templateEngine.compile(template, context);
await redis.setex(cacheKey, 300, JSON.stringify(result)); // 5 min cache

return result;
```

### Database Optimization

```sql
-- Optimized indexes for common queries
CREATE INDEX CONCURRENTLY idx_templates_project_category
  ON "Template"("projectId", "category")
  WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY idx_templates_search
  ON "Template" USING gin(to_tsvector('english', name || ' ' || description || ' ' || content))
  WHERE "deletedAt" IS NULL;

-- Materialized view for analytics
CREATE MATERIALIZED VIEW template_analytics AS
SELECT
  t.id,
  t.name,
  COUNT(ue.id) FILTER (WHERE ue.action = 'VIEW') as views,
  COUNT(ue.id) FILTER (WHERE ue.action = 'USE') as uses,
  AVG(CASE WHEN ue.action = 'USE' THEN 1.0 ELSE 0.0 END) as conversion_rate
FROM "Template" t
LEFT JOIN "TemplateUsageEvent" ue ON t.id = ue."templateId"
WHERE t."deletedAt" IS NULL
GROUP BY t.id, t.name;
```

## Security Considerations

### Input Validation

```typescript
// Template content sanitization
const sanitizedContent = DOMPurify.sanitize(templateContent, {
  ALLOWED_TAGS: [], // No HTML tags allowed in templates
  ALLOWED_ATTR: [],
});

// Variable validation
const variableSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), // Valid identifier
  type: z.enum(["string", "number", "boolean", "date", "array", "object"]),
  required: z.boolean().optional(),
});
```

### Access Control

```typescript
// Template access control
const canEditTemplate = async (userId: string, templateId: string) => {
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    include: { project: { include: { account: true } } },
  });

  return (
    template?.project.account.id === userId || (await hasProjectAccess(userId, template?.projectId))
  );
};
```

## Monitoring and Analytics

### Metrics Collection

```typescript
// Template usage tracking
await templateAnalytics.trackUsage(templateId, {
  action: "compile",
  context: { platform: "twitter", userId },
  timestamp: new Date(),
});

// Performance monitoring
const compilationTime = performance.now();
const result = await templateEngine.compile(template, context);
const duration = performance.now() - compilationTime;

await metrics.histogram("template_compilation_duration", duration, {
  templateId,
  success: result.success,
});
```

### Real-time Dashboard

```typescript
// WebSocket updates for real-time analytics
socket.on("template:usage", (event) => {
  updateTemplateMetrics(event.templateId, event.action);
  broadcastToAdmins("template_activity", event);
});
```

## Migration Guide

### From Legacy Template System

```sql
-- Migrate existing ContentTemplate to new Template schema
INSERT INTO "Template" (
  id, "projectId", "accountId", name, description, category,
  content, platforms, tags, "createdAt", "updatedAt"
)
SELECT
  id, "projectId", "accountId", name, description,
  COALESCE(category, 'general'),
  (content->>'text')::text,
  ARRAY['twitter'], -- Default platform
  tags,
  "createdAt", "updatedAt"
FROM "ContentTemplate"
WHERE "deletedAt" IS NULL;
```

### Component Migration

```typescript
// Before (legacy)
import { TemplateManager } from "@/components/templates/TemplateManager";

// After (enhanced)
import { TemplateLibrary, TemplateEditor, ABTestManager } from "@/components/templates";
```

## Roadmap

### Phase 1: Core Features ✅

- [x] Handlebars template engine
- [x] Template editor with Monaco
- [x] Variable auto-completion
- [x] Basic A/B testing
- [x] Version control

### Phase 2: Advanced Features 🚧

- [ ] Rule-based template suggestions
- [ ] Advanced analytics dashboard
- [ ] Template marketplace
- [ ] Multi-language support
- [ ] Advanced collaboration features

### Phase 3: Enterprise Features 📋

- [ ] Template governance and approval workflows
- [ ] Advanced security and compliance
- [ ] Custom helper function development
- [ ] Enterprise SSO integration
- [ ] Advanced reporting and exports

## Contributing

Please see the main project [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines on contributing to the template system.

## Support

For questions and support:

- 📖 Documentation: [Enhanced Template System Docs](./Enhanced-Template-System.md)
- 🐛 Issues: [GitHub Issues](../../issues)
- 💬 Discussions: [GitHub Discussions](../../discussions)
