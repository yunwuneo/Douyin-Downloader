const db = require('./db');
const vectorStore = require('./vectorStore');
const aiAnalyzer = require('./aiAnalyzer');

/**
 * 用户偏好学习服务
 * 负责处理用户反馈、更新偏好模型等
 */
class PreferenceService {
  constructor() {
    // 偏好权重：喜欢 +1，不喜欢 -1
    this.likeWeight = parseFloat(process.env.PREFERENCE_LIKE_WEIGHT) || 1.0;
    this.dislikeWeight = parseFloat(process.env.PREFERENCE_DISLIKE_WEIGHT) || -1.0;
    
    // 向量推荐权重 (0-1)，剩余为标签权重
    this.vectorWeight = parseFloat(process.env.PREFERENCE_VECTOR_WEIGHT) || 0.7;
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

      // ========== 向量数据库更新 ==========
      if (feedbackType === 'like') {
        try {
          // 获取视频向量
          const videoVector = await vectorStore.getVector(aweme_id);
          if (videoVector) {
            console.log(`更新用户向量画像 (基于 ${aweme_id})`);
            await vectorStore.updateUserProfile(videoVector);
          } else {
            // 如果向量不存在，尝试生成（这可能比较慢，但在异步任务中也许可以接受）
            // 这里为了响应速度，暂时跳过或记录日志
            console.warn(`视频向量不存在，无法更新向量画像: ${aweme_id}`);
            // TODO: 可以触发后台任务生成向量
          }
        } catch (vecError) {
          console.error(`更新向量画像失败:`, vecError.message);
        }
      }

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
      // 1. 获取标签基础分数
      const tagScore = await db.calculateVideoPreferenceScore(aweme_id);
      
      // 2. 获取向量相似度分数
      let vectorScore = 0;
      try {
        const userVector = await vectorStore.getUserProfileVector();
        const videoVector = await vectorStore.getVector(aweme_id);
        
        if (userVector && videoVector) {
          const similarity = aiAnalyzer.cosineSimilarity(userVector, videoVector);
          // 将相似度 (-1 到 1) 映射到分数 (比如 0 到 10，或者保持 -1 到 1)
          // 假设 tagScore 大约是 0-10 范围 (根据权重和log(count))
          // 我们可以将相似度归一化到类似范围，或者只是加权
          vectorScore = similarity; // -1 to 1
        }
      } catch (vecError) {
        console.warn(`获取向量分数失败:`, vecError.message);
      }

      // 3. 混合分数
      // tagScore 通常是 > 0 的累加值。我们需要知道它的量级。
      // 假设 tagScore 是 "匹配数 * 权重"。
      
      // 如果没有向量数据，回退到纯标签
      if (vectorScore === 0) return tagScore;

      // 混合策略：
      // 将 vectorScore 映射到 0-10 (假设)
      const normalizedVectorScore = (vectorScore + 1) * 5; // 0 to 10
      
      // 简单加权
      // 这里的混合逻辑可能需要调优
      return (tagScore * (1 - this.vectorWeight)) + (normalizedVectorScore * this.vectorWeight);
      
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



