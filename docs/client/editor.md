# Universal Content Editor

## Overview

The Universal Content Editor is a comprehensive rich-text editing system built on TipTap 3.6.1 that enables users to create, edit, and preview social media content across multiple platforms simultaneously. It provides a unified editing experience with platform-specific constraints, real-time previews, auto-save functionality, and intelligent content optimization.

## Architecture

### Core Components

```
Universal Content Editor
├── ContentEditor.tsx           # Main editor component
├── PlatformPreview.tsx        # Real-time platform previews
├── TemplateSelector.tsx       # Template system integration
├── SchedulePicker.tsx         # Scheduling interface
└── useAutoSave.ts            # Auto-save functionality
```

### Dependencies

- **TipTap 3.6.1**: Rich text editor framework
- **React 19.2.4**: UI framework
- **TanStack Query**: Data fetching and caching
- **Provider Registry**: Platform configuration system
- **Template System**: Pre-built content templates

## TipTap 3.6.1 Integration

### Editor Configuration

The editor is configured with essential extensions for social media content creation:

```typescript
const editor = useEditor({
  extensions: [
    StarterKit,
    CharacterCount.configure({
      limit: charLimit, // Dynamic based on selected platforms
    }),
    Placeholder.configure({
      placeholder: "What's on your mind?",
    }),
  ],
  content: "",
  onUpdate: ({ editor }) => {
    const text = editor.getText();
    const charCount = editor.storage.characterCount.characters();
    onContentChange?.(text, charCount);

    // Trigger auto-save
    saveDraft({
      content: text,
      title,
      tags,
      projectId,
      locale,
      selectedProviders,
    });
  },
});
```

### Supported Extensions

- **StarterKit**: Basic formatting (bold, italic, lists, etc.)
- **CharacterCount**: Real-time character counting with platform limits
- **Placeholder**: Dynamic placeholder text

### Dynamic Character Limits

The editor dynamically adjusts character limits based on selected platforms:

```typescript
const getMinCharLimit = () => {
  if (selectedProviders.length === 0) return 280; // Default to Twitter limit

  const charLimits = selectedProviders.map((id) => providerRegistry.getCharLimit(id));
  return Math.min(...charLimits);
};
```

## Auto-Save Functionality

### useAutoSave Hook

The auto-save system provides both local and server-side persistence:

```typescript
export function useAutoSave(config: AutoSaveConfig) {
  const { key, interval = 30000, enabled = true, onSave } = config;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Debounced save function
  const save = useCallback(
    (data: AutoSaveData) => {
      dataRef.current = data;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        if (dataRef.current) {
          performSave(dataRef.current);
        }
      }, interval);
    },
    [performSave, interval]
  );
}
```

### usePostDraft Hook

Specialized hook for post drafts with API integration:

```typescript
export function usePostDraft(postId?: string) {
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();

  const autoSave = useAutoSave({
    key: postId || "new_post",
    interval: 15000, // Save every 15 seconds for posts
  });

  const saveDraft = useCallback(
    (draft: DraftData) => {
      autoSave.save({
        content: draft.content,
        title: draft.title,
        tags: draft.tags,
        selectedProviders: draft.selectedProviders,
      });
    },
    [autoSave]
  );

  const publishPost = useCallback(
    async (postData: CreatePostRequest) => {
      const result = postId
        ? await updatePost.mutateAsync({ id: postId, data: postData })
        : await createPost.mutateAsync(postData);

      // Clear draft after successful publish
      autoSave.clearDraft();
      return result;
    },
    [postId, createPost, updatePost, autoSave]
  );
}
```

### Save Status Indicators

Visual feedback for save operations:

```typescript
{saveStatus === "saving" && (
  <div className="flex items-center gap-1">
    <Clock className="h-4 w-4 animate-spin" />
    <span>Saving...</span>
  </div>
)}
{saveStatus === "saved" && (
  <div className="flex items-center gap-1 text-green-600">
    <CheckCircle2 className="h-4 w-4" />
    <span>Saved</span>
  </div>
)}
```

## Platform-Specific Constraints and Validation

### Provider Registry Integration

The editor integrates with the provider registry for platform-specific constraints:

```typescript
interface ProviderConfig {
  id: string;
  charLimit: number;
  mediaLimits: {
    maxFiles: number;
    maxFileSize: number;
    supportedTypes: string[];
  };
  features: {
    threads: boolean;
    polls: boolean;
    scheduling: boolean;
    hashtags: boolean;
    mentions: boolean;
    links: boolean;
  };
}
```

