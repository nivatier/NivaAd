"""DbLogHandler — a Python logging.Handler that writes log records to the
system_logs table so they're queryable and downloadable from the developer panel.

Design decisions:
- Sync SQLAlchemy session (same pattern as Celery tasks) — logging can fire
  from both async (API) and sync (worker/beat) contexts; a sync session
  avoids needing an event loop at call time.
- Queue-based: log records are put on a thread-safe queue and a background
  thread drains it. This means logging never blocks the request thread or
  worker task, even if the DB is briefly slow.
- Skips its own logs: records from "nivaad.log_handler" or SQLAlchemy itself
  are dropped to avoid infinite recursion.
- Level filter: only INFO and above are written — DEBUG is too noisy.
- Message cap: truncated at 4000 chars to prevent runaway stack traces
  bloating the DB. Full tracebacks rarely useful; the first 4000 chars
  always capture the error type and location.
"""
import logging
import queue
import threading
from datetime import datetime

# Loggers whose records we must never write to the DB (recursion guard)
_SKIP_LOGGERS = {
    "nivaad.log_handler",
    "sqlalchemy",
    "sqlalchemy.engine",
    "sqlalchemy.engine.base",
    "sqlalchemy.pool",
    "alembic",
    "uvicorn.access",   # per-request access log — too noisy, not useful in DB
    "watchfiles",       # vite/uvicorn dev watcher — only fires in dev, very noisy
}

_MAX_MSG = 4000  # truncate messages longer than this


class DbLogHandler(logging.Handler):
    """Async-safe logging handler that writes to system_logs via a background
    thread so it never blocks the caller."""

    def __init__(self, service: str, db_url: str):
        super().__init__(level=logging.INFO)
        self.service = service
        self._db_url = db_url
        self._queue: queue.Queue = queue.Queue(maxsize=5000)
        self._thread = threading.Thread(target=self._drain, daemon=True, name="db-log-drain")
        self._thread.start()

    def emit(self, record: logging.LogRecord) -> None:
        # Skip our own loggers and anything below INFO
        if record.levelno < logging.INFO:
            return
        logger_root = record.name.split(".")[0]
        if record.name in _SKIP_LOGGERS or logger_root in {"sqlalchemy", "alembic", "watchfiles"}:
            return
        try:
            msg = self.format(record)
            if len(msg) > _MAX_MSG:
                msg = msg[:_MAX_MSG] + "\n… (truncated)"
            self._queue.put_nowait({
                "service":     self.service,
                "level":       record.levelname,
                "logger_name": record.name,
                "message":     msg,
                "created_at":  datetime.utcnow(),
            })
        except queue.Full:
            pass  # drop silently rather than blocking

    def _drain(self) -> None:
        """Background thread: batch-writes queued records to the DB using
        asyncpg directly — avoids the psycopg2 dependency that the sync
        SQLAlchemy engine would require (the project uses asyncpg throughout)."""
        import asyncio
        import asyncpg

        # Build a raw DSN from the SQLAlchemy URL
        # e.g. postgresql+asyncpg://user:pass@host:5432/db -> postgres://user:pass@host:5432/db
        dsn = self._db_url.replace("postgresql+asyncpg://", "postgresql://").replace("postgresql+psycopg2://", "postgresql://")

        async def _run():
            conn = await asyncpg.connect(dsn)
            try:
                while True:
                    batch = []
                    # Pull whatever is in the queue right now
                    try:
                        batch.append(self._queue.get(timeout=2))
                    except queue.Empty:
                        continue
                    for _ in range(99):
                        try:
                            batch.append(self._queue.get_nowait())
                        except queue.Empty:
                            break
                    if batch:
                        await conn.executemany(
                            "INSERT INTO system_logs (service, level, logger_name, message, created_at) "
                            "VALUES ($1, $2, $3, $4, $5)",
                            [(r["service"], r["level"], r["logger_name"], r["message"], r["created_at"]) for r in batch],
                        )
            finally:
                await conn.close()

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        while True:
            try:
                loop.run_until_complete(_run())
            except Exception:
                import traceback, time
                traceback.print_exc()
                time.sleep(5)  # back off and retry on connection error


# Module-level singleton — created once per process in install_db_log_handler()
_handler: DbLogHandler | None = None


def install_db_log_handler(service: str, db_url: str) -> None:
    """Call once at process startup (main.py for API, worker.py for Celery).
    Attaches the handler to the root logger so every logger in the process
    that propagates (the default) will write to the DB."""
    global _handler
    if _handler is not None:
        return  # already installed (e.g. double-import guard)

    _handler = DbLogHandler(service=service, db_url=db_url)
    # Plain format — timestamp added by created_at column, no need in message
    formatter = logging.Formatter("%(name)s - %(message)s")
    _handler.setFormatter(formatter)

    root = logging.getLogger()
    root.addHandler(_handler)
