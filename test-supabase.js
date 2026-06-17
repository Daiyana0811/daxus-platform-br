const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('URL:', supabaseUrl);
console.log('KEY:', supabaseKey ? 'PRESENT' : 'MISSING');

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('email', 'zaki@daxus.com')
    .eq('status', 'Activo')
    .single();
    
  if (error) {
    console.error('ERROR:', error);
  } else {
    console.log('DATA:', data);
  }
}

test();
