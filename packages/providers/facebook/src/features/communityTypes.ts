/**
 * @file communityTypes.ts
 * @description Type definitions for Facebook community features — comments, messages, moderation
 *              rules, conversations, quick replies, and templates.
 * @layer infrastructure
 */
export interface FacebookComment {
  id: string;
  message: string;
  from: {
    id: string;
    name: string;
    profilePicture?: string;
  };
  createdTime: string;
  likeCount: number;
  replyCount: number;
  parentId?: string; // For replies
  canReply: boolean;
  canLike: boolean;
  canHide: boolean;
  canRemove: boolean;
  isHidden: boolean;
  attachment?: {
    type: "photo" | "video" | "link" | "sticker";
    url?: string;
    description?: string;
  };
  userLikes: boolean;
  permalink?: string;
}

export interface FacebookMessage {
  id: string;
  message?: string;
  from: {
    id: string;
    name: string;
    email?: string;
    profilePicture?: string;
  };
  to: {
    id: string;
    name: string;
  };
  createdTime: string;
  attachments?: Array<{
    type: "image" | "video" | "audio" | "file" | "template" | "fallback";
    payload?: {
      url?: string;
      templateType?: string;
      elements?: unknown[];
    };
  }>;
  isRead: boolean;
  tags?: string[];
  sticker?: {
    id: string;
    url: string;
  };
}

export interface FacebookModerationAction {
  type: "hide" | "delete" | "ban_user" | "approve" | "report_spam";
  targetId: string; // Comment ID or User ID
  reason?: string;
  duration?: number; // For temporary bans (in hours)
  message?: string; // Optional message to user
}

export interface FacebookModerationRule {
  id?: string;
  name: string;
  isActive: boolean;
  triggers: {
    keywords?: string[];
    phrases?: string[];
    userIds?: string[];
    regex?: string;
    sentiment?: "negative" | "positive" | "neutral";
    reportCount?: number;
  };
  actions: {
    autoHide?: boolean;
    autoDelete?: boolean;
    flagForReview?: boolean;
    notifyModerators?: boolean;
    sendWarning?: boolean;
    banUser?: {
      duration: number; // hours
      reason: string;
    };
  };
  exceptions?: {
    userIds?: string[]; // Users exempt from this rule
    adminOverride?: boolean;
  };
}

export interface FacebookCommunityInsights {
  pageId: string;
  period: {
    since: string;
    until: string;
  };
  engagement: {
    totalComments: number;
    totalMessages: number;
    avgResponseTime: number; // in minutes
    responseRate: number; // percentage
    resolvedQueries: number;
    escalatedQueries: number;
  };
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
  };
  topContributors: Array<{
    userId: string;
    name: string;
    commentCount: number;
    likeCount: number;
    engagementScore: number;
  }>;
  moderationStats: {
    hiddenComments: number;
    deletedComments: number;
    bannedUsers: number;
    reportedContent: number;
    autoModeratedActions: number;
  };
  popularTopics: Array<{
    topic: string;
    mentions: number;
    sentiment: "positive" | "negative" | "neutral";
  }>;
  responseTime: {
    avgFirstResponse: number; // minutes
    avgResolution: number; // minutes
    withinSLA: number; // percentage
  };
}

export interface FacebookConversation {
  id: string;
  participants: Array<{
    id: string;
    name: string;
    email?: string;
    profilePicture?: string;
  }>;
  messageCount: number;
  unreadCount: number;
  lastMessage: FacebookMessage;
  updatedTime: string;
  tags?: string[];
  priority?: "low" | "normal" | "high" | "urgent";
  status?: "open" | "pending" | "resolved" | "closed";
  assignedTo?: {
    id: string;
    name: string;
  };
}

export interface FacebookQuickReply {
  contentType: "text" | "location" | "user_phone_number" | "user_email";
  title: string;
  payload?: string;
  imageUrl?: string;
}

export interface FacebookMessageTemplate {
  id?: string;
  name: string;
  text: string;
  quickReplies?: FacebookQuickReply[];
  attachments?: Array<{
    type: "image" | "audio" | "video" | "template";
    payload: {
      url?: string;
      templateType?: "generic" | "button" | "receipt" | "list";
      elements?: unknown[];
    };
  }>;
  tags?: string[];
  category?: string;
  isActive: boolean;
}