### Platform Constraints

- **X (Twitter)**: 280 characters, 4 media files, threading support
- **Instagram**: 2,200 characters, 10 media files, no links in posts
- **LinkedIn**: 3,000 characters, 9 media files, professional focus
- **Facebook**: 63,206 characters, 30 media files, extensive media support

### Validation Logic

```typescript
const validateContent = (providerId: string, content: string, media: File[]) => {
  const requirements = providerRegistry.getRequirements(providerId);
  const errors: string[] = [];

  requirements.forEach((requirement) => {
    if (!requirement.validate(content, media)) {
      errors.push(requirement.message);
    }
  });

  return { valid: errors.length === 0, errors };
};
```

## Media Handling with Drag-and-Drop

### Drag-and-Drop Implementation

```typescript
const handleDrop = useCallback(
  (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = Array.from(e.dataTransfer.files).filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
    );

    if (files.length + mediaFiles.length > mediaLimit) {
      alert(`Maximum ${mediaLimit} media files allowed for selected providers`);
      return;
    }

    setMediaFiles((prev) => [...prev, ...files]);
    onMediaAdd?.(files);
  },
  [mediaFiles.length, mediaLimit, onMediaAdd]
);
```

### Media Validation

- **File Type Validation**: Images and videos only
- **Platform Limits**: Respects per-platform media limits
- **Visual Feedback**: Drag overlay and progress indicators

### Media Preview

```typescript
{mediaFiles.length > 0 && (
  <div className="border-t p-4">
    <div className="grid grid-cols-4 gap-2">
      {mediaFiles.map((file, index) => (
        <div key={index} className="relative group">
          {file.type.startsWith("image/") ? (
            <img
              src={URL.createObjectURL(file)}
              alt={file.name}
              className="w-full h-24 object-cover rounded-md"
            />
          ) : (
            <div className="w-full h-24 bg-secondary rounded-md flex items-center justify-center">
              <Video className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
          <Button
            onClick={() => removeMedia(index)}
            variant="destructive"
            size="sm"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0 opacity-0 group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  </div>
)}
```

## Template System Integration

### Template Structure

```typescript
interface PostTemplate {
  id: string;
  name: string;
  description: string;
  category:
    "announcement" | "promotion" | "engagement" | "question" | "educational" | "personal" | "event";
  content: string;
  tags: string[];
  variables?: string[];
  platforms: string[];
  preview?: string;
}
```

### Template Categories

- **Announcements**: Product launches, company news
- **Promotions**: Sales, offers, service promotions
- **Engagement**: Behind-the-scenes, user spotlights
- **Questions**: Polls, feedback requests
- **Educational**: Tips, tutorials, myth-busting
- **Personal**: Stories, experiences, reflections
- **Events**: Webinars, conferences, meetups

### Variable Substitution

```typescript
export function fillTemplateVariables(
  template: PostTemplate,
  variables: Record<string, string>
): string {
  let content = template.content;

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, "g");
    content = content.replace(regex, value);
  });

  return content;
}
```

### Template Usage Flow

1. **Template Selection**: Browse by category or search
2. **Variable Input**: Fill required template variables
3. **Live Preview**: See content with variables replaced
4. **Apply Template**: Insert into editor for further customization

## Real-Time Platform Previews

### Preview Components

The system provides authentic previews for each platform:

```typescript
const renderTwitterPreview = () => (
  <div className="bg-white border rounded-lg max-w-lg mx-auto">
    {threadSegments.map((segment, idx) => (
      <div key={idx} className={cn("p-4", idx > 0 && "border-t")}>
        <div className="flex space-x-3">
          <Avatar className="w-10 h-10">
            <AvatarImage src={userInfo.avatar} />
            <AvatarFallback>{userInfo.name[0]}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-1">
              <span className="font-bold text-gray-900">{userInfo.name}</span>
              <span className="text-gray-500">@{userInfo.username}</span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-500">now</span>
              {threadSegments.length > 1 && (
                <span className="text-blue-500 text-sm">
                  {segment.index}/{threadSegments.length}
                </span>
              )}
            </div>
            <div className="mt-1">
              <p className="text-gray-900 whitespace-pre-wrap">{segment.text}</p>
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);
```

### Platform-Specific Features

- **Twitter/X**: Thread indicators, media grids, engagement buttons
- **Instagram**: Square media layout, story-style presentation
- **LinkedIn**: Professional styling, article-like format

