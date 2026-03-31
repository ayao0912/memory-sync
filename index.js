import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import http from 'http';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

async function getEmbedding(text) {
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text
  });
  return response.embeddings[0].values;
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

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gemini的记忆库</title>
<style>
body{font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#1a1a2e;color:#eee}
h1{color:#a5d6a7;text-align:center}
textarea,input,select{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none;box-sizing:border-box}
button{background:#4caf50;color:white;padding:12px;border:none;border-radius:8px;width:100%;margin:10px 0;cursor:pointer}
button:hover{background:#45a049}
.result{background:#2a2a4e;padding:15px;border-radius:8px;margin:10px 0;white-space:pre-wrap}
.star{color:#ffd700}
</style></head>
<body>
<h1>Gemini的记忆库</h1>
<h3>添加记忆</h3>
<textarea id="content" rows="3" placeholder="记忆内容..."></textarea>
<select id="star"><option value="1">⭐ 日常</option><option value="2">⭐⭐ 重要</option><option value="3">⭐⭐⭐ 核心</option></select>
<input type="date" id="date">
<button onclick="addMem()">添加记忆</button>
<h3>搜索记忆</h3>
<input type="text" id="query" placeholder="搜索...">
<button onclick="searchMem()">搜索</button>
<div id="results"></div>
<script>
async function addMem(){
  const r=await fetch('/add',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({content:document.getElementById('content').value,
      star_level:parseInt(document.getElementById('star').value),
      memory_date:document.getElementById('date').value||null})});
  const d=await r.json();
  document.getElementById('results').innerHTML='<div class="result">'+(d.error?'错误: '+d.error.message:'添加成功!')+'</div>';
  document.getElementById('content').value='';
}
async function searchMem(){
  const q=document.getElementById('query').value;
  const r=await fetch('/search?q='+encodeURIComponent(q));
  const d=await r.json();
  let h='';
  if(d.data&&d.data.length){
    d.data.forEach(m=>{h+='<div class="result"><span class="star">'+'⭐'.repeat(m.star_level)+'</span> '+m.memory_date+'<br>'+m.content+'</div>'});
  }else{h='<div class="result">没有找到相关记忆</div>';}
  document.getElementById('results').innerHTML=h;
}
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/add') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { content, star_level, memory_date } = JSON.parse(body);
        const result = await addMemory(content, star_level, memory_date);
        res.end(JSON.stringify(result));
      } catch(e) {
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
    });
  } else if (req.method === 'GET' && req.url.startsWith('/search')) {
    try {
      const query = new URL(req.url, 'http://localhost').searchParams.get('q');
      const result = await searchMemory(query);
      res.end(JSON.stringify(result));
    } catch(e) {
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  } else {
    res.end(JSON.stringify({ status: 'Memory service running!' }));
  }
});

server.listen(process.env.PORT || 3000);
console.log('Memory service started!');

});

server.listen(process.env.PORT || 3000);
console.log('Memory service started!');
