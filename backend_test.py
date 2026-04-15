#!/usr/bin/env python3
"""
Backend Auth API Testing for Barkodcu Cepte POS App
Tests all authentication endpoints with comprehensive scenarios
"""

import requests
import json
import sys
from typing import Dict, Any, Optional

# Backend URL from environment
BACKEND_URL = "https://kasap-management.preview.emergentagent.com/api"

class AuthAPITester:
    def __init__(self):
        self.base_url = BACKEND_URL
        self.session = requests.Session()
        self.auth_token = None
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test results"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}")
        if details:
            print(f"   Details: {details}")
        if response_data and not success:
            print(f"   Response: {response_data}")
        print()
        
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details,
            "response": response_data
        })
    
    def make_request(self, method: str, endpoint: str, data: Dict = None, headers: Dict = None) -> tuple:
        """Make HTTP request and return (success, response_data, status_code)"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method.upper() == "GET":
                response = self.session.get(url, headers=headers)
            elif method.upper() == "POST":
                response = self.session.post(url, json=data, headers=headers)
            elif method.upper() == "PUT":
                response = self.session.put(url, json=data, headers=headers)
            elif method.upper() == "DELETE":
                response = self.session.delete(url, headers=headers)
            else:
                return False, f"Unsupported method: {method}", 0
            
            try:
                response_data = response.json()
            except:
                response_data = response.text
            
            return response.status_code < 400, response_data, response.status_code
            
        except Exception as e:
            return False, f"Request failed: {str(e)}", 0
    
    def test_register_valid(self):
        """Test user registration with valid data"""
        test_data = {
            "full_name": "Test Backend",
            "username": "backendtest",
            "email": "backend@test.com",
            "password": "Test123!",
            "tax_number": "12345678901",
            "tenant_id": "BACKEND-001",
            "tenant_name": "Test Şube",
            "business_type": "restoran",
            "terms_accepted": True
        }
        
        success, response, status_code = self.make_request("POST", "/auth/register", test_data)
        
        if success and status_code == 200:
            if "access_token" in response and "user" in response:
                self.auth_token = response["access_token"]
                user_data = response["user"]
                if (user_data.get("email") == test_data["email"] and 
                    user_data.get("username") == test_data["username"] and
                    len(user_data.get("tenants", [])) == 1):
                    self.log_test("Register Valid User", True, f"User created successfully with token")
                else:
                    self.log_test("Register Valid User", False, "Invalid user data in response", response)
            else:
                self.log_test("Register Valid User", False, "Missing token or user in response", response)
        else:
            self.log_test("Register Valid User", False, f"Status: {status_code}", response)
    
    def test_register_duplicate_email(self):
        """Test registration with duplicate email"""
        test_data = {
            "full_name": "Another User",
            "username": "anotheruser",
            "email": "backend@test.com",  # Same email as previous test
            "password": "Test123!",
            "tax_number": "98765432109",
            "tenant_id": "BACKEND-002",
            "tenant_name": "Another Şube",
            "business_type": "normal",
            "terms_accepted": True
        }
        
        success, response, status_code = self.make_request("POST", "/auth/register", test_data)
        
        if not success and status_code == 400:
            if "e-posta adresi zaten kayıtlı" in str(response).lower():
                self.log_test("Register Duplicate Email", True, "Correctly rejected duplicate email")
            else:
                self.log_test("Register Duplicate Email", False, "Wrong error message", response)
        else:
            self.log_test("Register Duplicate Email", False, f"Should have failed with 400, got {status_code}", response)
    
    def test_register_duplicate_username(self):
        """Test registration with duplicate username"""
        test_data = {
            "full_name": "Another User",
            "username": "backendtest",  # Same username as first test
            "email": "another@test.com",
            "password": "Test123!",
            "tax_number": "98765432109",
            "tenant_id": "BACKEND-002",
            "tenant_name": "Another Şube",
            "business_type": "normal",
            "terms_accepted": True
        }
        
        success, response, status_code = self.make_request("POST", "/auth/register", test_data)
        
        if not success and status_code == 400:
            if "kullanıcı adı zaten kullanılıyor" in str(response).lower():
                self.log_test("Register Duplicate Username", True, "Correctly rejected duplicate username")
            else:
                self.log_test("Register Duplicate Username", False, "Wrong error message", response)
        else:
            self.log_test("Register Duplicate Username", False, f"Should have failed with 400, got {status_code}", response)
    
    def test_register_invalid_tax_number(self):
        """Test registration with invalid tax number"""
        test_data = {
            "full_name": "Test User",
            "username": "testuser3",
            "email": "test3@test.com",
            "password": "Test123!",
            "tax_number": "123",  # Too short
            "tenant_id": "BACKEND-003",
            "tenant_name": "Test Şube",
            "business_type": "normal",
            "terms_accepted": True
        }
        
        success, response, status_code = self.make_request("POST", "/auth/register", test_data)
        
        if not success and status_code == 400:
            if "vergi numarası" in str(response).lower():
                self.log_test("Register Invalid Tax Number", True, "Correctly rejected invalid tax number")
            else:
                self.log_test("Register Invalid Tax Number", False, "Wrong error message", response)
        else:
            self.log_test("Register Invalid Tax Number", False, f"Should have failed with 400, got {status_code}", response)
    
    def test_register_short_password(self):
        """Test registration with short password"""
        test_data = {
            "full_name": "Test User",
            "username": "testuser4",
            "email": "test4@test.com",
            "password": "123",  # Too short
            "tax_number": "12345678901",
            "tenant_id": "BACKEND-004",
            "tenant_name": "Test Şube",
            "business_type": "normal",
            "terms_accepted": True
        }
        
        success, response, status_code = self.make_request("POST", "/auth/register", test_data)
        
        # This should fail due to validation
        if not success:
            self.log_test("Register Short Password", True, "Correctly rejected short password")
        else:
            self.log_test("Register Short Password", False, f"Should have failed, got {status_code}", response)
    
    def test_register_terms_not_accepted(self):
        """Test registration without accepting terms"""
        test_data = {
            "full_name": "Test User",
            "username": "testuser5",
            "email": "test5@test.com",
            "password": "Test123!",
            "tax_number": "12345678901",
            "tenant_id": "BACKEND-005",
            "tenant_name": "Test Şube",
            "business_type": "normal",
            "terms_accepted": False
        }
        
        success, response, status_code = self.make_request("POST", "/auth/register", test_data)
        
        if not success and status_code == 400:
            if "şartlar" in str(response).lower():
                self.log_test("Register Terms Not Accepted", True, "Correctly rejected when terms not accepted")
            else:
                self.log_test("Register Terms Not Accepted", False, "Wrong error message", response)
        else:
            self.log_test("Register Terms Not Accepted", False, f"Should have failed with 400, got {status_code}", response)
    
    def test_login_with_email(self):
        """Test login with email"""
        login_data = {
            "email": "backend@test.com",
            "password": "Test123!"
        }
        
        success, response, status_code = self.make_request("POST", "/auth/login", login_data)
        
        if success and status_code == 200:
            if "access_token" in response and "user" in response:
                self.auth_token = response["access_token"]
                self.log_test("Login with Email", True, "Successfully logged in with email")
            else:
                self.log_test("Login with Email", False, "Missing token or user in response", response)
        else:
            self.log_test("Login with Email", False, f"Status: {status_code}", response)
    
    def test_login_with_username(self):
        """Test login with username"""
        login_data = {
            "email": "backendtest",  # Using username in email field
            "password": "Test123!"
        }
        
        success, response, status_code = self.make_request("POST", "/auth/login", login_data)
        
        if success and status_code == 200:
            if "access_token" in response and "user" in response:
                self.log_test("Login with Username", True, "Successfully logged in with username")
            else:
                self.log_test("Login with Username", False, "Missing token or user in response", response)
        else:
            self.log_test("Login with Username", False, f"Status: {status_code}", response)
    
    def test_login_wrong_password(self):
        """Test login with wrong password"""
        login_data = {
            "email": "backend@test.com",
            "password": "WrongPassword123!"
        }
        
        success, response, status_code = self.make_request("POST", "/auth/login", login_data)
        
        if not success and status_code == 401:
            self.log_test("Login Wrong Password", True, "Correctly rejected wrong password")
        else:
            self.log_test("Login Wrong Password", False, f"Should have failed with 401, got {status_code}", response)
    
    def test_login_nonexistent_user(self):
        """Test login with nonexistent user"""
        login_data = {
            "email": "nonexistent@test.com",
            "password": "Test123!"
        }
        
        success, response, status_code = self.make_request("POST", "/auth/login", login_data)
        
        if not success and status_code == 401:
            self.log_test("Login Nonexistent User", True, "Correctly rejected nonexistent user")
        else:
            self.log_test("Login Nonexistent User", False, f"Should have failed with 401, got {status_code}", response)
    
    def test_get_me(self):
        """Test getting current user info"""
        if not self.auth_token:
            self.log_test("Get Current User", False, "No auth token available")
            return
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        success, response, status_code = self.make_request("GET", "/auth/me", headers=headers)
        
        if success and status_code == 200:
            if "email" in response and "username" in response and "tenants" in response:
                self.log_test("Get Current User", True, f"Retrieved user info for {response.get('email')}")
            else:
                self.log_test("Get Current User", False, "Invalid user data structure", response)
        else:
            self.log_test("Get Current User", False, f"Status: {status_code}", response)
    
    def test_get_me_invalid_token(self):
        """Test getting current user with invalid token"""
        headers = {"Authorization": "Bearer invalid_token_here"}
        success, response, status_code = self.make_request("GET", "/auth/me", headers=headers)
        
        if not success and status_code == 401:
            self.log_test("Get Current User Invalid Token", True, "Correctly rejected invalid token")
        else:
            self.log_test("Get Current User Invalid Token", False, f"Should have failed with 401, got {status_code}", response)
    
    def test_add_tenant(self):
        """Test adding a new tenant"""
        if not self.auth_token:
            self.log_test("Add Tenant", False, "No auth token available")
            return
        
        tenant_data = {
            "tenant_id": "BACKEND-002",
            "name": "İkinci Şube"
        }
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        success, response, status_code = self.make_request("POST", "/auth/tenants", tenant_data, headers)
        
        if success and status_code == 200:
            if "tenants" in response and len(response["tenants"]) == 2:
                # Check if the new tenant was added
                tenant_ids = [t["tenant_id"] for t in response["tenants"]]
                if "BACKEND-002" in tenant_ids:
                    self.log_test("Add Tenant", True, "Successfully added new tenant")
                else:
                    self.log_test("Add Tenant", False, "New tenant not found in response", response)
            else:
                self.log_test("Add Tenant", False, "Invalid tenant count in response", response)
        else:
            self.log_test("Add Tenant", False, f"Status: {status_code}", response)
    
    def test_add_duplicate_tenant(self):
        """Test adding duplicate tenant ID"""
        if not self.auth_token:
            self.log_test("Add Duplicate Tenant", False, "No auth token available")
            return
        
        tenant_data = {
            "tenant_id": "BACKEND-002",  # Same as previous test
            "name": "Duplicate Şube"
        }
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        success, response, status_code = self.make_request("POST", "/auth/tenants", tenant_data, headers)
        
        if not success and status_code == 400:
            if "tenant id zaten ekli" in str(response).lower():
                self.log_test("Add Duplicate Tenant", True, "Correctly rejected duplicate tenant ID")
            else:
                self.log_test("Add Duplicate Tenant", False, "Wrong error message", response)
        else:
            self.log_test("Add Duplicate Tenant", False, f"Should have failed with 400, got {status_code}", response)
    
    def test_rename_tenant(self):
        """Test renaming a tenant"""
        if not self.auth_token:
            self.log_test("Rename Tenant", False, "No auth token available")
            return
        
        update_data = {
            "name": "Yeni İsim"
        }
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        success, response, status_code = self.make_request("PUT", "/auth/tenants/BACKEND-002", update_data, headers)
        
        if success and status_code == 200:
            if "tenants" in response:
                # Find the updated tenant
                updated_tenant = None
                for tenant in response["tenants"]:
                    if tenant["tenant_id"] == "BACKEND-002":
                        updated_tenant = tenant
                        break
                
                if updated_tenant and updated_tenant["name"] == "Yeni İsim":
                    self.log_test("Rename Tenant", True, "Successfully renamed tenant")
                else:
                    self.log_test("Rename Tenant", False, "Tenant name not updated", response)
            else:
                self.log_test("Rename Tenant", False, "No tenants in response", response)
        else:
            self.log_test("Rename Tenant", False, f"Status: {status_code}", response)
    
    def test_delete_tenant(self):
        """Test deleting a tenant"""
        if not self.auth_token:
            self.log_test("Delete Tenant", False, "No auth token available")
            return
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        success, response, status_code = self.make_request("DELETE", "/auth/tenants/BACKEND-002", headers=headers)
        
        if success and status_code == 200:
            if "tenants" in response:
                # Check that the tenant was removed
                tenant_ids = [t["tenant_id"] for t in response["tenants"]]
                if "BACKEND-002" not in tenant_ids:
                    self.log_test("Delete Tenant", True, "Successfully deleted tenant")
                else:
                    self.log_test("Delete Tenant", False, "Tenant still exists after deletion", response)
            else:
                self.log_test("Delete Tenant", False, "No tenants in response", response)
        else:
            self.log_test("Delete Tenant", False, f"Status: {status_code}", response)
    
    def test_delete_last_tenant(self):
        """Test deleting the last remaining tenant (should fail)"""
        if not self.auth_token:
            self.log_test("Delete Last Tenant", False, "No auth token available")
            return
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        success, response, status_code = self.make_request("DELETE", "/auth/tenants/BACKEND-001", headers=headers)
        
        if not success and status_code == 400:
            if "en az 1 veri kaynağı" in str(response).lower():
                self.log_test("Delete Last Tenant", True, "Correctly prevented deletion of last tenant")
            else:
                self.log_test("Delete Last Tenant", False, "Wrong error message", response)
        else:
            self.log_test("Delete Last Tenant", False, f"Should have failed with 400, got {status_code}", response)
    
    def test_existing_credentials(self):
        """Test login with existing test credentials"""
        login_data = {
            "email": "test@test.com",
            "password": "123456"
        }
        
        success, response, status_code = self.make_request("POST", "/auth/login", login_data)
        
        if success and status_code == 200:
            self.log_test("Login Existing Credentials", True, "Successfully logged in with existing test credentials")
        else:
            self.log_test("Login Existing Credentials", False, f"Status: {status_code} - Existing test user may not exist", response)
    
    def run_all_tests(self):
        """Run all authentication tests"""
        print(f"🚀 Starting Backend Auth API Tests")
        print(f"Backend URL: {self.base_url}")
        print("=" * 60)
        
        # Registration tests
        print("📝 REGISTRATION TESTS")
        print("-" * 30)
        self.test_register_valid()
        self.test_register_duplicate_email()
        self.test_register_duplicate_username()
        self.test_register_invalid_tax_number()
        self.test_register_short_password()
        self.test_register_terms_not_accepted()
        
        # Login tests
        print("🔐 LOGIN TESTS")
        print("-" * 30)
        self.test_login_with_email()
        self.test_login_with_username()
        self.test_login_wrong_password()
        self.test_login_nonexistent_user()
        
        # User info tests
        print("👤 USER INFO TESTS")
        print("-" * 30)
        self.test_get_me()
        self.test_get_me_invalid_token()
        
        # Tenant management tests
        print("🏢 TENANT MANAGEMENT TESTS")
        print("-" * 30)
        self.test_add_tenant()
        self.test_add_duplicate_tenant()
        self.test_rename_tenant()
        self.test_delete_tenant()
        self.test_delete_last_tenant()
        
        # Existing credentials test
        print("🔑 EXISTING CREDENTIALS TEST")
        print("-" * 30)
        self.test_existing_credentials()
        
        # Summary
        print("=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for result in self.test_results if result["success"])
        total = len(self.test_results)
        failed_tests = [result for result in self.test_results if not result["success"]]
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {(passed/total)*100:.1f}%")
        
        if failed_tests:
            print("\n❌ FAILED TESTS:")
            for test in failed_tests:
                print(f"  • {test['test']}: {test['details']}")
        
        return passed == total


if __name__ == "__main__":
    tester = AuthAPITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)