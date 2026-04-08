/**
 * Test Data Factory
 * Generates unique test data to prevent collisions between concurrent tests
 *
 * Features:
 * - Unique identifiers using timestamps and random strings
 * - Automatic tracking of created entities for cleanup
 * - Proper cleanup in reverse dependency order
 */
import { prisma } from "@infra/prisma";
import type { AdminUser, Account, Project, Post, Channel } from "@infra/prisma";

interface CreatedIds {
  adminUsers: string[];
  accounts: string[];
  projects: string[];
  posts: string[];
  channels: string[];
}

export class TestDataFactory {
  private createdIds: CreatedIds = {
    adminUsers: [],
    accounts: [],
    projects: [],
    posts: [],
    channels: [],
  };

  /**
   * Generate unique identifier
   */
  private uniqueId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate unique email
   */
  uniqueEmail(prefix = "test"): string {
    return `${prefix}-${this.uniqueId()}@example.com`;
  }

  /**
   * Generate unique name
   */
  uniqueName(prefix = "Test"): string {
    return `${prefix} ${this.uniqueId()}`;
  }

  /**
   * Create test admin user
   */
  async createAdminUser(
    overrides: Partial<Omit<AdminUser, "id" | "createdAt" | "updatedAt">> = {}
  ): Promise<AdminUser> {
    const user = await prisma.adminUser.create({
      data: {
        email: this.uniqueEmail("admin"),
        passwordHash: "$2b$10$testHash123456789012345678901234567890123456789012",
        roleId: "role-admin",
        ...overrides,
      },
    });
    this.createdIds.adminUsers.push(user.id);
    return user;
  }

  /**
   * Create test account
   */
  async createAccount(
    overrides: Partial<Omit<Account, "id" | "createdAt" | "updatedAt">> = {}
  ): Promise<Account> {
    const account = await prisma.account.create({
      data: {
        email: this.uniqueEmail("account"),
        name: this.uniqueName("Account"),
        subscription: "PRO",
        ...overrides,
      },
    });
    this.createdIds.accounts.push(account.id);
    return account;
  }

  /**
   * Create test project
   */
  async createProject(
    accountId: string,
    overrides: Partial<Omit<Project, "id" | "accountId" | "createdAt" | "updatedAt">> = {}
  ): Promise<Project> {
    const project = await prisma.project.create({
      data: {
        accountId,
        name: this.uniqueName("Project"),
        locale: "en",
        ...overrides,
      },
    });
    this.createdIds.projects.push(project.id);
    return project;
  }

  /**
   * Create test channel
   */
  async createChannel(
    projectId: string,
    overrides: Partial<Omit<Channel, "id" | "projectId" | "createdAt" | "updatedAt">> = {}
  ): Promise<Channel> {
    const channel = await prisma.channel.create({
      data: {
        projectId,
        provider: "x",
        name: this.uniqueName("Channel"),
        accessToken: `test-token-${this.uniqueId()}`,
        refreshToken: `test-refresh-${this.uniqueId()}`,
        expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
        providerAccountId: this.uniqueId(),
        ...overrides,
      },
    });
    this.createdIds.channels.push(channel.id);
    return channel;
  }

  /**
   * Create test post
   */
  async createPost(
    projectId: string,
    overrides: Partial<Omit<Post, "id" | "projectId" | "createdAt" | "updatedAt">> = {}
  ): Promise<Post> {
    const post = await prisma.post.create({
      data: {
        projectId,
        status: "draft",
        ...overrides,
      },
    });
    this.createdIds.posts.push(post.id);
    return post;
  }

  /**
   * Create a complete test hierarchy: Account -> Project -> Channel + Post
   */
  async createTestHierarchy(): Promise<{
    account: Account;
    project: Project;
    channel: Channel;
    post: Post;
  }> {
    const account = await this.createAccount();
    const project = await this.createProject(account.id);
    const channel = await this.createChannel(project.id);
    const post = await this.createPost(project.id);

    return { account, project, channel, post };
  }

  /**
   * Get all created entity IDs for manual cleanup or verification
   */
  getCreatedIds(): Readonly<CreatedIds> {
    return { ...this.createdIds };
  }

  /**
   * Cleanup all created test data (reverse dependency order)
   * IMPORTANT: Call this in after() hooks to prevent test pollution
   */
  async cleanup(): Promise<void> {
    try {
      // Delete in reverse order of foreign key dependencies
      if (this.createdIds.posts.length > 0) {
        // First delete related records
        await prisma.postMedia.deleteMany({
          where: { postId: { in: this.createdIds.posts } },
        });
        await prisma.postContent.deleteMany({
          where: { postId: { in: this.createdIds.posts } },
        });
        await prisma.publishLog.deleteMany({
          where: { postId: { in: this.createdIds.posts } },
        });
        await prisma.post.deleteMany({
          where: { id: { in: this.createdIds.posts } },
        });
      }

      if (this.createdIds.channels.length > 0) {
        await prisma.channel.deleteMany({
          where: { id: { in: this.createdIds.channels } },
        });
      }

      if (this.createdIds.projects.length > 0) {
        await prisma.project.deleteMany({
          where: { id: { in: this.createdIds.projects } },
        });
      }

      if (this.createdIds.accounts.length > 0) {
        await prisma.account.deleteMany({
          where: { id: { in: this.createdIds.accounts } },
        });
      }

      if (this.createdIds.adminUsers.length > 0) {
        // Delete related admin sessions first
        await prisma.adminSession.deleteMany({
          where: { adminUserId: { in: this.createdIds.adminUsers } },
        });
        await prisma.adminUser.deleteMany({
          where: { id: { in: this.createdIds.adminUsers } },
        });
      }

      // Reset tracking
      this.createdIds = {
        adminUsers: [],
        accounts: [],
        projects: [],
        posts: [],
        channels: [],
      };
    } catch (err) {
      console.warn("Test data cleanup warning:", err);
    }
  }
}

/**
 * Create a new test data factory instance
 * Each test file should create its own factory
 */
export function createTestDataFactory(): TestDataFactory {
  return new TestDataFactory();
}
