#!/bin/sh
set -e

echo "🚀 Starting Railway deployment..."

# Run database migrations
echo "📊 Running database migrations..."
cd /app
pnpm --filter @infra/prisma prisma migrate deploy

echo "✅ Migrations complete!"

# Start the application
echo "🌟 Starting application..."
cd /app/apps/api
exec pnpm exec tsx --tsconfig ../../tsconfig.base.json src/index.ts
