declare module "isomorphic-dompurify" {
  interface DOMPurifyStatic {
    sanitize(source: string | Node, config?: any): string;
    sanitize(source: string | Node, config: { RETURN_DOM_FRAGMENT: true }): DocumentFragment;
    sanitize(source: string | Node, config: { RETURN_DOM: true }): HTMLElement;
    addHook(
      type: string,
      callback: (currentNode: Element, hookEvent: any, config: any) => void
    ): void;
    removeHook(type: string): void;
    isSupported: boolean;
  }

  const DOMPurify: DOMPurifyStatic;
  export default DOMPurify;
}
