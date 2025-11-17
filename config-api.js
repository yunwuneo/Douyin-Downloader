const express = require('express');
const cors = require('cors');
const path = require('path');
const { readJSON, saveJSON } = require('./src/utils');

const app = express();

// 中间件
app.use(express.json());
app.use(cors());

// 配置文件路径
const configPath = path.join(__dirname, 'config.json');

async function getConfig() {
  const config = await readJSON(configPath);
  // 确保基础结构存在
  return {
    users: Array.isArray(config?.users) ? config.users : [],
    settings: config?.settings || { page_size: 20, sort_type: 0 }
  };
}

async function writeConfig(newConfig) {
  const normalized = {
    users: Array.isArray(newConfig.users) ? newConfig.users : [],
    settings: newConfig.settings || { page_size: 20, sort_type: 0 }
  };
  await saveJSON(configPath, normalized);
  return normalized;
}

// 获取完整配置
app.get('/api/config', async (req, res) => {
  try {
    const config = await getConfig();
    res.json(config);
  } catch (e) {
    console.error('读取配置失败:', e.message);
    res.status(500).json({ message: '读取配置失败' });
  }
});

// 更新完整配置
app.put('/api/config', async (req, res) => {
  try {
    const config = await writeConfig(req.body || {});
    res.json(config);
  } catch (e) {
    console.error('写入配置失败:', e.message);
    res.status(500).json({ message: '写入配置失败' });
  }
});

// 获取用户列表
app.get('/api/users', async (req, res) => {
  try {
    const config = await getConfig();
    res.json(config.users);
  } catch (e) {
    console.error('读取用户列表失败:', e.message);
    res.status(500).json({ message: '读取用户列表失败' });
  }
});

// 新增用户
app.post('/api/users', async (req, res) => {
  try {
    const { sec_user_id, username, monitor_type, max_cursor } = req.body || {};

    if (!sec_user_id || !username) {
      return res.status(400).json({ message: 'sec_user_id 与 username 为必填项' });
    }

    const config = await getConfig();

    const exists = config.users.some(u => u.sec_user_id === sec_user_id);
    if (exists) {
      return res.status(409).json({ message: '该 sec_user_id 已存在' });
    }

    const user = {
      sec_user_id,
      username,
      monitor_type: monitor_type || 'posts',
      max_cursor: typeof max_cursor === 'number' ? max_cursor : 0
    };

    config.users.push(user);
    await writeConfig(config);

    res.status(201).json(user);
  } catch (e) {
    console.error('新增用户失败:', e.message);
    res.status(500).json({ message: '新增用户失败' });
  }
});

// 更新用户
app.put('/api/users/:sec_user_id', async (req, res) => {
  try {
    const { sec_user_id } = req.params;
    const { username, monitor_type, max_cursor } = req.body || {};

    const config = await getConfig();
    const idx = config.users.findIndex(u => u.sec_user_id === sec_user_id);
    if (idx === -1) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const user = config.users[idx];
    if (username !== undefined) user.username = username;
    if (monitor_type !== undefined) user.monitor_type = monitor_type;
    if (max_cursor !== undefined) user.max_cursor = max_cursor;

    config.users[idx] = user;
    await writeConfig(config);

    res.json(user);
  } catch (e) {
    console.error('更新用户失败:', e.message);
    res.status(500).json({ message: '更新用户失败' });
  }
});

// 删除用户
app.delete('/api/users/:sec_user_id', async (req, res) => {
  try {
    const { sec_user_id } = req.params;
    const config = await getConfig();
    const before = config.users.length;
    config.users = config.users.filter(u => u.sec_user_id !== sec_user_id);

    if (config.users.length === before) {
      return res.status(404).json({ message: '用户不存在' });
    }

    await writeConfig(config);
    res.status(204).send();
  } catch (e) {
    console.error('删除用户失败:', e.message);
    res.status(500).json({ message: '删除用户失败' });
  }
});

// 获取与更新 settings
app.get('/api/settings', async (req, res) => {
  try {
    const config = await getConfig();
    res.json(config.settings);
  } catch (e) {
    console.error('读取设置失败:', e.message);
    res.status(500).json({ message: '读取设置失败' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const partial = req.body || {};
    const config = await getConfig();
    config.settings = {
      ...config.settings,
      ...partial
    };
    await writeConfig(config);
    res.json(config.settings);
  } catch (e) {
    console.error('更新设置失败:', e.message);
    res.status(500).json({ message: '更新设置失败' });
  }
});

// 静态 Web UI
const uiDir = path.join(__dirname, 'config-ui');
app.use('/', express.static(uiDir));

// 启动端口
const PORT = process.env.CONFIG_API_PORT || 4000;
app.listen(PORT, () => {
  console.log(`配置管理 API 已启动: http://localhost:${PORT}`);
});





