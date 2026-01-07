const express = require('express');
const line = require('@line/bot-sdk');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
app.use(cors());

// ==================== Resend Email 設定 ====================
let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('✅ Resend Email 已設定');
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

// ==================== 通知功能 ====================

// 發送 Email 確認信給學員
async function sendConfirmationEmail(registration, event) {
  if (!resend) {
    console.log('⚠️ Email 未設定，跳過發送');
    return false;
  }
  
  const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
  
  try {
    await resend.emails.send({
      from: senderEmail,
      to: registration.email,
      subject: `✅ 報名成功 - ${event.title}`,
      html: `
        <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #6366f1, #a855f7); color: white; padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
            <h1 style="margin: 0;">🎉 報名成功！</h1>
          </div>
          <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 16px 16px;">
            <p style="font-size: 18px;">親愛的 <strong>${registration.name}</strong> 您好，</p>
            <p>感謝您報名參加我們的活動，以下是您的報名資訊：</p>
            
            <div style="background: white; padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #6366f1;">
              <h2 style="color: #6366f1; margin-top: 0;">📅 ${event.title}</h2>
              <p><strong>📆 日期：</strong>${event.date}</p>
              <p><strong>⏰ 時間：</strong>${event.time}${event.endTime ? ' - ' + event.endTime : ''}</p>
              <p><strong>📍 地點：</strong>${event.location}</p>
            </div>
            
            <p style="color: #64748b; font-size: 14px;">
              如有任何問題，請回覆此信件聯繫我們。<br>
              期待在活動中見到您！
            </p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <p style="color: #94a3b8; font-size: 12px; text-align: center;">
              此信件由工作坊管理系統自動發送
            </p>
          </div>
        </div>
      `
    });
    
    console.log(`✅ Email 已發送至 ${registration.email}`);
    return true;
  } catch (error) {
    console.error('❌ Email 發送失敗:', error.message);
    return false;
  }
}

// 發送 LINE 通知給管理員
async function sendAdminLineNotification(registration, event) {
  if (ADMIN_IDS.length === 0) {
    console.log('⚠️ 未設定管理員，跳過 LINE 通知');
    return false;
  }
  
  try {
    const message = {
      type: 'flex',
      altText: `新報名通知 - ${registration.name}`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🔔 新報名通知', weight: 'bold', size: 'lg', color: '#ffffff' }
          ],
          backgroundColor: '#10b981',
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `👤 ${registration.name}`, weight: 'bold', size: 'md' },
            { type: 'text', text: `📧 ${registration.email}`, size: 'sm', color: '#666666', margin: 'sm' },
            { type: 'text', text: `📱 ${registration.phone || '未填寫'}`, size: 'sm', color: '#666666', margin: 'sm' },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: `📅 ${event.title}`, size: 'sm', color: '#6366f1', margin: 'lg', weight: 'bold' },
            { type: 'text', text: `報名人數：${event.registrations || 0}/${event.maxParticipants}`, size: 'xs', color: '#888888', margin: 'sm' }
          ],
          paddingAll: '15px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'button', action: { type: 'message', label: '查看報名', text: '最新報名' }, style: 'primary', height: 'sm' }
          ],
          paddingAll: '10px'
        }
      }
    };
    
    // 發送給所有管理員
    for (const adminId of ADMIN_IDS) {
      try {
        await client.pushMessage({ to: adminId, messages: [message] });
        console.log(`✅ LINE 通知已發送給管理員 ${adminId}`);
      } catch (e) {
        console.error(`❌ 發送給 ${adminId} 失敗:`, e.message);
      }
    }
    return true;
  } catch (error) {
    console.error('❌ LINE 通知發送失敗:', error.message);
    return false;
  }
}

