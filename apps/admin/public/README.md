# Static assets of the admin app

This directory holds the files Next serves verbatim from `/`. It must exist even when empty: `apps/admin/Dockerfile` copies it into the runtime image (`COPY … /app/apps/admin/public`), and a missing directory fails that build stage. It has not held Storybook assets since the admin Storybook was removed on 2026-10-06 (slice 0.22).
