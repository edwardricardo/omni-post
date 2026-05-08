/**
 * @file useObjectURL.ts
 * @description Hook that turns a `File[]` into stable `string[]` blob URLs and
 *              revokes them on unmount or when the file array reference changes.
 *              Replaces the `URL.createObjectURL(file)`-in-render pattern that
 *              leaked blob URLs across every re-render.
 * @hook useObjectURLs
 * @layer infrastructure
 */

import { useEffect, useMemo } from "react";

/**
 * Stable object URLs for an array of File objects with automatic cleanup on
 * unmount or when the file array reference changes.
 */
export function useObjectURLs(files: ReadonlyArray<File>): string[] {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [urls]);
  return urls;
}
