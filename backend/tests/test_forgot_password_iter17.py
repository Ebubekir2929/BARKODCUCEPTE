"""
Iteration 17 — Verify forgot_password lockout fix.

Order of operations per playbook (auth.py lines ~305-370):
  1. Lookup user (active only)
  2. Generate temp password (NOT yet persisted)
  3. send_email(...)
  4. If send_email fails -> HTTP 500, password UNCHANGED
  5. Only on success -> UPDATE users SET password, must_change_password=1

Right now email providers are broken by design (Brevo key disabled).
So calling forgot-password with a KNOWN account MUST:
  - return 500 with detail containing 'şifreniz değiştirilmedi'
  - leave the user's password intact -> login with old password still works
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://price-update-test.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

KNOWN_EMAIL = "cakmak_ebubekir@hotmail.com"
KNOWN_PASSWORD = "admin"
REGRESSION_EMAIL = "cakmak.ebubekir29@gmail.com"
REGRESSION_PASSWORD = "1234567"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- helpers ----------
def _login(s, email, password):
    return s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)


def _forgot(s, email):
    return s.post(f"{API}/auth/forgot-password", json={"email": email}, timeout=30)


# ---------- forgot-password lockout fix ----------
class TestForgotPasswordLockoutFix:
    def test_1_baseline_login_before_forgot(self, s):
        r = _login(s, KNOWN_EMAIL, KNOWN_PASSWORD)
        assert r.status_code == 200, f"Baseline login failed: {r.status_code} {r.text}"
        assert "access_token" in r.json()

    def test_2_forgot_password_returns_500_with_turkish_message_round1(self, s):
        r = _forgot(s, KNOWN_EMAIL)
        assert r.status_code == 500, f"Expected 500 (email broken), got {r.status_code}: {r.text}"
        detail = (r.json() or {}).get("detail", "")
        assert "şifreniz değiştirilmedi" in detail, f"Turkish 'şifreniz değiştirilmedi' missing in detail: {detail!r}"

    def test_3_password_still_works_after_failed_forgot_round1(self, s):
        r = _login(s, KNOWN_EMAIL, KNOWN_PASSWORD)
        assert r.status_code == 200, f"LOCKOUT REGRESSION: login broke after forgot-password. Got {r.status_code}: {r.text}"
        assert "access_token" in r.json()

    def test_4_forgot_password_500_round2_idempotent(self, s):
        r = _forgot(s, KNOWN_EMAIL)
        assert r.status_code == 500, f"Expected 500 on 2nd call, got {r.status_code}: {r.text}"
        assert "şifreniz değiştirilmedi" in (r.json() or {}).get("detail", "")

    def test_5_password_still_works_after_failed_forgot_round2(self, s):
        r = _login(s, KNOWN_EMAIL, KNOWN_PASSWORD)
        assert r.status_code == 200, f"LOCKOUT REGRESSION round2: {r.status_code} {r.text}"

    def test_6_unknown_email_returns_200_no_enumeration(self, s):
        r = _forgot(s, "yok@example.com")
        assert r.status_code == 200, f"Unknown email should be 200 generic, got {r.status_code}: {r.text}"
        body = r.json()
        assert body.get("ok") is True
        # Must NOT leak "user not found"
        msg = body.get("message", "").lower()
        assert "bulunamadı" not in msg and "not found" not in msg

    def test_7_empty_email_returns_400(self, s):
        r = _forgot(s, "")
        assert r.status_code == 400, f"Empty email should 400, got {r.status_code}: {r.text}"


# ---------- regression: other account still logs in ----------
class TestLoginRegression:
    def test_regression_other_account_login(self, s):
        r = _login(s, REGRESSION_EMAIL, REGRESSION_PASSWORD)
        assert r.status_code == 200, f"Regression login failed: {r.status_code} {r.text}"
        assert "access_token" in r.json()
