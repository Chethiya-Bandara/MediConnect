import bcrypt
import random

def hash_nic(nic: str):
    return bcrypt.hashpw(nic.encode(), bcrypt.gensalt()).decode()

def generate_dhid():
    return f"DHID-{random.randint(1000,9999)}-{random.randint(1000,9999)}"