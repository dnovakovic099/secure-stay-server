import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabaseRoleKey = process.env.SUPABASE_ROLE_KEY || '';
if (!supabaseUrl || !supabaseKey || !supabaseRoleKey) {
  throw new Error('Supabase URL or Key is missing.');
}


export const supabaseAdmin = createClient(supabaseUrl, supabaseRoleKey);

export const supabase = createClient(supabaseUrl, supabaseKey);