// 取消報名通知管理員
async function sendCancelNotificationToAdmin(registration, event) {
  if (ADMIN_IDS.length === 0) return;
  
  try {
    const message = {
      type: 'flex',
      altText: `取消報名通知 - ${registration.name}`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '❌ 取消報名通知', weight: 'bold', size: 'lg', color: '#ffffff' }
          ],
          backgroundColor: '#ef4444',
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `👤 ${registration.name}`, weight: 'bold', size: 'md' },
            { type: 'text', text: `📧 ${registration.email}`, size: 'sm', color: '#666666', margin: 'sm' },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: `📅 ${event.title}`, size: 'sm', color: '#6366f1', margin: 'lg', weight: 'bold' },
            { type: 'text', text: `剩餘名額：${event.maxParticipants - (event.registrations || 0)}/${event.maxParticipants}`, size: 'xs', color: '#888888', margin: 'sm' }
          ],
          paddingAll: '15px'
        }
      }
    };
    
    for (const adminId of ADMIN_IDS) {
      try {
        await client.pushMessage({ to: adminId, messages: [message] });
      } catch (e) {
        console.error(`發送取消通知給 ${adminId} 失敗:`, e.message);
      }
    }
  } catch (error) {
    console.error('取消通知發送失敗:', error.message);
  }
}

// ==================== Firebase 初始化 ====================
let db = null;
let useFirebase = false;

async function initFirebase() {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) {
      console.log('⚠️ Firebase 未設定，使用記憶體模式');
      return;
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
    db = admin.firestore();
    await db.collection('_test').limit(1).get();
    useFirebase = true;
    console.log('✅ Firebase Firestore 連線成功');
  } catch (error) {
    console.error('⚠️ Firebase 連線失敗:', error.message);
    db = null;
    useFirebase = false;
  }
}
initFirebase();

// ==================== 記憶體資料 ====================
let memoryData = {
  events: [
    { id: '1', title: 'AI 繪圖入門工作坊', description: '學習 Stable Diffusion', date: '2026-01-15', time: '14:00', endTime: '17:00', location: '線上 Google Meet', maxParticipants: 30, status: 'active', registrations: 24, notifications: 2, certificates: 0, instructorName: '王老師', createdAt: new Date().toISOString() },
    { id: '2', title: 'Vibe Coding 實戰營', description: '用自然語言寫程式', date: '2026-01-22', time: '09:00', endTime: '12:00', location: '台北市信義區', maxParticipants: 20, status: 'draft', registrations: 0, notifications: 0, certificates: 0, instructorName: '王老師', createdAt: new Date().toISOString() }
  ],
  registrations: [
    { id: '1', eventId: '1', name: '王小明', email: 'xiaoming@example.com', phone: '0912345678', createdAt: '2026-01-02', status: 'confirmed' },
    { id: '2', eventId: '1', name: '李小華', email: 'xiaohua@example.com', phone: '0923456789', createdAt: '2026-01-03', status: 'pending' }
  ],
  posters: [],
  settings: {}
};

// ==================== 資料操作函數 ====================
async function getEvents() {
  if (!useFirebase) return memoryData.events;
  try {
    const snapshot = await db.collection('events').orderBy('createdAt', 'desc').get();
    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error('getEvents error:', e.message);
    return memoryData.events;
  }
}

