const express = require('express');
const line = require('@line/bot-sdk');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
app.use(cors());

// ==================== Together AI 設定 ====================
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY || '';
if (TOGETHER_API_KEY) {
  console.log('✅ Together AI 已設定');
}

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
    { id: '1', title: 'AI 繪圖入門工作坊', description: '學習 Stable Diffusion', date: '2026-01-15', time: '14:00', endTime: '17:00', location: '線上 Google Meet', maxParticipants: 30, status: 'active', registrations: 24, notifications: 2, certificates: 0, instructorName: '王老師', createdAt: new Date().toISOString(), price: 0 },
    { id: '2', title: 'Vibe Coding 實戰營', description: '用自然語言寫程式', date: '2026-01-22', time: '09:00', endTime: '12:00', location: '台北市信義區', maxParticipants: 20, status: 'draft', registrations: 0, notifications: 0, certificates: 0, instructorName: '王老師', createdAt: new Date().toISOString(), price: 500 }
  ],
  registrations: [
    { id: '1', eventId: '1', name: '王小明', email: 'xiaoming@example.com', phone: '0912345678', createdAt: '2026-01-02', status: 'confirmed', checkedIn: false, checkedInAt: null },
    { id: '2', eventId: '1', name: '李小華', email: 'xiaohua@example.com', phone: '0923456789', createdAt: '2026-01-03', status: 'pending', checkedIn: false, checkedInAt: null }
  ],
  posters: [],
  tempPosters: {},
  showcase: [],
  schedules: [],
  lineBindings: [],  // 學員 LINE 綁定資料 { lineUserId, email, name, bindAt }
  waitlist: [],      // 候補名單 { id, eventId, name, email, phone, createdAt, notified }
  checkins: [],      // 簽到記錄 { id, eventId, regId, checkedInAt }
  feedback: [],      // 問卷回饋 { id, eventId, regId, rating, comment, createdAt }
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

// ==================== LINE 綁定功能 ====================
async function getLineBindings() {
  if (!useFirebase) return memoryData.lineBindings || [];
  try {
    const snapshot = await db.collection('lineBindings').get();
    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error('getLineBindings error:', e.message);
    return [];
  }
}

async function addLineBinding(binding) {
  const newBinding = {
    ...binding,
    bindAt: new Date().toISOString()
  };
  
  if (!useFirebase) {
    // 檢查是否已綁定
    const existing = memoryData.lineBindings.find(b => b.lineUserId === binding.lineUserId);
    if (existing) {
      // 更新現有綁定
      const idx = memoryData.lineBindings.findIndex(b => b.lineUserId === binding.lineUserId);
      memoryData.lineBindings[idx] = { ...existing, ...newBinding };
      return memoryData.lineBindings[idx];
    }
    newBinding.id = Date.now().toString();
    memoryData.lineBindings.push(newBinding);
    return newBinding;
  }
  
  try {
    // 檢查是否已綁定
    const snapshot = await db.collection('lineBindings').where('lineUserId', '==', binding.lineUserId).get();
    if (!snapshot.empty) {
      // 更新現有綁定
      const docId = snapshot.docs[0].id;
      await db.collection('lineBindings').doc(docId).update(newBinding);
      return { id: docId, ...newBinding };
    }
    const docRef = await db.collection('lineBindings').add(newBinding);
    return { id: docRef.id, ...newBinding };
  } catch (e) {
    console.error('addLineBinding error:', e.message);
    return null;
  }
}

async function removeLineBinding(lineUserId) {
  if (!useFirebase) {
    memoryData.lineBindings = memoryData.lineBindings.filter(b => b.lineUserId !== lineUserId);
    return true;
  }
  try {
    const snapshot = await db.collection('lineBindings').where('lineUserId', '==', lineUserId).get();
    if (!snapshot.empty) {
      await db.collection('lineBindings').doc(snapshot.docs[0].id).delete();
    }
    return true;
  } catch (e) {
    console.error('removeLineBinding error:', e.message);
    return false;
  }
}

