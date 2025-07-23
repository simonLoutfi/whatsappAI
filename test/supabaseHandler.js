const { createClient } = require('@supabase/supabase-js');

const url = 'https://qvijckgxoauxeyoowcsn.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aWpja2d4b2F1eGV5b293Y3NuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjc0MjUxOSwiZXhwIjoyMDY4MzE4NTE5fQ.iVbqPo0-YdzSwyPD0ZNfCUqbM31lm9tlH-9IihePo98'; 
const supabase = createClient(url, key);

async function getFaqAndStock() {
  const { data: faq, error: faqError } = await supabase.from('faqs').select('*');
  const { data: stock, error: stockError } = await supabase.from('stock').select('*');

  if (faqError || stockError) {
    console.error('Error fetching FAQ or stock:', faqError || stockError);
    return { faq: [], stock: [] };
  }

  return { faq, stock };
}

async function insertOrder(phone, product, quantity, address) {
  const order = {
    phone,
    product,
    quantity,
    address,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase.from('orders').insert([order]);

  if (error) {
    console.error('Error inserting order:', error);
  } else {
    console.log('Order inserted:', data);
  }
}

module.exports = { getFaqAndStock, insertOrder };
