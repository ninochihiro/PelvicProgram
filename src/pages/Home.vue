<script setup>
import { computed, onMounted, ref } from 'vue'
import { authState, getNetworkInfo } from '../utils/authClient'

const trainingModules = [
  {
    step: '01',
    mode: 'learning',
    title: '基础学习',
    code: 'LRN',
    tag: '认识结构与位置',
    description: '建立盆底肌、痛点与勿触区域的完整解剖认知。',
    outcome: '适合首次使用与设备调试后进入'
  },
  {
    step: '02',
    mode: 'intensive',
    title: '准确性训练',
    code: 'ACC',
    tag: '单目标反复校准',
    description: '按系统目标完成痛点、肌群或勿触区域定位。',
    outcome: '每题三次机会，错误后显示标准答案'
  },
  {
    step: '03',
    mode: 'comprehensive',
    title: '全面性训练',
    code: 'CMP',
    tag: '完整检查流程',
    description: '覆盖 15 个痛点和 2 个勿触区域，并完成名称确认。',
    outcome: '实时显示已完成数量与遗漏项'
  },
  {
    step: '04',
    mode: 'exam',
    title: '模拟考场',
    code: 'EXM',
    tag: '综合能力测评',
    description: '随机完成书面判断与按压定位，考试中不提前显示答案。',
    outcome: '提交后输出分数、错题与误触记录'
  }
]

const preparationModules = [
  {
    title: '使用说明',
    code: 'DOC',
    description: '了解系统分区、训练顺序和设备准备要求。',
    to: '/begin'
  },
  {
    title: '理论知识',
    code: '3D',
    description: '通过 3D 模型查看肌肉、骨骼及其解剖信息。',
    to: '/theory'
  }
]

const toolModules = [
  {
    title: '15 通道压力可视化',
    code: 'ADC',
    description: '检查电极分布、通道数值、基线与数据帧状态。',
    to: '/sensor',
    tag: '设备校准'
  },
  {
    title: '信号与模型测试',
    code: 'SIG',
    description: '查看实时波形并验证通道到模型的映射关系。',
    to: '/test',
    tag: '开发诊断'
  }
]

const visibleToolModules = computed(() =>
  authState.user?.role === 'admin'
    ? toolModules
    : toolModules.filter((item) => item.to !== '/test')
)

const lanAddresses = ref([])

onMounted(async () => {
  try {
    const info = await getNetworkInfo()
    lanAddresses.value = (info.addresses ?? []).map(
      (address) => `http://${address}:${info.ports.frontend}`
    )
  } catch {
    lanAddresses.value = []
  }
})
</script>

