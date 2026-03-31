import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import http from 'http';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function getEmbedding(text) {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

async function addMemory(content, starLevel, memoryDate) {
  const embedding = await getEmbedding(content);
  const { data, error } = await supabase
    .from('memories')
    .insert({ content, star_level: starLevel, memory_date: memoryDate, embedding });
  return { data, error };
}

async function searchMemory(query, count = 5) {
  const embedding = await getEmbedding(query);
  const { data, error } = await supabase.rpc('search_memories', {
    query_embedding: embedding,
    match_count: count,
    min_star: 1
  });
  return { data, error };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'POST' && req.url === '/add') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const { content, star_level, memory_date } = JSON.parse(body);
      const result = await addMemory(content, star_level, memory_date);
      res.end(JSON.stringify(result));
    });
  } else if (req.method === 'GET' && req.url.startsWith('/search')) {
    const query = new URL(req.url, 'http://localhost').searchParams.get('q');
    const result = await searchMemory(query);
    res.end(JSON.stringify(result));
  } else {
    res.end(JSON.stringify({ status: 'Memory service running!' }));
  }
});

server.listen(process.env.PORT || 3000);
console.log('Memory service started!');
