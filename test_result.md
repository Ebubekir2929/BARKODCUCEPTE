#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Turkish POS/Sales Management Expo app with Login, Register, Forgot Password screens.
  Dashboard with Cash/Card/OpenAccount/Total cards, weekly comparison, hourly sales chart,
  top/least selling products, branch-wise sales, cancellation receipts.
  Stock page with lazy loading, caching, offline support.
  Customer accounts page with movements and invoice details.
  Reports page with PDF/Excel export.
  Light/Dark theme support.

backend:
  - task: "Basic API Status Endpoint"
    implemented: true
    working: true
    file: "server.py"
    stuck_count: 0
    priority: "low"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Default API endpoints working, demo data used for frontend"

  - task: "Auth Register API"
    implemented: true
    working: true
    file: "routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "POST /api/auth/register - Full registration with full_name, username, email, password, tax_number, tenant_id, tenant_name, business_type, terms_accepted. Validates email uniqueness, username uniqueness, tax number format. Returns JWT token and user data with tenants."
      - working: true
        agent: "testing"
        comment: "✅ TESTED: Registration API working correctly. Successfully validates all fields, rejects duplicates (email/username), enforces tax number format (10-11 digits), password length, and terms acceptance. Returns proper JWT token and user data. Minor: Tax validation returns 422 instead of 400 but validation works correctly."

  - task: "Auth Login API"
    implemented: true
    working: true
    file: "routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "POST /api/auth/login - Login with email or username. bcrypt password verification. Returns JWT token."
      - working: true
        agent: "testing"
        comment: "✅ TESTED: Login API working perfectly. Supports login with both email and username, correctly validates passwords using bcrypt, returns proper JWT tokens, and properly rejects invalid credentials with 401 status."

  - task: "Auth Me API"
    implemented: true
    working: true
    file: "routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "GET /api/auth/me - Returns current user info using Bearer token"
      - working: true
        agent: "testing"
        comment: "✅ TESTED: Me API working correctly. Properly validates Bearer tokens, returns complete user information including tenants, and correctly rejects invalid tokens with 401 status."

  - task: "Tenant Management APIs"
    implemented: true
    working: true
    file: "routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "POST /api/auth/tenants (add), PUT /api/auth/tenants/{tenant_id} (rename), DELETE /api/auth/tenants/{tenant_id} (remove). Max 10 tenants, min 1 tenant validation."
      - working: true
        agent: "testing"
        comment: "✅ TESTED: All tenant management APIs working correctly. ADD: Successfully adds tenants with duplicate ID validation. RENAME: Updates tenant names properly. DELETE: Removes tenants with minimum 1 tenant validation. All operations require valid authentication."

frontend:
  - task: "Login Screen"
    implemented: true
    working: true
    file: "app/(auth)/login.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Login with JWT auth working, theme toggle available"

  - task: "Register Screen"
    implemented: true
    working: true
    file: "app/(auth)/register.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false

  - task: "Forgot Password Screen"
    implemented: true
    working: true
    file: "app/(auth)/forgot-password.tsx"
    stuck_count: 0
    priority: "medium"

  - task: "Dashboard Screen"
    implemented: true
    working: true
    file: "app/(tabs)/dashboard.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Full dashboard with cards, charts, branch sales, hourly sales, products, location summary"

  - task: "Stock Management Screen"
    implemented: true
    working: true
    file: "app/(tabs)/stock.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Stock list with lazy loading, caching, search, filter, product detail with movements"

  - task: "Customers Screen"
    implemented: true
    working: true
    file: "app/(tabs)/customers.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Customer list with balance, search, filter, movements and invoice details"

  - task: "Reports Screen"
    implemented: true
    working: true
    file: "app/(tabs)/reports.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "5 report types with CSV/HTML export functionality"

  - task: "Settings Screen"
    implemented: true
    working: true
    file: "app/(tabs)/settings.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Theme toggle, cache clear, user info display, logout"

  - task: "Light/Dark Theme"
    implemented: true
    working: true
    file: "src/store/themeStore.ts"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Theme toggling working correctly"

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "All screens working"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: "MVP completed with all screens, DEMO data is being used. Backend API needs to be implemented for real data."
  - agent: "main"
    message: "Added real auth backend with MongoDB - Register (POST /api/auth/register), Login (POST /api/auth/login), Me (GET /api/auth/me), Tenant CRUD APIs. Frontend register screen updated with 2-step form (step 1: personal info, step 2: business info). Login now connects to real API. DataSourceSelector shows tenant names from user profile. Test credentials in /app/memory/test_credentials.md. All new backend endpoints need testing."
  - agent: "testing"
    message: "✅ BACKEND AUTH TESTING COMPLETE: All 4 auth API endpoints tested successfully. 18 test scenarios executed with 94.4% success rate (17/18 passed). All critical functionality working: registration with validation, login with email/username, JWT token authentication, tenant management (add/rename/delete). Only minor issue: tax validation returns 422 instead of 400 but validation works correctly. Backend logs show proper bcrypt password hashing and all operations logged correctly. Auth system is production-ready."