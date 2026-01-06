const express = require('express');
const line = require('@line/bot-sdk');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(cors());

// ==================== Firebase 初始化 ====================
let db;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  
  if (serviceAccount.project_id) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('✅ Firebase 連線成功');
  } else {
    console.log('⚠️ Firebase 未設定，使用記憶體模式');
  }
} catch (error) {
  console.error('Firebase 初始化失敗:', error.message);
}

// ==================== LINE Bot 設定 ====================
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || ''
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: lineConfig.channelAccessToken
});

const ADMIN_IDS = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);

// ==================== Firestore 資料操作 ====================

// 取得所有活動
async function getEvents() {
  if (!db) return getMemoryData().events;
  const snapshot = await db.collection('events').orderBy('createdAt', 'desc').get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// 取得單一活動
async function getEvent(eventId) {
  if (!db) return getMemoryData().events.find(e => e.id === eventId);
  const doc = await db.collection('events').doc(eventId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

// 新增活動
async function addEvent(eventData) {
  if (!db) {
    const newEvent = { ...eventData, id: Date.now().toString(), createdAt: new Date().toISOString() };
    memoryData.events.push(newEvent);
    return newEvent;
  }
  const docRef = await db.collection('events').add({
    ...eventData,
    registrations: 0,
    notifications: 0,
    certificates: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { id: docRef.id, ...eventData };
}

// 更新活動
async function updateEvent(eventId, updates) {
  if (!db) {
    const idx = memoryData.events.findIndex(e => e.id === eventId);
    if (idx !== -1) memoryData.events[idx] = { ...memoryData.events[idx], ...updates };
    return;
  }
  await db.collection('events').doc(eventId).update(updates);
}

// 取得所有報名
async function getRegistrations(eventId = null) {
  if (!db) {
    const regs = getMemoryData().registrations;
    return eventId ? regs.filter(r => r.eventId === eventId) : regs;
  }
  let query = db.collection('registrations').orderBy('createdAt', 'desc');
  if (eventId) query = query.where('eventId', '==', eventId);
  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// 新增報名
async function addRegistration(regData) {
  if (!db) {
    const newReg = { ...regData, id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'pending' };
    memoryData.registrations.push(newReg);
    const event = memoryData.events.find(e => e.id === regData.eventId);
    if (event) event.registrations++;
    return newReg;
  }
  
  // 新增報名
  const docRef = await db.collection('registrations').add({
    ...regData,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // 更新活動報名數
  await db.collection('events').doc(regData.eventId).update({
    registrations: admin.firestore.FieldValue.increment(1)
  });
  
  return { id: docRef.id, ...regData };
}

// 更新報名狀態
async function updateRegistration(regId, updates) {
  if (!db) {
    const idx = memoryData.registrations.findIndex(r => r.id === regId);
    if (idx !== -1) memoryData.registrations[idx] = { ...memoryData.registrations[idx], ...updates };
    return;
  }
  await db.collection('registrations').doc(regId).update(updates);
}

// 取得設定
async function getSettings() {
  if (!db) return getMemoryData().settings;
  const doc = await db.collection('settings').doc('main').get();
  return doc.exists ? doc.data() : { geminiApiKey: '' };
}

// 更新設定
async function saveSettings(settings) {
  if (!db) {
    memoryData.settings = settings;
    return;
  }
  await db.collection('settings').doc('main').set(settings, { merge: true });
}

// ==================== 記憶體備援 ====================
let memoryData = {
  events: [
    { id: '1', title: 'AI 繪圖入門工作坊', description: '學習 Stable Diffusion', date: '2026-01-15', time: '14:00', endTime: '17:00', location: '線上 Google Meet', maxParticipants: 30, status: 'active', registrations: 24, notifications: 2, certificates: 0, instructorName: '王老師', createdAt: new Date().toISOString() },
    { id: '2', title: 'Vibe Coding 實戰營', description: '用自然語言寫程式', date: '2026-01-22', time: '09:00', endTime: '12:00', location: '台北市信義區', maxParticipants: 20, status: 'draft', registrations: 0, notifications: 0, certificates: 0, instructorName: '王老師', createdAt: new Date().toISOString() }
  ],
  registrations: [
    { id: '1', eventId: '1', name: '王小明', email: 'xiaoming@example.com', phone: '0912345678', createdAt: '2026-01-02', status: 'confirmed' },
    { id: '2', eventId: '1', name: '李小華', email: 'xiaohua@example.com', phone: '0923456789', createdAt: '2026-01-03', status: 'pending' }
  ],
  settings: { geminiApiKey: process.env.GEMINI_API_KEY || '' }
};

function getMemoryData() { return memoryData; }

// ==================== Gemini API ====================
async function callGemini(prompt) {
  const settings = await getSettings();
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) return '請先設定 Gemini API Key';
  
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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

// ==================== LINE Bot 訊息處理 ====================
function isAdmin(userId) {
  if (ADMIN_IDS.length === 0) return true;
  return ADMIN_IDS.includes(userId);
}

function createFlexCard(title, content, color = '#6366f1') {
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg', color: '#ffffff' }],
        backgroundColor: color, paddingAll: '15px'
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'text', text: content, wrap: true, size: 'sm' }],
        paddingAll: '15px'
      }
    }
  };
}

function createEventsCarousel(events) {
  const bubbles = events.slice(0, 10).map(ev => ({
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: ev.title, weight: 'bold', size: 'md', color: '#ffffff', wrap: true }],
      backgroundColor: ev.status === 'active' ? '#10b981' : ev.status === 'draft' ? '#6b7280' : '#ef4444',
      paddingAll: '12px'
    },
    body: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: `📅 ${ev.date} ${ev.time}`, size: 'xs', color: '#666666' },
        { type: 'text', text: `📍 ${ev.location}`, size: 'xs', color: '#666666', margin: 'sm' },
        { type: 'separator', margin: 'md' },
        {
          type: 'box', layout: 'horizontal',
          contents: [
            { type: 'text', text: `報名 ${ev.registrations || 0}/${ev.maxParticipants}`, size: 'xs', color: '#6366f1' },
            { type: 'text', text: ev.status === 'active' ? '進行中' : ev.status === 'draft' ? '草稿' : '已結束', size: 'xs', color: '#999999', align: 'end' }
          ],
          margin: 'md'
        }
      ],
      paddingAll: '12px'
    },
    footer: {
      type: 'box', layout: 'horizontal',
      contents: [
        { type: 'button', action: { type: 'message', label: '詳情', text: `活動詳情 ${ev.id}` }, style: 'primary', height: 'sm', flex: 1 },
        { type: 'button', action: { type: 'message', label: '文宣', text: `生成文宣 ${ev.id}` }, style: 'secondary', height: 'sm', flex: 1, margin: 'sm' }
      ],
      paddingAll: '10px'
    }
  }));
  return { type: 'flex', altText: '活動列表', contents: { type: 'carousel', contents: bubbles } };
}