### Thread Preview

For content exceeding character limits:

```typescript
const threadSegments = activeProviderData
  ? providerRegistry.getThreadSegments(activeProvider, content).map((text, index) => ({
      text,
      index: index + 1,
      charCount: text.length,
    }))
  : [{ text: content, index: 1, charCount: content.length }];
```

## Character Counting and Limit Warnings

### Dynamic Character Counting

```typescript
const charCount = editor?.storage.characterCount.characters() || 0;
const charPercentage = (charCount / charLimit) * 100;
```

### Visual Indicators

```typescript
<div className="flex items-center justify-between">
  <div className="flex items-center gap-2">
    {charCount > charLimit && <AlertCircle className="h-4 w-4 text-destructive" />}
    <span
      className={cn(
        "text-sm font-medium",
        charCount > charLimit && "text-destructive",
        charPercentage > 80 && charPercentage <= 100 && "text-yellow-600",
        charPercentage <= 80 && "text-muted-foreground"
      )}
    >
      {charCount} / {charLimit}
    </span>
  </div>

  {/* Progress Bar */}
  <div className="flex-1 mx-4">
    <div className="h-2 bg-secondary rounded-full overflow-hidden">
      <div
        className={cn(
          "h-full transition-all",
          charCount > charLimit && "bg-destructive",
          charPercentage > 80 && charPercentage <= 100 && "bg-yellow-500",
          charPercentage <= 80 && "bg-primary"
        )}
        style={{ width: `${Math.min(charPercentage, 100)}%` }}
      />
    </div>
  </div>

  {/* Threading Indicator */}
  {charCount > charLimit && (
    <span className="text-sm text-muted-foreground">
      Will create thread with {Math.ceil(charCount / charLimit)} posts
    </span>
  )}
</div>
```

### Color-Coded Warnings

- **Green**: Under 80% of limit
- **Yellow**: 80-100% of limit
- **Red**: Over limit (threading required)

## Collaborative Editing Features (Planned)

### Architecture for Collaboration

The system is designed to support future collaborative features:

```typescript
interface CollaborationState {
  users: {
    id: string;
    name: string;
    avatar?: string;
    cursor?: {
      position: number;
      selection?: { from: number; to: number };
    };
  }[];
  version: number;
  lastModified: Date;
  conflicts?: {
    position: number;
    users: string[];
    resolution?: "manual" | "auto";
  }[];
}
```

### Planned Features

- **Real-time Collaboration**: Multiple users editing simultaneously
- **User Cursors**: See where other users are editing
- **Conflict Resolution**: Handle simultaneous edits
- **Version History**: Track changes over time
- **Comments**: Inline feedback and suggestions

### WebSocket Integration

```typescript
// Planned implementation
interface CollaborativeEditor {
  onUserJoin: (user: User) => void;
  onUserLeave: (userId: string) => void;
  onCursorMove: (userId: string, position: number) => void;
  onContentChange: (delta: any, author: string) => void;
  onComment: (comment: Comment) => void;
}
```

## Usage Examples

### Basic Editor Setup

```typescript
import { ContentEditor } from '@/components/editor/ContentEditor';

function PostCreator() {
  const [content, setContent] = useState('');
  const [charCount, setCharCount] = useState(0);

  return (
    <ContentEditor
      onContentChange={(content, charCount) => {
        setContent(content);
        setCharCount(charCount);
      }}
      onMediaAdd={(files) => {
        console.log('Media added:', files);
      }}
      projectId="project-123"
      locale="en"
      showPreview={true}
    />
  );
}
```

### With Auto-Save

```typescript
function EditPost({ postId }: { postId: string }) {
  const {
    saveDraft,
    saveStatus,
    lastSaved,
    publishPost,
    isPublishing
  } = usePostDraft(postId);

  return (
    <ContentEditor
      postId={postId}
      onContentChange={(content, charCount) => {
        saveDraft({
          content,
          projectId: 'project-123',
          locale: 'en'
        });
      }}
    />
  );
}
```

### Platform Preview Integration

```typescript
function ContentWithPreview() {
  const [selectedProviders, setSelectedProviders] = useState(['x', 'linkedin']);
  const [content, setContent] = useState('');
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ContentEditor
        onContentChange={setContent}
        onMediaAdd={setMediaFiles}
        showPreview={false}
      />
      <PlatformPreview
        content={content}
        mediaFiles={mediaFiles}
        selectedProviders={selectedProviders}
        userInfo={{
          name: 'John Doe',
          username: 'johndoe',
          avatar: '/avatars/john.jpg'
        }}
      />
    </div>
  );
}
```

