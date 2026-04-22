"""Email helper — HTTP API (Brevo/Resend) preferred, SMTP as fallback.

Railway ve benzeri PaaS'ler SMTP portlarını (25/465/587/2525) bloklar.
Bu modül önce HTTP API sağlayıcılarını dener, bunlar yoksa SMTP'ye düşer.

Öncelik sırası:
1. BREVO_API_KEY (Brevo HTTP API)
2. RESEND_API_KEY (Resend HTTP API)
3. SMTP (son çare)
"""
import os
import smtplib
import ssl
import logging
import httpx
from email.message import EmailMessage

logger = logging.getLogger(__name__)


def _send_via_brevo(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Send via Brevo (Sendinblue) HTTP API."""
    api_key = os.environ.get("BREVO_API_KEY", "").strip()
    if not api_key:
        return False

    from_addr = os.environ.get("SMTP_FROM", "").strip()
    from_name = os.environ.get("SMTP_FROM_NAME", "Barkodcu Cepte").strip()

    if not from_addr:
        logger.error("[Brevo] SMTP_FROM env variable missing")
        return False

    try:
        resp = httpx.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "accept": "application/json",
                "api-key": api_key,
                "content-type": "application/json",
            },
            json={
                "sender": {"name": from_name, "email": from_addr},
                "to": [{"email": to_email}],
                "subject": subject,
                "htmlContent": html_body or f"<p>{text_body}</p>",
                "textContent": text_body or "Bu e-posta HTML formatındadır.",
            },
            timeout=15.0,
        )
        if 200 <= resp.status_code < 300:
            logger.info(f"[Brevo] Email sent to {to_email}: {subject}")
            return True
        logger.error(f"[Brevo] Failed ({resp.status_code}): {resp.text}")
        return False
    except Exception as e:
        logger.error(f"[Brevo] Exception sending to {to_email}: {e}")
        return False


def _send_via_resend(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Send via Resend HTTP API."""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        return False

    from_addr = os.environ.get("RESEND_FROM", os.environ.get("SMTP_FROM", "onboarding@resend.dev")).strip()
    from_name = os.environ.get("SMTP_FROM_NAME", "Barkodcu Cepte").strip()
    from_field = f"{from_name} <{from_addr}>" if from_name else from_addr

    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": from_field,
                "to": [to_email],
                "subject": subject,
                "html": html_body or text_body,
                "text": text_body or "",
            },
            timeout=15.0,
        )
        if 200 <= resp.status_code < 300:
            logger.info(f"[Resend] Email sent to {to_email}: {subject}")
            return True
        logger.error(f"[Resend] Failed ({resp.status_code}): {resp.text}")
        return False
    except Exception as e:
        logger.error(f"[Resend] Exception sending to {to_email}: {e}")
        return False


def _send_via_smtp(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Fallback: classic SMTP."""
    host = os.environ.get("SMTP_HOST", "").strip()
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    from_addr = os.environ.get("SMTP_FROM", user).strip()
    from_name = os.environ.get("SMTP_FROM_NAME", "Barkodcu Cepte").strip()

    if not host or not user or not password:
        logger.error("SMTP not configured")
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_addr}>" if from_name else from_addr
    msg["To"] = to_email
    msg.set_content(text_body or "Bu e-posta HTML formatındadır.")
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    try:
        context = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
                server.login(user, password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=30) as server:
                server.ehlo()
                server.starttls(context=context)
                server.login(user, password)
                server.send_message(msg)
        logger.info(f"[SMTP] Email sent to {to_email}: {subject}")
        return True
    except Exception as e:
        logger.error(f"[SMTP] send failed to {to_email}: {e}")
        return False


def send_email(to_email: str, subject: str, html_body: str, text_body: str = "") -> bool:
    """Send email via best available method (Brevo HTTP → Resend HTTP → SMTP)."""
    # 1) Brevo HTTP API (port-block safe)
    if os.environ.get("BREVO_API_KEY", "").strip():
        if _send_via_brevo(to_email, subject, html_body, text_body):
            return True
        logger.warning("Brevo failed, trying Resend...")

    # 2) Resend HTTP API
    if os.environ.get("RESEND_API_KEY", "").strip():
        if _send_via_resend(to_email, subject, html_body, text_body):
            return True
        logger.warning("Resend failed, falling back to SMTP...")

    # 3) SMTP fallback
    return _send_via_smtp(to_email, subject, html_body, text_body)