async function getEvent(eventId) {
  if (!useFirebase) return memoryData.events.find(e => e.id === eventId);
  try {
    const doc = await db.collection('events').doc(eventId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (e) {
    return memoryData.events.find(e => e.id === eventId);
  }
}

async function addEvent(eventData) {
  const newEvent = { ...eventData, registrations: 0, notifications: 0, certificates: 0, createdAt: new Date().toISOString() };
  if (!useFirebase) {
    newEvent.id = Date.now().toString();
    memoryData.events.unshift(newEvent);
    return newEvent;
  }
  try {
    const docRef = await db.collection('events').add(newEvent);
    return { id: docRef.id, ...newEvent };
  } catch (e) {
    newEvent.id = Date.now().toString();
    memoryData.events.unshift(newEvent);
    return newEvent;
  }
}

async function updateEvent(eventId, updates) {
  if (!useFirebase) {
    const idx = memoryData.events.findIndex(e => e.id === eventId);
    if (idx !== -1) memoryData.events[idx] = { ...memoryData.events[idx], ...updates };
    return;
  }
  try { await db.collection('events').doc(eventId).update(updates); } catch (e) { console.error('updateEvent error:', e.message); }
}

async function getRegistrations(eventId = null) {
  if (!useFirebase) {
    const regs = memoryData.registrations;
    return eventId ? regs.filter(r => r.eventId === eventId) : regs;
  }
  try {
    let query = db.collection('registrations').orderBy('createdAt', 'desc');
    if (eventId) query = query.where('eventId', '==', eventId);
    const snapshot = await query.get();
    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    const regs = memoryData.registrations;
    return eventId ? regs.filter(r => r.eventId === eventId) : regs;
  }
}

async function addRegistration(regData, sendNotifications = true) {
  const newReg = { ...regData, status: 'pending', createdAt: new Date().toISOString() };
  let event = null;
  
  if (!useFirebase) {
    newReg.id = Date.now().toString();
    memoryData.registrations.unshift(newReg);
    event = memoryData.events.find(e => e.id === regData.eventId);
    if (event) event.registrations++;
  } else {
    try {
      const docRef = await db.collection('registrations').add(newReg);
      await db.collection('events').doc(regData.eventId).update({ registrations: admin.firestore.FieldValue.increment(1) });
      newReg.id = docRef.id;
      
      // 取得活動資料
      const eventDoc = await db.collection('events').doc(regData.eventId).get();
      event = eventDoc.exists ? { id: eventDoc.id, ...eventDoc.data() } : null;
    } catch (e) {
      newReg.id = Date.now().toString();
      memoryData.registrations.unshift(newReg);
      event = memoryData.events.find(e => e.id === regData.eventId);
    }
  }
  
  // 發送通知
  if (sendNotifications && event) {
    // 非同步發送，不阻擋回應
    setImmediate(async () => {
      await sendConfirmationEmail(newReg, event);
      await sendAdminLineNotification(newReg, event);
    });
  }
  
  return newReg;
}

async function updateRegistration(regId, updates) {
  if (!useFirebase) {
    const idx = memoryData.registrations.findIndex(r => r.id === regId);
    if (idx !== -1) memoryData.registrations[idx] = { ...memoryData.registrations[idx], ...updates };
    return;
  }
  try {
    await db.collection('registrations').doc(regId).update(updates);
  } catch (e) {
    console.error('updateRegistration error:', e.message);
  }
}

// ==================== AI API（支援 OpenAI + Gemini）====================
async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.8
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('OpenAI error:', error.message);
    return null;
  }
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  
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
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error('Gemini error:', error.message);
    return null;
  }
}

// 智慧選擇 AI：優先 OpenAI，備援 Gemini
async function callAI(prompt) {
  // 優先使用 OpenAI
  let result = await callOpenAI(prompt);
  if (result) {
    console.log('✅ 使用 OpenAI 生成');
    return { text: result, provider: 'OpenAI' };
  }
  
  // 備援使用 Gemini
  result = await callGemini(prompt);
  if (result) {
    console.log('✅ 使用 Gemini 生成');
    return { text: result, provider: 'Gemini' };
  }
  
  return { text: '請先設定 OpenAI 或 Gemini API Key', provider: null };
}

// ==================== LINE Bot 訊息處理 ====================
function isAdmin(userId) {
  if (ADMIN_IDS.length === 0) return true;
  return ADMIN_IDS.includes(userId);
}

function createFlexCard(title, content, color = '#6366f1') {
  return {
    type: 'flex', altText: title,
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg', color: '#ffffff' }], backgroundColor: color, paddingAll: '15px' },
      body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: content, wrap: true, size: 'sm' }], paddingAll: '15px' }
    }
  };
}

