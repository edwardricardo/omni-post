/**
 * @file PostsPagination.tsx
 * @description Page-number row + Prev/Next controls for the posts list.
 *              Hidden by the parent when totalPages ≤ 1 or when the
 *              current view mode is `virtual` (virtual scroll loads in
 *              place, no paging needed).
 * @component PostsPagination
 * @layer infrastructure
 */

import { Button } from "@packages/ui";

interface PostsPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function PostsPagination({ currentPage, totalPages, onPageChange }: PostsPaginationProps) {
  return (
    <div className="flex justify-center space-x-2">
      <Button
        variant="outline"
        disabled={currentPage === 1}
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
      >
        Previous
      </Button>
      <div className="flex items-center space-x-1">
        {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
          const page = i + 1;
          return (
            <Button
              key={page}
              variant={currentPage === page ? "default" : "outline"}
              size="sm"
              onClick={() => onPageChange(page)}
            >
              {page}
            </Button>
          );
        })}
      </div>
      <Button
        variant="outline"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
      >
        Next
      </Button>
    </div>
  );
}
