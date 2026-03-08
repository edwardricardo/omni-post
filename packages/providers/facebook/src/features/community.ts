import { FacebookApiClient, FacebookCredentials } from "../apiClient.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:facebook:community");

export type {
  FacebookComment,
  FacebookMessage,
  FacebookModerationAction,
  FacebookModerationRule,
  FacebookCommunityInsights,
  FacebookConversation,
  FacebookQuickReply,
  FacebookMessageTemplate,
} from "./communityTypes.js";

import type {
  FacebookComment,
  FacebookMessage,
  FacebookModerationAction,
  FacebookModerationRule,
  FacebookCommunityInsights,
  FacebookConversation,
  FacebookQuickReply,
  FacebookMessageTemplate,
} from "./communityTypes.js";

export class FacebookCommunityApi {
  private apiClient: FacebookApiClient;

  constructor(credentials: FacebookCredentials) {
    this.apiClient = new FacebookApiClient(credentials);
  }

  /**
   * Get comments for a post
   */
  async getPostComments(
    postId: string,
    options: {
      filter?: "stream" | "toplevel";
      order?: "chronological" | "reverse_chronological";
      includeReplies?: boolean;
      limit?: number;
      after?: string;
    } = {}
  ): Promise<{
    comments: FacebookComment[];
    hasNextPage: boolean;
    nextCursor?: string;
  }> {
    const params = new URLSearchParams({
      fields:
        "id,message,from{id,name,picture},created_time,like_count,comment_count,parent,can_reply,can_like,can_hide,can_remove,is_hidden,attachment,user_likes,permalink_url",
      filter: options.filter || "stream",
      order: options.order || "chronological",
      limit: (options.limit || 25).toString(),
    });

    if (options.after) {
      params.append("after", options.after);
    }

    const response = await this.apiClient.makeApiRequest(`/${postId}/comments?${params}`);

    const data = await response.json();

    const comments = (data.data || []).map((comment: any) => ({
      id: comment.id,
      message: comment.message || "",
      from: {
        id: comment.from.id,
        name: comment.from.name,
        profilePicture: comment.from.picture?.data?.url,
      },
      createdTime: comment.created_time,
      likeCount: comment.like_count || 0,
      replyCount: comment.comment_count || 0,
      parentId: comment.parent?.id,
      canReply: comment.can_reply || false,
      canLike: comment.can_like || false,
      canHide: comment.can_hide || false,
      canRemove: comment.can_remove || false,
      isHidden: comment.is_hidden || false,
      attachment: comment.attachment
        ? {
            type: comment.attachment.type,
            url: comment.attachment.url,
            description: comment.attachment.description,
          }
        : undefined,
      userLikes: comment.user_likes || false,
      permalink: comment.permalink_url,
    }));

    // Get replies if requested and not already included
    if (options.includeReplies) {
      for (const comment of comments) {
        if (comment.replyCount > 0 && !comment.parentId) {
          const replies = await this.getCommentReplies(comment.id);
          comments.push(...replies);
        }
      }
    }

    return {
      comments,
      hasNextPage: !!data.paging?.next,
      nextCursor: data.paging?.cursors?.after,
    };
  }

  /**
   * Get replies to a comment
   */
  async getCommentReplies(commentId: string, limit = 25): Promise<FacebookComment[]> {
    const response = await this.apiClient.makeApiRequest(
      `/${commentId}/comments?fields=id,message,from{id,name,picture},created_time,like_count,parent,can_reply,can_like,can_hide,can_remove,is_hidden,attachment,user_likes&limit=${limit}`
    );

    const data = await response.json();

    return (data.data || []).map((reply: any) => ({
      id: reply.id,
      message: reply.message || "",
      from: {
        id: reply.from.id,
        name: reply.from.name,
        profilePicture: reply.from.picture?.data?.url,
      },
      createdTime: reply.created_time,
      likeCount: reply.like_count || 0,
      replyCount: 0, // Replies to replies are not supported
      parentId: reply.parent?.id || commentId,
      canReply: reply.can_reply || false,
      canLike: reply.can_like || false,
      canHide: reply.can_hide || false,
      canRemove: reply.can_remove || false,
      isHidden: reply.is_hidden || false,
      attachment: reply.attachment
        ? {
            type: reply.attachment.type,
            url: reply.attachment.url,
            description: reply.attachment.description,
          }
        : undefined,
      userLikes: reply.user_likes || false,
    }));
  }