async function getLineUserIdByEmail(email) {
  const bindings = await getLineBindings();
  const binding = bindings.find(b => b.email.toLowerCase() === email.toLowerCase());
  return binding?.lineUserId || null;
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
  
  // 學員專用指令（不需要管理員權限）
  if (text.startsWith('綁定 ') || text.startsWith('綁定')) {
    const email = text.replace('綁定', '').trim();
    if (!email || !email.includes('@')) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '❌ 請輸入正確格式：\n綁定 您的Email\n\n範例：綁定 example@gmail.com' }]
      });
    }
    
    // 檢查是否有此 Email 的報名
    const regs = await getRegistrations();
    const found = regs.find(r => r.email.toLowerCase() === email.toLowerCase());
    
    if (!found) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `❌ 找不到 ${email} 的報名資料\n\n請確認您輸入的是報名時使用的 Email` }]
      });
    }
    
    // 綁定 LINE ID
    await addLineBinding({
      lineUserId: userId,
      email: email,
      name: found.name
    });
    
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'flex',
        altText: '綁定成功！',
        contents: {
          type: 'bubble',
          header: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: '✅ 綁定成功！', weight: 'bold', color: '#ffffff', size: 'lg' }
          ], backgroundColor: '#10b981', paddingAll: '20px' },
          body: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: `👤 ${found.name}`, weight: 'bold', size: 'md' },
            { type: 'text', text: `📧 ${email}`, size: 'sm', color: '#666666', margin: 'sm' },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '您將會收到：', weight: 'bold', size: 'sm', margin: 'lg', color: '#6366f1' },
            { type: 'text', text: '• 活動提醒通知', size: 'sm', color: '#666666', margin: 'sm' },
            { type: 'text', text: '• 課前資料通知', size: 'sm', color: '#666666', margin: 'sm' },
            { type: 'text', text: '• 課後回饋通知', size: 'sm', color: '#666666', margin: 'sm' },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '輸入「我的活動」查看已報名活動', size: 'xs', color: '#888888', margin: 'lg', align: 'center' }
          ], paddingAll: '20px' }
        }
      }]
    });
  }
  
  if (text === '解除綁定' || text === '取消綁定') {
    await removeLineBinding(userId);
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '✅ 已解除 LINE 綁定\n\n您將不再收到活動通知' }]
    });
  }
  
  if (text === '我的活動' || text === '我的報名') {
    const bindings = await getLineBindings();
    const binding = bindings.find(b => b.lineUserId === userId);
    
    if (!binding) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '❌ 您尚未綁定 Email\n\n請輸入：綁定 您的Email' }]
      });
    }
    
    const regs = await getRegistrations();
    const events = await getEvents();
    const myRegs = regs.filter(r => r.email.toLowerCase() === binding.email.toLowerCase() && r.status === 'confirmed');
    
    if (myRegs.length === 0) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '📭 您目前沒有已確認的報名' }]
      });
    }
    
    const bubbles = myRegs.map(reg => {
      const ev = events.find(e => e.id === reg.eventId);
      if (!ev) return null;
      return {
        type: 'bubble',
        header: { type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: ev.title, weight: 'bold', size: 'md', color: '#ffffff', wrap: true }
        ], backgroundColor: ev.status === 'active' ? '#10b981' : '#6b7280', paddingAll: '15px' },
        body: { type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: `📅 ${ev.date}`, size: 'sm', color: '#333333' },
          { type: 'text', text: `⏰ ${ev.time}${ev.endTime ? ' - ' + ev.endTime : ''}`, size: 'sm', color: '#666666', margin: 'sm' },
          { type: 'text', text: `📍 ${ev.location || '待定'}`, size: 'sm', color: '#666666', margin: 'sm' },
          { type: 'text', text: ev.status === 'active' ? '✅ 進行中' : '🔴 已結束', size: 'xs', color: ev.status === 'active' ? '#10b981' : '#ef4444', margin: 'lg' }
        ], paddingAll: '15px' }
      };
    }).filter(Boolean);
    
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'flex',
        altText: `我的活動 (${myRegs.length})`,
        contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles.slice(0, 10) }
      }]
    });
  }
  
  if (text === '綁定狀態' || text === '查詢綁定') {
    const bindings = await getLineBindings();
    const binding = bindings.find(b => b.lineUserId === userId);
    
    if (binding) {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 已綁定\n\n👤 ${binding.name}\n📧 ${binding.email}\n📅 綁定時間：${new Date(binding.bindAt).toLocaleString('zh-TW')}` }]
      });
    } else {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '❌ 尚未綁定\n\n請輸入：綁定 您的Email' }]
      });
    }
  }
  
  // 管理員權限檢查（以下指令需要管理員權限）
  if (!isAdmin(userId)) {
    // 非管理員的其他訊息，顯示學員指令說明
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'flex',
        altText: '學員指令說明',
        contents: {
          type: 'bubble',
          header: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: '📖 學員指令', weight: 'bold', color: '#ffffff', size: 'lg' }
          ], backgroundColor: '#6366f1', paddingAll: '15px' },
          body: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: '綁定 Email', weight: 'bold', size: 'sm', color: '#6366f1' },
            { type: 'text', text: '綁定您的報名 Email 以接收通知', size: 'xs', color: '#666666', margin: 'sm' },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: '我的活動', weight: 'bold', size: 'sm', color: '#6366f1', margin: 'md' },
            { type: 'text', text: '查看已報名的活動', size: 'xs', color: '#666666', margin: 'sm' },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: '綁定狀態', weight: 'bold', size: 'sm', color: '#6366f1', margin: 'md' },
            { type: 'text', text: '查看目前的綁定狀態', size: 'xs', color: '#666666', margin: 'sm' },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: '解除綁定', weight: 'bold', size: 'sm', color: '#6366f1', margin: 'md' },
            { type: 'text', text: '解除 Email 綁定', size: 'xs', color: '#666666', margin: 'sm' }
          ], paddingAll: '15px' }
        }
      }]
    });
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
        
        // 同時呼叫兩個 AI
        const [openaiResult, geminiResult] = await Promise.all([
          callOpenAI(prompt).catch(() => null),
          callGemini(prompt).catch(() => null)
        ]);
        
        const bubbles = [];
        
        // OpenAI 結果
        if (openaiResult) {
          bubbles.push({
            type: 'bubble', size: 'mega',
            header: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '🤖 OpenAI GPT-4o', weight: 'bold', color: '#ffffff', size: 'md' },
              { type: 'text', text: ev.title, size: 'xs', color: '#ffffffcc', wrap: true }
            ], backgroundColor: '#10b981', paddingAll: '15px' },
            body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: openaiResult.slice(0, 500), wrap: true, size: 'sm', color: '#333333' }
            ], paddingAll: '15px' },
            footer: { type: 'box', layout: 'vertical', contents: [
              { type: 'button', action: { type: 'postback', label: '✓ 保存此版本', data: `action=save_poster&eventId=${eventId}&provider=OpenAI` }, style: 'primary', height: 'sm' },
              { type: 'button', action: { type: 'message', label: '📤 傳送文案', text: openaiResult.slice(0, 300) }, style: 'secondary', height: 'sm', margin: 'sm' }
            ], paddingAll: '10px' }
          });
        }
        
        // Gemini 結果
        if (geminiResult) {
          bubbles.push({
            type: 'bubble', size: 'mega',
            header: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '✨ Gemini', weight: 'bold', color: '#ffffff', size: 'md' },
              { type: 'text', text: ev.title, size: 'xs', color: '#ffffffcc', wrap: true }
            ], backgroundColor: '#6366f1', paddingAll: '15px' },
            body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: geminiResult.slice(0, 500), wrap: true, size: 'sm', color: '#333333' }
            ], paddingAll: '15px' },
            footer: { type: 'box', layout: 'vertical', contents: [
              { type: 'button', action: { type: 'postback', label: '✓ 保存此版本', data: `action=save_poster&eventId=${eventId}&provider=Gemini` }, style: 'primary', height: 'sm' },
              { type: 'button', action: { type: 'message', label: '📤 傳送文案', text: geminiResult.slice(0, 300) }, style: 'secondary', height: 'sm', margin: 'sm' }
            ], paddingAll: '10px' }
          });
        }
        
        if (bubbles.length > 0) {
          // 先存暫存，之後保存用
          if (!memoryData.tempPosters) memoryData.tempPosters = {};
          memoryData.tempPosters[eventId] = {
            openai: openaiResult,
            gemini: geminiResult,
            eventTitle: ev.title
          };
          
          messages = [{
            type: 'flex',
            altText: `${ev.title} 文宣 - 左右滑動比較`,
            contents: { type: 'carousel', contents: bubbles }
          }];
        } else {
          messages.push(createFlexCard('🎨 生成失敗', '兩個 AI 都無法生成，請確認 API Key 設定'));
        }
      } else {
        messages.push({ type: 'text', text: '找不到此活動' });
      }
    }
    else if (text.startsWith('保存文宣 ')) {
      const parts = text.split(' ');
      const eventId = parts[1];
      const provider = parts[2];
      
      // 從暫存取得完整文宣
      const temp = memoryData.tempPosters?.[eventId];
      if (temp) {
        const content = provider === 'OpenAI' ? temp.openai : temp.gemini;
        if (content) {
          const poster = {
            eventId,
            eventTitle: temp.eventTitle,
            style: '社群貼文',
            provider,
            content,
            createdAt: new Date().toISOString()
          };
          
          if (useFirebase) {
            await db.collection('posters').add(poster);
          } else {
            if (!memoryData.posters) memoryData.posters = [];
            poster.id = Date.now().toString();
            memoryData.posters.unshift(poster);
          }
          
          messages.push(createFlexCard('✅ 已保存文宣', `${temp.eventTitle}\n${provider} 版本已保存`, '#10b981'));
        } else {
          messages.push({ type: 'text', text: '找不到此文宣內容' });
        }
      } else {
        messages.push({ type: 'text', text: '文宣已過期，請重新生成' });
      }
    }
    else if (text === '已保存文宣' || text === '文宣列表') {
      let posters = [];
      if (useFirebase) {
        const snapshot = await db.collection('posters').orderBy('createdAt', 'desc').limit(5).get();
        posters = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } else {
        posters = (memoryData.posters || []).slice(0, 5);
      }
      
      if (posters.length === 0) {
        messages.push(createFlexCard('📁 已保存文宣', '還沒有保存任何文宣'));
      } else {
        const items = posters.map(p => ({
          type: 'box', layout: 'vertical', margin: 'lg', contents: [
            { type: 'text', text: `📅 ${p.eventTitle}`, weight: 'bold', size: 'sm' },
            { type: 'text', text: `${p.style} · ${p.provider}`, size: 'xs', color: '#888888' },
            { type: 'text', text: p.content.slice(0, 80) + '...', size: 'xs', color: '#666666', wrap: true, margin: 'sm' }
          ]
        }));
        messages.push({
          type: 'flex', altText: '已保存文宣',
          contents: {
            type: 'bubble',
            header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: `📁 已保存文宣（${posters.length}）`, weight: 'bold', color: '#ffffff' }], backgroundColor: '#a855f7', paddingAll: '15px' },
            body: { type: 'box', layout: 'vertical', contents: items, paddingAll: '15px' }
          }
        });
      }
    }
    else if (text === '報名連結' || text === '連結') {
      const events = await getEvents();
      const activeEvents = events.filter(e => e.status === 'active');
      if (activeEvents.length === 0) {
        messages.push(createFlexCard('🔗 報名連結', '目前沒有進行中的活動'));
      } else {
        const baseUrl = process.env.WEB_URL || 'https://workshop-bot-ut8f.onrender.com';
        const bubbles = activeEvents.slice(0, 10).map(ev => {
          const url = `${baseUrl}?register=${ev.id}`;
          const spotsLeft = ev.maxParticipants - (ev.registrations || 0);
          // 使用 QR Code API
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
          return {
            type: 'bubble',
            header: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '🔗 報名連結', weight: 'bold', color: '#ffffff', size: 'sm' }
            ], backgroundColor: '#3b82f6', paddingAll: '12px' },
            hero: {
              type: 'image',
              url: qrUrl,
              size: 'full',
              aspectRatio: '1:1',
              aspectMode: 'fit',
              backgroundColor: '#ffffff'
            },
            body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: ev.title, weight: 'bold', size: 'md', wrap: true },
              { type: 'text', text: `📅 ${ev.date} ${ev.time || ''}${ev.endTime ? '-' + ev.endTime : ''}`, size: 'xs', color: '#888888', margin: 'md' },
              { type: 'text', text: `📍 ${ev.location || '待定'}`, size: 'xs', color: '#888888', margin: 'sm' },
              { type: 'text', text: `👥 剩餘名額：${spotsLeft}/${ev.maxParticipants}`, size: 'xs', color: spotsLeft > 0 ? '#10b981' : '#ef4444', margin: 'sm' }
            ], paddingAll: '15px' },
            footer: { type: 'box', layout: 'vertical', contents: [
              { type: 'button', action: { type: 'uri', label: '🔗 開啟報名頁', uri: url }, style: 'primary', height: 'sm' },
              { type: 'button', action: { type: 'message', label: '📤 傳送連結', text: `📝 ${ev.title}\n\n🔗 報名連結：\n${url}` }, style: 'secondary', height: 'sm', margin: 'sm' }
            ], paddingAll: '10px' }
          };
        });
        
        messages.push({
          type: 'flex',
          altText: '報名連結與 QR Code - 左右滑動查看',
          contents: { type: 'carousel', contents: bubbles }
        });
      }
    }
    else if (text.startsWith('QR ') || text.startsWith('qr ') || text === 'QR' || text === 'qr' || text === 'qrcode') {
      const events = await getEvents();
      const activeEvents = events.filter(e => e.status === 'active');
      if (activeEvents.length === 0) {
        messages.push(createFlexCard('📱 QR Code', '目前沒有進行中的活動'));
      } else if (activeEvents.length === 1 || text === 'QR' || text === 'qr' || text === 'qrcode') {
        // 只有一個活動或未指定，顯示選擇
        messages.push({
          type: 'flex', altText: '選擇活動',
          contents: {
            type: 'bubble',
            header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '📱 選擇活動產生 QR Code', weight: 'bold', color: '#ffffff' }], backgroundColor: '#3b82f6', paddingAll: '15px' },
            body: { type: 'box', layout: 'vertical', contents: activeEvents.map(ev => ({ type: 'button', action: { type: 'message', label: ev.title.slice(0, 20), text: `QR ${ev.id}` }, style: 'secondary', margin: 'sm' })), paddingAll: '15px' }
          }
        });
      } else {
        // 指定活動 ID
        const eventId = text.split(' ')[1];
        const ev = activeEvents.find(e => e.id === eventId);
        if (ev) {
          const baseUrl = process.env.WEB_URL || 'https://workshop-bot-ut8f.onrender.com';
          const url = `${baseUrl}?register=${ev.id}`;
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(url)}`;
          
          // 傳送大圖 QR Code
          messages.push({
            type: 'flex', altText: `${ev.title} QR Code`,
            contents: {
              type: 'bubble', size: 'mega',
              header: { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '📱 報名 QR Code', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: ev.title, size: 'sm', color: '#ffffffcc', wrap: true }
              ], backgroundColor: '#3b82f6', paddingAll: '15px' },
              hero: {
                type: 'image',
                url: qrUrl,
                size: 'full',
                aspectRatio: '1:1',
                aspectMode: 'fit',
                backgroundColor: '#ffffff'
              },
              body: { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '📅 ' + ev.date + ' ' + (ev.time || '') + (ev.endTime ? '-' + ev.endTime : ''), size: 'sm', color: '#555555' },
                { type: 'text', text: '📍 ' + (ev.location || '待定'), size: 'sm', color: '#555555', margin: 'sm' },
                { type: 'text', text: '掃描上方 QR Code 即可報名', size: 'xs', color: '#888888', margin: 'lg', align: 'center' }
              ], paddingAll: '15px' },
              footer: { type: 'box', layout: 'vertical', contents: [
                { type: 'button', action: { type: 'uri', label: '📥 下載 QR Code 圖片', uri: qrUrl }, style: 'primary', height: 'sm' },
                { type: 'button', action: { type: 'message', label: '📤 傳送連結', text: `📝 ${ev.title}\n\n🔗 報名連結：\n${url}` }, style: 'secondary', height: 'sm', margin: 'sm' }
              ], paddingAll: '10px' }
            }
          });
        }
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
🔗 報名連結 - QR Code 報名
🎨 生成文宣 - AI 文案
🔔 通知 - 發送上課提醒
🏆 證書 - 發送結業證書
🎪 作品牆 - 學員作品

✅ 確認全部 - 批次確認報名
🌐 網頁 - 開啟管理後台

${aiStatus}`;
      messages.push(createFlexCard('❓ 使用說明', helpText, '#6366f1'));
    }
    // === 通知功能 ===
    else if (text === '通知' || text === '發送通知' || text === '提醒' || text === '上課提醒') {
      const events = await getEvents();
      const regs = await getRegistrations();
      const activeEvents = events.filter(e => e.status === 'active');
      if (activeEvents.length === 0) {
        messages.push(createFlexCard('🔔 發送通知', '目前沒有進行中的活動'));
      } else {
        const bubbles = activeEvents.slice(0, 10).map(ev => {
          const confirmed = regs.filter(r => r.eventId === ev.id && r.status === 'confirmed');
          return {
            type: 'bubble',
            header: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '🔔 發送通知', weight: 'bold', color: '#ffffff', size: 'sm' }
            ], backgroundColor: '#f59e0b', paddingAll: '12px' },
            body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: ev.title, weight: 'bold', size: 'md', wrap: true },
              { type: 'text', text: `📅 ${ev.date} ${ev.time || ''}`, size: 'xs', color: '#888888', margin: 'md' },
              { type: 'text', text: `👥 已確認：${confirmed.length} 人`, size: 'xs', color: '#10b981', margin: 'sm' }
            ], paddingAll: '15px' },
            footer: { type: 'box', layout: 'vertical', contents: [
              { type: 'button', action: { type: 'postback', label: '⏰ 上課提醒', data: `action=send_notification&eventId=${ev.id}&type=reminder` }, style: 'primary', height: 'sm' },
              { type: 'button', action: { type: 'postback', label: '🚀 活動開始', data: `action=send_notification&eventId=${ev.id}&type=start` }, style: 'secondary', height: 'sm', margin: 'sm' },
              { type: 'button', action: { type: 'postback', label: '📚 課前資料', data: `action=send_notification&eventId=${ev.id}&type=material` }, style: 'secondary', height: 'sm', margin: 'sm' }
            ], paddingAll: '10px' }
          };
        });
        messages.push({ type: 'flex', altText: '選擇活動發送通知', contents: { type: 'carousel', contents: bubbles } });
      }
    }
    else if (text.startsWith('發送通知 ')) {
      const parts = text.split(' ');
      const eventId = parts[1];
      const notifyType = parts[2] || 'reminder';
      const ev = await getEvent(eventId);
      
      if (ev && resend) {
        const regs = await getRegistrations();
        const confirmed = regs.filter(r => r.eventId === eventId && r.status === 'confirmed');
        
        if (confirmed.length === 0) {
          messages.push(createFlexCard('🔔 發送通知', '此活動沒有已確認的學員', '#ef4444'));
        } else {
          // AI 生成通知內容
          const typeLabels = { reminder: '上課提醒', start: '活動開始', material: '課前資料', feedback: '課後回饋' };
          const prompt = `請為「${ev.title}」工作坊撰寫${typeLabels[notifyType] || '通知'}的 Email 內容。
