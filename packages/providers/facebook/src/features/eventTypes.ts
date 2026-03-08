/**
 * @file eventTypes.ts
 * @description Type definitions for Facebook Events API.
 * Consumed by eventCrud.ts and eventAnalytics.ts.
 */

export interface FacebookEventLocation {
  name?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
}

export interface FacebookEventTicketing {
  ticketUrl?: string;
  ticketingTermsUrl?: string;
  ticketProvider?: string;
  currency?: string;
  price?: number;
  priceRange?: {
    min: number;
    max: number;
  };
  isFree?: boolean;
}

export interface FacebookEventOptions {
  name: string;
  description: string;
  startTime: Date;
  endTime?: Date;
  location?: FacebookEventLocation;
  isOnline?: boolean;
  onlineEventUrl?: string;
  coverPhoto?: string;
  category?:
    | "ART_EVENT"
    | "BOOK_EVENT"
    | "MOVIE_EVENT"
    | "FUNDRAISER"
    | "VOLUNTEERING"
    | "FAMILY_EVENT"
    | "FESTIVAL_EVENT"
    | "NEIGHBORHOOD"
    | "RELIGIOUS_EVENT"
    | "SHOPPING"
    | "COMEDY_EVENT"
    | "MUSIC_EVENT"
    | "DANCE_EVENT"
    | "NIGHTLIFE"
    | "THEATRE_EVENT"
    | "DINING_EVENT"
    | "FOOD_TASTING"
    | "CONFERENCE_EVENT"
    | "MEETUP"
    | "CLASS_EVENT"
    | "LECTURE"
    | "WORKSHOP"
    | "FITNESS"
    | "SPORTS_EVENT"
    | "OTHER";
  privacy?: "PUBLIC" | "CLOSED" | "SECRET";
  ticketing?: FacebookEventTicketing;
  guestListEnabled?: boolean;
  canGuestsInvite?: boolean;
  isPageOwned?: boolean;
  timezone?: string;
  tags?: string[];
}

export interface FacebookEventResponse {
  id: string;
  name: string;
  description: string;
  startTime: string;
  endTime?: string;
  location?: FacebookEventLocation;
  coverPhoto?: {
    id: string;
    source: string;
  };
  attendingCount: number;
  interestedCount: number;
  maybeCount: number;
  noreplyCount: number;
  permalink: string;
  category: string;
  privacy: string;
  isOnline: boolean;
  onlineEventUrl?: string;
  timezone: string;
  createdTime: string;
  updatedTime: string;
  status: "PUBLISHED" | "SCHEDULED" | "CANCELLED" | "DRAFT";
}

export interface FacebookEventAttendee {
  id: string;
  name: string;
  rsvpStatus: "attending" | "interested" | "maybe" | "not_replied";
  profilePicture?: string;
  joinedTime: string;
}

export interface FacebookEventInsights {
  eventId: string;
  impressions: number;
  reach: number;
  eventViews: number;
  eventResponses: number;
  ticketClicks: number;
  websiteClicks: number;
  actionClicks: number;
  photoViews: number;
  period: {
    since: string;
    until: string;
  };
  demographics?: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    countries: Record<string, number>;
    cities: Record<string, number>;
  };
  rsvpBreakdown: {
    attending: number;
    interested: number;
    maybe: number;
    notReplied: number;
  };
  trafficSources: {
    facebook: number;
    instagram: number;
    external: number;
    direct: number;
  };
}

export interface FacebookEventPost {
  id: string;
  message: string;
  createdTime: string;
  reactions: {
    like: number;
    love: number;
    wow: number;
    haha: number;
    sad: number;
    angry: number;
  };
  comments: number;
  shares: number;
}

export interface FacebookEventUpdate {
  name?: string;
  description?: string;
  startTime?: Date;
  endTime?: Date;
  location?: FacebookEventLocation;
  coverPhoto?: string;
  category?: string;
  privacy?: "PUBLIC" | "CLOSED" | "SECRET";
  ticketing?: FacebookEventTicketing;
  isOnline?: boolean;
  onlineEventUrl?: string;
}
