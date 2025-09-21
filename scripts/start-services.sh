#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Tri-Protocol Backend Services${NC}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}⚠️  docker-compose command not found. Trying 'docker compose'...${NC}"
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# Navigate to project root
cd "$(dirname "$0")/.." || exit

# Create necessary directories
echo -e "${YELLOW}📁 Creating necessary directories...${NC}"
mkdir -p scripts/postgres-init
mkdir -p scripts/mongodb-init

# Stop any existing services
echo -e "${YELLOW}🛑 Stopping any existing services...${NC}"
$COMPOSE_CMD down

# Start services
echo -e "${GREEN}🔧 Starting backend services...${NC}"
$COMPOSE_CMD up -d

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"

# Function to check service health
check_service() {
    local service=$1
    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if $COMPOSE_CMD ps | grep -q "$service.*healthy"; then
            echo -e "${GREEN}✅ $service is healthy${NC}"
            return 0
        fi
        echo -n "."
        sleep 2
        ((attempt++))
    done

    echo -e "${RED}❌ $service failed to become healthy${NC}"
    return 1
}

# Check each service
services=("redis" "postgres" "mongodb" "qdrant")
all_healthy=true

for service in "${services[@]}"; do
    if ! check_service "$service"; then
        all_healthy=false
    fi
done

if [ "$all_healthy" = true ]; then
    echo -e "${GREEN}✅ All services are running and healthy!${NC}"
    echo ""
    echo -e "${GREEN}📊 Service URLs:${NC}"
    echo -e "  • Redis:        redis://localhost:6379"
    echo -e "  • PostgreSQL:   postgresql://triprotocol:triprotocol123@localhost:5432/triprotocol"
    echo -e "  • MongoDB:      mongodb://triprotocol:triprotocol123@localhost:27017/triprotocol"
    echo -e "  • Qdrant:       http://localhost:6333"
    echo ""
    echo -e "${GREEN}🖥️  GUI Tools:${NC}"
    echo -e "  • RedisInsight: http://localhost:8001"
    echo -e "  • pgAdmin:      http://localhost:8080 (admin@triprotocol.com / admin123)"
    echo -e "  • Mongo Express: http://localhost:8081"
    echo ""
    echo -e "${YELLOW}💡 To stop services, run: $COMPOSE_CMD down${NC}"
    echo -e "${YELLOW}💡 To view logs, run: $COMPOSE_CMD logs -f [service-name]${NC}"
else
    echo -e "${RED}⚠️  Some services failed to start properly${NC}"
    echo -e "${YELLOW}Check logs with: $COMPOSE_CMD logs${NC}"
    exit 1
fi