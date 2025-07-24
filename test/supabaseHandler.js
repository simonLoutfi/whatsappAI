const { createClient } = require('@supabase/supabase-js');

const url = 'https://qvijckgxoauxeyoowcsn.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aWpja2d4b2F1eGV5b293Y3NuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjc0MjUxOSwiZXhwIjoyMDY4MzE4NTE5fQ.iVbqPo0-YdzSwyPD0ZNfCUqbM31lm9tlH-9IihePo98'; 
const supabase = createClient(url, key);

// Service account user ID (create a dedicated service user in your Supabase auth)
const SERVICE_USER_ID = 'd1a2b3c4-1234-5678-9012-345678901234'; 

async function getFaqAndStock() {
  const { data: faq, error: faqError } = await supabase.from('faqs').select('*');
  const { data: stock, error: stockError } = await supabase.from('stock').select('*');

  if (faqError || stockError) {
    console.error('Error fetching FAQ or stock:', faqError || stockError);
    return { faq: [], stock: [] };
  }

  return { faq, stock };
}

async function insertOrder(
  customer_phone,
  customer_whatsapp,
  customer_name,
  product,
  quantity,
  address,
  notes = '',
  total_amount = 0
) {
  try {
    // Generate a more unique order number
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const orderData = {
      order_number: orderNumber,
      customer_name,
      customer_phone,
      customer_whatsapp,
      product: `${product} (${quantity} units)`,
      quantity: parseInt(quantity),
      address,
      notes,
      total_amount: parseFloat(total_amount.toFixed(2)), // Ensure 2 decimal places
      status: 'pending',
      created_by: SERVICE_USER_ID // Using predefined service account
    };

    console.log('Inserting order:', orderData);

    const { data, error } = await supabase
      .from('orders')
      .insert([orderData])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Detailed Supabase error:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    throw new Error(`Database insert failed: ${error.message}`);
  }
}

module.exports = { getFaqAndStock, insertOrder };