async function createDashboardCard() {
  const events = await getEvents();
  const regs = await getRegistrations();
  
  const totalEvents = events.length;
  const activeEvents = events.filter(e => e.status === 'active').length;
  const totalRegs = regs.length;
  const totalCerts = events.reduce((s, e) => s + (e.certificates || 0), 0);

  return {
    type: 'flex',
    altText: '系統總覽',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: '📊 系統總覽', weight: 'bold', size: 'xl', color: '#ffffff' },
          { type: 'text', text: `🔥 Firebase 即時同步`, size: 'xs', color: '#ffffffcc' }
        ],
        backgroundColor: '#6366f1', paddingAll: '20px'
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          {
            type: 'box', layout: 'horizontal',
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
            type: 'box', layout: 'horizontal',
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
      }
    }
  };
}

async function createRecentRegistrations() {
  const regs = await getRegistrations();
  const events = await getEvents();
  const recent = regs.slice(0, 5);

  if (recent.length === 0) {
    return createFlexCard('📋 最新報名', '目前沒有報名資料');
  }

  const items = recent.map(r => {
    const event = events.find(e => e.id === r.eventId);
    return {
      type: 'box', layout: 'horizontal',
      contents: [
        { type: 'text', text: r.status === 'confirmed' ? '✅' : '⏳', flex: 0 },
        {
          type: 'box', layout: 'vertical',
          contents: [
            { type: 'text', text: r.name, weight: 'bold', size: 'sm' },
            { type: 'text', text: event?.title || '未知活動', size: 'xs', color: '#888888' }
          ],
          flex: 1, margin: 'md'
        }
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
        type: 'box', layout: 'vertical',
        contents: [{ type: 'text', text: '📋 最新報名', weight: 'bold', size: 'lg', color: '#ffffff' }],
        backgroundColor: '#3b82f6', paddingAll: '15px'
      },
      body: { type: 'box', layout: 'vertical', contents: items, paddingAll: '15px' }
    }
  };
}

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

async function handleMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text?.trim() || '';
  
  if (!isAdmin(userId)) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [createFlexCard('⚠️ 權限不足', '您不是管理員。\n\nYour ID: ' + userId, '#ef4444')]
    });
  }

  let messages = [];
  const events = await getEvents();

  if (text === '總覽' || text === '查看總覽' || text === '首頁') {
    messages.push(await createDashboardCard());
  }
  else if (text === '活動列表' || text === '活動' || text === '查看活動') {
    if (events.length === 0) {
      messages.push(createFlexCard('📅 活動列表', '目前沒有任何活動'));
    } else {
      messages.push(createEventsCarousel(events));
    }
  }
  else if (text.startsWith('活動詳情')) {
    const eventId = text.split(' ')[1];
    const ev = await getEvent(eventId);
    if (ev) {
      const content = `📅 日期：${ev.date} ${ev.time}\n📍 地點：${ev.location}\n👥 報名：${ev.registrations || 0}/${ev.maxParticipants}\n📨 通知：${ev.notifications || 0} 次\n🏆 證書：${ev.certificates || 0} 張\n\n狀態：${ev.status === 'active' ? '✅ 進行中' : ev.status === 'draft' ? '📝 草稿' : '🔴 已結束'}`;
      messages.push(createFlexCard(`📅 ${ev.title}`, content, ev.status === 'active' ? '#10b981' : '#6b7280'));
    } else {
      messages.push({ type: 'text', text: '找不到此活動' });
    }
  }
  else if (text === '最新報名' || text === '報名') {
    messages.push(await createRecentRegistrations());
  }
  else if (text === '生成文宣' || text === '文宣') {
    const activeEvents = events.filter(e => e.status === 'active');
    if (activeEvents.length === 0) {
      messages.push(createFlexCard('🎨 生成文宣', '目前沒有進行中的活動'));
    } else {
      messages.push({
        type: 'flex',
        altText: '選擇活動',
        contents: {
          type: 'bubble',
          header: {
            type: 'box', layout: 'vertical',
            contents: [{ type: 'text', text: '🎨 選擇要生成文宣的活動', weight: 'bold', size: 'md', color: '#ffffff' }],
            backgroundColor: '#a855f7', paddingAll: '15px'
          },
          body: {
            type: 'box', layout: 'vertical',
            contents: activeEvents.map(ev => ({
              type: 'button',
              action: { type: 'message', label: ev.title.slice(0, 20), text: `生成文宣 ${ev.id}` },
              style: 'secondary', margin: 'sm'
            })),
            paddingAll: '15px'
          }
        }
      });
    }
  }
  else if (text.startsWith('生成文宣 ')) {
    const eventId = text.split(' ')[1];
    const ev = await getEvent(eventId);
    if (ev) {
      const prompt = `你是活動文案專家。請為以下工作坊撰寫社群貼文風格的宣傳文案，活潑有趣，包含適當的 emoji 和 hashtag。

活動：${ev.title}
說明：${ev.description || ''}
時間：${ev.date} ${ev.time}
地點：${ev.location}
名額：${ev.maxParticipants} 人

直接輸出文案，約150-250字。`;
      
      const poster = await callGemini(prompt);
      messages = [createFlexCard(`🎨 ${ev.title} 文宣`, poster, '#a855f7')];
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

🔥 Firebase 即時同步
網頁版和 LINE Bot 資料同步！`;
    messages.push(createFlexCard('❓ 使用說明', helpText, '#6366f1'));
  }
  else if (text === 'myid' || text === '我的ID') {
    messages.push({ type: 'text', text: `您的 User ID：\n${userId}` });
  }
  else if (text === 'db' || text === '資料庫狀態') {
    const status = db ? '✅ Firebase 已連線' : '⚠️ 使用記憶體模式';
    messages.push({ type: 'text', text: status });
  }
  else {
    messages.push({
      type: 'text',
      text: `您好！我是工作坊管理助手 🎓\n\n請使用指令：\n・總覽\n・活動列表\n・最新報名\n・生成文宣\n・說明`,
      quickReply: createQuickReply()
    });
  }

  return client.replyMessage({ replyToken: event.replyToken, messages });
}

// ==================== LINE Webhook ====================
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(async event => {
      if (event.type === 'message' && event.message.type === 'text') {
        await handleMessage(event);
      } else if (event.type === 'follow') {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: `歡迎使用工作坊管理系統！🎓\n\n輸入「說明」查看指令`,
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

// ==================== API 端點 ====================
app.use(express.json());

// 活動 API
app.get('/api/events', async (req, res) => {
  try {
    const events = await getEvents();
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/events', async (req, res) => {
  try {
    const newEvent = await addEvent(req.body);
    res.json(newEvent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/events/:id', async (req, res) => {
  try {
    await updateEvent(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 報名 API
app.get('/api/registrations', async (req, res) => {
  try {
    const regs = await getRegistrations(req.query.eventId);
    res.json(regs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/registrations', async (req, res) => {
  try {
    const newReg = await addRegistration(req.body);
    res.json(newReg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/registrations/:id', async (req, res) => {
  try {
    await updateRegistration(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 設定 API
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    await saveSettings(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 資料庫狀態
app.get('/api/status', (req, res) => {
  res.json({
    firebase: !!db,
    mode: db ? 'Firebase Firestore' : 'Memory',
    timestamp: new Date().toISOString()
  });
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
  console.log(`🔥 Database: ${db ? 'Firebase' : 'Memory'}`);
});