function createEventsCarousel(events) {
  if (events.length === 0) return createFlexCard('📅 活動列表', '目前沒有任何活動');
  const bubbles = events.slice(0, 10).map(ev => ({
    type: 'bubble', size: 'kilo',
    header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: ev.title, weight: 'bold', size: 'md', color: '#ffffff', wrap: true }], backgroundColor: ev.status === 'active' ? '#10b981' : ev.status === 'draft' ? '#6b7280' : '#ef4444', paddingAll: '12px' },
    body: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: `📅 ${ev.date} ${ev.time}${ev.endTime ? '-' + ev.endTime : ''}`, size: 'xs', color: '#666666' },
      { type: 'text', text: `📍 ${ev.location}`, size: 'xs', color: '#666666', margin: 'sm' },
      { type: 'separator', margin: 'md' },
      { type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: `報名 ${ev.registrations || 0}/${ev.maxParticipants}`, size: 'xs', color: '#6366f1' },
        { type: 'text', text: ev.status === 'active' ? '進行中' : ev.status === 'draft' ? '草稿' : '已結束', size: 'xs', color: '#999999', align: 'end' }
      ], margin: 'md' }
    ], paddingAll: '12px' },
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'box', layout: 'horizontal', contents: [
        { type: 'button', action: { type: 'message', label: '詳情', text: `活動詳情 ${ev.id}` }, style: 'primary', height: 'sm', flex: 1 },
        { type: 'button', action: { type: 'message', label: '文宣', text: `生成文宣 ${ev.id}` }, style: 'secondary', height: 'sm', flex: 1, margin: 'sm' }
      ] },
      ev.status === 'active' ? { type: 'button', action: { type: 'uri', label: '🔗 報名連結', uri: `${process.env.WEB_URL || 'https://workshop-bot-ut8f.onrender.com'}?register=${ev.id}` }, style: 'link', height: 'sm', margin: 'sm' } : null
    ].filter(Boolean), paddingAll: '10px' }
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
  const aiStatus = process.env.OPENAI_API_KEY ? '🤖 OpenAI' : (process.env.GEMINI_API_KEY ? '✨ Gemini' : '❌ 未設定');

  return {
    type: 'flex', altText: '系統總覽',
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', contents: [
        { type: 'text', text: '📊 系統總覽', weight: 'bold', size: 'xl', color: '#ffffff' },
        { type: 'text', text: `🔥 Firebase | ${aiStatus}`, size: 'xs', color: '#ffffffcc' }
      ], backgroundColor: '#6366f1', paddingAll: '20px' },
      body: { type: 'box', layout: 'vertical', contents: [
        { type: 'box', layout: 'horizontal', contents: [
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
        ] },
        { type: 'separator', margin: 'lg' },
        { type: 'box', layout: 'horizontal', contents: [
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
        ], margin: 'lg' }
      ], paddingAll: '20px' }
    }
  };
}

async function createRecentRegistrations() {
  const regs = await getRegistrations();
  const events = await getEvents();
  const recent = regs.slice(0, 5);
  if (recent.length === 0) return createFlexCard('📋 最新報名', '目前沒有報名資料');
  
  const pendingCount = regs.filter(r => r.status === 'pending').length;
  
  const items = recent.map(r => {
    const event = events.find(e => e.id === r.eventId);
    return { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: r.status === 'confirmed' ? '✅' : '⏳', flex: 0 },
      { type: 'box', layout: 'vertical', contents: [
        { type: 'text', text: r.name, weight: 'bold', size: 'sm' },
        { type: 'text', text: event?.title || '未知活動', size: 'xs', color: '#888888' }
      ], flex: 1, margin: 'md' }
    ], margin: 'md' };
  });
  
  const footer = pendingCount > 0 ? {
    type: 'box', layout: 'vertical',
    contents: [
      { type: 'button', action: { type: 'message', label: `✅ 確認全部 (${pendingCount})`, text: '確認全部' }, style: 'primary', height: 'sm' }
    ],
    paddingAll: '10px'
  } : null;
  
  return { type: 'flex', altText: '最新報名', contents: { type: 'bubble',
    header: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: '📋 最新報名', weight: 'bold', size: 'lg', color: '#ffffff' },
      { type: 'text', text: `待確認：${pendingCount} 筆`, size: 'xs', color: '#ffffffcc' }
    ], backgroundColor: '#3b82f6', paddingAll: '15px' },
    body: { type: 'box', layout: 'vertical', contents: items, paddingAll: '15px' },
    ...(footer && { footer })
  }};
}

