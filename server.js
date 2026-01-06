const express = require('express');
const line = require('@line/bot-sdk');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());

// LINE Bot 設定
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || ''
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: lineConfig.channelAccessToken
});

// 管理員 User IDs（可在環境變數設定多個，用逗號分隔）
const ADMIN_IDS = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);

// 模擬資料庫（實際應用請接 Firebase/MongoDB）
let workshopData = {
  events: [
    { id: '1', title: 'AI 繪圖入門工作坊', date: '2026-01-15', time: '14:00', location: '線上 Google Meet', maxParticipants: 30, registrations: 24, status: 'active', notifications: 2, certificates: 0 },
    { id: '2', title: 'Vibe Coding 實戰營', date: '2026-01-22', time: '09:00', location: '台北市信義區', maxParticipants: 20, registrations: 0, status: 'draft', notifications: 0, certificates: 0 },
    { id: '3', title: 'ChatGPT 教學應用', date: '2025-12-20', time: '13:30', location: '線上 Zoom', maxParticipants: 50, registrations: 48, status: 'ended', notifications: 5, certificates: 45 }
  ],
  registrations: [
    { id: '1', eventId: '1', name: '王小明', email: 'xiaoming@example.com', phone: '0912345678', createdAt: '2026-01-02', status: 'confirmed' },
    { id: '2', eventId: '1', name: '李小華', email: 'xiaohua@example.com', phone: '0923456789', createdAt: '2026-01-03', status: 'pending' }
  ],
  settings: {
    geminiApiKey: process.env.GEMINI_API_KEY || ''
  }
};

// 檢查是否為管理員
function isAdmin(userId) {
  // 如果沒設定管理員，允許所有人（開發測試用）
  if (ADMIN_IDS.length === 0) return true;
  return ADMIN_IDS.includes(userId);
}

// Gemini API 呼叫
async function callGemini(prompt) {
  if (!workshopData.settings.geminiApiKey) {
    return '請先設定 Gemini API Key';
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${workshopData.settings.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 800 }
        })
      }
    );
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '生成失敗';
  } catch (error) {
    return '呼叫 AI 失敗：' + error.message;
  }
}

// 建立 Flex Message 卡片
function createFlexCard(title, content, color = '#6366f1') {
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg', color: '#ffffff' }],
        backgroundColor: color,
        paddingAll: '15px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: content, wrap: true, size: 'sm' }],
        paddingAll: '15px'
      }
    }
  };
}

// 建立活動列表 Carousel
function createEventsCarousel(events) {
  const bubbles = events.map(ev => ({
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: ev.title, weight: 'bold', size: 'md', color: '#ffffff', wrap: true }
      ],
      backgroundColor: ev.status === 'active' ? '#10b981' : ev.status === 'draft' ? '#6b7280' : '#ef4444',
      paddingAll: '12px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: `📅 ${ev.date} ${ev.time}`, size: 'xs', color: '#666666' },
        { type: 'text', text: `📍 ${ev.location}`, size: 'xs', color: '#666666', margin: 'sm' },
        { type: 'separator', margin: 'md' },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `報名 ${ev.registrations}/${ev.maxParticipants}`, size: 'xs', color: '#6366f1' },
            { type: 'text', text: ev.status === 'active' ? '進行中' : ev.status === 'draft' ? '草稿' : '已結束', size: 'xs', color: '#999999', align: 'end' }
          ],
          margin: 'md'
        }
      ],
      paddingAll: '12px'
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'button', action: { type: 'message', label: '詳情', text: `活動詳情 ${ev.id}` }, style: 'primary', height: 'sm', flex: 1 },
        { type: 'button', action: { type: 'message', label: '文宣', text: `生成文宣 ${ev.id}` }, style: 'secondary', height: 'sm', flex: 1, margin: 'sm' }
      ],
      paddingAll: '10px'
    }
  }));

  return {
    type: 'flex',
    altText: '活動列表',
    contents: { type: 'carousel', contents: bubbles.slice(0, 10) }
  };
}