活動日期：${ev.date}，時間：${ev.time}${ev.endTime ? '-' + ev.endTime : ''}，地點：${ev.location}
要求：簡潔親切、100字內、直接輸出內容`;
          
          let notifyContent = '';
          try {
            const aiResult = await callAI(prompt);
            notifyContent = aiResult.text;
          } catch (e) {
            notifyContent = `親愛的學員您好，\n\n提醒您「${ev.title}」將於 ${ev.date} ${ev.time} 在 ${ev.location} 舉行，請準時出席！`;
          }
          
          // 發送 Email
          const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
          let sent = 0;
          for (const reg of confirmed) {
            try {
              await resend.emails.send({
                from: senderEmail,
                to: reg.email,
                subject: `🔔 ${typeLabels[notifyType] || '通知'} - ${ev.title}`,
                html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #f59e0b, #f97316); color: white; padding: 20px; border-radius: 10px 10px 0 0;">
                    <h2 style="margin: 0;">🔔 ${typeLabels[notifyType] || '通知'}</h2>
                    <p style="margin: 5px 0 0; opacity: 0.9;">${ev.title}</p>
                  </div>
                  <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 10px 10px;">
                    <p>親愛的 ${reg.name} 您好，</p>
                    <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0;">${notifyContent}</div>
                    <div style="background: #fef3c7; padding: 15px; border-radius: 8px;">
                      <p style="margin: 0;"><strong>📅 日期：</strong>${ev.date}</p>
                      <p style="margin: 5px 0;"><strong>⏰ 時間：</strong>${ev.time}${ev.endTime ? ' - ' + ev.endTime : ''}</p>
                      <p style="margin: 0;"><strong>📍 地點：</strong>${ev.location}</p>
                    </div>
                  </div>
                </div>`
              });
              sent++;
            } catch (e) {
              console.error(`發送給 ${reg.email} 失敗:`, e.message);
            }
          }
          
          messages.push(createFlexCard('✅ 通知已發送', `${typeLabels[notifyType]}\n\n📧 成功發送：${sent}/${confirmed.length} 人\n📅 ${ev.title}`, '#10b981'));
        }
      } else if (!resend) {
        messages.push(createFlexCard('❌ Email 未設定', '請在 Render 設定 RESEND_API_KEY', '#ef4444'));
      } else {
        messages.push({ type: 'text', text: '找不到此活動' });
      }
    }
    // === 證書功能 ===
    else if (text === '證書' || text === '發送證書' || text === '結業證書') {
      const events = await getEvents();
      const regs = await getRegistrations();
      const endedEvents = events.filter(e => e.status === 'ended');
      if (endedEvents.length === 0) {
        messages.push(createFlexCard('🏆 發送證書', '沒有已結束的活動\n\n請先在網頁版將活動狀態改為「已結束」'));
      } else {
        const bubbles = endedEvents.slice(0, 10).map(ev => {
          const confirmed = regs.filter(r => r.eventId === ev.id && r.status === 'confirmed');
          return {
            type: 'bubble',
            header: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '🏆 發送證書', weight: 'bold', color: '#ffffff', size: 'sm' }
            ], backgroundColor: '#8b5cf6', paddingAll: '12px' },
            body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: ev.title, weight: 'bold', size: 'md', wrap: true },
              { type: 'text', text: `📅 ${ev.date}`, size: 'xs', color: '#888888', margin: 'md' },
              { type: 'text', text: `👥 已確認學員：${confirmed.length} 人`, size: 'xs', color: '#8b5cf6', margin: 'sm' }
            ], paddingAll: '15px' },
            footer: { type: 'box', layout: 'vertical', contents: [
              { type: 'button', action: { type: 'postback', label: '📧 發送全部證書', data: `action=send_certificates&eventId=${ev.id}` }, style: 'primary', height: 'sm' }
            ], paddingAll: '10px' }
          };
        });
        messages.push({ type: 'flex', altText: '選擇活動發送證書', contents: { type: 'carousel', contents: bubbles } });
      }
    }
    else if (text.startsWith('發送證書 ')) {
      const eventId = text.split(' ')[1];
      const ev = await getEvent(eventId);
      
      if (ev && resend) {
        const regs = await getRegistrations();
        const confirmed = regs.filter(r => r.eventId === eventId && r.status === 'confirmed');
        
        if (confirmed.length === 0) {
          messages.push(createFlexCard('🏆 發送證書', '此活動沒有已確認的學員', '#ef4444'));
        } else {
          const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
          const formatDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          let sent = 0;
          
          for (const reg of confirmed) {
            try {
              await resend.emails.send({
                from: senderEmail,
                to: reg.email,
                subject: `🏆 Certificate - ${ev.title}`,
                html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #8b5cf6, #a855f7); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="margin: 0;">🏆 Certificate of Completion</h1>
                  </div>
                  <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; text-align: center;">
                    <p style="color: #64748b;">This is to certify that</p>
                    <h2 style="color: #1e293b; font-size: 28px; margin: 15px 0;">${reg.name}</h2>
                    <p style="color: #64748b;">has successfully completed the workshop</p>
                    <h3 style="color: #8b5cf6; margin: 15px 0;">${ev.title}</h3>
                    <p style="color: #94a3b8;">Date: ${formatDate(ev.date)}</p>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 25px 0;">
                    <p style="color: #94a3b8; font-size: 12px;">Congratulations on completing the workshop!</p>
                  </div>
                </div>`
              });
              sent++;
            } catch (e) {
              console.error(`發送證書給 ${reg.email} 失敗:`, e.message);
            }
          }
          
          // 更新活動證書數量
          await updateEvent(eventId, { certificates: sent });
          
          messages.push(createFlexCard('✅ 證書已發送', `📧 成功發送：${sent}/${confirmed.length} 人\n📅 ${ev.title}`, '#8b5cf6'));
        }
      } else if (!resend) {
        messages.push(createFlexCard('❌ Email 未設定', '請在 Render 設定 RESEND_API_KEY', '#ef4444'));
      } else {
        messages.push({ type: 'text', text: '找不到此活動' });
      }
    }
    // === 作品牆功能 ===
    else if (text === '作品牆' || text === '作品' || text === '學員作品') {
      let works = [];
      if (useFirebase) {
        const snapshot = await db.collection('showcase').orderBy('createdAt', 'desc').limit(10).get();
        works = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } else {
        works = (memoryData.showcase || []).slice(0, 10);
      }
      
      if (works.length === 0) {
        const baseUrl = process.env.WEB_URL || 'https://workshop-bot-ut8f.onrender.com';
        messages.push({
          type: 'flex', altText: '學員作品牆',
          contents: {
            type: 'bubble',
            header: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '🎪 學員作品牆', weight: 'bold', color: '#ffffff' }
            ], backgroundColor: '#ec4899', paddingAll: '15px' },
            body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '還沒有學員作品', color: '#666666', align: 'center' },
              { type: 'text', text: '請到網頁版新增作品', size: 'sm', color: '#888888', align: 'center', margin: 'md' }
            ], paddingAll: '20px' },
            footer: { type: 'box', layout: 'vertical', contents: [
              { type: 'button', action: { type: 'uri', label: '🌐 前往新增作品', uri: baseUrl }, style: 'primary', height: 'sm' }
            ], paddingAll: '10px' }
          }
        });
      } else {
        const bubbles = works.map(work => {
          const contents = [
            { type: 'text', text: work.title, weight: 'bold', size: 'md', wrap: true },
            { type: 'text', text: `👤 ${work.studentName}`, size: 'sm', color: '#ec4899', margin: 'md' }
          ];
          if (work.description) {
            contents.push({ type: 'text', text: work.description.slice(0, 60) + (work.description.length > 60 ? '...' : ''), size: 'xs', color: '#666666', margin: 'sm', wrap: true });
          }
          
          const bubble = {
            type: 'bubble',
            header: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '🎪 學員作品', weight: 'bold', color: '#ffffff', size: 'sm' }
            ], backgroundColor: '#ec4899', paddingAll: '12px' },
            body: { type: 'box', layout: 'vertical', contents, paddingAll: '15px' }
          };
          
          if (work.imageUrl) {
            bubble.hero = { type: 'image', url: work.imageUrl, size: 'full', aspectRatio: '16:9', aspectMode: 'cover' };
          }
          
          if (work.link) {
            bubble.footer = { type: 'box', layout: 'vertical', contents: [
              { type: 'button', action: { type: 'uri', label: '🔗 查看作品', uri: work.link }, style: 'primary', height: 'sm' }
            ], paddingAll: '10px' };
          }
          
          return bubble;
        });
        
        messages.push({ type: 'flex', altText: '學員作品牆', contents: { type: 'carousel', contents: bubbles } });
      }
    }
    else if (text === '網頁' || text === '網頁版' || text === '後台' || text === '管理') {
      const baseUrl = process.env.WEB_URL || 'https://workshop-bot-ut8f.onrender.com';
      messages.push({
        type: 'flex', altText: '網頁管理後台',
        contents: {
          type: 'bubble',
          header: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: '🌐 網頁管理後台', weight: 'bold', color: '#ffffff', size: 'lg' }
          ], backgroundColor: '#6366f1', paddingAll: '20px' },
          body: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: '功能列表', weight: 'bold', size: 'md' },
            { type: 'box', layout: 'vertical', margin: 'lg', contents: [
              { type: 'text', text: '📊 儀表板 - 總覽統計', size: 'sm', color: '#555555' },
              { type: 'text', text: '📅 活動管理 - 新增/編輯活動', size: 'sm', color: '#555555', margin: 'sm' },
              { type: 'text', text: '📋 報名管理 - 確認/取消報名', size: 'sm', color: '#555555', margin: 'sm' },
              { type: 'text', text: '🎨 AI 文宣 - 雙版本產生', size: 'sm', color: '#555555', margin: 'sm' },
              { type: 'text', text: '🏆 證書產生 - 下載/寄送', size: 'sm', color: '#555555', margin: 'sm' }
            ]}
          ], paddingAll: '20px' },
          footer: { type: 'box', layout: 'vertical', contents: [
            { type: 'button', action: { type: 'uri', label: '🚀 開啟網頁後台', uri: baseUrl }, style: 'primary', height: 'sm' },
            { type: 'button', action: { type: 'message', label: '📤 分享連結', text: `🌐 工作坊管理後台\n\n${baseUrl}` }, style: 'secondary', height: 'sm', margin: 'sm' }
          ], paddingAll: '15px' }
        }
      });
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
      } else if (event.type === 'postback') {
        // 處理按鈕點擊事件
        await handlePostback(event);
      } else if (event.type === 'follow') {
        const userId = event.source.userId;
        const isAdmin = ADMIN_IDS.includes(userId);
        
        if (isAdmin) {
          await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `歡迎使用工作坊管理系統！🎓\n\n您是管理員，輸入「說明」查看指令`, quickReply: createQuickReply() }] });
        } else {
          // 學員加入，顯示綁定說明
          await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
              type: 'flex',
              altText: '歡迎加入！請綁定您的 Email',
              contents: {
                type: 'bubble',
                header: { type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: '🎓 歡迎加入！', weight: 'bold', color: '#ffffff', size: 'lg' }
                ], backgroundColor: '#6366f1', paddingAll: '20px' },
                body: { type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: '請綁定您的報名 Email，即可收到活動通知！', wrap: true, size: 'md', color: '#333333' },
                  { type: 'separator', margin: 'lg' },
                  { type: 'text', text: '綁定方式', weight: 'bold', size: 'md', margin: 'lg', color: '#6366f1' },
                  { type: 'text', text: '輸入：綁定 您的Email', size: 'sm', color: '#666666', margin: 'md' },
                  { type: 'text', text: '範例：綁定 example@gmail.com', size: 'xs', color: '#888888', margin: 'sm' },
                  { type: 'separator', margin: 'lg' },
                  { type: 'text', text: '其他指令', weight: 'bold', size: 'md', margin: 'lg', color: '#6366f1' },
                  { type: 'text', text: '• 我的活動 - 查看已報名活動', size: 'sm', color: '#666666', margin: 'md' },
                  { type: 'text', text: '• 解除綁定 - 解除 Email 綁定', size: 'sm', color: '#666666', margin: 'sm' }
                ], paddingAll: '20px' }
              }
            }]
          });
        }
      }
    }));
    res.status(200).end();
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).end();
  }
});

// 處理 Postback 事件（按鈕點擊）
async function handlePostback(event) {
  const userId = event.source.userId;
  const data = event.postback.data;
  
  // 解析 postback data
  const params = new URLSearchParams(data);
  const action = params.get('action');
  const eventId = params.get('eventId');
  const type = params.get('type');
  const provider = params.get('provider');
  
  try {
    // 保存文宣
    if (action === 'save_poster' && eventId && provider) {
      const tempPoster = memoryData.tempPosters?.[eventId]?.[provider.toLowerCase()];
      if (tempPoster) {
        const events = await getEvents();
        const ev = events.find(e => e.id === eventId);
        
        if (useFirebase) {
          await db.collection('posters').add({
            eventId,
            eventTitle: ev?.title || '',
            provider,
            content: tempPoster,
            style: '社群活潑',
            createdAt: new Date().toISOString()
          });
        }
        
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ 已保存 ${provider} 版本文宣！\n\n輸入「已保存文宣」查看所有保存的文宣` }]
        });
      } else {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '❌ 找不到暫存的文宣，請重新生成' }]
        });
      }
      return;
    }
    
    // 發送通知
    if (action === 'send_notification' && eventId && type) {
      const events = await getEvents();
      const ev = events.find(e => e.id === eventId);
      if (!ev) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '❌ 找不到活動' }]
        });
        return;
      }
      
      // AI 生成通知內容
      const typeLabels = { reminder: '上課提醒', start: '活動開始', material: '課前資料', feedback: '課後回饋' };
      let notifyContent = '';
      try {
        const prompt = `請為「${ev.title}」工作坊撰寫${typeLabels[type] || '通知'}的簡短通知。日期：${ev.date}，時間：${ev.time}，地點：${ev.location}。80字內、親切專業。`;
        const result = await callAI(prompt);
        notifyContent = result.text;
      } catch (e) {
        notifyContent = `親愛的學員您好，提醒您「${ev.title}」將於 ${ev.date} ${ev.time} 在 ${ev.location} 舉行！`;
      }
      
      // 發送 Email
      const regs = await getRegistrations();
      const confirmed = regs.filter(r => r.eventId === eventId && r.status === 'confirmed');
      let sent = 0;
      
      if (resend && confirmed.length > 0) {
        const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
        for (const reg of confirmed) {
          try {
            await resend.emails.send({
              from: senderEmail,
              to: reg.email,
              subject: `🔔 ${typeLabels[type] || '通知'} - ${ev.title}`,
              html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:linear-gradient(135deg,#6366f1,#a855f7);color:white;padding:20px;border-radius:10px 10px 0 0;">
                  <h2 style="margin:0;">🔔 ${typeLabels[type] || '通知'}</h2>
                </div>
                <div style="background:#f8fafc;padding:20px;border-radius:0 0 10px 10px;">
                  <p>親愛的 ${reg.name} 您好，</p>
                  <p>${notifyContent}</p>
                  <div style="background:#e0e7ff;padding:15px;border-radius:8px;margin:15px 0;">
                    <p style="margin:0;"><strong>📅</strong> ${ev.date}</p>
                    <p style="margin:5px 0;"><strong>⏰</strong> ${ev.time}${ev.endTime ? ' - ' + ev.endTime : ''}</p>
                    <p style="margin:0;"><strong>📍</strong> ${ev.location}</p>
                  </div>
                </div>
              </div>`
            });
            sent++;
          } catch (e) {}
        }
      }
      
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ ${typeLabels[type] || '通知'}已發送！\n\n📧 成功：${sent}/${confirmed.length} 人` }]
      });
      return;
    }
    
    // 發送證書
    if (action === 'send_certificates' && eventId) {
      const events = await getEvents();
      const ev = events.find(e => e.id === eventId);
      if (!ev) {
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '❌ 找不到活動' }]
        });
        return;
      }
      
      const regs = await getRegistrations();
      const confirmed = regs.filter(r => r.eventId === eventId && r.status === 'confirmed');
      let sent = 0;
      
      if (resend && confirmed.length > 0) {
        const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
        const dateObj = new Date(ev.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        for (const reg of confirmed) {
          try {
            await resend.emails.send({
              from: senderEmail,
              to: reg.email,
              subject: `🏆 結業證書 - ${ev.title}`,
              html: `<div style="font-family:serif;max-width:700px;margin:0 auto;border:8px double #6366f1;padding:40px;background:linear-gradient(135deg,#faf5ff,#f0f9ff);">
                <div style="text-align:center;">
                  <h1 style="color:#6366f1;font-size:36px;margin:0;">🏆 結業證書</h1>
                  <p style="color:#64748b;margin:10px 0 30px;">Certificate of Completion</p>
                  <div style="border-top:2px solid #6366f1;border-bottom:2px solid #6366f1;padding:20px;margin:20px 0;">
                    <p style="font-size:14px;color:#64748b;margin:0;">This is to certify that</p>
                    <h2 style="font-size:32px;color:#1e293b;margin:10px 0;">${reg.name}</h2>
                    <p style="font-size:14px;color:#64748b;margin:0;">has successfully completed</p>
                    <h3 style="font-size:24px;color:#6366f1;margin:10px 0;">${ev.title}</h3>
                    <p style="color:#64748b;">Date: ${dateStr}</p>
                  </div>
                  <p style="color:#64748b;font-size:12px;margin-top:30px;">工作坊管理系統 自動發送</p>
                </div>
              </div>`
            });
            sent++;
          } catch (e) {}
        }
        
        // 更新活動證書數
        await updateEvent(eventId, { certificates: sent });
      }
      
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `✅ 證書已發送！\n\n📧 成功：${sent}/${confirmed.length} 人` }]
      });
      return;
    }
    
    // 其他未處理的 postback
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '收到您的操作！' }]
    });
    
  } catch (error) {
    console.error('Postback error:', error);
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '❌ 操作失敗，請稍後再試' }]
      });
    } catch (e) {}
  }
}

