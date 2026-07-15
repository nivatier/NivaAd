"""Real SMTP email sending — goes to Mailpit in local dev (catch-all,
viewable at http://localhost:8025, nothing actually leaves your machine),
and would go to a real SMTP provider in production via the same
SMTP_HOST/PORT settings pointed at a real server."""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)


def send_email(to: str, subject: str, html_body: str, text_body: str | None = None) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = "NivaAd <noreply@nivaad.local>"
    msg["To"] = to
    if text_body:
        msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.sendmail("noreply@nivaad.local", [to], msg.as_string())
        logger.info("[email] sent '%s' to %s", subject, to)
    except Exception as exc:  # noqa: BLE001
        # Don't let a mail-server hiccup break the calling request (e.g.
        # an invite should still be created even if the email send has a
        # transient problem — the admin can always resend).
        logger.error("[email] FAILED to send '%s' to %s: %s", subject, to, exc)


def send_invite_email(to: str, full_name: str, inviter_name: str, company_name: str, accept_url: str) -> None:
    subject = f"You've been invited to join {company_name} on NivaAd"
    html = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #7c3aed;">You're invited to NivaAd</h2>
      <p>Hi {full_name or "there"},</p>
      <p><strong>{inviter_name}</strong> has invited you to join <strong>{company_name}</strong>'s
      NivaAd workspace.</p>
      <p style="margin: 24px 0;">
        <a href="{accept_url}" style="background: linear-gradient(135deg,#f5c542,#e8a33d);
           color: #1a1a1a; padding: 12px 24px; border-radius: 999px; text-decoration: none;
           font-weight: 600; display: inline-block;">Accept invite &amp; set your password</a>
      </p>
      <p style="color: #888; font-size: 12px;">If the button doesn't work, copy this link:<br>{accept_url}</p>
    </div>
    """
    send_email(to, subject, html, text_body=f"You've been invited to join {company_name} on NivaAd. Accept here: {accept_url}")