// 建立總覽卡片
function createDashboardCard() {
  const totalEvents = workshopData.events.length;
  const activeEvents = workshopData.events.filter(e => e.status === 'active').length;
  const totalRegs = workshopData.registrations.length;
  const totalNotifications = workshopData.events.reduce((s, e) => s + e.notifications, 0);
  const totalCerts = workshopData.events.reduce((s, e) => s + e.certificates, 0);

  return {
    type: 'flex',
    altText: '系統總覽',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📊 系統總覽', weight: 'bold', size: 'xl', color: '#ffffff' },
          { type: 'text', text: new Date().toLocaleDateString('zh-TW'), size: 'xs', color: '#ffffffcc' }
        ],
        backgroundColor: '#6366f1',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '📅', size: 'xxl', align: 'center' },
                { type: 'text', text: String(totalEvents), weight: 'bold', size: 'xl', align: 'center', color: '#6366f1' },
                { type: 'text', text: '活動總數', size: 'xs', align: 'center', color: '#888888' }
              ], flex: 1 },
              { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '✅', size: 'xxl', align: 'center' },
                { type: 'text', text: String(activeEvents), weight: 'bold', size: 'xl', align: 'center', color: '#10b981' },
                { type: 'text', text: '進行中', size: 'xs', align: 'center', color: '#888888' }
              ], flex: 1 }
            ]
          },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '👥', size: 'xxl', align: 'center' },
                { type: 'text', text: String(totalRegs), weight: 'bold', size: 'xl', align: 'center', color: '#3b82f6' },
                { type: 'text', text: '報名人數', size: 'xs', align: 'center', color: '#888888' }
              ], flex: 1 },
              { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '🏆', size: 'xxl', align: 'center' },
                { type: 'text', text: String(totalCerts), weight: 'bold', size: 'xl', align: 'center', color: '#f59e0b' },
                { type: 'text', text: '已發證書', size: 'xs', align: 'center', color: '#888888' }
              ], flex: 1 }
            ],
            margin: 'lg'
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', action: { type: 'message', label: '📅 活動列表', text: '活動列表' }, style: 'primary', height: 'sm' },
          { type: 'button', action: { type: 'message', label: '📋 最新報名', text: '最新報名' }, style: 'secondary', height: 'sm', margin: 'sm' }
        ],
        paddingAll: '10px'
      }
    }
  };
}

// 建立最新報名列表
function createRecentRegistrations() {
  const recent = workshopData.registrations
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  if (recent.length === 0) {
    return createFlexCard('📋 最新報名', '目前沒有報名資料');
  }

  const items = recent.map(r => {
    const event = workshopData.events.find(e => e.id === r.eventId);
    return {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: r.status === 'confirmed' ? '✅' : '⏳', flex: 0 },
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: r.name, weight: 'bold', size: 'sm' },
            { type: 'text', text: event?.title || '未知活動', size: 'xs', color: '#888888' }
          ],
          flex: 1,
          margin: 'md'
        },
        { type: 'text', text: r.createdAt, size: 'xs', color: '#888888', flex: 0 }
      ],
      margin: 'md'
    };
  });

  return {
    type: 'flex',
    altText: '最新報名',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: '📋 最新報名', weight: 'bold', size: 'lg', color: '#ffffff' }],
        backgroundColor: '#3b82f6',
        paddingAll: '15px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: items,
        paddingAll: '15px'
      }
    }
  };
}

// 建立 Quick Reply 按鈕
function createQuickReply() {
  return {
    items: [
      { type: 'action', action: { type: 'message', label: '📊 總覽', text: '總覽' } },
      { type: 'action', action: { type: 'message', label: '📅 活動', text: '活動列表' } },
      { type: 'action', action: { type: 'message', label: '📋 報名', text: '最新報名' } },
      { type: 'action', action: { type: 'message', label: '🎨 文宣', text: '生成文宣' } },
      { type: 'action', action: { type: 'message', label: '❓ 說明', text: '說明' } }
    ]
  };
}

