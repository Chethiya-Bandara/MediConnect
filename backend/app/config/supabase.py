from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("SUPABASE_URL")
anon_key = os.getenv("SUPABASE_KEY")
service_key = os.getenv("SUPABASE_SERVICE_KEY")

supabase = create_client(url, anon_key)  # for auth
supabase_admin = create_client(url, service_key)  # for admin