function createQuickReply() {
  return { items: [
    { type: 'action', action: { type: 'message', label: '📊 總覽', text: '總覽' } },
    { type: 'action', action: { type: 'message', label: '📅 活動', text: '活動列表' } },
    { type: 'action', action: { type: 'message', label: '📋 報名', text: '最新報名' } },
    { type: 'action', action: { type: 'message', label: '🔗 連結', text: '報名連結' } },
    { type: 'action', action: { type: 'message', label: '🎨 文宣', text: '生成文宣' } }
  ]};
}

async function handleMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text?.trim() || '';
  
  if (!isAdmin(userId)) {
    return client.replyMessage({ replyToken: event.replyToken, messages: [createFlexCard('⚠️ 權限不足', '您不是管理員。\n\nYour ID:\n' + userId, '#ef4444')] });
  }

  let messages = [];
  try {
    if (text === '總覽' || text === '查看總覽' || text === '首頁') {
      messages.push(await createDashboardCard());
    }
    else if (text === '活動列表' || text === '活動' || text === '查看活動') {
      const events = await getEvents();
      messages.push(createEventsCarousel(events));
    }
    else if (text.startsWith('活動詳情')) {
      const eventId = text.split(' ')[1];
      const ev = await getEvent(eventId);
      if (ev) {
        const regLink = `${process.env.WEB_URL || 'https://workshop-bot-ut8f.onrender.com'}?register=${ev.id}`;
        const content = `📅 日期：${ev.date} ${ev.time}${ev.endTime ? ' - ' + ev.endTime : ''}\n📍 地點：${ev.location}\n👥 報名：${ev.registrations || 0}/${ev.maxParticipants}\n📨 通知：${ev.notifications || 0} 次\n🏆 證書：${ev.certificates || 0} 張\n\n狀態：${ev.status === 'active' ? '✅ 進行中' : ev.status === 'draft' ? '📝 草稿' : '🔴 已結束'}${ev.status === 'active' ? '\n\n🔗 報名連結：\n' + regLink : ''}`;
        messages.push(createFlexCard(`📅 ${ev.title}`, content, ev.status === 'active' ? '#10b981' : '#6b7280'));
      } else {
        messages.push({ type: 'text', text: '找不到此活動' });
      }
    }
    else if (text === '最新報名' || text === '報名') {
      messages.push(await createRecentRegistrations());
    }
    else if (text === '生成文宣' || text === '文宣') {
      const events = await getEvents();
      const activeEvents = events.filter(e => e.status === 'active');
      if (activeEvents.length === 0) {
        messages.push(createFlexCard('🎨 生成文宣', '目前沒有進行中的活動'));
      } else {
        messages.push({
          type: 'flex', altText: '選擇活動',
          contents: { type: 'bubble',
            header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '🎨 選擇活動', weight: 'bold', size: 'md', color: '#ffffff' }], backgroundColor: '#a855f7', paddingAll: '15px' },
            body: { type: 'box', layout: 'vertical', contents: activeEvents.map(ev => ({ type: 'button', action: { type: 'message', label: ev.title.slice(0, 20), text: `生成文宣 ${ev.id}` }, style: 'secondary', margin: 'sm' })), paddingAll: '15px' }
          }
        });
      }
    }
    else if (text.startsWith('生成文宣 ')) {
      const eventId = text.split(' ')[1];
      const ev = await getEvent(eventId);
      if (ev) {
        const prompt = `你是活動文案專家。請為以下工作坊撰寫社群貼文風格的宣傳文案，活潑有趣，包含 emoji 和 hashtag。

【活動資訊 - 請務必正確使用】
活動名稱：${ev.title}
活動說明：${ev.description || '無'}
活動日期：${ev.date}（這是活動舉辦的日期，只有一天）
活動時間：${ev.time}${ev.endTime ? ' 至 ' + ev.endTime : ''}
活動地點：${ev.location}
報名名額：${ev.maxParticipants} 人

重要提醒：
- 活動只有一天，日期是 ${ev.date}
- 時間是 ${ev.time}${ev.endTime ? ' 到 ' + ev.endTime : ''}
- 請勿編造或修改日期時間

直接輸出文案，約150-250字。`;
        
        const { text: poster, provider } = await callAI(prompt);
        const title = provider ? `🎨 ${ev.title}（${provider}）` : '🎨 生成失敗';
        messages = [createFlexCard(title, poster, '#a855f7')];
      } else {
        messages.push({ type: 'text', text: '找不到此活動' });
      }
    }
    else if (text === '報名連結' || text === '連結') {
      const events = await getEvents();
      const activeEvents = events.filter(e => e.status === 'active');
      if (activeEvents.length === 0) {
        messages.push(createFlexCard('🔗 報名連結', '目前沒有進行中的活動'));
      } else {
        const links = activeEvents.map(ev => {
          const url = `${process.env.WEB_URL || 'https://workshop-bot-ut8f.onrender.com'}?register=${ev.id}`;
          return `📅 ${ev.title}\n${url}`;
        }).join('\n\n');
        messages.push(createFlexCard('🔗 報名連結', links, '#3b82f6'));
      }
    }
    else if (text === '確認全部' || text === '確認所有報名') {
      const regs = await getRegistrations();
      const pending = regs.filter(r => r.status === 'pending');
      if (pending.length === 0) {
        messages.push({ type: 'text', text: '沒有待確認的報名' });
      } else {
        for (const reg of pending) {
          await updateRegistration(reg.id, { status: 'confirmed' });
        }
        messages.push(createFlexCard('✅ 批次確認完成', `已確認 ${pending.length} 筆報名`, '#10b981'));
      }
    }
    else if (text.startsWith('確認 ')) {
      const name = text.replace('確認 ', '').trim();
      const regs = await getRegistrations();
      const found = regs.find(r => r.name === name && r.status === 'pending');
      if (found) {
        await updateRegistration(found.id, { status: 'confirmed' });
        messages.push(createFlexCard('✅ 確認成功', `已確認 ${name} 的報名`, '#10b981'));
      } else {
        messages.push({ type: 'text', text: `找不到 ${name} 的待確認報名` });
      }
    }
    else if (text === '說明' || text === '幫助' || text === 'help') {
      const aiStatus = process.env.OPENAI_API_KEY ? '🤖 OpenAI 已連線' : (process.env.GEMINI_API_KEY ? '✨ Gemini 已連線' : '❌ AI 未設定');
      const helpText = `🎓 工作坊管理 Bot

📊 總覽 - 系統統計
📅 活動列表 - 所有活動
📋 最新報名 - 報名資料
🔗 報名連結 - 取得報名網址
🎨 生成文宣 - AI 文案

✅ 確認報名：
• 確認全部 - 批次確認
• 確認 姓名 - 單筆確認

🔥 Firebase 已連線
${aiStatus}`;
      messages.push(createFlexCard('❓ 使用說明', helpText, '#6366f1'));
    }
    else if (text === 'myid' || text === '我的ID') {
      messages.push({ type: 'text', text: `您的 User ID：\n${userId}` });
    }
    else if (text === 'db' || text === '資料庫狀態') {
      const status = useFirebase ? '✅ Firebase Firestore 已連線' : '⚠️ 使用記憶體模式';
      messages.push({ type: 'text', text: `資料庫狀態：\n${status}` });
    }
    else if (text === 'ai' || text === 'AI狀態' || text === '狀態') {
      const openai = process.env.OPENAI_API_KEY ? '✅ 已設定' : '❌ 未設定';
      const gemini = process.env.GEMINI_API_KEY ? '✅ 已設定' : '❌ 未設定';
      const email = process.env.RESEND_API_KEY ? '✅ 已設定' : '❌ 未設定';
      const admins = ADMIN_IDS.length > 0 ? `✅ ${ADMIN_IDS.length} 人` : '❌ 未設定';
      messages.push({ type: 'text', text: `系統狀態：\n\n🤖 OpenAI: ${openai}\n✨ Gemini: ${gemini}\n📧 Email: ${email}\n👥 管理員: ${admins}\n\n報名通知：${email === '✅ 已設定' ? '學員收 Email + 管理員收 LINE' : '僅管理員收 LINE'}` });
    }
    else {
      messages.push({ type: 'text', text: `您好！我是工作坊管理助手 🎓\n\n請輸入：總覽、活動列表、最新報名、生成文宣、說明`, quickReply: createQuickReply() });
    }
  } catch (error) {
    console.error('handleMessage error:', error);
    messages.push({ type: 'text', text: '處理訊息時發生錯誤' });
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
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `歡迎使用工作坊管理系統！🎓\n\n輸入「說明」查看指令`, quickReply: createQuickReply() }] });
      }
    }));
    res.status(200).end();
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).end();
  }
});