## API Documentation

### ContentEditor Props

```typescript
interface ContentEditorProps {
  onContentChange?: (content: string, charCount: number) => void;
  onMediaAdd?: (files: File[]) => void;
  postId?: string;
  initialContent?: string;
  initialTitle?: string;
  initialTags?: string[];
  projectId?: string;
  locale?: string;
  showPreview?: boolean;
}
```

### PlatformPreview Props

```typescript
interface PlatformPreviewProps {
  content: string;
  mediaFiles: File[];
  selectedProviders: string[];
  userInfo?: {
    name: string;
    username: string;
    avatar?: string;
  };
}
```

### TemplateSelector Props

```typescript
interface TemplateSelectorProps {
  onTemplateSelect: (content: string, title?: string, tags?: string[]) => void;
  selectedPlatforms?: string[];
  isOpen: boolean;
  onClose: () => void;
}
```

### SchedulePicker Props

```typescript
interface SchedulePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (scheduledAt: Date, timezone?: string) => void;
  selectedProviders?: string[];
  inline?: boolean;
}
```

## Performance Considerations

### Optimization Strategies

1. **Debounced Auto-Save**: Prevents excessive API calls
2. **Lazy Loading**: Templates and previews load on demand
3. **Memoized Components**: Prevents unnecessary re-renders
4. **Virtual Scrolling**: For large template lists
5. **Image Compression**: Reduces media file sizes

### Memory Management

```typescript
// Cleanup media URLs to prevent memory leaks
useEffect(() => {
  return () => {
    mediaFiles.forEach((file) => {
      URL.revokeObjectURL(URL.createObjectURL(file));
    });
  };
}, [mediaFiles]);
```

## Testing Strategy

### Unit Tests

- **Editor State Management**: Content updates, character counting
- **Auto-Save Logic**: Debouncing, error handling
- **Template System**: Variable substitution, validation
- **Media Handling**: File validation, preview generation

### Integration Tests

- **Platform Previews**: Correct rendering for each platform
- **Threading Logic**: Proper content segmentation
- **Schedule Picker**: Date/time validation and formatting

### E2E Tests

- **Complete Workflow**: Create, edit, preview, publish
- **Multi-Platform**: Cross-platform content creation
- **Error Scenarios**: Network failures, validation errors

## Security Considerations

### Content Sanitization

- **XSS Prevention**: All user content is sanitized
- **File Validation**: Media files are validated for type and size
- **Input Limits**: Character and file count limits enforced

### API Security

- **Authentication**: All API calls require valid tokens
- **Rate Limiting**: Prevents API abuse
- **CORS**: Proper cross-origin request handling

## Future Enhancements

### Planned Features

1. **AI Content Generation**: GPT-powered content suggestions
2. **Advanced Scheduling**: Optimal posting time recommendations
3. **Analytics Integration**: Performance tracking and insights
4. **Content Library**: Reusable content snippets
5. **Team Collaboration**: Multi-user editing and approval workflows
6. **Mobile App**: React Native implementation
7. **Offline Support**: PWA with offline editing capabilities

### Technical Improvements

1. **Performance**: Virtual scrolling, code splitting
2. **Accessibility**: WCAG 2.1 AA compliance
3. **Internationalization**: Multi-language support
4. **Testing**: Increased test coverage and E2E automation
5. **Documentation**: Interactive API documentation

## Troubleshooting

### Common Issues

1. **Auto-save not working**: Check network connectivity and authentication
2. **Character count incorrect**: Verify TipTap extension configuration
3. **Media upload fails**: Check file size and type restrictions
4. **Preview not updating**: Ensure selectedProviders state is properly managed

### Debug Mode

Enable debug logging for troubleshooting:

```typescript
const DEBUG = process.env.NODE_ENV === "development";

if (DEBUG) {
  console.log("Editor state:", {
    content,
    charCount,
    selectedProviders,
    saveStatus,
  });
}
```

## Conclusion

The Universal Content Editor provides a comprehensive solution for multi-platform social media content creation. Built on modern web technologies with a focus on user experience, performance, and extensibility, it serves as the foundation for efficient social media management workflows.

The system's modular architecture allows for easy extension and customization, while its integration with the provider registry ensures consistent behavior across different social media platforms. With planned collaborative features and AI integration, the Universal Content Editor will continue to evolve as a powerful tool for content creators and social media managers.
