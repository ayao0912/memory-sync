import { createClient } from '@supabase/supabase-js';
import http from 'http';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const server = http.createServer(async (req, res) => {
  // 允许跨域
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // 首页
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'Memory service running!'}));
    return;
  }
  
  // 显示所有记忆（纯文本）
  if (req.method === 'GET' && req.url === '/memories') {
    try {
      const { data } = await supabase
        .from('memories')
        .select('content')
        .order('created_at', { ascending: false });
      
      let text = '【Gemini和瑶瑶的重要记忆】\n\n';
      for (const m of data || []) {
        text += m.content + '\n\n---\n\n';
      }
      
      res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end(text || '暂无记忆');
    } catch (e) {
      res.writeHead(500, {'Content-Type': 'text/plain'});
      res.end('Error: ' + e.message);
    }
    return;
  }
  
  // 其他请求返回404
  res.writeHead(404);
  res.end('Not found');
});

server.listen(process.env.PORT || 3000);
console.log('Memory service started!');
