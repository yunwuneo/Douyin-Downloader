const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();
const fetch = require('node-fetch');

/**
 * 多存储后端管理器
 * 当前支持:
 * - local (本地，实际下载已经完成，这里只做占位)
 * - dropbox
 * - s3
 */

class StorageManager {
  constructor(baseDownloadDir) {
    this.baseDownloadDir = baseDownloadDir || process.env.DOWNLOAD_DIR || './downloads';
    this.backends = [];
    this.initBackends();
  }

  /**
   * 初始化所有启用的后端
   */
  initBackends() {
    const backendEnv = process.env.STORAGE_BACKENDS || 'local';
    const backendNames = backendEnv
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);

    // 始终包含 local，占位用
    if (!backendNames.includes('local')) {
      backendNames.unshift('local');
    }

    for (const name of backendNames) {
      if (name === 'local') {
        this.backends.push(this.createLocalBackend());
      } else if (name === 'dropbox') {
        const dropboxBackend = this.createDropboxBackend();
        if (dropboxBackend) this.backends.push(dropboxBackend);
      } else if (name === 's3') {
        const s3Backend = this.createS3Backend();
        if (s3Backend) this.backends.push(s3Backend);
      } else {
        console.warn(`未知存储后端: ${name}，已跳过`);
      }
    }

    console.log(
      `多存储后端已初始化: ${this.backends.map((b) => b.name).join(', ') || '无'}`
    );
  }

  /**
   * 本地后端（占位）
   */
  createLocalBackend() {
    return {
      name: 'local',
      async upload(localPath, relativePath) {
        // 本地下载已经在主流程完成，这里仅打印日志，方便调试
        console.log(`[local] 文件已保存在本地: ${relativePath || localPath}`);
      },
    };
  }

  /**
   * 获取或刷新 Dropbox access token（支持短期 token + refresh_token）
   */
  async getDropboxAccessToken() {
    // 兼容旧配置: 如果只配置了静态 access token，就直接用，但可能会过期
    if (
      process.env.DROPBOX_ACCESS_TOKEN &&
      !process.env.DROPBOX_REFRESH_TOKEN
    ) {
      return process.env.DROPBOX_ACCESS_TOKEN;
    }

    const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
    const clientId = process.env.DROPBOX_APP_KEY;
    const clientSecret = process.env.DROPBOX_APP_SECRET;

    if (!refreshToken || !clientId || !clientSecret) {
      console.warn(
        '未配置 Dropbox 刷新参数 (DROPBOX_REFRESH_TOKEN / DROPBOX_APP_KEY / DROPBOX_APP_SECRET)，Dropbox 后端不会启用'
      );
      return null;
    }

    // 简单的内存级缓存，避免每个文件都刷新一次
    if (
      this._dropboxToken &&
      this._dropboxToken.accessToken &&
      this._dropboxToken.expiresAt &&
      Date.now() < this._dropboxToken.expiresAt - 60 * 1000 // 提前 60 秒刷新
    ) {
      return this._dropboxToken.accessToken;
    }

    try {
      const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(
          `刷新 Dropbox access token 失败: ${resp.status} ${text}`
        );
      }

      const data = await resp.json();
      const accessToken = data.access_token;
      const expiresIn = data.expires_in || 4 * 60 * 60; // 默认 4 小时

      this._dropboxToken = {
        accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
      };

      return accessToken;
    } catch (error) {
      console.error(
        '获取 Dropbox access token 失败，请检查 refresh_token / app key / app secret 配置:',
        error.message
      );
      return null;
    }
  }

  /**
   * Dropbox 后端
   */
  createDropboxBackend() {
    let Dropbox;
    try {
      Dropbox = require('dropbox').Dropbox;
    } catch (error) {
      console.error('未安装 dropbox 依赖，请运行: npm install dropbox');
      return null;
    }

    const baseFolder = process.env.DROPBOX_BASE_FOLDER || '/douyin-downloads';

    return {
      name: 'dropbox',
      async upload(localPath, relativePath) {
        try {
          const accessToken = await this.getDropboxAccessToken();
          if (!accessToken) {
            console.warn(
              '[dropbox] 未能获取有效的 access token，已跳过本次上传'
            );
            return;
          }

          const dbx = new Dropbox({ accessToken, fetch });

          const fileContent = await fs.readFile(localPath);
          // Dropbox 路径必须是 POSIX 风格
          const remotePath = path
            .posix
            .join(baseFolder, relativePath || path.basename(localPath))
            .replace(/\\/g, '/');

          await dbx.filesUpload({
            path: remotePath,
            contents: fileContent,
            mode: { '.tag': 'overwrite' },
          });

          console.log(`[dropbox] 上传成功: ${remotePath}`);
        } catch (error) {
          console.error(`[dropbox] 上传失败 (${relativePath || localPath}): ${error.message}`);
        }
      },
    };
  }

  /**
   * S3 后端
   */
  createS3Backend() {
    const region = process.env.S3_REGION;
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!region || !bucket || !accessKeyId || !secretAccessKey) {
      console.warn('S3 配置不完整 (S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)，S3 后端不会启用');
      return null;
    }

    let S3Client, PutObjectCommand;
    try {
      ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
    } catch (error) {
      console.error('未安装 @aws-sdk/client-s3 依赖，请运行: npm install @aws-sdk/client-s3');
      return null;
    }

    const basePrefix = (process.env.S3_BASE_PREFIX || 'douyin-downloads').replace(/^\/+/, '');

    const client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    return {
      name: 's3',
      async upload(localPath, relativePath) {
        try {
          const key = path
            .posix
            .join(basePrefix, relativePath || path.basename(localPath))
            .replace(/\\/g, '/');

          const fileStream = fs.createReadStream(localPath);

          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: fileStream,
            })
          );

          console.log(`[s3] 上传成功: s3://${bucket}/${key}`);
        } catch (error) {
          console.error(`[s3] 上传失败 (${relativePath || localPath}): ${error.message}`);
        }
      },
    };
  }

  /**
   * 同步单个文件到所有后端
   * @param {string} localPath - 本地文件绝对或相对路径
   * @param {string} relativePath - 相对于下载根目录的路径，用于远端结构
   */
  async syncFile(localPath, relativePath) {
    if (!this.backends.length) {
      return;
    }

    const relPath =
      relativePath ||
      path.relative(this.baseDownloadDir, path.resolve(localPath));

    const tasks = this.backends.map((backend) =>
      backend
        .upload(localPath, relPath)
        .catch((error) =>
          console.error(
            `[${backend.name}] 上传过程中发生异常 (${relPath}): ${error.message}`
          )
        )
    );

    await Promise.all(tasks);
  }
}

// 单例导出
const storageManager = new StorageManager();

module.exports = storageManager;


