/**
 * @file useImageMetadata.ts
 * @description Async helper that loads dimensions and aspect ratio from an
 *              image File via a temporary `Image()` element.
 * @layer infrastructure
 */

export interface ImageFileMetadata {
  width: number;
  height: number;
  aspectRatio: number;
}

/**
 * Read intrinsic image metadata. Creates a temporary blob URL on the
 * `<img>` source and revokes it once the load resolves (or errors).
 */
export function readImageMetadata(file: File): Promise<ImageFileMetadata> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const metadata: ImageFileMetadata = {
        width: img.naturalWidth,
        height: img.naturalHeight,
        aspectRatio: img.naturalWidth / img.naturalHeight,
      };
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    img.onerror = (event) => {
      URL.revokeObjectURL(url);
      reject(event instanceof Error ? event : new Error("Failed to load image metadata"));
    };
    img.src = url;
  });
}
