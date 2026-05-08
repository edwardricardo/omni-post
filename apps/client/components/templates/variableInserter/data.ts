/**
 * @file data.ts
 * @description Static catalogues consumed by the VariableInserter side
 *              panel: the common Handlebars variables grouped by domain
 *              ("User & Profile", "Date & Time", ...) and the registry
 *              of Handlebars helpers shipped with the template engine.
 *              Pure data — no React, no state.
 * @layer infrastructure
 */

import { Calendar, Clock, Hash, Star, Type, User, type LucideIcon } from "lucide-react";

export interface VariableGroup {
  name: string;
  /** Lucide icon component — instantiated lazily by the consumer. */
  Icon: LucideIcon;
  variables: string[];
  description: string;
}

export interface HelperInfo {
  name: string;
  syntax: string;
  description: string;
  example: string;
  category: string;
}

export const COMMON_VARIABLES: VariableGroup[] = [
  {
    name: "User & Profile",
    Icon: User,
    variables: ["username", "firstName", "lastName", "email", "avatar", "bio"],
    description: "User profile information",
  },
  {
    name: "Date & Time",
    Icon: Calendar,
    variables: ["date", "time", "currentYear", "currentMonth", "currentDay", "timestamp"],
    description: "Date and time variables",
  },
  {
    name: "Social Media",
    Icon: Hash,
    variables: ["hashtags", "mentions", "platforms", "followersCount", "likesCount"],
    description: "Social media related variables",
  },
  {
    name: "Business",
    Icon: Star,
    variables: ["companyName", "productName", "price", "discount", "offer", "revenue"],
    description: "Business and product variables",
  },
  {
    name: "Content",
    Icon: Type,
    variables: ["title", "description", "content", "summary", "category", "tags"],
    description: "Content related variables",
  },
  {
    name: "Events",
    Icon: Clock,
    variables: ["eventName", "eventDate", "eventTime", "location", "speakers", "agenda"],
    description: "Event information variables",
  },
];

export const HANDLEBARS_HELPERS: HelperInfo[] = [
  {
    name: "if",
    syntax: "{{#if condition}}...{{/if}}",
    description: "Conditional block - renders content if condition is truthy",
    example: "{{#if premium}}Premium content{{/if}}",
    category: "Conditionals",
  },
  {
    name: "unless",
    syntax: "{{#unless condition}}...{{/unless}}",
    description: "Inverse conditional - renders content if condition is falsy",
    example: "{{#unless premium}}Free content{{/unless}}",
    category: "Conditionals",
  },
  {
    name: "each",
    syntax: "{{#each array}}...{{/each}}",
    description: "Loop through an array",
    example: "{{#each hashtags}}#{{this}} {{/each}}",
    category: "Loops",
  },
  {
    name: "with",
    syntax: "{{#with object}}...{{/with}}",
    description: "Change context to an object",
    example: "{{#with user}}{{firstName}} {{lastName}}{{/with}}",
    category: "Context",
  },
  {
    name: "formatDate",
    syntax: '{{formatDate date "format"}}',
    description: "Format a date using date-fns format strings",
    example: '{{formatDate date "MMM dd, yyyy"}}',
    category: "Formatting",
  },
  {
    name: "uppercase",
    syntax: "{{uppercase string}}",
    description: "Convert string to uppercase",
    example: "{{uppercase productName}}",
    category: "Formatting",
  },
  {
    name: "lowercase",
    syntax: "{{lowercase string}}",
    description: "Convert string to lowercase",
    example: "{{lowercase email}}",
    category: "Formatting",
  },
  {
    name: "capitalize",
    syntax: "{{capitalize string}}",
    description: "Capitalize first letter of string",
    example: "{{capitalize firstName}}",
    category: "Formatting",
  },
  {
    name: "join",
    syntax: '{{join array "separator"}}',
    description: "Join array elements with separator",
    example: '{{join hashtags ", "}}',
    category: "Arrays",
  },
  {
    name: "length",
    syntax: "{{length array}}",
    description: "Get length of array or string",
    example: "{{length hashtags}} tags",
    category: "Arrays",
  },
  {
    name: "hashtag",
    syntax: "{{hashtag tag}}",
    description: "Add # prefix to tag if not present",
    example: '{{hashtag "productivity"}}',
    category: "Social",
  },
  {
    name: "link",
    syntax: '{{link url "text"}}',
    description: "Create a markdown link",
    example: '{{link website "Visit our site"}}',
    category: "Formatting",
  },
  {
    name: "eq",
    syntax: "{{#if (eq a b)}}...{{/if}}",
    description: "Check if two values are equal",
    example: '{{#if (eq platform "twitter")}}Tweet content{{/if}}',
    category: "Conditionals",
  },
  {
    name: "random",
    syntax: '{{random "option1" "option2" "option3"}}',
    description: "Randomly select one of the provided options",
    example: '{{random "Great!" "Awesome!" "Amazing!"}}',
    category: "Utility",
  },
];

export const HELPER_CATEGORIES: string[] = [
  "all",
  ...Array.from(new Set(HANDLEBARS_HELPERS.map((h) => h.category))),
];
