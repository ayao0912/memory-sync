import { createClient } from '@supabase/supabase-js';
import http from 'http';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function getEmbedding(text) {
  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=' + process.env.GOOGLE_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } })
    }
  );
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.embedding.values;
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

async function addMemory(content, starLevel, memoryDate) {
  const embedding = await getEmbedding(content);
  const { data, error } = await supabase
    .from('memories')
    .insert({ content, star_level: starLevel, memory_date: memoryDate, embedding });
  return { data, error };
}

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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

// 新增一个全局变量，用来保存那个“不挂断的电话”（SSE 连接）
let activeSSEConnection = null;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. 建立 SSE 连接 (接通电话)
  if (req.url === '/sse' || req.url === '/mcp/sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // 保存这个连接
    activeSSEConnection = res;

    // 告诉客户端，纸条该扔到哪里 (使用绝对路径更安全)
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    sendSSE(res, 'endpoint', `${protocol}://${host}/mcp/message`);
    
    // 保持连接不断开
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
      if (activeSSEConnection === res) activeSSEConnection = null;
    });
    return;
  }

  // 2. 接收客户端的消息 (收纸条)
  if (req.method === 'POST' && req.url === '/mcp/message') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      
      // 【修复关键点1】：收到纸条后，立刻回复 HTTP 202 Accepted，不要把结果写在这里！
      res.writeHead(202, { 'Content-Type': 'text/plain' });
      res.end('Accepted');

      // 如果电话挂断了，就不处理了
      if (!activeSSEConnection) return;

      try {
        const message = JSON.parse(body);
        let responsePayload = null;

        // 处理初始化
        if (message.method === 'initialize') {
          responsePayload = {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'gemini-memory', version: '1.0.0' }
            }
          };
        } 
        // 处理获取工具列表
        else if (message.method === 'tools/list') {
          responsePayload = {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: [{
                name: 'search_memory',
                description: '搜索Gemini和瑶瑶的共同记忆。当瑶瑶说"你记得""以前""上次"等词时使用。',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: '搜索关键词' }
                  },
                  required: ['query']
                }
              }]
            }
          };
        } 
        // 处理调用工具 (查数据库)
        else if (message.method === 'tools/call') {
          const { name, arguments: args } = message.params;
          if (name === 'search_memory') {
            const result = await searchMemory(args.query, 5);
            const memories = result.data?.map(m => 
              `[${m.memory_date}] ${'⭐'.repeat(m.star_level)} ${m.content}`
            ).join('\n') || '没有找到相关记忆';
            
            responsePayload = {
              jsonrpc: '2.0',
              id: message.id,
              result: { content: [{ type: 'text', text: memories }] }
            };
          }
        } 
        else {
          responsePayload = { jsonrpc: '2.0', id: message.id, result: {} };
        }

        // 【修复关键点2】：把结果通过之前的电话 (SSE 连接) 念给客户端听！
        if (responsePayload) {
          sendSSE(activeSSEConnection, 'message', responsePayload);
        }

      } catch(e) {
        // 如果报错了，也要通过 SSE 告诉客户端
        sendSSE(activeSSEConnection, 'message', { 
          jsonrpc: '2.0', 
          error: { code: -32603, message: e.message } 
        });
      }
    });
    return;
  }

  // ==== 下面是你原本的网页和手动测试接口 ====
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }

  if (req.url.startsWith('/mcp/search_memory')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const query = url.searchParams.get('q') || url.searchParams.get('query');
      const count = parseInt(url.searchParams.get('count')) || 5;
      const result = await searchMemory(query, count);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch(e) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Memory service started on port ' + PORT);
});