// ==================== API 端點 ====================
app.use(express.json());
app.get('/api/events', async (req, res) => { try { res.json(await getEvents()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/events', async (req, res) => { try { res.json(await addEvent(req.body)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/events/:id', async (req, res) => { try { await updateEvent(req.params.id, req.body); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

app.delete('/api/events/:id', async (req, res) => {
  try {
    if (useFirebase) {
      await db.collection('events').doc(req.params.id).delete();
    } else {
      const idx = memoryData.events.findIndex(e => e.id === req.params.id);
      if (idx !== -1) memoryData.events.splice(idx, 1);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/registrations', async (req, res) => { try { res.json(await getRegistrations(req.query.eventId)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/registrations', async (req, res) => { try { res.json(await addRegistration(req.body)); } catch (e) { res.status(500).json({ error: e.message }); } });

app.put('/api/registrations/:id', async (req, res) => {
  try {
    await updateRegistration(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 查詢報名
app.get('/api/registrations/check', async (req, res) => {
  try {
    const { email, eventId } = req.query;
    const regs = await getRegistrations();
    const found = regs.find(r => r.email === email && r.eventId === eventId);
    if (found) {
      res.json({ found: true, registration: found });
    } else {
      res.json({ found: false });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 取消報名（學員或管理員）
app.post('/api/registrations/:id/cancel', async (req, res) => {
  try {
    // 先取得報名資料檢查狀態
    const regs = await getRegistrations();
    const reg = regs.find(r => r.id === req.params.id);
    
    if (!reg) {
      return res.status(404).json({ error: '找不到報名資料' });
    }
    
    // 如果已經是取消狀態，不做任何事
    if (reg.status === 'cancelled') {
      return res.json({ success: true, message: '已經是取消狀態' });
    }
    
    // 更新為取消狀態
    await updateRegistration(req.params.id, { status: 'cancelled' });
    
    // 減少活動報名人數
    if (useFirebase) {
      await db.collection('events').doc(reg.eventId).update({ registrations: admin.firestore.FieldValue.increment(-1) });
    } else {
      const ev = memoryData.events.find(e => e.id === reg.eventId);
      if (ev && ev.registrations > 0) ev.registrations--;
    }
    
    // 重新取得更新後的活動資料並通知管理員
    const events = await getEvents();
    const event = events.find(e => e.id === reg.eventId);
    if (event) {
      sendCancelNotificationToAdmin(reg, event);
    }
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 寄送證書
app.post('/api/send-certificate', async (req, res) => {
  try {
    const { registration, event } = req.body;
    if (!resend) {
      return res.json({ success: false, error: 'Email 未設定' });
    }
    
    const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
    const formatDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    await resend.emails.send({
      from: senderEmail,
      to: registration.email,
      subject: `🏆 Certificate - ${event.title}`,
      html: `
        <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #6366f1, #a855f7); color: white; padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
            <h1 style="margin: 0;">🏆 Certificate of Completion</h1>
          </div>
          <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 16px 16px; text-align: center;">
            <p style="font-size: 16px; color: #64748b;">This is to certify that</p>
            <h2 style="font-size: 28px; color: #1e293b; margin: 20px 0;">${registration.name}</h2>
            <p style="font-size: 16px; color: #64748b;">has successfully completed the workshop</p>
            <h3 style="font-size: 22px; color: #6366f1; margin: 20px 0;">${event.title}</h3>
            <p style="font-size: 14px; color: #94a3b8;">Date: ${formatDate(event.date)}</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
            <p style="color: #94a3b8; font-size: 12px;">
              Congratulations on completing the workshop!<br>
              We hope you enjoyed the learning experience.
            </p>
          </div>
        </div>
      `
    });
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
app.get('/api/status', (req, res) => {
  res.json({
    firebase: useFirebase,
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    email: !!process.env.RESEND_API_KEY,
    adminCount: ADMIN_IDS.length,
    timestamp: new Date().toISOString()
  });
});

// AI 文宣生成 API
app.post('/api/generate-poster', async (req, res) => {
  try {
    const { event, style } = req.body;
    const prompt = `你是活動文案專家。請為以下工作坊撰寫${style}的宣傳文案。

【活動資訊 - 請務必正確使用】
活動名稱：${event.title}
活動說明：${event.description || '無'}
活動日期：${event.date}（這是活動舉辦的日期，只有一天）
活動時間：${event.time || ''}${event.endTime ? ' 至 ' + event.endTime : ''}
活動地點：${event.location || ''}
報名名額：${event.maxParticipants} 人

重要提醒：
- 活動只有一天，日期是 ${event.date}
- 請勿編造或修改日期時間

直接輸出文案，約150-250字。`;
    
    const result = await callAI(prompt);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 雙AI同時產生文宣
app.post('/api/generate-poster-dual', async (req, res) => {
  try {
    const { event, style } = req.body;
    const prompt = `你是活動文案專家。請為以下工作坊撰寫${style}的宣傳文案。

【活動資訊 - 請務必正確使用】
活動名稱：${event.title}
活動說明：${event.description || '無'}
活動日期：${event.date}（這是活動舉辦的日期，只有一天）
活動時間：${event.time || ''}${event.endTime ? ' 至 ' + event.endTime : ''}
活動地點：${event.location || ''}
報名名額：${event.maxParticipants} 人

重要提醒：
- 活動只有一天，日期是 ${event.date}
- 請勿編造或修改日期時間

直接輸出文案，約150-250字。`;
    
    // 同時呼叫兩個 AI
    const [openaiResult, geminiResult] = await Promise.all([
      callOpenAI(prompt).catch(() => null),
      callGemini(prompt).catch(() => null)
    ]);
    
    res.json({
      openai: openaiResult || '',
      gemini: geminiResult || ''
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 文宣 CRUD
app.get('/api/posters', async (req, res) => {
  try {
    if (useFirebase) {
      const snapshot = await db.collection('posters').orderBy('createdAt', 'desc').get();
      const posters = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(posters);
    } else {
      res.json(memoryData.posters || []);
    }
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/posters', async (req, res) => {
  try {
    const poster = { ...req.body };
    if (useFirebase) {
      const docRef = await db.collection('posters').add(poster);
      res.json({ id: docRef.id, ...poster });
    } else {
      poster.id = Date.now().toString();
      if (!memoryData.posters) memoryData.posters = [];
      memoryData.posters.unshift(poster);
      res.json(poster);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/posters/:id', async (req, res) => {
  try {
    if (useFirebase) {
      await db.collection('posters').doc(req.params.id).delete();
    } else {
      if (memoryData.posters) {
        memoryData.posters = memoryData.posters.filter(p => p.id !== req.params.id);
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 靜態檔案
app.use(express.static('public'));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔥 Firebase: ${useFirebase ? '已連線' : '記憶體模式'}`);
  console.log(`🤖 OpenAI: ${process.env.OPENAI_API_KEY ? '已設定' : '未設定'}`);
  console.log(`✨ Gemini: ${process.env.GEMINI_API_KEY ? '已設定' : '未設定'}`);
  console.log(`📧 Resend: ${process.env.RESEND_API_KEY ? '已設定' : '未設定'}`);
  console.log(`👥 管理員: ${ADMIN_IDS.length > 0 ? ADMIN_IDS.length + ' 人' : '未設定'}`);
});
