#!/usr/bin/env node

/**
 * 获取 Dropbox refresh_token 的辅助脚本
 *
 * 使用方法：
 * 1. 确保在 Dropbox 应用后台为你的 app 配置了重定向地址（Redirect URI），例如：
 *    http://localhost:53682/auth
 * 2. 在命令行里设置环境变量或在 .env 里配置：
 *    DROPBOX_APP_KEY=你的_app_key
 *    DROPBOX_APP_SECRET=你的_app_secret
 * 3. 运行脚本：
 *    node scripts/dropbox_get_refresh_token.js
 * 4. 打开脚本打印出的授权链接，在浏览器中登录并同意授权
 * 5. 授权完成后，浏览器会跳转到你配置的 Redirect URI，地址栏会带有 ?code=xxxx
 *    复制这个 code，粘贴回脚本，脚本会帮你换取 refresh_token
 */

require('dotenv').config();
const readline = require('readline');
const fetch = require('node-fetch');
const HttpsProxyAgent = require('https-proxy-agent');

const APP_KEY = process.env.DROPBOX_APP_KEY;
const APP_SECRET = process.env.DROPBOX_APP_SECRET;

// 可选：通过环境变量配置 HTTP 代理，例如：
//   export HTTPS_PROXY="http://127.0.0.1:7890"
//   或 export HTTP_PROXY="http://127.0.0.1:7890"
const PROXY_URL =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.ALL_PROXY ||
  '';

const proxyAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

// 必须和 Dropbox 应用后台配置的 Redirect URI 完全一致
const REDIRECT_URI =
  process.env.DROPBOX_REDIRECT_URI || 'http://localhost:53682/auth';

if (!APP_KEY || !APP_SECRET) {
  console.error(
    '请先在环境变量中配置 DROPBOX_APP_KEY 和 DROPBOX_APP_SECRET 再运行本脚本。'
  );
  process.exit(1);
}

console.log('================ Dropbox refresh_token 获取助手 ================');
console.log('');
console.log('1）请在 Dropbox 应用后台确认 Redirect URI 已配置为：');
console.log(`   ${REDIRECT_URI}`);
console.log('');

const authUrl = new URL('https://www.dropbox.com/oauth2/authorize');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', APP_KEY);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('token_access_type', 'offline'); // 要求返回 refresh_token

console.log('2）在浏览器中打开以下链接，登录并同意授权：');
console.log('');
console.log(`   ${authUrl.toString()}`);
console.log('');
console.log('3）授权完成后，浏览器会跳转到 Redirect URI，地址栏看起来像：');
console.log('   http://localhost:53682/auth?code=xxxxxxxxxxxxxxxxxxxxxxx');
console.log('   其中 code= 后面的那一长串字符串就是「授权 code」。');
console.log('');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('请粘贴浏览器地址栏中的 code 参数值（不含 ?code=）：', async (code) => {
  rl.close();

  code = (code || '').trim();
  if (!code) {
    console.error('未输入 code，已退出。');
    process.exit(1);
  }

  try {
    console.log('\n正在向 Dropbox 交换 access_token 和 refresh_token...\n');

    const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: APP_KEY,
        client_secret: APP_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
      agent: proxyAgent,
    });

    const text = await resp.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`解析返回结果失败：${text}`);
    }

    if (!resp.ok) {
      throw new Error(
        `请求失败：${resp.status} ${resp.statusText}\n` +
          `错误详情：${JSON.stringify(data)}`
      );
    }

    console.log('交换成功！Dropbox 返回的数据大致如下：');
    console.log(JSON.stringify(data, null, 2));
    console.log('');

    if (!data.refresh_token) {
      console.warn(
        '注意：返回数据中没有 refresh_token，请检查：\n' +
          '1）授权链接中是否包含 token_access_type=offline\n' +
          '2）Dropbox 后台应用是否支持 offline access\n' +
          '3）是否重复使用了已经授权过的 code（code 只能用一次）'
      );
    } else {
      console.log('================ 重要信息（请保存） ================');
      console.log(`refresh_token: ${data.refresh_token}`);
      console.log('');
      console.log('建议将其写入 .env：');
      console.log(`DROPBOX_REFRESH_TOKEN=${data.refresh_token}`);
      console.log('然后就可以配合项目中的自动刷新逻辑长期使用了。');
    }
  } catch (err) {
    console.error('\n请求 Dropbox Token 接口失败：', err.message);
    process.exit(1);
  }
});


