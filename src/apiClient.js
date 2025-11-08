const axios = require('axios');
require('dotenv').config();

class ApiClient {
  constructor() {
    this.apiKey = process.env.API_KEY;
    this.baseUrl = process.env.API_BASE_URL || 'https://api.tikhub.io/api/v1/douyin/app/v3';
    
    // 创建axios实例
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
  }

  /**
   * 获取用户发布的作品
   * @param {string} secUserId - 用户sec_user_id
   * @param {number} maxCursor - 游标，用于翻页
   * @param {number} count - 获取数量
   * @param {number} sortType - 排序类型
   * @returns {Promise} API响应
   */
  async getUserPosts(secUserId, maxCursor = 0, count = 20, sortType = 0) {
    try {
      const response = await this.client.get('/fetch_user_post_videos', {
        params: {
          sec_user_id: secUserId,
          max_cursor: maxCursor,
          count: count,
          sort_type: sortType
        },
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.data;
    } catch (error) {
      console.error(`获取用户作品失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取用户点赞的作品
   * @param {string} secUserId - 用户sec_user_id
   * @param {number} maxCursor - 游标，用于翻页
   * @param {number} counts - 获取数量
   * @returns {Promise} API响应
   */
  async getUserLikes(secUserId, maxCursor = 0, counts = 20) {
    try {
      const response = await this.client.get('/fetch_user_like_videos', {
        params: {
          sec_user_id: secUserId,
          max_cursor: maxCursor,
          counts: counts
        },
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      return response.data;
    } catch (error) {
      console.error(`获取用户点赞作品失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 根据监控类型获取用户作品
   * @param {object} user - 用户配置对象
   * @param {object} settings - 全局设置
   * @returns {Promise} API响应
   */
  async fetchUserContent(user, settings) {
    const { sec_user_id, monitor_type, max_cursor } = user;
    const { page_size, sort_type } = settings;
    
    if (monitor_type === 'posts') {
      return this.getUserPosts(sec_user_id, max_cursor, page_size, sort_type);
    } else if (monitor_type === 'likes') {
      return this.getUserLikes(sec_user_id, max_cursor, page_size);
    } else {
      throw new Error(`未知的监控类型: ${monitor_type}`);
    }
  }
}

module.exports = new ApiClient();