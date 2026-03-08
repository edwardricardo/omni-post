#!/bin/bash

# Setup Development Environment Script
# Comprehensive one-command environment setup with automated validation

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REQUIRED_NODE_VERSION="20"
REQUIRED_PNPM_VERSION="10"

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Node.js version
check_node_version() {
    if ! command_exists node; then
        log_error "Node.js is not installed"
        log_info "Please install Node.js ${REQUIRED_NODE_VERSION} from https://nodejs.org/"
        return 1
    fi

    local node_version
    node_version=$(node --version | sed 's/v//' | cut -d. -f1)

    if [ "$node_version" -lt "$REQUIRED_NODE_VERSION" ]; then
        log_error "Node.js version $node_version is too old. Required: ${REQUIRED_NODE_VERSION}+"
        return 1
    fi

    log_success "Node.js version $(node --version) is compatible"
    return 0
}

# Check pnpm version
check_pnpm_version() {
    if ! command_exists pnpm; then
        log_info "Installing pnpm..."
        npm install -g pnpm@latest
    fi

    local pnpm_version
    pnpm_version=$(pnpm --version | cut -d. -f1)

    if [ "$pnpm_version" -lt "$REQUIRED_PNPM_VERSION" ]; then
        log_warning "pnpm version $pnpm_version might be outdated. Recommended: ${REQUIRED_PNPM_VERSION}+"
        log_info "Updating pnpm..."
        npm install -g pnpm@latest
    fi

    log_success "pnpm version $(pnpm --version) is ready"
    return 0
}

# Check Docker installation
check_docker() {
    if ! command_exists docker; then
        log_error "Docker is not installed"
        log_info "Please install Docker from https://docs.docker.com/get-docker/"
        return 1
    fi

    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon is not running"
        log_info "Please start Docker and try again"
        return 1
    fi

    log_success "Docker is installed and running"
    return 0
}

# Check Git configuration
check_git_config() {
    if ! command_exists git; then
        log_error "Git is not installed"
        return 1
    fi

    local git_name git_email
    git_name=$(git config --global user.name 2>/dev/null || echo "")
    git_email=$(git config --global user.email 2>/dev/null || echo "")

    if [ -z "$git_name" ] || [ -z "$git_email" ]; then
        log_warning "Git user configuration is incomplete"
        log_info "Please run: git config --global user.name 'Your Name'"
        log_info "Please run: git config --global user.email 'your.email@example.com'"
    else
        log_success "Git is configured for $git_name <$git_email>"
    fi

    return 0
}

# Setup VS Code configuration
setup_vscode() {
    local vscode_dir="$PROJECT_ROOT/.vscode"

    if [ ! -d "$vscode_dir" ]; then
        log_info "VS Code configuration directory not found, creating..."
        mkdir -p "$vscode_dir"
    fi

    # Check if VS Code is installed
    if command_exists code; then
        log_info "Installing recommended VS Code extensions..."

        # Read extensions from extensions.json and install them
        if [ -f "$vscode_dir/extensions.json" ]; then
            local extensions
            extensions=$(jq -r '.recommendations[]' "$vscode_dir/extensions.json" 2>/dev/null || echo "")

            if [ -n "$extensions" ]; then
                echo "$extensions" | while read -r extension; do
                    if [ -n "$extension" ]; then
                        log_info "Installing extension: $extension"
                        code --install-extension "$extension" --force >/dev/null 2>&1 || true
                    fi
                done
                log_success "VS Code extensions installed"
            fi
        fi
    else
        log_warning "VS Code not found in PATH. Extensions not installed."
        log_info "Install VS Code from https://code.visualstudio.com/"
    fi
}

# Install dependencies
install_dependencies() {
    log_info "Installing project dependencies..."

    cd "$PROJECT_ROOT"

    # Clean install
    if [ -d "node_modules" ]; then
        log_info "Cleaning existing node_modules..."
        rm -rf node_modules
    fi

    # Remove package manager lock files if they exist and are different
    if [ -f "package-lock.json" ]; then
        log_info "Removing package-lock.json (using pnpm)"
        rm package-lock.json
    fi

    if [ -f "yarn.lock" ]; then
        log_info "Removing yarn.lock (using pnpm)"
        rm yarn.lock
    fi

    # Install dependencies
    pnpm install --frozen-lockfile

    log_success "Dependencies installed successfully"
}

# Setup environment files
setup_environment_files() {
    log_info "Setting up environment files..."

    cd "$PROJECT_ROOT"

    # Check for .env file
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            log_info "Creating .env from .env.example..."
            cp .env.example .env
            log_warning "Please review and update .env with your configuration"
        else
            log_warning ".env.example not found. You may need to create .env manually"
        fi
    else
        log_success ".env file already exists"
    fi

    # Setup quality directory structure
    mkdir -p quality/{reports,config,scripts,automation,dashboards}
    mkdir -p quality/reports/{security,code-quality,tests,performance,final}

    log_success "Environment files and directories created"
}

# Setup Docker services
setup_docker_services() {
    log_info "Setting up Docker services..."

    cd "$PROJECT_ROOT"

    # Start services
    docker compose up -d

    # Wait for services to be ready
    log_info "Waiting for services to be ready..."

    # Wait for PostgreSQL
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker compose exec -T postgres pg_isready >/dev/null 2>&1; then
            break
        fi
        sleep 2
        attempt=$((attempt + 1))
    done

    if [ $attempt -eq $max_attempts ]; then
        log_error "PostgreSQL failed to start within expected time"
        return 1
    fi

    # Wait for Redis
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
            break
        fi
        sleep 2
        attempt=$((attempt + 1))
    done

    if [ $attempt -eq $max_attempts ]; then
        log_error "Redis failed to start within expected time"
        return 1
    fi

    log_success "Docker services are running"
}

