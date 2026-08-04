"""Real SMTP email sending — goes to Mailpit in local dev (catch-all,
viewable at http://localhost:8025, nothing actually leaves your machine),
and goes to a real SMTP provider (e.g. AWS SES) in production via the
SMTP_HOST/PORT/USER/PASSWORD/FROM settings in .env."""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)


def is_suppressed(to: str) -> bool:
    """Check synchronously whether an address is in the email_suppressions
    table before sending. Uses psycopg sync driver to avoid needing an
    async session in this sync email context."""
    try:
        import psycopg
        dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
        with psycopg.connect(dsn) as conn:
            row = conn.execute(
                "SELECT 1 FROM email_suppressions WHERE email = %s LIMIT 1",
                (to.lower().strip(),)
            ).fetchone()
            return row is not None
    except Exception as exc:
        # If we cannot check, allow the send — better to send than silently drop
        logger.warning("[email] suppression check failed for %s: %s", to, exc)
        return False


def smtp_health_check() -> dict:
    """Perform a real STARTTLS + AUTH handshake against the configured SMTP
    server — the same path a real send follows — without actually sending
    a message.  Returns a dict with keys: status ("ok"/"error"), detail
    (human string), auth_mode ("tls+auth" | "open"), and latency_ms.

    Why not a plain TCP connect?
    Railway containers cannot reach external port 587 via a bare TCP open
    because the egress is proxied; the connection only succeeds once the
    TLS handshake (STARTTLS) completes.  A raw asyncio.open_connection()
    always times out, giving a false "error" on the infrastructure page
    even though email delivery works fine.  This function exercises the
    real code path so the health card reflects reality.
    """
    import time
    start = time.monotonic()
    auth_mode = "tls+auth" if (settings.SMTP_USER and settings.SMTP_PASSWORD) else "open"
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.ehlo()
            if settings.SMTP_USER and settings.SMTP_PASSWORD and settings.ENV != "development":
                server.starttls()
                server.ehlo()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            # If we reach here the credentials are valid; don't send anything
        latency_ms = round((time.monotonic() - start) * 1000, 1)
        return {
            "status": "ok",
            "latency_ms": latency_ms,
            "detail": f"{settings.SMTP_HOST}:{settings.SMTP_PORT} reachable — auth: {auth_mode}",
            "auth_mode": auth_mode,
        }
    except Exception as exc:
        latency_ms = round((time.monotonic() - start) * 1000, 1)
        return {
            "status": "error",
            "latency_ms": latency_ms,
            "detail": str(exc),
            "auth_mode": auth_mode,
        }


def send_email(to: str, subject: str, html_body: str, text_body: str | None = None) -> None:
    # Skip suppressed addresses — hard bounces and spam complaints
    if is_suppressed(to):
        logger.warning("[email] skipping suppressed address: %s (subject: %s)", to, subject)
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    if text_body:
        msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    # Extract the bare address from "Name <addr>" format for sendmail()
    from_addr = settings.SMTP_FROM
    if "<" in from_addr and ">" in from_addr:
        from_addr = from_addr.split("<")[1].rstrip(">").strip()

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.ehlo()
            # Use TLS + auth only in production — Mailpit (local dev) doesn't
            # support STARTTLS and doesn't need auth either.
            if settings.SMTP_USER and settings.SMTP_PASSWORD and settings.ENV != "development":
                server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(from_addr, [to], msg.as_string())
        logger.info("[email] sent '%s' to %s", subject, to)
    except Exception as exc:  # noqa: BLE001
        # Don't let a mail-server hiccup break the calling request (e.g.
        # an invite should still be created even if the email send has a
        # transient problem — the admin can always resend).
        logger.error("[email] FAILED to send '%s' to %s: %s", subject, to, exc)


def send_verification_email(to: str, full_name: str, verify_url: str) -> None:
    subject = "Verify your NivaSpark email address"
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #7c3aed;">Verify your email</h2>
      <p>Hi {full_name or "there"},</p>
      <p>Thanks for signing up to NivaSpark! Click the button below to verify your email address and activate your account.</p>
      <p style="margin: 24px 0;">
        <a href="{verify_url}" style="background: linear-gradient(135deg,#f5c542,#e8a33d);
           color: #1a1a1a; padding: 12px 24px; border-radius: 999px; text-decoration: none;
           font-weight: 600; display: inline-block;">Verify email &amp; get started</a>
      </p>
      <p style="color: #888; font-size: 12px;">This link expires in 24 hours. If the button doesn't work, copy this link:<br>{verify_url}</p>
      <p style="color: #888; font-size: 12px;">If you didn't create a NivaSpark account, you can safely ignore this email.</p>
    </div>
    """
    send_email(to, subject, html, text_body=f"Verify your NivaSpark email: {verify_url}")


def send_invite_email(to: str, full_name: str, inviter_name: str, company_name: str, accept_url: str) -> None:
    subject = f"You've been invited to join {company_name} on NivaSpark"
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #7c3aed;">You're invited to NivaSpark</h2>
      <p>Hi {full_name or "there"},</p>
      <p><strong>{inviter_name}</strong> has invited you to join <strong>{company_name}</strong>'s
      NivaSpark workspace.</p>
      <p style="margin: 24px 0;">
        <a href="{accept_url}" style="background: linear-gradient(135deg,#f5c542,#e8a33d);
           color: #1a1a1a; padding: 12px 24px; border-radius: 999px; text-decoration: none;
           font-weight: 600; display: inline-block;">Accept invite &amp; set your password</a>
      </p>
      <p style="color: #888; font-size: 12px;">If the button doesn't work, copy this link:<br>{accept_url}</p>
    </div>
    """
    send_email(to, subject, html, text_body=f"You've been invited to join {company_name} on NivaSpark. Accept here: {accept_url}")
