/**
 * @file Notification.ts
 * @description Domain entity representing an in-app notification sent to a team member.
 *   Encapsulates read/unread lifecycle and expiration logic.
 * @layer domain
 */
import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";
import { NotificationId } from "../value-objects/NotificationId.js";
import { NotificationType, type NotificationTypeValue } from "../value-objects/NotificationType.js";

interface NotificationProps {
  id: NotificationId;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  actorName?: string;
  isRead: boolean;
  readAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

interface CreateNotificationParams {
  recipientId: string;
  type: NotificationTypeValue;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  actorName?: string;
  metadata?: Record<string, unknown>;
}

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * @class NotificationEntity
 * @description Domain entity for in-app notifications.
 *   State changes are performed through explicit behavior methods.
 */
export class NotificationEntity {
  private readonly _props: NotificationProps;

  private constructor(props: NotificationProps) {
    this._props = props;
  }

  // --- Getters ---

  /** @description Unique identifier for this notification */
  get id(): NotificationId {
    return this._props.id;
  }

  /** @description The team member who receives this notification */
  get recipientId(): string {
    return this._props.recipientId;
  }

  /** @description The notification type/category */
  get type(): NotificationType {
    return this._props.type;
  }

  /** @description Short summary shown in notification list */
  get title(): string {
    return this._props.title;
  }

  /** @description Detailed notification message */
  get body(): string {
    return this._props.body;
  }

  /** @description The type of resource this notification relates to (e.g. "post", "channel") */
  get resourceType(): string | undefined {
    return this._props.resourceType;
  }

  /** @description The ID of the related resource */
  get resourceId(): string | undefined {
    return this._props.resourceId;
  }

  /** @description The ID of the user who triggered this notification */
  get actorId(): string | undefined {
    return this._props.actorId;
  }

  /** @description The display name of the actor */
  get actorName(): string | undefined {
    return this._props.actorName;
  }

  /** @description Whether this notification has been read */
  get isRead(): boolean {
    return this._props.isRead;
  }

  /** @description When this notification was marked as read */
  get readAt(): Date | undefined {
    return this._props.readAt;
  }

  /** @description Additional structured data for this notification */
  get metadata(): Record<string, unknown> | undefined {
    return this._props.metadata;
  }

  /** @description When this notification was created */
  get createdAt(): Date {
    return this._props.createdAt;
  }

  // --- Factory ---

  /**
   * @method create
   * @description Creates a new NotificationEntity, validating all required fields.
   * @param params - Creation parameters
   * @returns Result containing the new entity on success, InvalidValueError on validation failure
   */
  static create(params: CreateNotificationParams): Result<NotificationEntity, InvalidValueError> {
    if (!params.recipientId || params.recipientId.trim().length === 0) {
      return err(
        new InvalidValueError("recipientId", params.recipientId, "Recipient ID is required")
      );
    }
    if (!params.title || params.title.trim().length === 0) {
      return err(new InvalidValueError("title", params.title, "Title is required"));
    }
    if (!params.body || params.body.trim().length === 0) {
      return err(new InvalidValueError("body", params.body, "Body is required"));
    }

    const typeResult = NotificationType.create(params.type);
    if (!typeResult.ok) {
      return err(new InvalidValueError("type", params.type, typeResult.error.message));
    }

    const props: NotificationProps = {
      id: NotificationId.generate(),
      recipientId: params.recipientId,
      type: typeResult.value,
      title: params.title.trim(),
      body: params.body.trim(),
      isRead: false,
      createdAt: new Date(),
      ...(params.resourceType !== undefined && { resourceType: params.resourceType }),
      ...(params.resourceId !== undefined && { resourceId: params.resourceId }),
      ...(params.actorId !== undefined && { actorId: params.actorId }),
      ...(params.actorName !== undefined && { actorName: params.actorName }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
    };

    return ok(new NotificationEntity(props));
  }

  // --- Reconstitution (from persistence) ---

  /**
   * @method reconstitute
   * @description Rebuilds a NotificationEntity from persisted data without validation.
   * @param props - The full set of properties from the data store
   * @returns A reconstituted NotificationEntity
   */
  static reconstitute(props: NotificationProps): NotificationEntity {
    return new NotificationEntity(props);
  }

  // --- Behavior ---

  /**
   * @method markAsRead
   * @description Marks this notification as read, recording the read timestamp.
   */
  markAsRead(): void {
    this._props.isRead = true;
    this._props.readAt = new Date();
  }

  /**
   * @method markAsUnread
   * @description Marks this notification as unread, clearing the read timestamp.
   *   Uses conditional spread pattern for exactOptionalPropertyTypes compliance.
   */
  markAsUnread(): void {
    this._props.isRead = false;
    delete this._props.readAt;
  }

  /**
   * @method isExpired
   * @description Checks whether this notification is older than the specified maximum age.
   * @param maxAgeDays - The maximum age in days
   * @returns true if createdAt is older than maxAgeDays from now
   */
  isExpired(maxAgeDays: number): boolean {
    const now = Date.now();
    const ageMs = now - this._props.createdAt.getTime();
    return ageMs > maxAgeDays * MILLISECONDS_PER_DAY;
  }
}

export type { NotificationProps, CreateNotificationParams };