<template>
  <div class="home-page">
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">MPPS PELVIC TRAINING WORKSPACE</span>
        <h1>盆底肌数字训练系统</h1>
        <p>
          从解剖学习、设备校准到准确性训练、全面性训练与模拟考核，
          按照统一路径完成盆底肌触诊能力培养。
        </p>
        <div class="hero-actions">
          <RouterLink
            :to="{ path: '/training', query: { mode: 'learning' } }"
            class="primary-action"
          >
            开始基础学习
          </RouterLink>
          <RouterLink to="/sensor" class="secondary-action">
            检查设备状态
          </RouterLink>
        </div>
        <div class="hero-badges">
          <span>15 个痛点</span>
          <span>2 个勿触区域</span>
          <span>固定 3 V 量程</span>
          <span>文字提示模式</span>
        </div>
        <p v-if="lanAddresses.length" class="lan-address">
          局域网访问：
          <a :href="lanAddresses[0]" target="_blank" rel="noreferrer">
            {{ lanAddresses[0] }}
          </a>
        </p>
      </div>

      <aside class="workflow-summary">
        <div class="summary-heading">
          <span>标准使用路径</span>
          <strong>建议按顺序完成</strong>
        </div>
        <ol>
          <li>
            <b>01</b>
            <div>
              <strong>连接并校准设备</strong>
              <small>选择串口，保持静置并采集基线</small>
            </div>
          </li>
          <li>
            <b>02</b>
            <div>
              <strong>完成基础学习</strong>
              <small>确认痛点、肌群和勿触区位置</small>
            </div>
          </li>
          <li>
            <b>03</b>
            <div>
              <strong>进入训练</strong>
              <small>先准确性，再全面性</small>
            </div>
          </li>
          <li>
            <b>04</b>
            <div>
              <strong>参加模拟考场</strong>
              <small>查看得分、错题和误触记录</small>
            </div>
          </li>
        </ol>
      </aside>
    </section>

    <section class="module-section">
      <header class="section-heading">
        <div>
          <span>01 · TRAINING PATH</span>
          <h2>训练与考核路径</h2>
        </div>
        <p>四个模块按能力递进组织，每次只聚焦当前训练目标。</p>
      </header>

      <div class="training-grid">
        <RouterLink
          v-for="module in trainingModules"
          :key="module.mode"
          :to="{ path: '/training', query: { mode: module.mode } }"
          class="training-card"
        >
          <div class="card-top">
            <span class="step-number">{{ module.step }}</span>
            <span class="card-tag">{{ module.tag }}</span>
          </div>
          <div class="module-code" aria-hidden="true">{{ module.code }}</div>
          <h3>{{ module.title }}</h3>
          <p>{{ module.description }}</p>
          <small>{{ module.outcome }}</small>
          <span class="card-action">进入模块 <b>→</b></span>
        </RouterLink>
      </div>
    </section>

    <section class="support-grid">
      <article class="support-section">
        <header class="section-heading compact">
          <div>
            <span>02 · PREPARATION</span>
            <h2>学习准备</h2>
          </div>
        </header>
        <div class="compact-links">
          <RouterLink
            v-for="item in preparationModules"
            :key="item.to"
            :to="item.to"
            class="compact-link"
          >
            <span class="compact-icon" aria-hidden="true">{{ item.code }}</span>
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.description }}</p>
            </div>
            <b>→</b>
          </RouterLink>
        </div>
      </article>

      <article class="support-section">
        <header class="section-heading compact">
          <div>
            <span>03 · DEVICE TOOLS</span>
            <h2>设备与信号工具</h2>
          </div>
        </header>
        <div class="compact-links">
          <RouterLink
            v-for="item in visibleToolModules"
            :key="item.to"
            :to="item.to"
            class="compact-link"
          >
            <span class="compact-icon" aria-hidden="true">{{ item.code }}</span>
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.description }}</p>
            </div>
            <small>{{ item.tag }}</small>
          </RouterLink>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  min-height: calc(100vh - 66px);
  padding: 24px clamp(18px, 3vw, 42px) 44px;
  overflow-x: hidden;
  color: #172839;
  background:
    radial-gradient(circle at 8% 4%, rgba(70, 191, 170, 0.12), transparent 25%),
    radial-gradient(circle at 92% 12%, rgba(81, 143, 219, 0.1), transparent 28%),
    #eef3f7;
}

.hero,
.module-section,
.support-section {
  width: min(1420px, 100%);
  margin-inline: auto;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(330px, 0.72fr);
  gap: 22px;
  padding: clamp(26px, 4vw, 46px);
  overflow: hidden;
  border-radius: 26px;
  color: #f5fbff;
  background:
    radial-gradient(circle at 82% 20%, rgba(64, 218, 186, 0.2), transparent 32%),
    linear-gradient(128deg, #0d2136, #174c5d);
  box-shadow: 0 22px 52px rgba(22, 51, 76, 0.18);
}

.eyebrow,
.section-heading span,
.summary-heading span {
  color: #5ce2c1;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.16em;
}

.hero h1 {
  margin: 10px 0 12px;
  font-size: clamp(34px, 4.2vw, 58px);
  line-height: 1.08;
  letter-spacing: -0.045em;
}

.hero-copy > p {
  max-width: 760px;
  margin: 0;
  color: #b8cfdd;
  font-size: 16px;
  line-height: 1.85;
}

.hero-copy,
.workflow-summary {
  min-width: 0;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  min-height: 42px;
  padding: 0 18px;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
}

.primary-action {
  color: #07261f;
  background: #5ce2c1;
}

.secondary-action {
  color: #e5f1f8;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
}

.hero-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 20px;
}

.hero-badges span {
  padding: 6px 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: #acc4d3;
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
}

.lan-address {
  margin: 13px 0 0;
  color: #9fb8c8;
  font-size: 11px;
}

.lan-address a {
  color: #68e0c4;
  text-decoration: none;
}

.workflow-summary {
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 19px;
  background: rgba(4, 20, 30, 0.28);
  backdrop-filter: blur(12px);
}

