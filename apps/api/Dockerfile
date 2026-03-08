# syntax=docker/dockerfile:1.4
# ==============================================================================
# API Service Dockerfile (uses shared base from docker/base/nodejs.Dockerfile)
# ==============================================================================

# Import shared stages
ARG SERVICE_PATH=apps/api
FROM ../../docker/base/nodejs.Dockerfile AS shared-base

# ==============================================================================
# Build Stage - Compile TypeScript
# ==============================================================================
FROM shared-base AS build
ARG SERVICE_PATH=apps/api

# Copy API source code
COPY apps/api ./apps/api

# Compile TypeScript (install temporarily, compile, then remove)
RUN pnpm add -D -w typescript && \
    cd apps/api && \
    pnpm exec tsc --outDir dist --skipLibCheck && \
    cd /app && \
    pnpm remove -D -w typescript

# ==============================================================================
# Production Runtime
# ==============================================================================
FROM shared-base AS runtime-base

# Copy production dependencies
COPY --from=shared-base /app/node_modules ./node_modules
COPY --from=shared-base /app/packages ./packages
COPY --from=shared-base /app/infra ./infra

# Copy compiled JavaScript
COPY --from=build --chown=nonroot:nonroot /app/apps/api/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/package.json ./

# API-specific environment
ENV PORT=3000

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');const req=http.request({host:'localhost',port:3000,path:'/health',timeout:5000},res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.end();"

# Start Fastify server
CMD ["dist/index.js"]