  /**
   * Reply to a comment
   */
  async replyToComment(
    commentId: string,
    message: string,
    attachmentUrl?: string
  ): Promise<FacebookComment> {
    const replyData: Record<string, unknown> = {
      message,
    };

    // Upload attachment if provided
    if (attachmentUrl) {
      await this.apiClient.uploadUnpublishedMedia(attachmentUrl, "photo");
      replyData.attachment_url = attachmentUrl;
    }

    const response = await this.apiClient.makeApiRequest(`/${commentId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(replyData),
    });

    const result = await response.json();

    // Get the full comment details
    const commentResponse = await this.apiClient.makeApiRequest(
      `/${result.id}?fields=id,message,from{id,name,picture},created_time,like_count,parent,can_reply,can_like,can_hide,can_remove,is_hidden,attachment,user_likes`
    );

    const commentData = await commentResponse.json();

    return {
      id: commentData.id,
      message: commentData.message || "",
      from: {
        id: commentData.from.id,
        name: commentData.from.name,
        profilePicture: commentData.from.picture?.data?.url,
      },
      createdTime: commentData.created_time,
      likeCount: commentData.like_count || 0,
      replyCount: 0,
      parentId: commentData.parent?.id,
      canReply: commentData.can_reply || false,
      canLike: commentData.can_like || false,
      canHide: commentData.can_hide || false,
      canRemove: commentData.can_remove || false,
      isHidden: commentData.is_hidden || false,
      ...(commentData.attachment && {
        attachment: {
          type: commentData.attachment.type,
          url: commentData.attachment.url,
          description: commentData.attachment.description,
        },
      }),
      userLikes: commentData.user_likes || false,
    };
  }

  /**
   * Perform moderation actions
   */
  async moderateContent(action: FacebookModerationAction): Promise<boolean> {
    try {
      switch (action.type) {
        case "hide":
          await this.apiClient.makeApiRequest(`/${action.targetId}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ is_hidden: true }),
          });
          break;

        case "delete":
          await this.apiClient.makeApiRequest(`/${action.targetId}`, {
            method: "DELETE",
          });
          break;

        case "ban_user":
          // Facebook doesn't have direct ban user API, but we can restrict them
          await this.apiClient.makeApiRequest(`/${this.apiClient.credentials.pageId}/blocked`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              uid: action.targetId,
              ...(action.reason && { reason: action.reason }),
            }),
          });
          break;

        case "approve":
          await this.apiClient.makeApiRequest(`/${action.targetId}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ is_hidden: false }),
          });
          break;

        case "report_spam":
          // Report the content as spam to Facebook
          await this.apiClient.makeApiRequest(`/${action.targetId}/reports`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              reason: "spam",
              ...(action.message && { message: action.message }),
            }),
          });
          break;
      }

      return true;
    } catch (error) {
      logger.error({ err: error, actionType: action.type }, "Failed to perform moderation action");
      return false;
    }
  }

  /**
   * Get page conversations
   */
  async getConversations(
    options: {
      folder?: "inbox" | "other" | "done";
      tags?: string[];
      limit?: number;
      after?: string;
    } = {}
  ): Promise<{
    conversations: FacebookConversation[];
    hasNextPage: boolean;
    nextCursor?: string;
  }> {
    const params = new URLSearchParams({
      fields:
        "id,participants,message_count,unread_count,updated_time,messages{id,message,from,to,created_time,attachments,tags}.limit(1)",
      limit: (options.limit || 25).toString(),
    });

    if (options.folder) {
      params.append("folder", options.folder);
    }

    if (options.tags?.length) {
      params.append("tags", options.tags.join(","));
    }

    if (options.after) {
      params.append("after", options.after);
    }

    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/conversations?${params}`
    );

    const data = await response.json();

    const conversations = (data.data || []).map((conv: any) => ({
      id: conv.id,
      participants: conv.participants.data.map((p: any) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        profilePicture: p.picture?.data?.url,
      })),
      messageCount: conv.message_count || 0,
      unreadCount: conv.unread_count || 0,
      lastMessage: conv.messages?.data?.[0]
        ? {
            id: conv.messages.data[0].id,
            message: conv.messages.data[0].message,
            from: conv.messages.data[0].from,
            to: conv.messages.data[0].to,
            createdTime: conv.messages.data[0].created_time,
            attachments: conv.messages.data[0].attachments,
            isRead: conv.unread_count === 0,
            tags: conv.messages.data[0].tags,
          }
        : undefined,
      updatedTime: conv.updated_time,
      tags: conv.tags,
    }));

    return {
      conversations,
      hasNextPage: !!data.paging?.next,
      nextCursor: data.paging?.cursors?.after,
    };
  }

  /**
   * Get messages from a conversation
   */
  async getConversationMessages(
    conversationId: string,
    options: {
      limit?: number;
      after?: string;
      before?: string;
    } = {}
  ): Promise<{
    messages: FacebookMessage[];
    hasNextPage: boolean;
    nextCursor?: string;
  }> {
    const params = new URLSearchParams({
      fields: "id,message,from,to,created_time,attachments,tags,sticker",
      limit: (options.limit || 25).toString(),
    });

    if (options.after) {
      params.append("after", options.after);
    }

    if (options.before) {
      params.append("before", options.before);
    }

    const response = await this.apiClient.makeApiRequest(`/${conversationId}/messages?${params}`);

    const data = await response.json();

    const messages = (data.data || []).map((msg: any) => ({
      id: msg.id,
      message: msg.message,
      from: {
        id: msg.from.id,
        name: msg.from.name,
        email: msg.from.email,
        profilePicture: msg.from.picture?.data?.url,
      },
      to: {
        id: msg.to.id,
        name: msg.to.name,
      },
      createdTime: msg.created_time,
      attachments: msg.attachments,
      isRead: true, // Assume read when fetching
      tags: msg.tags,
      sticker: msg.sticker,
    }));

    return {
      messages,
      hasNextPage: !!data.paging?.next,
      nextCursor: data.paging?.cursors?.after,
    };
  }

  /**
   * Send a message
   */
  async sendMessage(
    recipientId: string,
    content: {
      text?: string;
      attachmentUrl?: string;
      quickReplies?: FacebookQuickReply[];
      template?: Record<string, unknown>;
    }
  ): Promise<FacebookMessage> {
    const messageData: Record<string, unknown> = {
      recipient: { id: recipientId },
      message: {},
    };

    if (content.text) {
      messageData.message.text = content.text;
    }

    if (content.attachmentUrl) {
      messageData.message.attachment = {
        type: "image", // Determine type from URL
        payload: {
          url: content.attachmentUrl,
          is_reusable: true,
        },
      };
    }

    if (content.quickReplies?.length) {
      messageData.message.quick_replies = content.quickReplies;
    }

    if (content.template) {
      messageData.message.attachment = {
        type: "template",
        payload: content.template,
      };
    }

    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageData),
      }
    );

    const result = await response.json();

    return {
      id: result.message_id,
      ...(content.text !== undefined && { message: content.text }),
      from: {
        id: this.apiClient.credentials.pageId,
        name: "Page",
      },
      to: {
        id: recipientId,
        name: "User",
      },
      createdTime: new Date().toISOString(),
      isRead: false,
    };
  }

  /**
   * Mark conversation as read
   */
  async markConversationAsRead(conversationId: string): Promise<boolean> {
    try {
      await this.apiClient.makeApiRequest(`/${conversationId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ read: true }),
      });

      return true;
    } catch (error) {
      logger.error({ err: error }, "Failed to mark conversation as read");
      return false;
    }
  }

  /**
   * Tag conversation
   */
  async tagConversation(conversationId: string, tags: string[]): Promise<boolean> {
    try {
      await this.apiClient.makeApiRequest(`/${conversationId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags: tags.join(",") }),
      });

      return true;
    } catch (error) {
      logger.error({ err: error }, "Failed to tag conversation");
      return false;
    }
  }

  /**
   * Get community insights
   */
  async getCommunityInsights(period?: {
    since?: Date;
    until?: Date;
  }): Promise<FacebookCommunityInsights> {
    // This would typically aggregate data from multiple API calls
    // For now, return a structured response with available metrics

    const pageInsights = await this.apiClient.getPageInsights(period?.since, period?.until);

    // Mock community-specific insights structure
    return {
      pageId: this.apiClient.credentials.pageId,
      period: {
        since:
          period?.since?.toISOString() ||
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        until: period?.until?.toISOString() || new Date().toISOString(),
      },
      engagement: {
        totalComments: pageInsights.comments || 0,
        totalMessages: 0, // Would need to count from conversations
        avgResponseTime: 0,
        responseRate: 0,
        resolvedQueries: 0,
        escalatedQueries: 0,
      },
      sentiment: {
        positive: 0,
        neutral: 0,
        negative: 0,
      },
      topContributors: [],
      moderationStats: {
        hiddenComments: 0,
        deletedComments: 0,
        bannedUsers: 0,
        reportedContent: 0,
        autoModeratedActions: 0,
      },
      popularTopics: [],
      responseTime: {
        avgFirstResponse: 0,
        avgResolution: 0,
        withinSLA: 0,
      },
    };
  }

  /**
   * Create auto-moderation rule
   */
  async createModerationRule(
    _rule: FacebookModerationRule
  ): Promise<{ id: string; success: boolean }> {
    // This would typically integrate with Facebook's content moderation tools
    // For now, return a mock response
    const ruleId = `rule_${Date.now()}`;

    logger.info({ ruleId }, "Creating moderation rule");

    return {
      id: ruleId,
      success: true,
    };
  }

  /**
   * Get page roles and admins
   */
  async getPageRoles(): Promise<
    Array<{
      userId: string;
      name: string;
      role: string;
      canPostAsPage: boolean;
      canManagePageSettings: boolean;
      canModeratePage: boolean;
    }>
  > {
    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/roles?fields=user{id,name},role`
    );

    const data = await response.json();

    return (data.data || []).map((roleData: any) => ({
      userId: roleData.user.id,
      name: roleData.user.name,
      role: roleData.role,
      canPostAsPage: ["admin", "editor"].includes(roleData.role.toLowerCase()),
      canManagePageSettings: roleData.role.toLowerCase() === "admin",
      canModeratePage: ["admin", "editor", "moderator"].includes(roleData.role.toLowerCase()),
    }));
  }

  /**
   * Set typing indicator
   */
  async setTypingIndicator(recipientId: string, isTyping: boolean): Promise<boolean> {
    try {
      await this.apiClient.makeApiRequest(`/${this.apiClient.credentials.pageId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          sender_action: isTyping ? "typing_on" : "typing_off",
        }),
      });

      return true;
    } catch (error) {
      logger.error({ err: error }, "Failed to set typing indicator");
      return false;
    }
  }

  /**
   * Get message templates
   */
  async getMessageTemplates(): Promise<FacebookMessageTemplate[]> {
    // This would fetch saved message templates
    // For now, return an empty array as this requires additional setup
    return [];
  }

  /**
   * Save message template
   */
  async saveMessageTemplate(
    _template: FacebookMessageTemplate
  ): Promise<{ id: string; success: boolean }> {
    // This would save a reusable message template
    const templateId = `template_${Date.now()}`;

    logger.info({ templateId }, "Saving message template");

    return {
      id: templateId,
      success: true,
    };
  }
}