.summary-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.summary-heading strong {
  color: #dbeaef;
  font-size: 12px;
}

.workflow-summary ol {
  display: grid;
  gap: 8px;
  margin: 15px 0 0;
  padding: 0;
  list-style: none;
}

.workflow-summary li {
  display: grid;
  grid-template-columns: 32px 1fr;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.055);
}

.workflow-summary li b {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: #062b24;
  background: #5ce2c1;
  font-size: 10px;
}

.workflow-summary li strong,
.workflow-summary li small {
  display: block;
}

.workflow-summary li strong {
  font-size: 13px;
}

.workflow-summary li small {
  margin-top: 2px;
  color: #97afbe;
  font-size: 11px;
  line-height: 1.45;
}

.module-section {
  margin-top: 28px;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 14px;
  padding: 0 3px;
}

.section-heading span {
  color: #398e7c;
}

.section-heading h2 {
  margin: 5px 0 0;
  font-size: 29px;
  letter-spacing: -0.03em;
}

.section-heading p {
  max-width: 500px;
  margin: 0;
  color: #718598;
  font-size: 13px;
  text-align: right;
}

.training-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.training-card {
  position: relative;
  display: flex;
  min-height: 300px;
  flex-direction: column;
  padding: 19px;
  overflow: hidden;
  border: 1px solid rgba(49, 80, 109, 0.1);
  border-radius: 19px;
  color: #1d3345;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 13px 30px rgba(35, 62, 87, 0.08);
  text-decoration: none;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.training-card::after {
  position: absolute;
  right: -42px;
  bottom: -50px;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(88, 220, 189, 0.16), transparent 68%);
  content: "";
}

.training-card:hover {
  z-index: 2;
  border-color: rgba(49, 185, 155, 0.45);
  box-shadow: 0 20px 42px rgba(31, 77, 90, 0.14);
  transform: translateY(-4px);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.step-number {
  color: #15927a;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.1em;
}

.card-tag {
  padding: 5px 7px;
  border-radius: 999px;
  color: #557083;
  background: #edf3f6;
  font-size: 11px;
  font-weight: 800;
}

.module-code {
  display: grid;
  place-items: center;
  width: 54px;
  height: 35px;
  margin-top: 22px;
  border: 1px solid #cfe1df;
  border-radius: 7px;
  color: #1b7164;
  background: #edf7f4;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.training-card h3 {
  margin: 13px 0 7px;
  font-size: 22px;
}

.training-card p {
  margin: 0;
  color: #607689;
  font-size: 13px;
  line-height: 1.7;
}

.training-card > small {
  margin-top: 10px;
  color: #8a9cab;
  font-size: 11px;
  line-height: 1.6;
}

.card-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 17px;
  color: #137f6b;
  font-size: 12px;
  font-weight: 900;
}

.card-action b {
  font-size: 16px;
}

.support-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  width: min(1420px, 100%);
  margin: 28px auto 0;
}

.support-section {
  padding: 19px;
  border: 1px solid rgba(49, 80, 109, 0.1);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 12px 28px rgba(35, 62, 87, 0.07);
}

.section-heading.compact {
  align-items: flex-start;
  margin-bottom: 12px;
}

.section-heading.compact h2 {
  font-size: 22px;
}

.compact-links {
  display: grid;
  gap: 8px;
}

.compact-link {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 11px;
  border: 1px solid #e4ebf0;
  border-radius: 13px;
  color: #263c4e;
  background: #f8fafb;
  text-decoration: none;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.compact-link:hover {
  border-color: #99ddcc;
  background: #f1fbf8;
}

.compact-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: #e8f2f3;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.04em;
}

.compact-link strong {
  font-size: 14px;
}

.compact-link p {
  margin: 3px 0 0;
  color: #718496;
  font-size: 11px;
  line-height: 1.55;
}

.compact-link > b,
.compact-link > small {
  color: #168b73;
  font-size: 11px;
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .training-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .home-page {
    padding: 14px;
  }

  .hero {
    padding: 24px 20px;
    border-radius: 20px;
  }

  .hero h1 {
    font-size: 36px;
  }

  .summary-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .training-grid,
  .support-grid {
    grid-template-columns: 1fr;
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .section-heading p {
    text-align: left;
  }
}
</style>
