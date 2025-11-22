const db = require('./db');

/**
 * 用户偏好学习服务
 * 负责处理用户反馈、更新偏好模型等
 */
class PreferenceService {
  constructor() {
    // 偏好权重：喜欢 +1，不喜欢 -1
    this.likeWeight = parseFloat(process.env.PREFERENCE_LIKE_WEIGHT) || 1.0;
    this.dislikeWeight = parseFloat(process.env.PREFERENCE_DISLIKE_WEIGHT) || -1.0;
  }

  /**
   * 从视频特征中提取偏好特征
   */
  extractFeaturesFromVideo(videoFeatures) {
    const features = {};
    
    if (!videoFeatures || typeof videoFeatures !== 'object') {
      return features;
    }

    // 提取各种特征
    if (videoFeatures.primary_scene_type) {
      features['scene_type'] = videoFeatures.primary_scene_type;
    }

    if (videoFeatures.primary_colors && videoFeatures.primary_colors.length > 0) {
      videoFeatures.primary_colors.forEach(color => {
        features[`color_${color}`] = color;
      });
    }

    if (videoFeatures.primary_styles && videoFeatures.primary_styles.length > 0) {
      videoFeatures.primary_styles.forEach(style => {
        features[`style_${style}`] = style;
      });
    }

    if (videoFeatures.top_tags && videoFeatures.top_tags.length > 0) {
      videoFeatures.top_tags.forEach(tag => {
        features[`tag_${tag}`] = tag;
      });
    }

    return features;
  }

  /**
   * 处理用户反馈（喜欢/不喜欢）
   */
  async processFeedback(aweme_id, feedbackType) {
    try {
      console.log(`处理用户反馈: ${aweme_id} - ${feedbackType}`);

      // 获取视频特征
      const videoFeatures = await db.getVideoFeatures(aweme_id);
      if (!videoFeatures || !videoFeatures.ai_features) {
        console.warn(`视频特征不存在: ${aweme_id}`);
        return false;
      }

      // 提取特征
      const features = this.extractFeaturesFromVideo(videoFeatures.ai_features);
      
      // 计算权重（喜欢为正，不喜欢为负）
      const weight = feedbackType === 'like' ? this.likeWeight : this.dislikeWeight;

      // 更新每个特征的偏好分数
      const updatePromises = Object.entries(features).map(([key, value]) => {
        return db.updateUserPreference(key, value, weight);
      });

      await Promise.all(updatePromises);

      console.log(`用户反馈处理完成: ${aweme_id} - ${feedbackType}`);
      console.log(`更新了 ${Object.keys(features).length} 个特征偏好`);

      return true;
    } catch (error) {
      console.error(`处理用户反馈失败:`, error.message);
      return false;
    }
  }

  /**
   * 批量处理用户反馈
   */
  async processBatchFeedback(feedbacks) {
    try {
      console.log(`批量处理用户反馈: ${feedbacks.length} 条`);

      const results = [];
      
      for (const feedback of feedbacks) {
        const { aweme_id, feedback_type } = feedback;
        const success = await this.processFeedback(aweme_id, feedback_type);
        results.push({
          aweme_id,
          feedback_type,
          success
        });
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`批量处理完成: 成功 ${successCount}/${feedbacks.length}`);

      return results;
    } catch (error) {
      console.error(`批量处理用户反馈失败:`, error.message);
      return [];
    }
  }

  /**
   * 获取视频推荐分数（用于排序）
   */
  async getVideoRecommendationScore(aweme_id) {
    try {
      return await db.calculateVideoPreferenceScore(aweme_id);
    } catch (error) {
      console.error(`获取推荐分数失败:`, error.message);
      return 0;
    }
  }

  /**
   * 获取用户偏好统计
   */
  async getUserPreferenceStats() {
    try {
      const preferences = await db.getUserPreferences();
      
      // 计算统计信息
      const stats = {
        total_features: preferences.length,
        liked_features: preferences.filter(p => p.preference_score > 0).length,
        disliked_features: preferences.filter(p => p.preference_score < 0).length,
        top_liked: preferences
          .filter(p => p.preference_score > 0)
          .sort((a, b) => b.preference_score - a.preference_score)
          .slice(0, 10),
        top_disliked: preferences
          .filter(p => p.preference_score < 0)
          .sort((a, b) => a.preference_score - b.preference_score)
          .slice(0, 10)
      };

      return stats;
    } catch (error) {
      console.error(`获取偏好统计失败:`, error.message);
      return null;
    }
  }
}

module.exports = new PreferenceService();



