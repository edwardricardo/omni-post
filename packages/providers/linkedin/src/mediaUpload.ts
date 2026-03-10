/**
 * @file mediaUpload.ts
 * @description LinkedIn media upload helpers for image and video content.
 *              Handles the 2-step upload flow: initializeUpload then PUT binary.
 * @layer infrastructure
 */

import type { LinkedInApiClient } from "./apiClient.js";
import type { LinkedInPostPayload } from "./types.js";

/**
 * @function uploadAndAttachMedia
 * @description Uploads media files to LinkedIn and returns the content payload for the post.
 *              Handles single image, single video, and multi-image (carousel) posts.
 * @param apiClient - The LinkedIn API client instance
 * @param ownerUrn - The author URN (person or organization)
 * @param media - Array of media items to upload
 * @returns The content payload to attach to the post, or null if no media uploaded
 */
export async function uploadAndAttachMedia(
  apiClient: LinkedInApiClient,
  ownerUrn: string,
  media: Array<{ url: string; type: "image" | "video" | "gif"; alt?: string }>
): Promise<LinkedInPostPayload["content"] | null> {
  const images: Array<{ id: string; altText?: string }> = [];
  let videoUrn: string | undefined;

  for (const item of media) {
    if (item.type === "video") {
      const uploaded = await uploadVideo(apiClient, ownerUrn, item.url);
      if (uploaded) {
        videoUrn = uploaded;
      }
    } else {
      // Image upload (treat gif as image for LinkedIn)
      const uploaded = await uploadImage(apiClient, ownerUrn, item.url, item.alt);
      if (uploaded) {
        images.push(uploaded);
      }
    }
  }

  return buildMediaContent(videoUrn, images);
}

/**
 * @function uploadVideo
 * @description Fetches a video from URL and uploads it to LinkedIn via chunked upload.
 * @returns The LinkedIn video URN on success, undefined on failure
 */
async function uploadVideo(
  apiClient: LinkedInApiClient,
  ownerUrn: string,
  videoUrl: string
): Promise<string | undefined> {
  const mediaResponse = await fetch(videoUrl);
  if (!mediaResponse.ok) {
    return undefined;
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();
  const contentType = mediaResponse.headers.get("content-type") || "video/mp4";

  const initResult = await apiClient.initializeVideoUpload(ownerUrn, arrayBuffer.byteLength);
  const instructions = initResult.value.uploadInstructions;

  // Upload each chunk (typically one for small videos)
  for (const instruction of instructions) {
    const chunk = arrayBuffer.slice(instruction.firstByte, instruction.lastByte + 1);
    await apiClient.uploadMediaBinary(instruction.uploadUrl, chunk, contentType);
  }

  return initResult.value.video;
}

/**
 * @function uploadImage
 * @description Fetches an image from URL and uploads it to LinkedIn.
 * @returns Object with image URN and alt text on success, undefined on failure
 */
async function uploadImage(
  apiClient: LinkedInApiClient,
  ownerUrn: string,
  imageUrl: string,
  alt?: string
): Promise<{ id: string; altText?: string } | undefined> {
  const mediaResponse = await fetch(imageUrl);
  if (!mediaResponse.ok) {
    return undefined;
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();
  const contentType = mediaResponse.headers.get("content-type") || "image/jpeg";

  const initResult = await apiClient.initializeImageUpload(ownerUrn);
  await apiClient.uploadMediaBinary(initResult.value.uploadUrl, arrayBuffer, contentType);

  return {
    id: initResult.value.image,
    ...(alt ? { altText: alt } : {}),
  };
}

/**
 * @function buildMediaContent
 * @description Builds the LinkedIn post content payload from uploaded media references.
 */
function buildMediaContent(
  videoUrn: string | undefined,
  images: Array<{ id: string; altText?: string }>
): LinkedInPostPayload["content"] | null {
  // Video takes priority (LinkedIn doesn't mix video + images in one post)
  if (videoUrn) {
    return { media: { id: videoUrn } };
  }

  if (images.length === 1) {
    const singleImage = images[0];
    if (!singleImage) {
      return null;
    }
    return {
      media: {
        id: singleImage.id,
        ...(singleImage.altText ? { title: singleImage.altText } : {}),
      },
    };
  }

  if (images.length > 1) {
    return { multiImage: { images } };
  }

  return null;
}
