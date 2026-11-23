<template>
  <div class="theory-container">
    <div class="header">
      <router-link to="/" class="back-home">
        <i class="fas fa-arrow-left"></i>
        返回首页
      </router-link>
      <h1>MPPS数字孪生临床诊疗系统使用说明</h1>
    </div>
    
    <div class="content">
      <div class="theory-section">
        <h2>系统页面功能描述</h2>
        <div class="page-description">
          <div class="description-item">
            <h3>理论知识</h3>
            <p>本模块提供盆底肌肉的详细解剖结构知识，包括：</p>
            <ul>
              <li>各肌肉组的位置和形态</li>
              <li>肌肉的主要功能和作用</li>
              <li>相关解剖结构的三维展示</li>
              <li>常见病理状态的描述</li>
            </ul>
          </div>

          <div class="description-item">
            <h3>15 通道压力信号</h3>
            <p>用于观察盆底模型触点对应的压力 ADC 信号：</p>
            <ul>
              <li>15 路压力数据实时显示</li>
              <li>固定 3 V 量程下的统一 ADC 标尺</li>
              <li>静置基线与按压阈值判断</li>
              <li>对应肌肉模型的实时高亮反馈</li>
            </ul>
          </div>

          <div class="description-item">
            <h3>基础学习</h3>
            <p>学习 15 个痛点和两个勿触区域：</p>
            <ul>
              <li>痛点与对应肌群、骨骼高亮</li>
              <li>解剖起点、终点和主要功能</li>
              <li>勿触区域文字警告</li>
              <li>文字弹窗替代当前语音播报</li>
            </ul>
          </div>

          <div class="description-item">
            <h3>准确性与全面性练习</h3>
            <p>按目标逐项练习按压和识别：</p>
            <ul>
              <li>随机给出痛点或勿触区域目标</li>
              <li>每题最多三次按压机会</li>
              <li>三次错误后显示正确答案</li>
              <li>全面性练习要求完成名称确认</li>
            </ul>
          </div>

          <div class="description-item">
            <h3>模拟考场</h3>
            <p>进行书面答案与按压位置综合测评：</p>
            <ul>
              <li>随机排列 15 个痛点考核题目</li>
              <li>考试过程中暂不显示答案正误</li>
              <li>每题三次按压机会</li>
              <li>结束后显示得分和误触记录</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Theory'
}
</script>

<style scoped>
.theory-container {
  min-height: calc(100vh - 66px);
  margin: 0;
  background: #f5f7fa;
}

.header {
  display: flex;
  align-items: center;
  margin-bottom: 0px;
  padding: 20px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.back-home {
  /* position: absolute;
  top: 35px;
  left: 40px; */
  display: flex;
  margin-right: 20px;
  align-items: center;
  text-align: center;
  text-decoration: none;
  color: #2c3e50;
  font-weight: bold;
  padding: 10px 15px;
  background: rgb(234, 234, 234);
  border-radius: 5px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
  z-index: 1000;
}

.back-home:hover {
  transform: translateY(-3px);
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.35);
}
.back-home i {
  font-size: 1.2em;
}

 h1 {
  margin: auto;
  color: #232425;
  font-size: 2em;
}

.content {
  width: 100%;
  margin: 0;
  padding: 20px;
}

.theory-section {
  width: 100%;
  background: white;
  padding: 30px;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  margin-bottom: 0px;
}

h2 {
  color: #2c3e50;
  margin-bottom: 20px;
}

p {
  color: #34495e;
  line-height: 1.6;
  margin-bottom: 20px;
}

ul {
  color: #34495e;
  padding-left: 20px;
}

li {
  margin-bottom: 10px;
  line-height: 1.6;
}

.page-description {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.description-item {
  background: #f8f9fa;
  padding: 20px;
  border-radius: 8px;
  border-left: 4px solid #4fafbc;
}

.description-item h3 {
  color: #2c3e50;
  margin-bottom: 15px;
  font-size: 1.3em;
}

.description-item p {
  color: #34495e;
  margin-bottom: 15px;
}

.description-item ul {
  list-style-type: none;
  padding-left: 0;
}

.description-item ul li {
  position: relative;
  padding-left: 20px;
  margin-bottom: 8px;
  line-height: 1.6;
}

.description-item ul li:before {
  content: "•";
  color: #4fafbc;
  position: absolute;
  left: 0;
  font-weight: bold;
}

@media (max-width: 768px) {
  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: 20px;
  }
  
  h1 {
    font-size: 1.5em;
  }

  .theory-section {
    padding: 20px;
  }
  
  .description-item {
    padding: 15px;
  }
}
</style> 
