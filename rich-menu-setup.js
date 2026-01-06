/**
 * Rich Menu 自動建立腳本
 * 
 * 使用方式：
 * 1. 設定環境變數 LINE_CHANNEL_ACCESS_TOKEN
 * 2. 執行 node rich-menu-setup.js
 */

const fs = require('fs');
const path = require('path');

const LINE_API = 'https://api.line.me/v2/bot';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('請設定 LINE_CHANNEL_ACCESS_TOKEN 環境變數');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

// Rich Menu 設定（2500x1686 像素，6格選單）
const richMenuConfig = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: '工作坊管理選單',
  chatBarText: '📋 管理選單',
  areas: [
    // 第一排
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: 'message', text: '總覽' }
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: 'message', text: '活動列表' }
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: 'message', text: '最新報名' }
    },
    // 第二排
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: { type: 'message', text: '生成文宣' }
    },
    {
      bounds: { x: 833, y: 843, width: 834, height: 843 },
      action: { type: 'message', text: '說明' }
    },
    {
      bounds: { x: 1667, y: 843, width: 833, height: 843 },
      action: { type: 'uri', uri: process.env.WEB_URL || 'https://workshop-manager.onrender.com' }
    }
  ]
};

async function createRichMenu() {
  console.log('📱 建立 Rich Menu...');
  
  // 1. 建立 Rich Menu
  const createRes = await fetch(`${LINE_API}/richmenu`, {
    method: 'POST',
    headers,
    body: JSON.stringify(richMenuConfig)
  });
  
  if (!createRes.ok) {
    console.error('建立失敗:', await createRes.text());
    return;
  }
  
  const { richMenuId } = await createRes.json();
  console.log('✅ Rich Menu ID:', richMenuId);
  
  // 2. 上傳圖片
  console.log('🖼️ 上傳圖片...');
  const imagePath = path.join(__dirname, 'rich-menu.png');
  
  if (!fs.existsSync(imagePath)) {
    console.log('⚠️ 找不到 rich-menu.png，請手動上傳圖片');
    console.log(`上傳指令: curl -X POST ${LINE_API}/richmenu/${richMenuId}/content \\
    -H "Authorization: Bearer ${TOKEN}" \\
    -H "Content-Type: image/png" \\
    --data-binary @rich-menu.png`);
  } else {
    const imageBuffer = fs.readFileSync(imagePath);
    const uploadRes = await fetch(`${LINE_API}/richmenu/${richMenuId}/content`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'image/png'
      },
      body: imageBuffer
    });
    
    if (uploadRes.ok) {
      console.log('✅ 圖片上傳成功');
    } else {
      console.error('圖片上傳失敗:', await uploadRes.text());
    }
  }
  
  // 3. 設為預設選單
  console.log('🔗 設為預設選單...');
  const defaultRes = await fetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers
  });
  
  if (defaultRes.ok) {
    console.log('✅ 已設為預設選單');
  } else {
    console.error('設定預設失敗:', await defaultRes.text());
  }
  
  console.log('\n🎉 Rich Menu 設定完成！');
  console.log('Rich Menu ID:', richMenuId);
}

// 列出現有 Rich Menu
async function listRichMenus() {
  const res = await fetch(`${LINE_API}/richmenu/list`, { headers });
  const data = await res.json();
  console.log('現有 Rich Menu:', JSON.stringify(data, null, 2));
}

// 刪除所有 Rich Menu
async function deleteAllRichMenus() {
  const res = await fetch(`${LINE_API}/richmenu/list`, { headers });
  const { richmenus } = await res.json();
  
  for (const menu of richmenus) {
    await fetch(`${LINE_API}/richmenu/${menu.richMenuId}`, {
      method: 'DELETE',
      headers
    });
    console.log('已刪除:', menu.richMenuId);
  }
}

// 主程式
const command = process.argv[2] || 'create';

switch (command) {
  case 'create':
    createRichMenu();
    break;
  case 'list':
    listRichMenus();
    break;
  case 'delete':
    deleteAllRichMenus();
    break;
  default:
    console.log('指令: create | list | delete');
}
