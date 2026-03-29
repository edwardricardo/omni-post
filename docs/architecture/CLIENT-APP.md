# Client Application Architecture

## Overview

The Universal Client Dashboard is a modern React 19.2.4 application built with Next.js 16.2.1 (with Turbopack), providing a comprehensive content management interface for multi-platform social media publishing. It features a dynamic content editor, provider-agnostic architecture, and real-time collaboration capabilities.

**Port**: 3200 (configurable via environment)

## Technology Stack

### Core Framework

- **React**: 19.2.4 with concurrent rendering and automatic batching
- **Next.js**: 16.2.1 with App Router, server components, and Turbopack
- **TypeScript**: 6.0.2 with strict mode and exact optional properties
- **Node.js**: v24.14.1 with ES modules support

### State Management & Data Fetching

- **TanStack Query**: 5.90.2 for server state management
- **TanStack Query Devtools**: 5.90.2 for development debugging
- **Local State**: React 19 hooks (useState, useReducer, useContext)
- **Form State**: Custom hooks with auto-save functionality

### UI & Styling

- **Tailwind CSS**: 4.2.1 for utility-first styling (via `@tailwindcss/postcss`)
- **Radix UI**: Unified `radix-ui` 1.4.3 accessible component library (migrated from individual `@radix-ui/react-*` packages)
- **Lucide React**: 0.544.0 for icons
- **Class Variance Authority**: 0.7.0 for component variants

### Rich Text Editing

- **TipTap**: 3.6.1 core editor
- **TipTap Starter Kit**: 3.6.1 basic functionality
- **TipTap Character Count**: 3.6.1 for platform constraints
- **TipTap Placeholder**: 3.6.1 for user guidance

### Testing & Quality

- **Vitest**: 4.0.18 for unit and integration testing
- **React Testing Library**: 16.1.0 for component testing
- **Jest DOM**: 6.6.3 for DOM testing utilities
- **Playwright**: 1.55.1 for end-to-end testing
- **JSDOM**: 25.0.1 for DOM simulation
- **Storybook**: 10.2.13 for component documentation and visual testing

### Development Tools

- **ESLint**: 9.36.0 with Next.js configuration
- **PostCSS**: 8.5.6 for CSS processing

## Application Architecture

### Directory Structure

```
apps/client/
├── app/                          # Next.js App Router
│   ├── dashboard/               # Main dashboard pages
│   │   ├── layout.tsx          # Dashboard layout
│   │   ├── page.tsx            # Dashboard home
│   │   └── posts/              # Post management
│   │       ├── page.tsx        # Posts list
│   │       ├── new/            # Create new post
│   │       └── [id]/           # Post details
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Landing page
│   ├── login/                  # Authentication
│   ├── register/               # User registration
│   └── providers.tsx           # Global providers
├── components/                  # Reusable components
│   ├── editor/                 # Content editor components
│   ├── providers/              # Provider-specific components
│   ├── publishing/             # Publishing interface
│   ├── ui/                     # UI primitives
│   └── error/                  # Error handling
├── lib/                        # Business logic
│   ├── api/                    # API client and hooks
│   ├── auth/                   # Authentication logic
│   ├── hooks/                  # Custom React hooks
│   ├── providers/              # Provider registry
│   ├── templates/              # Content templates
│   └── utils/                  # Utility functions
└── tests/                      # Test files
```

### Core Components

#### 1. Universal Content Editor

**Location**: `components/editor/ContentEditor.tsx`

**Features**:

- **Rich Text Editing**: TipTap editor with markdown support
- **Real-time Character Counting**: Provider-specific limits
- **Auto-save**: Draft management with conflict resolution
- **Media Integration**: Drag-and-drop file uploads
- **Platform Previews**: Real-time content preview per provider
- **Template System**: Pre-built content templates
- **Collaborative Editing**: Real-time collaboration (planned)

**Key Hooks**:

```typescript
const {
  saveDraft,
  saveStatus,
  lastSaved,
  loadDraft,
  clearDraft,
  hasDraft,
  publishPost,
  isPublishing,
} = usePostDraft(postId);
```

#### 2. Provider Registry System

**Location**: `lib/providers/registry.ts`

**Features**:

- **Dynamic Provider Discovery**: Runtime provider registration
- **Capability-based Features**: Provider-specific functionality
- **Health Monitoring**: Real-time provider status
- **Constraint Validation**: Platform-specific limits

```typescript
interface ProviderMetadata {
  id: string;
  name: string;
  icon: string;
  color: string;
  capabilities: {
    maxChars: number;
    supportsMedia: boolean;
    supportsScheduling: boolean;
    supportsThreads: boolean;
  };
}
```

#### 3. Platform Preview System

**Location**: `components/editor/PlatformPreview.tsx`

**Features**:

- **Real-time Rendering**: Content preview as you type
- **Platform-specific Styling**: Native platform appearance
- **Media Preview**: Image and video rendering
- **Thread Visualization**: Multi-post thread preview
- **Character Limit Warnings**: Visual feedback for constraints

#### 4. Auto-save System

**Location**: `lib/hooks/useAutoSave.ts`

**Features**:

- **Debounced Saving**: Automatic draft persistence
- **Conflict Resolution**: Handle concurrent edits
- **Offline Support**: Local storage fallback
- **Recovery Mechanism**: Restore unsaved changes

```typescript
interface AutoSaveConfig {
  enabled: boolean;
  interval: number; // milliseconds
  debounceDelay: number;
  maxRetries: number;
  offlineStorage: boolean;
}
```

