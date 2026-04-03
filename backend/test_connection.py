# This file was used to test the connection validity between the supabase database and the mediconnect project
from dotenv import load_dotenv
import os
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")

supabase = create_client(url, key)

response = supabase.table("users").select("*").limit(1).execute()