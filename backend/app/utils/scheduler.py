from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timezone, timedelta

from app.config.supabase import supabase_admin


def mark_missed_appointments():
    cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=30)
    ).isoformat()

    supabase_admin.table("appointments") \
        .update({"status": "missed"}) \
        .eq("status", "pending") \
        .lt("end_time", cutoff) \
        .execute()

    print("Updating missed appointments")


scheduler = BackgroundScheduler()
scheduler.add_job(mark_missed_appointments, "interval", minutes=5)