// 處理 LINE 訊息
async function handleMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text?.trim() || '';
  
  // 檢查管理員權限
  if (!isAdmin(userId)) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [createFlexCard('⚠️ 權限不足', '您不是管理員，無法使用此功能。\n\n請聯繫系統管理員將您的 User ID 加入白名單。\n\nYour ID: ' + userId, '#ef4444')]
    });
  }

  let messages = [];

  // 指令處理
  if (text === '總覽' || text === '查看總覽' || text === '首頁') {
    messages.push(createDashboardCard());
  }
  else if (text === '活動列表' || text === '活動' || text === '查看活動') {
    if (workshopData.events.length === 0) {
      messages.push(createFlexCard('📅 活動列表', '目前沒有任何活動'));
    } else {
      messages.push(createEventsCarousel(workshopData.events));
    }
  }
  else if (text.startsWith('活動詳情')) {
    const eventId = text.split(' ')[1];
    const event = workshopData.events.find(e => e.id === eventId);
    if (event) {
      const regs = workshopData.registrations.filter(r => r.eventId === eventId);
      const content = `📅 日期：${event.date} ${event.time}\n📍 地點：${event.location}\n👥 報名：${event.registrations}/${event.maxParticipants}\n📨 通知：${event.notifications} 次\n🏆 證書：${event.certificates} 張\n\n狀態：${event.status === 'active' ? '✅ 進行中' : event.status === 'draft' ? '📝 草稿' : '🔴 已結束'}`;
      messages.push(createFlexCard(`📅 ${event.title}`, content, event.status === 'active' ? '#10b981' : '#6b7280'));
    } else {
      messages.push({ type: 'text', text: '找不到此活動' });
    }
  }
  else if (text === '最新報名' || text === '報名') {
    messages.push(createRecentRegistrations());
  }
  else if (text === '生成文宣' || text === '文宣') {
    const activeEvents = workshopData.events.filter(e => e.status === 'active');
    if (activeEvents.length === 0) {
      messages.push(createFlexCard('🎨 生成文宣', '目前沒有進行中的活動'));
    } else {
      messages.push({
        type: 'flex',
        altText: '選擇活動',
        contents: {
          type: 'bubble',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'text', text: '🎨 選擇要生成文宣的活動', weight: 'bold', size: 'md', color: '#ffffff' }],
            backgroundColor: '#a855f7',
            paddingAll: '15px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: activeEvents.map(ev => ({
              type: 'button',
              action: { type: 'message', label: ev.title.slice(0, 20), text: `生成文宣 ${ev.id}` },
              style: 'secondary',
              margin: 'sm'
            })),
            paddingAll: '15px'
          }
        }
      });
    }
  }
  else if (text.startsWith('生成文宣 ')) {
    const eventId = text.split(' ')[1];
    const event = workshopData.events.find(e => e.id === eventId);
    if (event) {
      messages.push({ type: 'text', text: '🤖 AI 正在生成文宣中...' });
      
      const prompt = `你是活動文案專家。請為以下工作坊撰寫社群貼文風格的宣傳文案，活潑有趣，包含適當的 emoji 和 hashtag。

活動：${event.title}
時間：${event.date} ${event.time}
地點：${event.location}
名額：${event.maxParticipants} 人

直接輸出文案，約150-250字。`;
      
      const poster = await callGemini(prompt);
      messages = [createFlexCard(`🎨 ${event.title} 文宣`, poster, '#a855f7')];
    } else {
      messages.push({ type: 'text', text: '找不到此活動' });
    }
  }
  else if (text === '說明' || text === '幫助' || text === 'help') {
    const helpText = `🎓 工作坊管理 Bot 使用說明

📊 總覽 - 查看系統統計
📅 活動列表 - 查看所有活動
📋 最新報名 - 查看報名資料
🎨 生成文宣 - AI 生成宣傳文案

💡 小技巧：
・點擊活動卡片按鈕可快速操作
・使用 Rich Menu 快速導航
・輸入「活動詳情 1」查看活動 ID 1`;
    messages.push(createFlexCard('❓ 使用說明', helpText, '#6366f1'));
  }
  else if (text === 'myid' || text === '我的ID') {
    messages.push({ type: 'text', text: `您的 User ID：\n${userId}\n\n請將此 ID 提供給系統管理員以獲得管理權限。` });
  }
  else {
    // 預設回覆
    messages.push({
      type: 'text',
      text: `您好！我是工作坊管理助手 🎓\n\n請使用以下指令：\n・總覽\n・活動列表\n・最新報名\n・生成文宣\n・說明\n\n或點擊下方 Rich Menu 按鈕操作`,
      quickReply: createQuickReply()
    });
  }

  // 加入 Quick Reply
  if (messages.length > 0 && messages[messages.length - 1].type !== 'text') {
    // 對於 Flex Message，不加 quickReply
  } else if (messages.length > 0) {
    messages[messages.length - 1].quickReply = createQuickReply();
  }

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: messages
  });
}

// LINE Webhook
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(async event => {
      if (event.type === 'message' && event.message.type === 'text') {
        await handleMessage(event);
      } else if (event.type === 'follow') {
        // 新加入的使用者
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: `歡迎使用工作坊管理系統！🎓\n\n我是您的管理助手，可以幫您：\n📊 查看活動統計\n📅 管理工作坊活動\n🎨 AI 生成宣傳文案\n\n輸入「說明」查看完整指令列表`,
            quickReply: createQuickReply()
          }]
        });
      }
    }));
    res.status(200).end();
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).end();
  }
});

// API 端點（供網頁前端使用）
app.use(express.json());

app.get('/api/events', (req, res) => {
  res.json(workshopData.events);
});

app.get('/api/registrations', (req, res) => {
  res.json(workshopData.registrations);
});

app.post('/api/events', (req, res) => {
  const newEvent = { ...req.body, id: Date.now().toString() };
  workshopData.events.push(newEvent);
  res.json(newEvent);
});

app.post('/api/registrations', (req, res) => {
  const newReg = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString().split('T')[0] };
  workshopData.registrations.push(newReg);
  // 更新活動報名人數
  const event = workshopData.events.find(e => e.id === newReg.eventId);
  if (event) event.registrations++;
  res.json(newReg);
});

// 靜態檔案
app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 LINE Webhook: /webhook`);
  console.log(`🌐 Web UI: /`);
});
