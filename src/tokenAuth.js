const db = require('./db');

/**
 * Token认证中间件
 */
class TokenAuth {
  /**
   * 验证token中间件
   */
  async verifyToken(req, res, next) {
    try {
      // 从header中获取token
      const token = req.headers['x-api-token'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.token;

      if (!token) {
        return res.status(401).json({
          success: false,
          error: '缺少认证token，请在header中提供 X-API-Token 或 Authorization: Bearer <token>'
        });
      }

      // 验证token是否存在
      const tokenInfo = await db.getUserToken(token);
      if (!tokenInfo) {
        // 如果token不存在，自动创建
        await db.createOrUpdateUserToken(token);
        req.tokenInfo = await db.getUserToken(token);
      } else {
        req.tokenInfo = tokenInfo;
      }

      req.token = token;
      next();
    } catch (error) {
      console.error('Token验证失败:', error.message);
      res.status(500).json({
        success: false,
        error: 'Token验证失败: ' + error.message
      });
    }
  }

  /**
   * 可选的token验证（如果提供了token则验证，否则跳过）
   */
  async optionalVerifyToken(req, res, next) {
    try {
      const token = req.headers['x-api-token'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.token;

      if (token) {
        const tokenInfo = await db.getUserToken(token);
        if (!tokenInfo) {
          await db.createOrUpdateUserToken(token);
          req.tokenInfo = await db.getUserToken(token);
        } else {
          req.tokenInfo = tokenInfo;
        }
        req.token = token;
      }

      next();
    } catch (error) {
      console.error('可选Token验证失败:', error.message);
      next(); // 即使失败也继续
    }
  }
}

module.exports = new TokenAuth();