### API Integration

#### API Client Architecture

**Location**: `lib/api/client.ts`

**Features**:

- **Type-safe Requests**: Full TypeScript integration
- **Automatic Retries**: Exponential backoff for failures
- **Token Management**: Automatic refresh token handling
- **Error Handling**: Consistent error response processing
- **Request Caching**: Response caching with TanStack Query

```typescript
class ApiClient {
  private baseUrl: string;
  private retryConfig: RetryConfig;

  async request<T>(endpoint: string, options?: RequestOptions): Promise<T>;
  async get<T>(endpoint: string): Promise<T>;
  async post<T>(endpoint: string, data: unknown): Promise<T>;
  async put<T>(endpoint: string, data: unknown): Promise<T>;
  async delete<T>(endpoint: string): Promise<T>;
}
```

#### React Query Integration

**Location**: `lib/api/hooks.ts`

**Key Queries**:

```typescript
// Provider management
const useProviders = () =>
  useQuery({
    queryKey: ["providers"],
    queryFn: () => api.providers.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

// Post management
const useCreatePost = () =>
  useMutation({
    mutationFn: api.posts.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });

// Real-time updates
const usePostDraft = (postId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (draft: PostDraft) => api.posts.saveDraft(postId, draft),
    onMutate: async (newDraft) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["post", postId] });
      const previousPost = queryClient.getQueryData(["post", postId]);
      queryClient.setQueryData(["post", postId], newDraft);
      return { previousPost };
    },
  });
};
```

### Authentication System

#### Auth Context

**Location**: `lib/auth/authContext.tsx`

**Features**:

- **JWT Token Management**: Automatic token refresh
- **Protected Routes**: Route-level authentication
- **Role-based Access**: Permission-based UI rendering
- **Session Persistence**: Secure token storage

```typescript
interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
}
```

#### Protected Route Pattern

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;

  if (!token && request.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
```

### Error Handling & User Experience

#### Error Boundary

**Location**: `components/error/ErrorBoundary.tsx`

**Features**:

- **Graceful Degradation**: Fallback UI for component errors
- **Error Reporting**: Automatic error logging
- **Recovery Actions**: User-initiated error recovery
- **Development Tools**: Enhanced error information in dev mode

#### Toast Notification System

**Location**: `lib/hooks/useToast.ts`

**Features**:

- **Multiple Types**: Success, error, warning, info
- **Auto-dismiss**: Configurable timeout
- **Action Buttons**: Interactive notifications
- **Queue Management**: Multiple toast handling

```typescript
const { success, error, warning, info } = useToast();

// Usage
success("Post published successfully!");
error("Failed to save draft", {
  action: { label: "Retry", onClick: retryAction },
});
```

### Performance Optimization

#### React 19 Features

- **Automatic Batching**: Improved state update performance
- **Concurrent Rendering**: Non-blocking UI updates
- **Suspense Improvements**: Better loading states
- **Server Components**: Reduced client-side JavaScript

#### Code Splitting

```typescript
// Dynamic imports for route-based splitting
const PostEditor = lazy(() => import("./components/editor/ContentEditor"));
const Analytics = lazy(() => import("./components/analytics/Dashboard"));

// Component-level splitting
const HeavyComponent = lazy(() =>
  import("./components/HeavyComponent").then((module) => ({
    default: module.HeavyComponent,
  }))
);
```

#### Bundle Optimization

- **Tree Shaking**: Unused code elimination
- **Image Optimization**: Next.js automatic optimization
- **Font Optimization**: Automatic font loading
- **CSS Purging**: Unused CSS removal

### Development Workflow

#### Development Commands

```bash
# Start development server
pnpm dev                    # Port 3200

# Build for production
pnpm build

# Run tests
pnpm test                   # Vitest
pnpm test:ui               # Vitest UI
pnpm test:coverage         # Coverage report

# Type checking
pnpm type-check

# Linting
pnpm lint
```

#### Environment Configuration

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000
NEXT_PUBLIC_ENVIRONMENT=development
```

### Testing Strategy

#### Unit Tests

- **Component Testing**: React Testing Library
- **Hook Testing**: Custom hook testing utilities
- **Utility Testing**: Pure function testing
- **API Testing**: Mock API responses

#### Integration Tests

- **User Flow Testing**: Complete feature workflows
- **API Integration**: Real API endpoint testing
- **Authentication Flow**: Login/logout testing
- **Error Handling**: Error scenario testing

#### Test Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
```

### Deployment & Production

#### Build Optimization

```typescript
// next.config.ts
const nextConfig = {
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  images: {
    domains: ["storage.example.com"],
  },
};
```

#### Performance Monitoring

- **Core Web Vitals**: Automatic monitoring
- **User Analytics**: Usage tracking
- **Error Monitoring**: Production error tracking
- **Performance Metrics**: Bundle size and load times

### Future Enhancements

#### Planned Features

- **Real-time Collaboration**: Multiple users editing simultaneously
- **Advanced Templates**: AI-powered content templates
- **Bulk Operations**: Multi-post management
- **Advanced Analytics**: Client-side analytics dashboard
- **Offline Support**: Progressive Web App features

#### Architecture Improvements

- **Micro-frontends**: Modular architecture for scalability
- **Edge Computing**: Edge API routes for performance
- **Service Workers**: Background sync and caching
- **GraphQL Integration**: Efficient data fetching

---

**Version**: 1.0
**Last Updated**: March 8, 2026
**React Version**: 19.2.4
**Next.js Version**: 16.2.1
**TypeScript Version**: 6.0.2
