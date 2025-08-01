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

    // Start a transaction
    const { data, error } = await supabase.rpc('create_order_with_items', {
      p_order_number: orderNumber,
      p_customer_name: customer_name,
      p_customer_phone: customer_phone,
      p_customer_whatsapp: customer_whatsapp,
      p_product_sku: productSku,
      p_product_name: productName,
      p_quantity: quantity,
      p_unit_price: unitPrice,
      p_total_amount: totalAmount,
      p_notes: notes
    });

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Order processing error:', {
      message: error.message,
      details: error.details,
      code: error.code
    });
    throw new Error(`Failed to process order: ${error.message}`);
  }
}

/**
 * Insert unknown questions into FAQ table for admin review
 * @param {string} question - The customer's question
 * @param {string} language - Detected language (en, ar, arabizi, fr, mixed)
 * @param {string} confidence - Confidence level (UNCERTAIN, UNKNOWN)
 * @returns {Promise<Object>} - Insert result
 */
async function insertUnknownQuestion(question, language = 'en', confidence = 'UNKNOWN') {
  try {
    console.log(`=== INSERTING UNKNOWN QUESTION ===`);
    console.log(`Question: ${question}`);
    console.log(`Language: ${language}`);
    console.log(`Confidence: ${confidence}`);

    // Check if this question already exists to avoid duplicates
    const { data: existingFaq, error: checkError } = await supabase
      .from('faqs')
      .select('id, question')
      .ilike('question', `%${question.trim()}%`)
      .limit(1);

    if (checkError) {
      console.error('Error checking existing FAQ:', checkError);
      // Continue with insertion even if check fails
    }

    if (existingFaq && existingFaq.length > 0) {
      console.log(`Question already exists in FAQ: ${existingFaq[0].question}`);
      return { 
        success: true, 
        message: 'Question already exists',
        existing_id: existingFaq[0].id 
      };
    }

    // Determine category based on language and confidence
    let category = 'unknown';
    if (confidence === 'UNCERTAIN') {
      category = 'uncertain';
    }
    if (language === 'arabizi' || language === 'ar') {
      category = `${category}_arabic`;
    }

    // Create pending FAQ entry for admin review
    const { data: newFaq, error: insertError } = await supabase
      .from('faqs')
      .insert({
        question: question.trim(),
        answer: '', // Empty answer - pending admin input
        category: category,
        is_active: false, // Inactive until admin reviews and adds answer
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null // No user auth context in chatbot
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting unknown question:', insertError);
      throw insertError;
    }

    console.log(`Successfully inserted unknown question:`, newFaq);
    
    return {
      success: true,
      message: 'Unknown question saved for admin review',
      faq_id: newFaq.id,
      category: category,
      language: language,
      confidence: confidence
    };

  } catch (error) {
    console.error('Failed to insert unknown question:', {
      question: question,
      language: language,
      confidence: confidence,
      error: error.message,
      details: error.details
    });
    
    // Don't throw error to avoid breaking the conversation flow
    return {
      success: false,
      message: `Failed to save question: ${error.message}`,
      error: error
    };
  }
}

/**
 * Get pending FAQ questions for admin review
 * @returns {Promise<Array>} - Array of pending FAQ questions
 */
async function getPendingFaqQuestions() {
  try {
    const { data: pendingFaqs, error } = await supabase
      .from('faqs')
      .select('*')
      .eq('is_active', false)
      .is('answer', null)
      .or('answer.eq.')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching pending FAQ questions:', error);
      return [];
    }

    return pendingFaqs || [];
  } catch (error) {
    console.error('Failed to get pending FAQ questions:', error);
    return [];
  }
}

/**
 * Update FAQ answer and activate it
 * @param {string} faqId - FAQ ID to update
 * @param {string} answer - Admin's answer
 * @param {string} category - Optional category update
 * @returns {Promise<Object>} - Update result
 */
async function updateFaqAnswer(faqId, answer, category = null) {
  try {
    const updateData = {
      answer: answer.trim(),
      is_active: true,
      updated_at: new Date().toISOString()
    };

    if (category) {
      updateData.category = category;
    }

    const { data: updatedFaq, error } = await supabase
      .from('faqs')
      .update(updateData)
      .eq('id', faqId)
      .select()
      .single();

    if (error) {
      console.error('Error updating FAQ answer:', error);
      throw error;
    }

    console.log(`Successfully updated FAQ:`, updatedFaq);
    
    return {
      success: true,
      message: 'FAQ updated and activated',
      faq: updatedFaq
    };

  } catch (error) {
    console.error('Failed to update FAQ answer:', error);
    throw error;
  }
}

module.exports = { 
  getFaqAndStock, 
  insertOrderWithItems, 
  insertUnknownQuestion,
  getPendingFaqQuestions,
  updateFaqAnswer
};