# Setup database
setup_database() {
    log_info "Setting up database..."

    cd "$PROJECT_ROOT"

    # Run migrations
    pnpm db:migrate

    # Ask if user wants to seed data
    echo
    read -p "Would you like to seed the database with demo data? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Seeding database with demo data..."
        pnpm db:seed
        log_success "Database seeded with demo data"
    fi
}

# Validate installation
validate_installation() {
    log_info "Validating installation..."

    cd "$PROJECT_ROOT"

    # Check TypeScript compilation
    log_info "Checking TypeScript compilation..."
    if pnpm run build --dry-run >/dev/null 2>&1; then
        log_success "TypeScript compilation successful"
    else
        log_error "TypeScript compilation failed"
        return 1
    fi

    # Check linting
    log_info "Checking code linting..."
    if pnpm run lint >/dev/null 2>&1; then
        log_success "Linting passed"
    else
        log_warning "Linting issues found. Run 'pnpm lint:fix' to auto-fix"
    fi

    # Check formatting
    log_info "Checking code formatting..."
    if pnpm run format:check >/dev/null 2>&1; then
        log_success "Code formatting is correct"
    else
        log_warning "Code formatting issues found. Run 'pnpm format' to fix"
    fi

    # Test API health
    log_info "Testing API health..."
    pnpm dev:api &
    local api_pid=$!

    # Wait for API to start
    local attempt=0
    local max_attempts=30
    while [ $attempt -lt $max_attempts ]; do
        if curl -f http://localhost:3000/health >/dev/null 2>&1; then
            log_success "API health check passed"
            break
        fi
        sleep 2
        attempt=$((attempt + 1))
    done

    # Stop API
    kill $api_pid 2>/dev/null || true

    if [ $attempt -eq $max_attempts ]; then
        log_error "API health check failed"
        return 1
    fi
}

# Install development tools
install_dev_tools() {
    log_info "Installing development tools..."

    # Global tools
    local tools=(
        "@playwright/test"
        "tsx"
        "lighthouse"
        "@lhci/cli"
        "autocannon"
        "clinic"
        "k6"
    )

    for tool in "${tools[@]}"; do
        if ! command_exists "${tool##*/}"; then
            log_info "Installing $tool..."
            npm install -g "$tool" 2>/dev/null || log_warning "Failed to install $tool globally"
        fi
    done

    # Setup Git hooks
    if [ -d ".git" ]; then
        log_info "Setting up Git hooks..."
        pnpm prepare >/dev/null 2>&1 || true
        log_success "Git hooks configured"
    fi

    log_success "Development tools installed"
}

# Generate development summary
generate_summary() {
    log_info "Generating development environment summary..."

    cat << EOF

🎉 Development Environment Setup Complete!

📋 Summary:
   • Node.js: $(node --version)
   • pnpm: $(pnpm --version)
   • Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')
   • Git: $(git --version | cut -d' ' -f3)

🚀 Available Commands:
   • pnpm dev          - Start full development stack
   • pnpm dev:api      - Start API server only
   • pnpm dev:client   - Start client app only
   • pnpm dev:admin    - Start admin app only
   • pnpm test         - Run all tests
   • pnpm lint         - Check code quality
   • pnpm format       - Format code
   • pnpm db:studio    - Open database studio

🔧 Services Running:
   • PostgreSQL: localhost:5432
   • Redis: localhost:6379
   • API will run on: localhost:3000
   • Client will run on: localhost:3001
   • Admin will run on: localhost:3002

💡 Next Steps:
   1. Review and update .env file with your configuration
   2. Run 'pnpm dev' to start development
   3. Open http://localhost:3000/docs for API documentation
   4. Use VS Code for the best development experience

🆘 Troubleshooting:
   • Run 'pnpm db:up' if database services stop
   • Run 'pnpm lint:fix' to auto-fix linting issues
   • Check .env file if services fail to connect
   • See quality/scripts/ for additional tools

EOF

    log_success "Setup completed successfully! 🎉"
}

# Main execution
main() {
    echo
    log_info "🚀 Setting up OmniPost development environment..."
    echo

    # System checks
    log_info "Step 1/9: Checking system requirements..."
    check_node_version || exit 1
    check_pnpm_version || exit 1
    check_docker || exit 1
    check_git_config

    # VS Code setup
    log_info "Step 2/9: Setting up VS Code..."
    setup_vscode

    # Environment setup
    log_info "Step 3/9: Setting up environment files..."
    setup_environment_files

    # Dependencies
    log_info "Step 4/9: Installing dependencies..."
    install_dependencies

    # Docker services
    log_info "Step 5/9: Starting Docker services..."
    setup_docker_services || exit 1

    # Database setup
    log_info "Step 6/9: Setting up database..."
    setup_database

    # Development tools
    log_info "Step 7/9: Installing development tools..."
    install_dev_tools

    # Validation
    log_info "Step 8/9: Validating installation..."
    validate_installation || log_warning "Some validation checks failed, but setup can continue"

    # Summary
    log_info "Step 9/9: Generating summary..."
    generate_summary
}

# Handle script interruption
trap 'log_error "Setup interrupted"; exit 1' INT TERM

# Change to project root
cd "$PROJECT_ROOT"

# Run main function
main "$@"