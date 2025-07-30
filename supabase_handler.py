from supabase import create_client

url = "https://qvijckgxoauxeyoowcsn.supabase.co"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aWpja2d4b2F1eGV5b293Y3NuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjc0MjUxOSwiZXhwIjoyMDY4MzE4NTE5fQ.iVbqPo0-YdzSwyPD0ZNfCUqbM31lm9tlH-9IihePo98"
supabase = create_client(url, key)

def get_faq_stock_and_profile():
    faq_data = supabase.table('faqs').select('*').execute().data
    stock_data = supabase.table('stock').select('*').execute().data
    profile_data = supabase.table('business_profiles').select('*').execute().data
    return faq_data, stock_data, profile_data


def insert_order(order_data):
    supabase.table('orders').insert(order_data).execute()