// ==================== API 端點 ====================
app.use(express.json());
app.get('/api/events', async (req, res) => { try { res.json(await getEvents()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/events', async (req, res) => { try { res.json(await addEvent(req.body)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/events/:id', async (req, res) => { try { await updateEvent(req.params.id, req.body); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

// 公開設定 API（給報名頁面用）
app.get('/api/public-config', (req, res) => {
  res.json({
    lineBotId: process.env.LINE_BOT_BASIC_ID || '@YOUR_BOT_ID',
    lineBotUrl: process.env.LINE_BOT_BASIC_ID 
      ? `https://line.me/R/ti/p/${process.env.LINE_BOT_BASIC_ID}`
      : null,
    orgName: process.env.ORG_NAME || '工作坊'
  });
});

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

// LINE 綁定 API
app.get('/api/line-bindings', async (req, res) => { 
  try { 
    res.json(await getLineBindings()); 
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  } 
});

app.get('/api/line-bindings/stats', async (req, res) => {
  try {
    const bindings = await getLineBindings();
    const regs = await getRegistrations();
    const confirmedEmails = [...new Set(regs.filter(r => r.status === 'confirmed').map(r => r.email.toLowerCase()))];
    const boundEmails = bindings.map(b => b.email.toLowerCase());
    const boundCount = confirmedEmails.filter(e => boundEmails.includes(e)).length;
    
    res.json({
      totalBindings: bindings.length,
      confirmedStudents: confirmedEmails.length,
      boundStudents: boundCount,
      unboundStudents: confirmedEmails.length - boundCount
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
    together: !!process.env.TOGETHER_API_KEY,
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

// AI 生成通知內容
app.post('/api/generate-notification', async (req, res) => {
  try {
    const { event, type } = req.body;
    const typePrompts = {
      reminder: '活動前一天的上課提醒，溫馨提醒時間地點和準備事項',
      start: '活動當天的開始通知，熱情歡迎學員',
      material: '課前資料通知，列出需要準備的東西',
      feedback: '課後回饋通知，感謝參與並詢問意見',
      custom: '一般活動通知'
    };
    
    const prompt = `請為以下工作坊撰寫${typePrompts[type] || typePrompts.custom}的 Email 通知內容。

活動：${event.title}
日期：${event.date}
時間：${event.time}${event.endTime ? ' - ' + event.endTime : ''}
地點：${event.location}

要求：
- 簡潔親切
- 包含重要資訊
- 約 100-150 字
- 直接輸出內容，不要標題`;

    const result = await callAI(prompt);
    res.json({ text: result.text, provider: result.provider });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 發送 Email 通知給學員
app.post('/api/send-notification', async (req, res) => {
  try {
    const { eventId, type, customMessage } = req.body;
    if (!resend) return res.json({ success: false, error: 'Email 未設定' });
    
    const regs = await getRegistrations();
    const events = await getEvents();
    const event = events.find(e => e.id === eventId);
    const confirmedRegs = regs.filter(r => r.eventId === eventId && r.status === 'confirmed');
    
    if (!event || confirmedRegs.length === 0) {
      return res.json({ success: false, error: '沒有可發送的對象' });
    }
    
    const typeLabels = {
      reminder: '⏰ 上課提醒',
      start: '🚀 活動開始',
      material: '📚 課前資料',
      feedback: '📝 課後回饋',
      custom: '📨 活動通知'
    };
    
    const subject = `${typeLabels[type] || '📨 通知'} - ${event.title}`;
    const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
    
    let sent = 0;
    let failed = [];
    console.log(`[通知發送] 開始發送給 ${confirmedRegs.length} 位報名者`);
    
    for (let i = 0; i < confirmedRegs.length; i++) {
      const reg = confirmedRegs[i];
      console.log(`[通知發送] 嘗試發送給: ${reg.name} <${reg.email}> (${i+1}/${confirmedRegs.length})`);
      
      // 每封信之間延遲 1500ms 避免速率限制（Resend 限制每秒 2 封）
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      try {
        const result = await resend.emails.send({
          from: senderEmail,
          to: reg.email,
          subject,
          html: `
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #6366f1, #a855f7); color: white; padding: 30px; border-radius: 16px 16px 0 0;">
                <h1 style="margin: 0;">${typeLabels[type] || '📨 通知'}</h1>
                <p style="margin: 10px 0 0; opacity: 0.9;">${event.title}</p>
              </div>
              <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 16px 16px;">
                <p>親愛的 ${reg.name} 您好，</p>
                <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0; white-space: pre-wrap;">${customMessage}</div>
                <div style="background: #e0e7ff; padding: 15px; border-radius: 10px; margin-top: 20px;">
                  <p style="margin: 0;"><strong>📅 日期：</strong>${event.date}</p>
                  <p style="margin: 5px 0;"><strong>⏰ 時間：</strong>${event.time}${event.endTime ? ' - ' + event.endTime : ''}</p>
                  <p style="margin: 0;"><strong>📍 地點：</strong>${event.location}</p>
                </div>
              </div>
            </div>
          `
        });
        console.log(`[通知發送] Resend 回傳:`, JSON.stringify(result));
        if (result.data?.id) {
          sent++;
          console.log(`[通知發送] ✓ 成功: ${reg.email}, ID: ${result.data.id}`);
        } else if (result.error) {
          console.error(`[通知發送] ✗ Resend 錯誤: ${reg.email}`, result.error);
          failed.push({ email: reg.email, error: result.error.message || JSON.stringify(result.error) });
        } else {
          sent++;
          console.log(`[通知發送] ✓ 成功: ${reg.email}`);
        }
      } catch (e) {
        console.error(`[通知發送] ✗ 失敗: ${reg.email}`, e.message);
        failed.push({ email: reg.email, error: e.message });
      }
    }
    
    console.log(`[通知發送] 完成: 成功 ${sent}/${confirmedRegs.length}, 失敗 ${failed.length}`);
    
    // 同時發送 LINE 通知給已綁定的學員
    let lineSent = 0;
    const bindings = await getLineBindings();
    
    for (const reg of confirmedRegs) {
      const binding = bindings.find(b => b.email.toLowerCase() === reg.email.toLowerCase());
      if (binding) {
        try {
          await client.pushMessage({
            to: binding.lineUserId,
            messages: [{
              type: 'flex',
              altText: `${typeLabels[type] || '📨 通知'} - ${event.title}`,
              contents: {
                type: 'bubble',
                header: { type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: typeLabels[type] || '📨 通知', weight: 'bold', color: '#ffffff', size: 'lg' },
                  { type: 'text', text: event.title, size: 'sm', color: '#ffffffcc', wrap: true, margin: 'sm' }
                ], backgroundColor: type === 'reminder' ? '#f59e0b' : type === 'start' ? '#10b981' : '#6366f1', paddingAll: '20px' },
                body: { type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: `${reg.name} 您好`, weight: 'bold', size: 'md' },
                  { type: 'text', text: customMessage.slice(0, 300), wrap: true, size: 'sm', color: '#333333', margin: 'md' },
                  { type: 'separator', margin: 'lg' },
                  { type: 'box', layout: 'vertical', contents: [
                    { type: 'text', text: `📅 ${event.date}`, size: 'sm', color: '#666666' },
                    { type: 'text', text: `⏰ ${event.time}${event.endTime ? ' - ' + event.endTime : ''}`, size: 'sm', color: '#666666', margin: 'sm' },
                    { type: 'text', text: `📍 ${event.location || '待定'}`, size: 'sm', color: '#666666', margin: 'sm' }
                  ], margin: 'lg', backgroundColor: '#f0f4ff', paddingAll: '15px', cornerRadius: '10px' }
                ], paddingAll: '20px' }
              }
            }]
          });
          lineSent++;
          console.log(`[LINE 通知] ✓ 成功: ${reg.email} -> ${binding.lineUserId}`);
        } catch (e) {
          console.error(`[LINE 通知] ✗ 失敗: ${reg.email}`, e.message);
        }
      }
    }
    
    console.log(`[LINE 通知] 完成: ${lineSent} 人`);
    res.json({ success: true, sent, total: confirmedRegs.length, failed, lineSent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 發送 LINE 通知給管理員
app.post('/api/send-line-notification', async (req, res) => {
  try {
    const { eventId, message } = req.body;
    if (ADMIN_IDS.length === 0) return res.json({ success: false, error: '未設定管理員' });
    
    const events = await getEvents();
    const event = events.find(e => e.id === eventId);
    
    for (const adminId of ADMIN_IDS) {
      try {
        await client.pushMessage({
          to: adminId,
          messages: [{
            type: 'flex',
            altText: `📨 通知 - ${event?.title || '活動'}`,
            contents: {
              type: 'bubble',
              header: { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '📨 活動通知', weight: 'bold', color: '#ffffff' }
              ], backgroundColor: '#6366f1', paddingAll: '15px' },
              body: { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: event?.title || '活動', weight: 'bold', size: 'md' },
                { type: 'text', text: message || '（無內容）', wrap: true, size: 'sm', color: '#555555', margin: 'md' }
              ], paddingAll: '15px' }
            }
          }]
        });
      } catch (e) {
        console.error(`發送給 ${adminId} 失敗:`, e.message);
      }
    }
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 學員作品牆 CRUD
app.get('/api/showcase', async (req, res) => {
  try {
    if (useFirebase) {
      const snapshot = await db.collection('showcase').orderBy('createdAt', 'desc').get();
      res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } else {
      res.json(memoryData.showcase || []);
    }
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/showcase', async (req, res) => {
  try {
    const work = { ...req.body };
    if (useFirebase) {
      const docRef = await db.collection('showcase').add(work);
      res.json({ id: docRef.id, ...work });
    } else {
      work.id = Date.now().toString();
      if (!memoryData.showcase) memoryData.showcase = [];
      memoryData.showcase.unshift(work);
      res.json(work);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/showcase/:id', async (req, res) => {
  try {
    if (useFirebase) {
      await db.collection('showcase').doc(req.params.id).delete();
    } else {
      if (memoryData.showcase) {
        memoryData.showcase = memoryData.showcase.filter(w => w.id !== req.params.id);
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI 客服 API
app.post('/api/ai-support', async (req, res) => {
  try {
    const { question, faqList, events } = req.body;
    
    // 建立 FAQ 和活動資訊
    const faqText = faqList.map(f => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
    const eventsText = events.filter(e => e.status === 'active').map(e => 
      `活動：${e.title}，日期：${e.date}，時間：${e.time || '未定'}，地點：${e.location || '未定'}，名額：${e.maxParticipants - (e.registrations || 0)} 人`
    ).join('\n');
    
    const prompt = `你是工作坊管理系統的 AI 客服助理。請根據以下資訊回答學員問題。

常見問題：
${faqText || '（無）'}

目前進行中的活動：
${eventsText || '（目前沒有進行中的活動）'}

學員問題：${question}

請用繁體中文、親切專業的語氣回答，控制在 100 字以內。如果問題與活動無關，請禮貌地引導回工作坊相關主題。`;

    const result = await callAI(prompt);
    res.json({ answer: result.text, provider: result.provider });
  } catch (e) {
    res.status(500).json({ error: e.message, answer: '抱歉，AI 服務暫時無法使用。' });
  }
});

// ==================== 排程功能 ====================
// 取得排程列表
app.get('/api/schedules', async (req, res) => {
  try {
    if (useFirebase) {
      const snapshot = await db.collection('schedules').orderBy('createdAt', 'desc').get();
      res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } else {
      res.json(memoryData.schedules || []);
    }
  } catch (e) {
    res.json([]);
  }
});

// 新增排程
app.post('/api/schedules', async (req, res) => {
  try {
    const schedule = {
      ...req.body,
      enabled: true,
      sent: false,
      createdAt: new Date().toISOString()
    };
    
    if (useFirebase) {
      const docRef = await db.collection('schedules').add(schedule);
      res.json({ id: docRef.id, ...schedule });
    } else {
      schedule.id = Date.now().toString();
      if (!memoryData.schedules) memoryData.schedules = [];
      memoryData.schedules.push(schedule);
      res.json(schedule);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新排程
app.put('/api/schedules/:id', async (req, res) => {
  try {
    if (useFirebase) {
      await db.collection('schedules').doc(req.params.id).update(req.body);
    } else {
      const idx = (memoryData.schedules || []).findIndex(s => s.id === req.params.id);
      if (idx >= 0) {
        memoryData.schedules[idx] = { ...memoryData.schedules[idx], ...req.body };
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 刪除排程
app.delete('/api/schedules/:id', async (req, res) => {
  try {
    if (useFirebase) {
      await db.collection('schedules').doc(req.params.id).delete();
    } else {
      memoryData.schedules = (memoryData.schedules || []).filter(s => s.id !== req.params.id);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 立即執行排程
app.post('/api/run-schedule', async (req, res) => {
  try {
    const { scheduleId } = req.body;
    let schedule;
    
    if (useFirebase) {
      const doc = await db.collection('schedules').doc(scheduleId).get();
      schedule = { id: doc.id, ...doc.data() };
    } else {
      schedule = (memoryData.schedules || []).find(s => s.id === scheduleId);
    }
    
    if (!schedule) {
      return res.json({ success: false, error: '找不到排程' });
    }
    
    // 執行發送
    const result = await executeSchedule(schedule);
    
    // 標記為已發送
    if (useFirebase) {
      await db.collection('schedules').doc(scheduleId).update({ sent: true, sentAt: new Date().toISOString() });
    } else {
      const idx = memoryData.schedules.findIndex(s => s.id === scheduleId);
      if (idx >= 0) {
        memoryData.schedules[idx].sent = true;
        memoryData.schedules[idx].sentAt = new Date().toISOString();
      }
    }
    
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 執行排程發送
async function executeSchedule(schedule) {
  if (!resend) return { success: false, error: 'Email 未設定' };
  
  const regs = await getRegistrations();
  const events = await getEvents();
  const event = events.find(e => e.id === schedule.eventId);
  
  if (!event) return { success: false, error: '找不到活動' };
  
  const confirmed = regs.filter(r => r.eventId === schedule.eventId && r.status === 'confirmed');
  if (confirmed.length === 0) return { success: false, error: '沒有已確認的學員' };
  
  // AI 生成通知內容
  const typeLabels = { reminder: '上課提醒', start: '活動開始', material: '課前資料', feedback: '課後回饋' };
  let notifyContent = '';
  
  try {
    const prompt = `請為「${event.title}」工作坊撰寫${typeLabels[schedule.type] || '通知'}的 Email 內容。
活動日期：${event.date}，時間：${event.time}${event.endTime ? '-' + event.endTime : ''}，地點：${event.location}
要求：簡潔親切、100字內、直接輸出內容`;
    const aiResult = await callAI(prompt);
    notifyContent = aiResult.text;
  } catch (e) {
    notifyContent = `親愛的學員您好，\n\n提醒您「${event.title}」將於 ${event.date} ${event.time} 在 ${event.location} 舉行，請準時出席！`;
  }
  
  // 發送 Email
  const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
  let sent = 0;
  
  for (let i = 0; i < confirmed.length; i++) {
    const reg = confirmed[i];
    
    // 每封信之間延遲 1500ms 避免速率限制
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    try {
      await resend.emails.send({
        from: senderEmail,
        to: reg.email,
        subject: `🔔 ${typeLabels[schedule.type] || '通知'} - ${event.title}`,
        html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #6366f1, #a855f7); color: white; padding: 20px; border-radius: 10px 10px 0 0;">
            <h2 style="margin: 0;">🔔 ${typeLabels[schedule.type] || '通知'}</h2>
            <p style="margin: 5px 0 0; opacity: 0.9;">${event.title}</p>
          </div>
          <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 10px 10px;">
            <p>親愛的 ${reg.name} 您好，</p>
            <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0;">${notifyContent}</div>
            <div style="background: #e0e7ff; padding: 15px; border-radius: 8px;">
              <p style="margin: 0;"><strong>📅 日期：</strong>${event.date}</p>
              <p style="margin: 5px 0;"><strong>⏰ 時間：</strong>${event.time}${event.endTime ? ' - ' + event.endTime : ''}</p>
              <p style="margin: 0;"><strong>📍 地點：</strong>${event.location}</p>
            </div>
            <p style="color: #64748b; font-size: 12px; margin-top: 20px;">此為自動發送的通知，由工作坊管理系統發出。</p>
          </div>
        </div>`
      });
      sent++;
      console.log(`[排程發送] ✓ ${reg.email}`);
    } catch (e) {
      console.error(`[排程發送] ✗ ${reg.email}:`, e.message);
    }
  }
  
  // 通知管理員
  for (const adminId of ADMIN_IDS) {
    try {
      await client.pushMessage({
        to: adminId,
        messages: [{
          type: 'text',
          text: `✅ 排程通知已發送\n\n📅 ${event.title}\n📨 類型：${typeLabels[schedule.type] || '通知'}\n📧 發送：${sent}/${confirmed.length} 人`
        }]
      });
    } catch (e) {}
  }
  
  return { success: true, sent, total: confirmed.length };
}

// 取得台灣時間
function getTaiwanTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

// 自動檢查排程（每 10 分鐘執行一次）- 使用台灣時間
async function checkSchedules() {
  try {
    let schedules = [];
    
    if (useFirebase) {
      const snapshot = await db.collection('schedules').where('enabled', '==', true).where('sent', '==', false).get();
      schedules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      schedules = (memoryData.schedules || []).filter(s => s.enabled && !s.sent);
    }
    
    // 使用台灣時間 (UTC+8)
    const now = getTaiwanTime();
    console.log(`[排程檢查] 台灣時間: ${now.toLocaleString('zh-TW')}, 待發送: ${schedules.length} 筆`);
    
    for (const schedule of schedules) {
      // 計算排程發送時間（台灣時區）
      const [year, month, day] = schedule.eventDate.split('-').map(Number);
      const eventDate = new Date(year, month - 1, day);
      
      if (schedule.type === 'feedback') {
        eventDate.setDate(eventDate.getDate() + (schedule.daysAfter || 1));
      } else {
        eventDate.setDate(eventDate.getDate() - (schedule.daysBefore || 1));
      }
      eventDate.setHours(schedule.hour || 9, schedule.minute || 0, 0, 0);
      
      // 如果已到發送時間
      if (now >= eventDate) {
        console.log(`[排程執行] ${schedule.eventTitle} - ${schedule.type}`);
        await executeSchedule(schedule);
        
        // 標記為已發送
        const sentAt = new Date().toISOString();
        if (useFirebase) {
          await db.collection('schedules').doc(schedule.id).update({ sent: true, sentAt });
        } else {
          const idx = memoryData.schedules.findIndex(s => s.id === schedule.id);
          if (idx >= 0) {
            memoryData.schedules[idx].sent = true;
            memoryData.schedules[idx].sentAt = sentAt;
          }
        }
      }
    }
  } catch (e) {
    console.error('檢查排程錯誤:', e.message);
  }
}

// ==================== AI 證書生成系統 ====================

// 根據活動主題自動判斷證書風格
function getCertificateStyle(eventTitle, eventDescription) {
  const text = `${eventTitle} ${eventDescription || ''}`.toLowerCase();
  
  if (text.includes('ai') || text.includes('程式') || text.includes('coding') || text.includes('開發') || text.includes('技術')) {
    return { style: '科技風', colors: '深藍色和紫色漸層', elements: '電路圖案、數位元素、幾何線條' };
  } else if (text.includes('親子') || text.includes('兒童') || text.includes('手作') || text.includes('創意')) {
    return { style: '活潑風', colors: '繽紛彩色、粉嫩色調', elements: '可愛插畫、星星、彩虹元素' };
  } else if (text.includes('企業') || text.includes('商業') || text.includes('管理') || text.includes('領導')) {
    return { style: '正式商務', colors: '金色和深藍色', elements: '金邊裝飾、盾牌徽章、莊重花紋' };
  } else if (text.includes('藝術') || text.includes('繪畫') || text.includes('設計') || text.includes('美術')) {
    return { style: '藝術風', colors: '水彩渲染效果', elements: '畫筆、調色盤、藝術裝飾' };
  } else if (text.includes('音樂') || text.includes('舞蹈') || text.includes('表演')) {
    return { style: '表演藝術', colors: '紅色和金色', elements: '音符、舞台燈光、幕布元素' };
  } else {
    return { style: '典雅專業', colors: '深綠色和金色', elements: '橄欖枝、桂冠、典雅花紋邊框' };
  }
}

// 生成證書背景圖（使用 Together AI FLUX）
async function generateCertificateBackground(eventTitle, eventDescription) {
  if (!TOGETHER_API_KEY) {
    console.log('⚠️ Together AI 未設定，使用預設背景');
    return null;
  }
  
  const styleInfo = getCertificateStyle(eventTitle, eventDescription);
  
  // 根據風格生成不同的精美背景
  const stylePrompts = {
    '科技風': 'futuristic digital certificate background, holographic effects, circuit board patterns, glowing neon blue and purple gradients, geometric shapes, tech grid lines, cyber aesthetic, metallic silver accents, dark navy background with luminous elements',
    '活潑風': 'cheerful colorful certificate background, rainbow watercolor splashes, cute confetti, balloon decorations, playful stars and hearts, pastel pink yellow blue, joyful celebration theme, soft clouds, whimsical design',
    '正式商務': 'luxurious executive certificate background, royal deep navy and gold, elegant damask patterns, ornate golden filigree borders, prestigious seal emblem area, marble texture, classical columns, sophisticated corporate design',
    '藝術風': 'artistic watercolor certificate background, beautiful paint splashes, creative brush strokes, palette of warm colors, artistic ink drops, canvas texture, impressionist style borders, gallery worthy design',
    '表演藝術': 'theatrical performance certificate background, red velvet curtains, golden spotlight effects, musical notes floating, stage lights, dramatic red and gold, entertainment awards style, glamorous design',
    '典雅專業': 'elegant premium certificate background, ornate Victorian flourishes, golden laurel wreaths in corners, classic ivory parchment texture, refined scrollwork borders, prestigious medallion space, timeless sophisticated design'
  };
  
  const basePrompt = stylePrompts[styleInfo.style] || stylePrompts['典雅專業'];
  const prompt = `${basePrompt}, certificate template, landscape orientation, large clean white or cream center area for text overlay, highly detailed decorative frame, professional print quality, 8k resolution, masterpiece quality, absolutely NO text NO letters NO words NO numbers anywhere`;

  try {
    console.log(`[AI 證書] 生成背景: ${eventTitle}`);
    console.log(`[AI 證書] 風格: ${styleInfo.style}`);
    
    const response = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOGETHER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'black-forest-labs/FLUX.1-schnell',
        prompt: prompt,
        width: 1440,
        height: 960,
        n: 1,
        steps: 4
      })
    });
    
    const data = await response.json();
    
    if (data.data && data.data[0]) {
      let imageData = data.data[0].url || data.data[0].b64_json;
      
      // 如果是 URL，下載圖片並轉成 Base64
      if (imageData && imageData.startsWith('http')) {
        try {
          console.log('[AI 證書] 下載圖片轉 Base64...');
          const imgResponse = await fetch(imageData);
          const arrayBuffer = await imgResponse.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          imageData = `data:image/png;base64,${base64}`;
          console.log('[AI 證書] ✓ Base64 轉換成功');
        } catch (e) {
          console.error('[AI 證書] Base64 轉換失敗:', e.message);
        }
      }
      
      console.log('[AI 證書] ✓ 背景生成成功');
      return { url: imageData, style: styleInfo };
    } else {
      console.error('[AI 證書] 生成失敗:', data);
      return null;
    }
  } catch (error) {
    console.error('[AI 證書] 錯誤:', error.message);
    return null;
  }
}

// 生成證書 PDF（結合 AI 背景 + 學員資料）
async function generateCertificatePDF(registration, event, backgroundUrl) {
  // 使用 HTML 模板生成證書（可在前端渲染為 PDF）
  const certNumber = `CERT-${event.id.slice(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const issueDate = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  
  const certificateHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&family=Playfair+Display:wght@700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          width: 297mm; height: 210mm; 
          font-family: 'Noto Sans TC', sans-serif;
          ${backgroundUrl ? `background-image: url('${backgroundUrl}'); background-size: cover; background-position: center;` : ''}
          display: flex; align-items: center; justify-content: center;
        }
        .certificate {
          width: 90%; height: 85%;
          ${!backgroundUrl ? `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: 8px double gold;
            border-radius: 20px;
          ` : ''}
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          text-align: center; padding: 40px;
          ${backgroundUrl ? 'background: rgba(255,255,255,0.85); border-radius: 20px;' : 'color: white;'}
        }
        .title { 
          font-family: 'Playfair Display', serif;
          font-size: 48px; font-weight: 700; 
          margin-bottom: 20px;
          ${backgroundUrl ? 'color: #333;' : ''}
        }
        .subtitle { font-size: 24px; margin-bottom: 40px; opacity: 0.9; ${backgroundUrl ? 'color: #555;' : ''} }
        .name { 
          font-size: 42px; font-weight: 700; 
          margin: 30px 0; padding: 10px 40px;
          border-bottom: 3px solid ${backgroundUrl ? '#333' : 'gold'};
          ${backgroundUrl ? 'color: #222;' : ''}
        }
        .event { font-size: 28px; margin: 20px 0; ${backgroundUrl ? 'color: #444;' : ''} }
        .details { font-size: 18px; margin: 30px 0; line-height: 1.8; ${backgroundUrl ? 'color: #666;' : 'opacity: 0.9;'} }
        .footer { 
          margin-top: auto; font-size: 14px; 
          display: flex; justify-content: space-between; width: 100%;
          ${backgroundUrl ? 'color: #888;' : 'opacity: 0.8;'}
        }
        .seal { 
          width: 80px; height: 80px; 
          border: 3px solid ${backgroundUrl ? '#c9a227' : 'gold'}; 
          border-radius: 50%; 
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; margin-top: 20px;
          ${backgroundUrl ? 'color: #c9a227;' : ''}
        }
      </style>
    </head>
    <body>
      <div class="certificate">
        <div class="title">Certificate of Completion</div>
        <div class="subtitle">研習證書</div>
        <div class="name">${registration.name}</div>
        <div class="event">完成「${event.title}」研習課程</div>
        <div class="details">
          <div>📅 課程日期：${event.date}</div>
          <div>📍 課程地點：${event.location}</div>
          <div>👨‍🏫 指導講師：${event.instructorName || '專業講師'}</div>
        </div>
        <div class="seal">VERIFIED</div>
        <div class="footer">
          <span>證書編號：${certNumber}</span>
          <span>發證日期：${issueDate}</span>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return {
    html: certificateHTML,
    certNumber,
    issueDate,
    backgroundUrl
  };
}

// API: 生成 AI 證書背景
app.post('/api/certificate/generate-background', async (req, res) => {
  try {
    const { eventId } = req.body;
    const event = await getEvent(eventId);
    
    if (!event) {
      return res.json({ success: false, error: '找不到活動' });
    }
    
    const result = await generateCertificateBackground(event.title, event.description);
    
    if (result) {
      res.json({ success: true, backgroundUrl: result.url, style: result.style });
    } else {
      res.json({ success: false, error: 'AI 背景生成失敗，將使用預設模板' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// API: 生成單張證書
app.post('/api/certificate/generate', async (req, res) => {
  try {
    const { eventId, registrationId, backgroundUrl } = req.body;
    
    const event = await getEvent(eventId);
    const regs = await getRegistrations();
    const reg = regs.find(r => r.id === registrationId);
    
    if (!event || !reg) {
      return res.json({ success: false, error: '找不到活動或報名資料' });
    }
    
    const certificate = await generateCertificatePDF(reg, event, backgroundUrl);
    res.json({ success: true, certificate });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// API: 批次生成並發送證書
app.post('/api/certificate/send-all', async (req, res) => {
  try {
    const { eventId, backgroundUrl } = req.body;
    
    const event = await getEvent(eventId);
    if (!event) {
      return res.json({ success: false, error: '找不到活動' });
    }
    
    const regs = await getRegistrations();
    const confirmedRegs = regs.filter(r => r.eventId === eventId && r.status === 'confirmed');
    
    if (confirmedRegs.length === 0) {
      return res.json({ success: false, error: '沒有已確認的報名者' });
    }
    
    // 生成背景（如果沒有提供）
    let bgUrl = backgroundUrl;
    if (!bgUrl && TOGETHER_API_KEY) {
      const bgResult = await generateCertificateBackground(event.title, event.description);
      bgUrl = bgResult?.url;
    }
    
    const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
    const orgName = process.env.ORG_NAME || '工作坊';
    let sent = 0;
    let failed = [];
    
    for (let i = 0; i < confirmedRegs.length; i++) {
      const reg = confirmedRegs[i];
      
      // 延遲避免速率限制
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      try {
        const certNumber = `CERT-${event.id.slice(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
        const issueDate = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // 根據活動類型選擇證書風格
        const styleInfo = getCertificateStyle(event.title, event.description);
        
        // 不同風格的配色方案
        const styleColors = {
          '科技風': { primary: '#6366f1', secondary: '#a855f7', accent: '#06b6d4', bg: 'linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)', border: '#6366f1', text: '#e2e8f0' },
          '活潑風': { primary: '#f472b6', secondary: '#fb923c', accent: '#fbbf24', bg: 'linear-gradient(135deg, #fdf2f8 0%, #fef3c7 50%, #ecfdf5 100%)', border: '#f472b6', text: '#831843' },
          '正式商務': { primary: '#1e3a5f', secondary: '#c9a227', accent: '#c9a227', bg: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 50%, #1e3a5f 100%)', border: '#c9a227', text: '#f8fafc' },
          '藝術風': { primary: '#7c3aed', secondary: '#ec4899', accent: '#06b6d4', bg: 'linear-gradient(135deg, #faf5ff 0%, #fce7f3 50%, #ecfeff 100%)', border: '#7c3aed', text: '#581c87' },
          '表演藝術': { primary: '#dc2626', secondary: '#c9a227', accent: '#fbbf24', bg: 'linear-gradient(135deg, #450a0a 0%, #7f1d1d 50%, #450a0a 100%)', border: '#c9a227', text: '#fef2f2' },
          '典雅專業': { primary: '#166534', secondary: '#c9a227', accent: '#c9a227', bg: 'linear-gradient(135deg, #f0fdf4 0%, #fefce8 50%, #f0fdf4 100%)', border: '#c9a227', text: '#166534' }
        };
        
        const colors = styleColors[styleInfo.style] || styleColors['典雅專業'];
        
        // 如果有 AI 背景，嵌入為 img 標籤（而非背景圖）
        const hasAiBg = bgUrl && bgUrl.startsWith('data:');
        
        // 直接在郵件中嵌入精美證書
        if (resend) {
          await resend.emails.send({
            from: senderEmail,
            to: reg.email,
            subject: `🏆 研習證書 - ${event.title}`,
            html: `
              <div style="font-family: 'Segoe UI', 'Microsoft JhengHei', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f1f5f9;">
                
                <!-- 頂部通知 -->
                <div style="background: linear-gradient(135deg, ${colors.primary}, ${colors.secondary}); color: white; padding: 25px; border-radius: 15px; text-align: center; margin-bottom: 30px;">
                  <h1 style="margin: 0; font-size: 28px;">🎉 恭喜完成研習！</h1>
                  <p style="margin: 10px 0 0; opacity: 0.9;">您的研習證書已準備完成（${styleInfo.style}）</p>
                </div>
                
                <!-- ========== 證書本體 ========== -->
                ${hasAiBg ? `
                  <!-- AI 生成的背景圖 -->
                  <div style="position: relative; margin-bottom: 30px;">
                    <img src="${bgUrl}" alt="Certificate Background" style="width: 100%; border-radius: 15px; display: block;" />
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 85%; background: rgba(255,255,255,0.95); border-radius: 10px; padding: 30px; text-align: center;">
                      <h2 style="font-family: Georgia, serif; font-size: 28px; color: ${colors.primary}; margin: 0 0 5px; font-style: italic;">Certificate of Completion</h2>
                      <p style="color: #666; font-size: 16px; margin: 0 0 15px; letter-spacing: 5px;">研 習 證 書</p>
                      <p style="color: #666; font-size: 14px; margin: 15px 0 5px;">茲證明</p>
                      <h1 style="font-size: 32px; color: #1a1a2e; margin: 0; border-bottom: 2px solid ${colors.accent}; display: inline-block; padding: 0 20px 5px;">${reg.name}</h1>
                      <p style="color: #666; font-size: 14px; margin: 15px 0 5px;">已順利完成</p>
                      <h3 style="font-size: 20px; color: ${colors.primary}; margin: 0;">「${event.title}」</h3>
                      <p style="color: #888; font-size: 12px; margin: 15px 0 5px;">📅 ${event.date} ⏰ ${event.time}${event.endTime ? '-' + event.endTime : ''} 📍 ${event.location}</p>
                      <p style="color: #888; font-size: 11px; margin: 10px 0 0;">${certNumber} | ${issueDate}</p>
                    </div>
                  </div>
                ` : `
                  <!-- 純 CSS 證書（無 AI 背景時） -->
                  <div style="background: ${colors.bg}; border-radius: 20px; padding: 20px; margin-bottom: 30px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
                    <div style="background: rgba(255,255,255,0.95); border-radius: 15px; padding: 40px; text-align: center; border: 4px double ${colors.accent};">
                      
                      <div style="margin-bottom: 15px;"><span style="font-size: 36px;">🏆</span></div>
                      
                      <h2 style="font-family: Georgia, serif; font-size: 30px; color: ${colors.primary}; margin: 0 0 5px; font-style: italic;">Certificate of Completion</h2>
                      <p style="color: #666; font-size: 18px; margin: 0 0 20px; letter-spacing: 6px;">研 習 證 書</p>
                      
                      <div style="border-top: 2px solid ${colors.accent}; border-bottom: 2px solid ${colors.accent}; padding: 20px 0; margin: 20px 0;">
                        <p style="color: #666; font-size: 14px; margin: 0 0 10px;">茲 證 明</p>
                        <h1 style="font-size: 36px; color: #1a1a2e; margin: 0;">${reg.name}</h1>
                      </div>
                      
                      <p style="color: #666; font-size: 14px; margin: 0 0 10px;">已順利完成</p>
                      <h3 style="font-size: 22px; color: ${colors.primary}; margin: 0 0 20px;">「${event.title}」</h3>
                      
                      <table style="margin: 0 auto; border-collapse: collapse; background: #f8fafc; border-radius: 8px;">
                        <tr><td style="padding: 10px 15px; color: #666;">📅 日期</td><td style="padding: 10px 15px; color: #333; font-weight: bold;">${event.date}</td></tr>
                        <tr><td style="padding: 10px 15px; color: #666;">⏰ 時間</td><td style="padding: 10px 15px; color: #333; font-weight: bold;">${event.time}${event.endTime ? ' - ' + event.endTime : ''}</td></tr>
                        <tr><td style="padding: 10px 15px; color: #666;">📍 地點</td><td style="padding: 10px 15px; color: #333; font-weight: bold;">${event.location}</td></tr>
                        <tr><td style="padding: 10px 15px; color: #666;">👨‍🏫 講師</td><td style="padding: 10px 15px; color: #333; font-weight: bold;">${event.instructorName || '專業講師'}</td></tr>
                      </table>
                      
                      <div style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <table style="width: 100%;">
                          <tr>
                            <td style="text-align: left; font-size: 11px; color: #888;">證書編號<br/><span style="font-family: monospace;">${certNumber}</span></td>
                            <td style="text-align: center;"><div style="width: 50px; height: 50px; border: 2px solid ${colors.accent}; border-radius: 50%; line-height: 46px; margin: 0 auto; color: ${colors.accent}; font-size: 9px;">✓ VERIFIED</div></td>
                            <td style="text-align: right; font-size: 11px; color: #888;">發證日期<br/>${issueDate}</td>
                          </tr>
                        </table>
                      </div>
                      
                    </div>
                  </div>
                `}
                
                <!-- 底部說明 -->
                <div style="text-align: center; color: #64748b; font-size: 13px; padding: 10px;">
                  <p style="margin: 0 0 5px;">此證書由 ${orgName} 自動發送</p>
                  <p style="margin: 0;">如有任何問題，請聯繫主辦單位</p>
                </div>
                
              </div>
            `
          });
        }
        
        sent++;
        console.log(`[證書發送] ✓ ${reg.email} (${certNumber}) [${styleInfo.style}]${hasAiBg ? ' [AI背景]' : ''}`);
      } catch (e) {
        console.error(`[證書發送] ✗ ${reg.email}:`, e.message);
        failed.push({ email: reg.email, error: e.message });
      }
    }
    
    // 更新活動證書數量
    await updateEvent(eventId, { certificates: sent });
    
    res.json({ success: true, sent, total: confirmedRegs.length, failed });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// API: 驗證證書
app.get('/api/certificate/verify/:certNumber', async (req, res) => {
  // 從證書編號解析活動 ID 和時間戳
  // 格式: CERT-XXXX-TIMESTAMP
  const { certNumber } = req.params;
  
  // 這裡可以加入更完整的驗證邏輯（如存入資料庫）
  res.json({ 
    valid: certNumber.startsWith('CERT-'),
    certNumber,
    message: certNumber.startsWith('CERT-') ? '此證書編號格式正確' : '證書編號格式無效'
  });
});

// ==================== 1. 簽到系統 API ====================
// 產生簽到 QR Code 連結
app.get('/api/checkin/qr/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const baseUrl = process.env.WEB_URL || `http://localhost:${process.env.PORT || 3000}`;
  const checkinUrl = `${baseUrl}?checkin=${eventId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(checkinUrl)}`;
  res.json({ checkinUrl, qrUrl, eventId });
});

// 執行簽到
app.post('/api/checkin', async (req, res) => {
  try {
    const { eventId, email } = req.body;
    const regs = await getRegistrations();
    const reg = regs.find(r => r.eventId === eventId && r.email.toLowerCase() === email.toLowerCase() && r.status === 'confirmed');
    
    if (!reg) {
      return res.json({ success: false, error: '找不到您的報名資料，請確認 Email 是否正確' });
    }
    
    if (reg.checkedIn) {
      return res.json({ success: false, error: '您已經簽到過了', checkedInAt: reg.checkedInAt });
    }
    
    // 更新簽到狀態
    const checkedInAt = new Date().toISOString();
    await updateRegistration(reg.id, { checkedIn: true, checkedInAt });
    
    res.json({ success: true, name: reg.name, checkedInAt });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 取得簽到統計
app.get('/api/checkin/stats/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const regs = await getRegistrations();
    const eventRegs = regs.filter(r => r.eventId === eventId && r.status === 'confirmed');
    const checkedIn = eventRegs.filter(r => r.checkedIn);
    
    res.json({
      total: eventRegs.length,
      checkedIn: checkedIn.length,
      notCheckedIn: eventRegs.length - checkedIn.length,
      checkedInList: checkedIn.map(r => ({ name: r.name, email: r.email, checkedInAt: r.checkedInAt })),
      notCheckedInList: eventRegs.filter(r => !r.checkedIn).map(r => ({ name: r.name, email: r.email }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 2. 問卷回饋系統 API ====================
// 取得問卷
app.get('/api/feedback/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    if (useFirebase) {
      const snapshot = await db.collection('feedback').where('eventId', '==', eventId).get();
      res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } else {
      res.json((memoryData.feedback || []).filter(f => f.eventId === eventId));
    }
  } catch (e) {
    res.json([]);
  }
});

// 提交問卷
app.post('/api/feedback', async (req, res) => {
  try {
    const { eventId, email, rating, comment, answers } = req.body;
    
    // 檢查是否已填過
    let existing = null;
    if (useFirebase) {
      const snapshot = await db.collection('feedback').where('eventId', '==', eventId).where('email', '==', email).get();
      existing = !snapshot.empty;
    } else {
      existing = (memoryData.feedback || []).find(f => f.eventId === eventId && f.email === email);
    }
    
    if (existing) {
      return res.json({ success: false, error: '您已經填寫過問卷了' });
    }
    
    const feedback = {
      eventId,
      email,
      rating: parseInt(rating) || 5,
      comment: comment || '',
      answers: answers || {},
      createdAt: new Date().toISOString()
    };
    
    if (useFirebase) {
      const docRef = await db.collection('feedback').add(feedback);
      res.json({ success: true, id: docRef.id });
    } else {
      feedback.id = Date.now().toString();
      if (!memoryData.feedback) memoryData.feedback = [];
      memoryData.feedback.push(feedback);
      res.json({ success: true, id: feedback.id });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 問卷統計
app.get('/api/feedback/stats/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    let feedbacks = [];
    
    if (useFirebase) {
      const snapshot = await db.collection('feedback').where('eventId', '==', eventId).get();
      feedbacks = snapshot.docs.map(doc => doc.data());
    } else {
      feedbacks = (memoryData.feedback || []).filter(f => f.eventId === eventId);
    }
    
    if (feedbacks.length === 0) {
      return res.json({ total: 0, avgRating: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    }
    
    const ratings = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRating = 0;
    
    feedbacks.forEach(f => {
      ratings[f.rating] = (ratings[f.rating] || 0) + 1;
      totalRating += f.rating;
    });
    
    res.json({
      total: feedbacks.length,
      avgRating: (totalRating / feedbacks.length).toFixed(1),
      ratings,
      comments: feedbacks.filter(f => f.comment).map(f => ({ rating: f.rating, comment: f.comment, createdAt: f.createdAt }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 3. 候補名單系統 API ====================
// 加入候補
app.post('/api/waitlist', async (req, res) => {
  try {
    const { eventId, name, email, phone } = req.body;
    
    // 檢查是否已在候補名單
    let existing = null;
    if (useFirebase) {
      const snapshot = await db.collection('waitlist').where('eventId', '==', eventId).where('email', '==', email).get();
      existing = !snapshot.empty;
    } else {
      existing = (memoryData.waitlist || []).find(w => w.eventId === eventId && w.email === email);
    }
    
    if (existing) {
      return res.json({ success: false, error: '您已經在候補名單中' });
    }
    
    const waitlistEntry = {
      eventId,
      name,
      email,
      phone: phone || '',
      createdAt: new Date().toISOString(),
      notified: false
    };
    
    if (useFirebase) {
      const docRef = await db.collection('waitlist').add(waitlistEntry);
      
      // 計算候補順位
      const snapshot = await db.collection('waitlist').where('eventId', '==', eventId).get();
      const position = snapshot.size;
      
      res.json({ success: true, id: docRef.id, position });
    } else {
      waitlistEntry.id = Date.now().toString();
      if (!memoryData.waitlist) memoryData.waitlist = [];
      memoryData.waitlist.push(waitlistEntry);
      
      const position = memoryData.waitlist.filter(w => w.eventId === eventId).length;
      res.json({ success: true, id: waitlistEntry.id, position });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 取得候補名單
app.get('/api/waitlist/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    if (useFirebase) {
      const snapshot = await db.collection('waitlist').where('eventId', '==', eventId).orderBy('createdAt', 'asc').get();
      res.json(snapshot.docs.map((doc, idx) => ({ id: doc.id, ...doc.data(), position: idx + 1 })));
    } else {
      const list = (memoryData.waitlist || []).filter(w => w.eventId === eventId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      res.json(list.map((w, idx) => ({ ...w, position: idx + 1 })));
    }
  } catch (e) {
    res.json([]);
  }
});

// 通知候補者（當有人取消時）
app.post('/api/waitlist/notify/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const events = await getEvents();
    const event = events.find(e => e.id === eventId);
    
    if (!event) return res.json({ success: false, error: '找不到活動' });
    
    // 找到第一位未通知的候補者
    let firstWaiting = null;
    if (useFirebase) {
      const snapshot = await db.collection('waitlist').where('eventId', '==', eventId).where('notified', '==', false).orderBy('createdAt', 'asc').limit(1).get();
      if (!snapshot.empty) {
        firstWaiting = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
      }
    } else {
      firstWaiting = (memoryData.waitlist || []).filter(w => w.eventId === eventId && !w.notified).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    }
    
    if (!firstWaiting) {
      return res.json({ success: false, error: '沒有候補者' });
    }
    
    // 發送通知 Email
    if (resend) {
      const senderEmail = process.env.SENDER_EMAIL || 'onboarding@resend.dev';
      const baseUrl = process.env.WEB_URL || 'http://localhost:3000';
      
      await resend.emails.send({
        from: senderEmail,
        to: firstWaiting.email,
        subject: `🎉 候補通知 - ${event.title} 有名額釋出！`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 20px; border-radius: 10px 10px 0 0;">
              <h2>🎉 好消息！有名額釋出了！</h2>
            </div>
            <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 10px 10px;">
              <p>親愛的 ${firstWaiting.name} 您好，</p>
              <p>您候補的活動「<strong>${event.title}</strong>」有名額釋出，請盡快完成報名！</p>
              <div style="background: #e0e7ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p><strong>📅 日期：</strong>${event.date}</p>
                <p><strong>⏰ 時間：</strong>${event.time}${event.endTime ? ' - ' + event.endTime : ''}</p>
                <p><strong>📍 地點：</strong>${event.location}</p>
              </div>
              <a href="${baseUrl}?register=${eventId}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">立即報名</a>
              <p style="color: #64748b; font-size: 12px; margin-top: 20px;">此名額保留 24 小時，逾期將通知下一位候補者。</p>
            </div>
          </div>
        `
      });
    }
    
    // 標記已通知
    if (useFirebase) {
      await db.collection('waitlist').doc(firstWaiting.id).update({ notified: true, notifiedAt: new Date().toISOString() });
    } else {
      const idx = memoryData.waitlist.findIndex(w => w.id === firstWaiting.id);
      if (idx !== -1) {
        memoryData.waitlist[idx].notified = true;
        memoryData.waitlist[idx].notifiedAt = new Date().toISOString();
      }
    }
    
    res.json({ success: true, notified: firstWaiting.email });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 4. 複製活動 API ====================
app.post('/api/events/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params;
    const { newDate, newTitle } = req.body;
    const originalEvent = await getEvent(id);
    
    if (!originalEvent) {
      return res.json({ success: false, error: '找不到原活動' });
    }
    
    const newEvent = {
      ...originalEvent,
      title: newTitle || `${originalEvent.title} (複製)`,
      date: newDate || originalEvent.date,
      status: 'draft',
      registrations: 0,
      notifications: 0,
      certificates: 0,
      createdAt: new Date().toISOString()
    };
    delete newEvent.id;
    
    const created = await addEvent(newEvent);
    res.json({ success: true, event: created });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 5. 數據儀表板 API ====================
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const events = await getEvents();
    const regs = await getRegistrations();
    
    // 活動統計
    const activeEvents = events.filter(e => e.status === 'active').length;
    const draftEvents = events.filter(e => e.status === 'draft').length;
    const completedEvents = events.filter(e => e.status === 'completed').length;
    
    // 報名統計
    const totalRegs = regs.length;
    const confirmedRegs = regs.filter(r => r.status === 'confirmed').length;
    const pendingRegs = regs.filter(r => r.status === 'pending').length;
    const cancelledRegs = regs.filter(r => r.status === 'cancelled').length;
    
    // 簽到統計
    const checkedInRegs = regs.filter(r => r.checkedIn).length;
    
    // 最近 7 天報名趨勢
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const count = regs.filter(r => r.createdAt && r.createdAt.startsWith(dateStr)).length;
      last7Days.push({ date: dateStr, count });
    }
    
    // 各活動報名數
    const eventStats = events.map(e => ({
      id: e.id,
      title: e.title,
      date: e.date,
      maxParticipants: e.maxParticipants,
      registrations: regs.filter(r => r.eventId === e.id && r.status === 'confirmed').length,
      checkedIn: regs.filter(r => r.eventId === e.id && r.checkedIn).length
    }));
    
    res.json({
      events: { total: events.length, active: activeEvents, draft: draftEvents, completed: completedEvents },
      registrations: { total: totalRegs, confirmed: confirmedRegs, pending: pendingRegs, cancelled: cancelledRegs, checkedIn: checkedInRegs },
      trend: last7Days,
      eventStats
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 問卷總覽
app.get('/api/dashboard/feedback', async (req, res) => {
  try {
    let feedbacks = [];
    if (useFirebase) {
      const snapshot = await db.collection('feedback').orderBy('createdAt', 'desc').limit(100).get();
      feedbacks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      feedbacks = memoryData.feedback || [];
    }
    
    const events = await getEvents();
    const totalFeedback = feedbacks.length;
    const avgRating = feedbacks.length > 0 
      ? (feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length).toFixed(1) 
      : 0;
    
    // 各活動回饋統計
    const eventFeedback = events.map(e => {
      const eFeedbacks = feedbacks.filter(f => f.eventId === e.id);
      return {
        id: e.id,
        title: e.title,
        count: eFeedbacks.length,
        avgRating: eFeedbacks.length > 0 
          ? (eFeedbacks.reduce((sum, f) => sum + f.rating, 0) / eFeedbacks.length).toFixed(1) 
          : 0
      };
    });
    
    res.json({ total: totalFeedback, avgRating, eventFeedback, recentComments: feedbacks.filter(f => f.comment).slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 啟動排程檢查（每 10 分鐘）
setInterval(checkSchedules, 10 * 60 * 1000);
// 啟動時也執行一次
setTimeout(checkSchedules, 5000);

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
