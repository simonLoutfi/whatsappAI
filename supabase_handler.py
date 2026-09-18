from supabase import create_client

url = ""
key = ""
supabase = create_client(url, key)

def get_faq_stock_and_profile():
    faq_data = supabase.table('faqs').select('*').execute().data
    stock_data = supabase.table('stock').select('*').execute().data
    profile_data = supabase.table('business_profiles').select('*').execute().data
    return faq_data, stock_data, profile_data


def insert_order(order_data):
    supabase.table('orders').insert(order_data).execute()
