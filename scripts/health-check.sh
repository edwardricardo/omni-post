#!/bin/bash
# Health Check Script for Container Services
# Usage: ./health-check.sh [service_name] [port]

set -e

SERVICE_NAME=${1:-"api"}
PORT=${2:-"3000"}
MAX_ATTEMPTS=${3:-30}
SLEEP_TIME=${4:-2}

echo "🔍 Starting health check for ${SERVICE_NAME} service on port ${PORT}"

attempt=1
while [ $attempt -le $MAX_ATTEMPTS ]; do
    echo "Attempt ${attempt}/${MAX_ATTEMPTS}..."

    # Check if the service is responding
    if curl -f -s "http://localhost:${PORT}/health" > /dev/null 2>&1; then
        echo "✅ ${SERVICE_NAME} service is healthy!"

        # Additional checks for specific services
        case $SERVICE_NAME in
            "api")
                echo "🔍 Testing API endpoints..."
                if curl -f -s "http://localhost:${PORT}/api/health" > /dev/null 2>&1; then
                    echo "✅ API endpoints responding"
                else
                    echo "⚠️  API endpoints not fully ready"
                fi
                ;;
            "admin"|"client")
                echo "🔍 Testing Next.js app..."
                if curl -f -s "http://localhost:${PORT}/_next/static/chunks" > /dev/null 2>&1; then
                    echo "✅ Next.js static assets available"
                else
                    echo "⚠️  Next.js assets not fully ready"
                fi
                ;;
        esac

        exit 0
    fi

    echo "⏳ Service not ready yet, waiting ${SLEEP_TIME}s..."
    sleep $SLEEP_TIME
    ((attempt++))
done

echo "❌ Health check failed after ${MAX_ATTEMPTS} attempts"
echo "🔍 Service ${SERVICE_NAME} on port ${PORT} is not responding"

# Debugging information
echo "📊 System information:"
echo "Memory usage:"
free -h
echo ""
echo "Disk usage:"
df -h
echo ""
echo "Network connections:"
netstat -tulpn | grep :$PORT || echo "No process listening on port $PORT"

exit 1