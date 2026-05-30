/**
 * @file events.ts
 * @description Facebook Events API client -- CRUD, attendees, insights, posts, invites.
 * Type definitions live in eventTypes.ts.
 * @layer infrastructure
 */

import { FacebookApiClient, FacebookCredentials } from "../apiClient.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:facebook:events");

// Re-export all types so existing importers continue to work
export type {
  FacebookEventLocation,
  FacebookEventTicketing,
  FacebookEventOptions,
  FacebookEventResponse,
  FacebookEventAttendee,
  FacebookEventInsights,
  FacebookEventPost,
  FacebookEventUpdate,
} from "./eventTypes.js";

import type {
  FacebookEventLocation,
  FacebookEventOptions,
  FacebookEventResponse,
  FacebookEventAttendee,
  FacebookEventInsights,
  FacebookEventPost,
  FacebookEventUpdate,
} from "./eventTypes.js";

export class FacebookEventsApi {
  private apiClient: FacebookApiClient;

  constructor(credentials: FacebookCredentials) {
    this.apiClient = new FacebookApiClient(credentials);
  }

  /**
   * Create a new Facebook Event
   */
  async createEvent(options: FacebookEventOptions): Promise<FacebookEventResponse> {
    let coverPhotoId: string | undefined;

    if (options.coverPhoto) {
      const coverUpload = await this.apiClient.uploadUnpublishedMedia(options.coverPhoto, "photo");
      coverPhotoId = coverUpload.id;
    }

    const eventData: Record<string, unknown> = {
      name: options.name,
      description: options.description,
      start_time: options.startTime.toISOString(),
      is_page_owned: options.isPageOwned !== false,
    };

    if (options.endTime) {
      eventData.end_time = options.endTime.toISOString();
    }

    if (options.location && !options.isOnline) {
      if (options.location.placeId) {
        eventData.place = options.location.placeId;
      } else {
        eventData.location_name = options.location.name;
        if (options.location.street || options.location.city) {
          const addressParts = [
            options.location.street,
            options.location.city,
            options.location.state,
            options.location.country,
          ].filter(Boolean);
          eventData.location_address = addressParts.join(", ");
        }
      }
    }

    if (options.isOnline) {
      eventData.is_online = true;
      if (options.onlineEventUrl) {
        eventData.online_event_url = options.onlineEventUrl;
      }
    }

    if (coverPhotoId) {
      eventData.cover = coverPhotoId;
    }
    if (options.category) {
      eventData.category = options.category;
    }
    if (options.privacy) {
      eventData.privacy = options.privacy;
    }
    if (options.timezone) {
      eventData.event_state_filter = options.timezone;
    }
    if (options.guestListEnabled !== undefined) {
      eventData.guest_list_enabled = options.guestListEnabled;
    }
    if (options.canGuestsInvite !== undefined) {
      eventData.can_guests_invite = options.canGuestsInvite;
    }

    if (options.ticketing) {
      if (options.ticketing.ticketUrl) {
        eventData.ticket_url = options.ticketing.ticketUrl;
      }
      if (options.ticketing.ticketingTermsUrl) {
        eventData.ticketing_terms_url = options.ticketing.ticketingTermsUrl;
      }
      if (options.ticketing.isFree !== undefined) {
        eventData.is_free = options.ticketing.isFree;
      }
    }

    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      }
    );

    const result = await response.json();
    return this.getEventDetails(result.id);
  }

  /**
   * Get event details
   */
  async getEventDetails(eventId: string): Promise<FacebookEventResponse> {
    const fields = [
      "id",
      "name",
      "description",
      "start_time",
      "end_time",
      "place",
      "cover",
      "attending_count",
      "interested_count",
      "maybe_count",
      "noreply_count",
      "event_times",
      "is_online",
      "online_event_url",
      "category",
      "type",
      "timezone",
      "created_time",
      "updated_time",
      "owner",
      "is_canceled",
    ];

    const response = await this.apiClient.makeApiRequest(`/${eventId}?fields=${fields.join(",")}`);
    const data = await response.json();

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      startTime: data.start_time,
      ...(data.end_time !== undefined && { endTime: data.end_time }),
      ...(data.place !== undefined && {
        location: {
          ...(data.place.name !== undefined && { name: data.place.name }),
          ...(data.place.location?.street !== undefined && { street: data.place.location.street }),
          ...(data.place.location?.city !== undefined && { city: data.place.location.city }),
          ...(data.place.location?.state !== undefined && { state: data.place.location.state }),
          ...(data.place.location?.country !== undefined && {
            country: data.place.location.country,
          }),
          ...(data.place.location?.zip !== undefined && { zip: data.place.location.zip }),
          ...(data.place.location?.latitude !== undefined && {
            latitude: data.place.location.latitude,
          }),
          ...(data.place.location?.longitude !== undefined && {
            longitude: data.place.location.longitude,
          }),
          ...(data.place.id !== undefined && { placeId: data.place.id }),
        } as FacebookEventLocation,
      }),
      ...(data.cover !== undefined && {
        coverPhoto: { id: data.cover.id, source: data.cover.source },
      }),
      attendingCount: data.attending_count || 0,
      interestedCount: data.interested_count || 0,
      maybeCount: data.maybe_count || 0,
      noreplyCount: data.noreply_count || 0,
      permalink: `https://www.facebook.com/events/${data.id}`,
      category: data.category || "OTHER",
      privacy: data.type || "PUBLIC",
      isOnline: data.is_online || false,
      ...(data.online_event_url !== undefined && { onlineEventUrl: data.online_event_url }),
      timezone: data.timezone || "UTC",
      createdTime: data.created_time,
      updatedTime: data.updated_time,
      status: data.is_canceled ? "CANCELLED" : "PUBLISHED",
    };
  }

  /**
   * Update an existing event
   */
  async updateEvent(eventId: string, updates: FacebookEventUpdate): Promise<FacebookEventResponse> {
    const updateData: Record<string, unknown> = {};

    if (updates.name) updateData.name = updates.name;
    if (updates.description) updateData.description = updates.description;
    if (updates.startTime) updateData.start_time = updates.startTime.toISOString();
    if (updates.endTime) updateData.end_time = updates.endTime.toISOString();

    if (updates.location) {
      if (updates.location.placeId) {
        updateData.place = updates.location.placeId;
      } else {
        updateData.location_name = updates.location.name;
        if (updates.location.street || updates.location.city) {
          const addressParts = [
            updates.location.street,
            updates.location.city,
            updates.location.state,
            updates.location.country,
          ].filter(Boolean);
          updateData.location_address = addressParts.join(", ");
        }
      }
    }

    if (updates.coverPhoto) {
      const coverUpload = await this.apiClient.uploadUnpublishedMedia(updates.coverPhoto, "photo");
      updateData.cover = coverUpload.id;
    }
    if (updates.category) updateData.category = updates.category;
    if (updates.privacy) updateData.type = updates.privacy;
    if (updates.isOnline !== undefined) updateData.is_online = updates.isOnline;
    if (updates.onlineEventUrl) updateData.online_event_url = updates.onlineEventUrl;

    if (updates.ticketing) {
      if (updates.ticketing.ticketUrl) updateData.ticket_url = updates.ticketing.ticketUrl;
      if (updates.ticketing.isFree !== undefined) updateData.is_free = updates.ticketing.isFree;
    }

    await this.apiClient.makeApiRequest(`/${eventId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateData),
    });

    return this.getEventDetails(eventId);
  }

  /**
   * Cancel an event
   */
  async cancelEvent(eventId: string): Promise<boolean> {
    try {
      await this.apiClient.makeApiRequest(`/${eventId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_canceled: true }),
      });
      return true;
    } catch (error) {
      logger.error({ err: error }, "Failed to cancel event");
      return false;
    }
  }

  /**
   * Delete an event
   */
  async deleteEvent(eventId: string): Promise<boolean> {
    try {
      const response = await this.apiClient.makeApiRequest(`/${eventId}`, {
        method: "DELETE",
      });
      const result = await response.json();
      return result.success === true;
    } catch (error) {
      logger.error({ err: error }, "Failed to delete event");
      return false;
    }
  }

  /**
   * Get event attendees
   */
  async getEventAttendees(
    eventId: string,
    rsvpStatus?: "attending" | "interested" | "maybe" | "not_replied",
    limit = 100
  ): Promise<FacebookEventAttendee[]> {
    const endpoint = rsvpStatus ? `${rsvpStatus}` : "attending";
    const response = await this.apiClient.makeApiRequest(
      `/${eventId}/${endpoint}?fields=id,name,picture,rsvp_status&limit=${limit}`
    );
    const data = await response.json();

    return (data.data || []).map((attendee: Record<string, unknown>) => {
      const picture = attendee.picture as Record<string, unknown> | undefined;
      const pictureData = picture?.data as Record<string, unknown> | undefined;
      return {
        id: attendee.id as string,
        name: attendee.name as string,
        rsvpStatus: (attendee.rsvp_status as string) || rsvpStatus || "attending",
        profilePicture: pictureData?.url as string | undefined,
        joinedTime: (attendee.created_time as string) || new Date().toISOString(),
      };
    });
  }

  /**
   * Get all event attendees by RSVP status
   */
  async getAllEventAttendees(eventId: string): Promise<{
    attending: FacebookEventAttendee[];
    interested: FacebookEventAttendee[];
    maybe: FacebookEventAttendee[];
    notReplied: FacebookEventAttendee[];
  }> {
    const [attending, interested, maybe, notReplied] = await Promise.all([
      this.getEventAttendees(eventId, "attending"),
      this.getEventAttendees(eventId, "interested"),
      this.getEventAttendees(eventId, "maybe"),
      this.getEventAttendees(eventId, "not_replied"),
    ]);
    return { attending, interested, maybe, notReplied };
  }

  /**
   * Get event insights and analytics
   */
  async getEventInsights(
    eventId: string,
    period?: { since?: Date; until?: Date }
  ): Promise<FacebookEventInsights> {
    const metrics = [
      "event_impressions",
      "event_reach",
      "event_views",
      "event_responses",
      "event_ticket_clicks",
      "event_website_clicks",
      "event_action_clicks",
      "event_photo_views",
    ];
    const params = new URLSearchParams({ metric: metrics.join(","), period: "lifetime" });

    if (period?.since) {
      params.append("since", Math.floor(period.since.getTime() / 1000).toString());
    }
    if (period?.until) {
      params.append("until", Math.floor(period.until.getTime() / 1000).toString());
    }

    const response = await this.apiClient.makeApiRequest(`/${eventId}/insights?${params}`);
    const data = await response.json();
    const eventDetails = await this.getEventDetails(eventId);

    const insights: Partial<FacebookEventInsights> = {
      eventId,
      impressions: 0,
      reach: 0,
      eventViews: 0,
      eventResponses: 0,
      ticketClicks: 0,
      websiteClicks: 0,
      actionClicks: 0,
      photoViews: 0,
      rsvpBreakdown: {
        attending: eventDetails.attendingCount,
        interested: eventDetails.interestedCount,
        maybe: eventDetails.maybeCount,
        notReplied: eventDetails.noreplyCount,
      },
      trafficSources: { facebook: 0, instagram: 0, external: 0, direct: 0 },
    };

    if (data.data && Array.isArray(data.data)) {
      for (const metric of data.data) {
        const value = metric.values?.[0]?.value || 0;
        switch (metric.name) {
          case "event_impressions":
            insights.impressions = value;
            break;
          case "event_reach":
            insights.reach = value;
            break;
          case "event_views":
            insights.eventViews = value;
            break;
          case "event_responses":
            insights.eventResponses = value;
            break;
          case "event_ticket_clicks":
            insights.ticketClicks = value;
            break;
          case "event_website_clicks":
            insights.websiteClicks = value;
            break;
          case "event_action_clicks":
            insights.actionClicks = value;
            break;
          case "event_photo_views":
            insights.photoViews = value;
            break;
        }
      }
    }

    return insights as FacebookEventInsights;
  }

  /**
   * Post an update to the event
   */
  async postEventUpdate(
    eventId: string,
    message: string,
    mediaUrl?: string
  ): Promise<FacebookEventPost> {
    const postData: Record<string, unknown> = { message };

    if (mediaUrl) {
      const mediaUpload = await this.apiClient.uploadUnpublishedMedia(mediaUrl, "photo");
      postData.attached_media = [{ media_fbid: mediaUpload.id }];
    }

    const response = await this.apiClient.makeApiRequest(`/${eventId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postData),
    });
    const result = await response.json();

    const postResponse = await this.apiClient.makeApiRequest(
      `/${result.id}?fields=id,message,created_time,reactions.summary(total_count),comments.summary(total_count),shares`
    );
    const postResult = await postResponse.json();

    return {
      id: postResult.id,
      message: postResult.message,
      createdTime: postResult.created_time,
      reactions: {
        like: postResult.reactions?.summary?.total_count || 0,
        love: 0,
        wow: 0,
        haha: 0,
        sad: 0,
        angry: 0,
      },
      comments: postResult.comments?.summary?.total_count || 0,
      shares: postResult.shares?.count || 0,
    };
  }

  /**
   * Get event posts/updates
   */
  async getEventPosts(eventId: string, limit = 25): Promise<FacebookEventPost[]> {
    const response = await this.apiClient.makeApiRequest(
      `/${eventId}/feed?fields=id,message,created_time,reactions.summary(total_count),comments.summary(total_count),shares&limit=${limit}`
    );
    const data = await response.json();

    return (data.data || []).map((post: Record<string, unknown>) => {
      const reactions = post.reactions as Record<string, unknown> | undefined;
      const reactionsSummary = reactions?.summary as Record<string, unknown> | undefined;
      const comments = post.comments as Record<string, unknown> | undefined;
      const commentsSummary = comments?.summary as Record<string, unknown> | undefined;
      const shares = post.shares as Record<string, unknown> | undefined;
      return {
        id: post.id as string,
        message: post.message as string,
        createdTime: post.created_time as string,
        reactions: {
          like: (reactionsSummary?.total_count as number) || 0,
          love: 0,
          wow: 0,
          haha: 0,
          sad: 0,
          angry: 0,
        },
        comments: (commentsSummary?.total_count as number) || 0,
        shares: (shares?.count as number) || 0,
      };
    });
  }

  /**
   * Invite users to an event
   */
  async inviteUsersToEvent(
    eventId: string,
    userIds: string[]
  ): Promise<{ success: boolean; invited: string[]; failed: string[] }> {
    const results = { success: true, invited: [] as string[], failed: [] as string[] };

    for (const userId of userIds) {
      try {
        await this.apiClient.makeApiRequest(`/${eventId}/invited`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: userId }),
        });
        results.invited.push(userId);
      } catch (error) {
        logger.warn({ err: error, userId }, "Failed to invite user");
        results.failed.push(userId);
      }
    }

    if (results.failed.length > 0) results.success = false;
    return results;
  }

  /**
   * Get page events
   */
  async getPageEvents(
    timeFilter?: "upcoming" | "past",
    limit = 25
  ): Promise<FacebookEventResponse[]> {
    let timeFilterParam = "";
    if (timeFilter === "upcoming") timeFilterParam = "&time_filter=upcoming";
    else if (timeFilter === "past") timeFilterParam = "&time_filter=past";

    const response = await this.apiClient.makeApiRequest(
      `/${this.apiClient.credentials.pageId}/events?limit=${limit}${timeFilterParam}`
    );
    const data = await response.json();
    return Promise.all(
      (data.data || []).map((event: Record<string, unknown>) =>
        this.getEventDetails(event.id as string)
      )
    );
  }

  /**
   * Search for events
   */
  async searchEvents(
    query: string,
    location?: { latitude: number; longitude: number; distance?: number }
  ): Promise<FacebookEventResponse[]> {
    const params = new URLSearchParams({
      q: query,
      type: "event",
      fields: "id,name,description,start_time,place,cover,attending_count",
    });

    if (location) {
      params.append("center", `${location.latitude},${location.longitude}`);
      if (location.distance) params.append("distance", location.distance.toString());
    }

    const response = await this.apiClient.makeApiRequest(`/search?${params}`);
    const data = await response.json();
    return Promise.all(
      (data.data || []).map((event: Record<string, unknown>) =>
        this.getEventDetails(event.id as string)
      )
    );
  }
}
