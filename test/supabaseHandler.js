const { createClient } = require('@supabase/supabase-js');

const url = 'https://qvijckgxoauxeyoowcsn.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2aWpja2d4b2F1eGV5b293Y3NuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjc0MjUxOSwiZXhwIjoyMDY4MzE4NTE5fQ.iVbqPo0-YdzSwyPD0ZNfCUqbM31lm9tlH-9IihePo98'; 
const supabase = createClient(url, key);

async function getFaqAndStock() {
  const { data: faq, error: faqError } = await supabase.from('faqs').select('*');
  const { data: stock, error: stockError } = await supabase.from('stock').select('*');
  const { data: business_profiles, error: businessProfilesError } = await supabase.from('business_profiles').select('*');

  if (faqError || stockError || businessProfilesError) {
    console.error('Error fetching FAQ, stock, or business profiles:', faqError || stockError || businessProfilesError);
    return { faq: [], stock: [], business_profiles: [] };
  }

  return { faq, stock, business_profiles };
}

async function insertOrderWithItems(
  customer_phone,
  customer_whatsapp,
  customer_name,
  productSku,
  productName,
  quantity,
  unitPrice,
  notes = ''
) {
  try {
    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const totalAmount = unitPrice * quantity;

    // 1. First insert the order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        customer_name,
        customer_phone,
        customer_whatsapp,
        notes,
        total_amount: totalAmount,
        status: 'pending'
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // 2. Get the stock item to get its ID
    const { data: stockItem, error: stockError } = await supabase
      .from('stock')
      .select('id')
      .eq('sku', productSku)
      .single();

    if (stockError) throw stockError;

    // 3. Insert the order item
    const { error: itemError } = await supabase
      .from('order_items')
      .insert({
        order_id: order.id,
        stock_id: stockItem.id,
        quantity: quantity,
        unit_price: unitPrice,
        total_price: totalAmount
      });

    if (itemError) throw itemError;

    // 4. Update stock quantity (optional)
    await supabase
      .from('stock')
      .update({ quantity: supabase.rpc('decrement', { val: quantity }) })
      .eq('sku', productSku);

    return {
      order_id: order.id,
      order_number: orderNumber,
      customer_name,
      product_name: productName,
      quantity,
      total_amount: totalAmount
    };
  } catch (error) {
    console.error('Order processing error:', {
      message: error.message,
      details: error.details,
      code: error.code
    });
    throw new Error(`Failed to process order: ${error.message}`);
  }
}

module.exports = { getFaqAndStock, insertOrderWithItems };