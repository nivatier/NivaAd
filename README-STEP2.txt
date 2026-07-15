NivaAd — Step 2 file placement
==============================
Unzip this archive INTO your project folder:
  F:\MY WORKS\00-NIVATIER\00-PRODUCTS\02-NivaAd\

After extracting you should have:
  02-NivaAd\
    docker-compose.yml
    .env.example
    backend\
      Dockerfile
      requirements.txt
      alembic.ini
      alembic\  (env.py, script.py.mako, versions\)
      app\      (main.py, config.py, database.py, models.py, security.py,
                 schemas.py, deps.py, worker.py, routers\auth.py)
    frontend\   (still empty — Step 5)

Then:
  1. Copy .env.example to .env  (right-click copy/paste, rename to ".env")
  2. You can leave the placeholder values for now — real keys come later.
