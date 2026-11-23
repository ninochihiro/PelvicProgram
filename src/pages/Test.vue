<template>
  <div class="test-container">
    <!-- 添加返回按钮 -->
    <router-link to="/" class="back-home">
      <i class="fas fa-arrow-left"></i>
      返回首页
    </router-link>
    
    <!-- 左侧串口波形显示区域 -->
    <div class="waveform-section">
      <div class="control-panel">
        <h2>肌肉信号测试</h2>
        <div class="serial-controls">
          <select v-model="selectedPortPath" @change="handlePortChange">
            <option :value="null">选择串口</option>
            <option v-for="port in availablePorts" 
                    :key="port.path" 
                    :value="port.path">
              {{ port.friendlyName || port.path }} {{ isVirtualPort(port.path) ? '(虚拟)' : '' }}
            </option>
          </select>
          <button @click="refreshPorts" class="refresh-btn">
            刷新
          </button>
          <button 
            @click="toggleConnection"
            :class="isConnected ? 'connected' : 'disconnected'">
            {{ isConnected ? '断开连接' : '连接' }}
          </button>
        </div>
        <div class="channel-controls">
          <div class="channel-group">
            <div v-for="i in channelCount" :key="i" class="channel-item">
              <div class="channel-header">
                <!-- <span class="channel-name">通道{{ i }} - {{ medicalInfo[channelMuscleMap[i-1][0]]?.title.replace(/（左）|（右）/, '') }}</span> -->
                  
                <div class="channel-color" :style="{ backgroundColor: channelColors[i-1] }"></div>
                <span class="channel-name">{{ medicalInfo[channelMuscleMap[i-1][0]]?.title}}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- 七个通道的波形图表 -->
      <div class="charts-container">
        <div v-for="(chart, index) in charts" :key="index" 
             :ref="`chart${index}`" 
             class="chart-item">
        </div>
      </div>
    </div>
    
    <!-- 右侧3D模型显示区域 -->
    <div class="model-section">
      <div class="model-content">
        <h2>盆底肌肉模型</h2>
        <p class="model-description">这里将显示盆底肌肉的3D模型，通过串口连接后按压相应肌肉位置进行信号测试</p>
        <!-- 添加模型容器 -->
        <div ref="modelContainer" class="model-container"></div>
        <div class="model-controls">
          <p>功能说明：</p>
          <ul>
            <li>⚪点击模型相应肌肉或骨骼位置可查看详细信息</li>
            <li>⚪连接串口后，可按压相应痛点位置进行信号测试</li>
            <li>⚪左键：旋转视角、右键：平移视角、滚轮：缩放模型</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as echarts from 'echarts';
import { shallowRef } from 'vue';
import { createSerialSocket } from '../utils/serialSocket';
import { CHANNEL_COUNT, parseSerialFrame } from '../utils/serialProtocol';

export default {
  name: 'Test',
  data() {
    return {
      scene: shallowRef(null),
      camera: shallowRef(null),
      renderer: shallowRef(null),
      controls: shallowRef(null),
      modelGroup: shallowRef(null),
      nodeList: [],
      selectedNode: null,
      initialY: 0,
      categories: {},
      animationFrameId: null,
      
      ws: null,
      availablePorts: [],
      selectedPortPath: null,
      isConnected: false,
      
      charts: new Array(CHANNEL_COUNT).fill(null),
      chartOptions: [],
      channelCount: CHANNEL_COUNT,
      dataBuffer: Array(CHANNEL_COUNT).fill().map(() => []),
      maxDataPoints: 100,
      receivedData: [], // 用于存储接收到的数据
      maxLogLines: 100, // 最多显示的日志行数
      channelColors: [
        '#0000ff', '#ff0000', '#009900', '#ff9900',  // 通道1-4
        '#cc00cc', '#00cccc', '#cc6600', '#0066cc',  // 通道5-8
        '#cc0066', '#00cc66', '#6600cc', '#cc6600',  // 通道9-12
        '#0066cc', '#cc0066', '#00cc66', '#6600cc'   // 通道13-16
      ],

      // 添加医学信息数据
      medicalInfo: {
        // 肌肉部分
        'pubococcygeus_R': {
          title: '耻骨尾骨肌（右）',
          description: '耻骨尾骨肌是盆底肌群的重要组成部分，从耻骨延伸至尾骨。它是维持盆底功能的关键肌肉之一。',
          functions: ['支持盆底器官', '维持盆腔内压', '参与排尿控制']
        },
        'pubococcygeus_L': {
          title: '耻骨尾骨肌（左）',
          description: '耻骨尾骨肌是盆底肌群的重要组成部分，从耻骨延伸至尾骨。它是维持盆底功能的关键肌肉之一。',
          functions: ['支持盆底器官', '维持盆腔内压', '参与排尿控制']
        },
        'puborectalis_R': {
          title: '耻骨直肠肌（右）',
          description: '耻骨直肠肌呈U形环绕直肠，是维持大便控制的重要肌肉。',
          functions: ['维持肛门持续收缩', '参与排便控制', '支持盆底器官']
        },
        'puborectalis_L': {
          title: '耻骨直肠肌（左）',
          description: '耻骨直肠肌呈U形环绕直肠，是维持大便控制的重要肌肉。',
          functions: ['维持肛门持续收缩', '参与排便控制', '支持盆底器官']
        },
        'iliococcygeus_R': {
          title: '髂尾肌（右）',
          description: '髂尾肌是盆底后部的扁平肌肉，从髂骨延伸至尾骨。',
          functions: ['支持盆底后部', '维持盆腔器官位置', '协助盆底功能']
        },
        'iliococcygeus_L': {
          title: '髂尾肌（左）',
          description: '髂尾肌是盆底后部的扁平肌肉，从髂骨延伸至尾骨。',
          functions: ['支持盆底后部', '维持盆腔器官位置', '协助盆底功能']
        },
        'ischiococcygeus_R': {
          title: '坐骨肌（右）',
          description: '坐骨尾肌是一对小而扁平的肌肉，位于盆腔后外侧。',
          functions: ['稳定尾骨', '支持盆底后部', '协助盆底功能']
        },
        'ischiococcygeus_L': {
          title: '坐骨肌（左）',
          description: '坐骨尾肌是一对小而扁平的肌肉，位于盆腔后外侧。',
          functions: ['稳定尾骨', '支持盆底后部', '协助盆底功能']
        },
        'internus_R': {
          title: '闭孔内肌（右）',
          description: '闭孔内肌是深层髋关节肌肉，覆盖在闭孔膜的内侧。',
          functions: ['外旋髋关节', '稳定髋关节', '协助髋关节运动']
        },
        'internus_L': {
          title: '闭孔内肌（左）',
          description: '闭孔内肌是深层髋关节肌肉，覆盖在闭孔膜的内侧。',
          functions: ['外旋髋关节', '稳定髋关节', '协助髋关节运动']
        },
        'piriformis_R': {
          title: '梨状肌（右）',
          description: '梨状肌是一个梨形的肌肉，从骶骨延伸至股骨大转子。',
          functions: ['外旋髋关节', '外展髋关节', '稳定骶髂关节']
        },
        'piriformis_L': {
          title: '梨状肌（左）',
          description: '梨状肌是一个梨形的肌肉，从骶骨延伸至股骨大转子。',
          functions: ['外旋髋关节', '外展髋关节', '稳定骶髂关节']
        },

        // 骨骼部分
        'Sacrum': {
          title: '骶骨',
          description: '骶骨是脊柱的一部分，由5块骶椎融合而成的三角形骨骼。',
          functions: ['传递上身重量至骨盆', '保护骶神经', '与髂骨形成骶髂关节']
        },
        'Coccyx': {
          title: '尾骨',
          description: '尾骨是脊柱的一部分，由4块尾椎融合而成的三角形骨骼。',
          functions: ['尾骨（Coccyx） 是脊柱的最末端部分，由 3-5 块融合的尾椎组成，']
        },
        'Femur_R': {
          title: '股骨（右）',
          description: '股骨是人体最长、最大的长骨，位于大腿部位。',
          functions: ['支撑体重', '提供肌肉附着点', '参与下肢运动']
        },
        'Femur_L': {
          title: '股骨（左）',
          description: '股骨是人体最长、最大的长骨，位于大腿部位。',
          functions: ['支撑体重', '提供肌肉附着点', '参与下肢运动']
        },
        'Ilium_R': {
          title: '髂骨（右）',
          description: '髂骨是骨盆的上部，呈扇形，是骨盆的最大组成部分。',
          functions: ['支撑腹部器官', '提供肌肉附着点', '形成髋关节的一部分']
        },
        'Ilium_L': {
          title: '髂骨（左）',
          description: '髂骨是骨盆的上部，呈扇形，是骨盆的最大组成部分。',
          functions: ['支撑腹部器官', '提供肌肉附着点', '形成髋关节的一部分']
        },
        'Ischium_R': {
          title: '坐骨（右）',
          description: '坐骨位于骨盆下部后方，是人体承重时坐姿的主要支撑点。',
          functions: ['支撑坐位时的体重', '提供肌肉附着点', '形成髋关节的一部分']
        },
        'Ischium_L': {
          title: '坐骨（左）',
          description: '坐骨位于骨盆下部后方，是人体承重时坐姿的主要支撑点。',
          functions: ['支撑坐位时的体重', '提供肌肉附着点', '形成髋关节的一部分']
        },
        'Pubis_R': {
          title: '耻骨（右）',
          description: '耻骨位于骨盆前下方，与对侧耻骨相连形成耻骨联合。',
          functions: ['连接左右骨盆', '提供盆底肌群附着点', '保护膀胱和生殖器官']
        },
        'Pubis_L': {
          title: '耻骨（左）',
          description: '耻骨位于骨盆前下方，与对侧耻骨相连形成耻骨联合。',
          functions: ['连接左右骨盆', '提供盆底肌群附着点', '保护膀胱和生殖器官']
        },
        'Vertebra': {
          title: '椎骨',
          description: '椎骨是构成脊柱的骨性结构单位，具有保护脊髓和支撑躯干的功能。',
          functions: ['保护脊髓', '支撑躯干', '提供脊柱活动度']
        }
      },

      // 添加通道对应的肌肉名称映射
      // 添加通道对应的肌肉名称映射
      channelMuscleMap: {
        0: ['piriformis_L'], //梨状肌
        1: ['ischiococcygeus_L'], //坐骨尾骨肌
        2: ['iliococcygeus_L'], //髂尾肌
        3: ['internus_L'], //闭孔内肌
        4: ['puborectalis_L'], //耻骨直肠肌
        5: ['pubococcygeus_L'], //耻骨尾骨肌
        6: ['Ischium_L'], //坐骨棘
        7: ['Coccyx'], //尾骨
        8: ['piriformis_R'], //梨状肌
        9: ['ischiococcygeus_R'], //坐骨尾骨肌
        10: ['iliococcygeus_R'], //髂尾肌
        11: ['internus_R'], //闭孔内肌
        12: ['puborectalis_R'], //耻骨直肠肌
        13: ['pubococcygeus_R'], //耻骨尾骨肌
        14: ['Ischium_R'] //坐骨棘
      },
      
      // 添加通道基线阈值
      channelThresholds: Array(CHANNEL_COUNT).fill(1200),
      
      // 存储高亮状态的定时器
      highlightTimers: {},
    }
  },
  async mounted() {
    try {
      console.log('组件挂载，初始化...');
      
      // 等待 DOM 渲染完成
      await this.$nextTick();
      
      // 初始化场景
      await this.initScene();
      
      // 初始化控制面板
      this.initControlPanel();
      
      // 加载模型
      await this.loadModel();
      
      // 初始化图表
      await this.$nextTick();
      this.initCharts();
      
      // 开始动画循环
      this.animate();
      
      // 初始化 WebSocket
      await this.initWebSocket();
      
      // 添加窗口调整监听
      window.addEventListener('resize', this.onWindowResize);

      // 添加鼠标点击事件监听
      window.addEventListener('click', this.onMouseClick);
    } catch (error) {
      console.error('mounted 钩子中出错:', error);
    }
  },
  beforeUnmount() {
    // 移除事件监听器
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('click', this.onMouseClick);

    // 停止动画循环
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // 清理WebSocket连接
    if (this.ws) {
      this.ws.close();
    }

    // 清理图表
    this.charts.forEach(chart => {
      if (chart) {
        chart.dispose();
      }
    });

    // 清理Three.js资源
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }

    // 清理控制面板
    const controlPanel = document.querySelector('#model-info')?.parentNode;
    if (controlPanel) {
      document.body.removeChild(controlPanel);
    }
  },
  methods: {
    handlePortChange() {
        console.log('选择的串口:', this.selectedPortPath);
    },

    toggleConnection() {
        console.log('点击按钮，当前状态:', {
            isConnected: this.isConnected,
            selectedPort: this.selectedPortPath,
            wsState: this.ws?.readyState
        });

        if (this.isConnected) {
            this.disconnectPort();
        } else {
            this.connectPort();
        }
    },

    async connectPort() {
        if (!this.selectedPortPath) {
            alert('请先选择串口');
            return;
        }
        
        if (!this.ws) {
            console.error('WebSocket 未初始化');
            return;
        }

        if (this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket 未连接，当前状态:', this.ws.readyState);
            // 尝试重新连接 WebSocket
            await this.initWebSocket();
            return;
        }

        console.log('发送连接请求:', {
            type: 'connect',
            port: this.selectedPortPath
        });

        this.ws.send(JSON.stringify({
            type: 'connect',
            port: this.selectedPortPath
        }));
    },

    async disconnectPort() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket 未连接');
            return;
        }

        console.log('发送断开连接请求');
        this.ws.send(JSON.stringify({
            type: 'disconnect'
        }));
    },

    async initWebSocket() {
        try {
            if (this.ws) {
                this.ws.close();
            }

            console.log('初始化 WebSocket 连接...');
            this.ws = createSerialSocket();
            
            this.ws.onopen = () => {
                console.log('WebSocket 连接成功');
                this.listPorts();
            };

            this.ws.onmessage = (event) => {
                try {
                    console.log('收到WebSocket数据:', event.data);
                    
                    // 解析JSON消息
                    const message = JSON.parse(event.data);
                    console.log('解析后的消息:', message);

                    switch (message.type) {
                        case 'data':
                            // 处理数据消息
                            const frame = parseSerialFrame(message.data);
                            if (!frame) {
                              console.warn('无效串口帧:', message.data);
                              break;
                            }
                            const values = frame.values;
                            console.log('解析后的数值数组:', values);
                            
                            if (values) {
                                console.log('开始处理传感器数据...');
                                // 更新每个通道的数据
                                for (let i = 0; i < this.channelCount; i++) {
                                    if (!isNaN(values[i])) {
                                        // 添加新数据到缓冲区
                                        this.dataBuffer[i].push(values[i]);
                                        
                                        // 维护数据缓冲区大小
                                        if (this.dataBuffer[i].length > this.maxDataPoints) {
                                            this.dataBuffer[i].shift();
                                        }
                                        
                                        // 固定 3V 档下按压会使 ADC 升高
                                        if (values[i] >= this.channelThresholds[i]) {
                                            const muscleNames = this.channelMuscleMap[i];
                                            if (muscleNames) {
                                                // 使用通道对应的颜色
                                                const color = this.channelColors[i];
                                                this.highlightMuscle(muscleNames, 3000, color);
                                            }
                                        }
                                        
                                        // 更新图表
                                        this.updateChart(i);
                                    }
                                }
                                console.log('传感器数据处理完成');
                            }
                            break;

                        case 'ports-list':
                            this.availablePorts = message.ports;
                            break;
                        case 'connect-success':
                            this.isConnected = true;
                            break;
                        case 'disconnect-success':
                            this.isConnected = false;
                            break;
                        case 'error':
                            console.error('串口错误:', message.error);
                            alert('串口错误: ' + message.error);
                            break;
                        default:
                            console.log('未处理的消息类型:', message.type);
                    }
                } catch (error) {
                    console.error('处理 WebSocket 消息失败:', error, '原始数据:', event.data);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket 错误:', error);
            };

            this.ws.onclose = () => {
                console.log('WebSocket 连接关闭');
                this.isConnected = false;
                setTimeout(() => this.initWebSocket(), 3000);
            };
        } catch (error) {
            console.error('WebSocket 初始化失败:', error);
        }
    },

    async listPorts() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'list-ports'
        }));
      }
    },

    initCharts() {
      try {
        console.log('开始初始化图表...');
        
        for (let i = 0; i < this.channelCount; i++) {
          const chartRefs = this.$refs[`chart${i}`];
          if (!chartRefs || !chartRefs[0]) {
            console.warn(`图表 ${i + 1} 的 DOM 元素未找到`);
            continue;
          }

          const chartDom = chartRefs[0];
          console.log(`初始化图表 ${i + 1} 的DOM元素:`, chartDom);
          
          this.charts[i] = echarts.init(chartDom);
          console.log(`图表 ${i + 1} 初始化成功`);

          const option = {
            grid: {
              top: 25,
              left: 60,
              right: 20,
              bottom: 25,
            },
            xAxis: {
              type: 'category',
              boundaryGap: false,
              data: Array.from({ length: this.maxDataPoints }, (_, i) => i),
              show: true,
              axisLabel: {
                show: true,
                fontSize: 10
              }
            },
            yAxis: {
              type: 'value',
              scale: true,
              min: 0,
              max: 10000,
              splitLine: { show: true },
              axisLabel: {
                show: true,
                fontSize: 10,
                margin: 10,
                formatter: function(value) {
                  return value.toFixed(0);
                }
              },
              axisLine: {
                show: true
              },
              axisTick: {
                show: true
              }
            },
            series: [{
              data: this.dataBuffer[i],
              type: 'line',
              smooth: false,
              showSymbol: false,
              animation: false,
              lineStyle: {
                width: 2,
                color: this.channelColors[i]
              }
            }]
          };
          
          this.chartOptions[i] = option;
          this.charts[i].setOption(option);
          console.log(`图表 ${i + 1} 配置完成`);
        }
        
        console.log('所有图表初始化完成');
      } catch (error) {
        console.error('图表初始化错误:', error);
      }
    },

    updateChart(index) {
        if (this.charts[index]) {
            console.log(`更新图表 ${index + 1}，数据长度:`, this.dataBuffer[index].length);
            const option = {
                series: [{
                    data: this.dataBuffer[index],
                    type: 'line',
                    smooth: false,
                    showSymbol: false,
                    animation: false,
                    lineStyle: {
                        width: 2,
                        color: this.channelColors[index]
                    }
                }]
            };
            
            try {
                this.charts[index].setOption(option, {
                    notMerge: false,
                    lazyUpdate: true,
                    silent: true
                });
                console.log(`图表 ${index + 1} 更新成功`);
            } catch (error) {
                console.error(`更新图表 ${index + 1} 失败:`, error);
            }
        } else {
            console.warn(`图表 ${index + 1} 未初始化`);
        }
    },

    async initScene() {
      try {
        // 1. 获取容器并检查
        const container = this.$refs.modelContainer;
        if (!container) {
          throw new Error('Container not found');
        }

        // 2. 获取尺寸
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;

        // 3. 创建场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);
        console.log('场景创建成功');

        // 4. 创建相机
        this.camera = new THREE.PerspectiveCamera(
          30,             // fov
          width / height, // aspect
          1,             // near
          3000           // far
        );    
        this.camera.position.set(0, 200, 200); // 将相机放在z轴正方向
        this.camera.lookAt(0, 0, 0);
        console.log('相机创建成功');

        // 5. 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ 
          antialias: true,
          alpha: true 
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0xffffff, 1);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // 清除之前的canvas（如果存在）
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        container.appendChild(this.renderer.domElement);
        console.log('渲染器创建成功');

        // 6. 创建控制器
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        console.log('控制器创建成功');

        // 7. 添加平面
        const planeGeometry = new THREE.PlaneGeometry(200, 200);
        const planeMaterial = new THREE.MeshStandardMaterial({ 
          color: 0xcccccc,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide
        });
        const plane = new THREE.Mesh(planeGeometry, planeMaterial);
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = -230;
        plane.receiveShadow = true;
        this.scene.add(plane);

        // 8. 添加光源
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(150, 20, 200);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 1;
        directionalLight.shadow.camera.far = 1000;
        directionalLight.shadow.camera.left = -100;
        directionalLight.shadow.camera.right = 100;
        directionalLight.shadow.camera.top = 100;
        directionalLight.shadow.camera.bottom = -100;
        this.scene.add(directionalLight);

        const ambient = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(ambient);
        console.log('光源添加成功');

        // 9. 添加坐标轴
        const axesHelper = new THREE.AxesHelper(100);
        this.scene.add(axesHelper);
        
        console.log('场景初始化完成');
        return true;
      } catch (error) {
        console.error('初始化场景时出错:', error);
        return false;
      }
    },

    initControlPanel() {
      const controlPanel = document.createElement('div');
      controlPanel.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(255, 255, 255, 0.9);
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        max-height: calc(100vh - 40px);
        overflow-y: auto;
        z-index: 1000;
        width: 300px;
      `;

      // 添加标题区域（包含标题和关闭按钮）
      const titleContainer = document.createElement('div');
      titleContainer.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
      `;

      const title = document.createElement('h3');
      title.textContent = '模型信息';
      title.style.cssText = `
        margin: 0;
        color: #333;
        font-size: 18px;
      `;

      const closeButton = document.createElement('button');
      closeButton.innerHTML = '×';
      closeButton.style.cssText = `
        background: none;
        border: none;
        color: #666;
        font-size: 24px;
        cursor: pointer;
        padding: 0 5px;
        line-height: 1;
        transition: color 0.3s ease;
      `;
      closeButton.addEventListener('mouseover', () => {
        closeButton.style.color = '#000';
      });
      closeButton.addEventListener('mouseout', () => {
        closeButton.style.color = '#666';
      });
      closeButton.addEventListener('click', () => {
        // 重置所有节点的颜色
        this.nodeList.forEach(node => {
          if (node.material) {
            node.material.color.setHex(0xffffff);
          }
        });
        
        // 清除所有定时器
        Object.keys(this.highlightTimers).forEach(key => {
          clearTimeout(this.highlightTimers[key]);
        });
        this.highlightTimers = {};
        
        // 恢复默认信息显示
        const infoDiv = document.getElementById('model-info');
        if (infoDiv) {
          infoDiv.innerHTML = '<p>请点击模型查看详细信息</p>';
        }
      });

      titleContainer.appendChild(title);
      titleContainer.appendChild(closeButton);
      controlPanel.appendChild(titleContainer);

      // 添加信息显示区域
      const infoDiv = document.createElement('div');
      infoDiv.id = 'model-info';
      infoDiv.style.cssText = `
        padding: 10px;
        background: #f8f9fa;
        border-radius: 4px;
        margin-bottom: 15px;
      `;
      infoDiv.innerHTML = '<p>请点击模型查看详细信息</p>';
      controlPanel.appendChild(infoDiv);

      // 将控制面板添加到页面
      document.body.appendChild(controlPanel);
    },

    loadModel() {
      const loader = new GLTFLoader();
      console.log('开始加载模型...');
      
      return new Promise((resolve, reject) => {
        try {
          loader.load('/model/pelvicTest.gltf', (gltf) => {
              try {
                if (!gltf.scene) {
                  throw new Error('模型场景为空');
                }

                // 创建一个新的组来包含模型
                const modelGroup = new THREE.Group();
                
                // 遍历模型并设置材质和交互
                gltf.scene.traverse((node) => {
                  if (node.isMesh) {
                    console.log('处理网格对象:', node.name);
                    
                    // 直接使用原始节点，不创建新的网格和材质
                    node.castShadow = true;
                    node.receiveShadow = true;
                    
                    // 添加到节点列表
                    this.nodeList.push(node);
                  }
                });

                // 直接添加整个模型场景到模型组
                modelGroup.add(gltf.scene);

                // 设置模型组的位置和大小
                modelGroup.position.set(0, 0, 0);
                modelGroup.scale.set(0.9, 0.9, 0.9);
                
                // 添加到场景
                if (this.scene) {
                  this.scene.add(modelGroup);
                  this.modelGroup = modelGroup;
                  console.log('模型已添加到场景');

                  // ❗❗在这里调整相机位置
                  if (this.camera) {
                    this.camera.position.set(360, 100, 0);
                    this.camera.lookAt(0, 0, 0);
                  }
                  
                  if (this.controls) {
                    this.controls.target.set(0, 0, 0);
                    this.controls.enableDamping = true;
                    this.controls.dampingFactor = 0.05;
                    this.controls.enableZoom = true;
                    this.controls.update();
                  }
                } else {
                  throw new Error('场景未初始化');
                }
                
                resolve();
              } catch (error) {
                console.error('处理模型时出错:', error);
                reject(error);
              }
            },
            (progress) => {
              console.log('加载进度:', (progress.loaded / progress.total * 100).toFixed(2) + '%');
            },
            (error) => {
              console.error('加载模型时出错:', error);
              reject(error);
            }
          );
        } catch (error) {
          console.error('初始化加载器时出错:', error);
          reject(error);
        }
      });
    },

    onNodeClick(node) {
      try {
        // 重置所有节点的材质颜色
        this.nodeList.forEach(n => {
          if (n.material) {
            n.material.color.setHex(0xffffff);
          }
        });

        // 高亮选中的节点
        if (node.material) {
          node.material.color.setHex(0x33ee88);
        }

        // 更新选中的节点
        this.selectedNode = node;

        // 更新信息面板
        const info = this.medicalInfo[node.name];
        if (info) {
          const infoDiv = document.getElementById('model-info');
          if (infoDiv) {
            infoDiv.innerHTML = `
              <h4 style="margin: 0 0 10px 0; color: #333;">${info.title}</h4>
              <p style="margin: 0 0 10px 0; color: #666;">${info.description}</p>
              <h5 style="margin: 10px 0 5px 0; color: #333;">主要功能：</h5>
              <ul style="margin: 0; padding-left: 20px;">
                ${info.functions.map(f => `<li style="color: #666;">${f}</li>`).join('')}
              </ul>
            `;
          }
        }
      } catch (error) {
        console.error('处理点击事件时出错:', error);
      }
    },

    animate() {
      if (!this.renderer || !this.scene || !this.camera) {
        console.warn('Three.js objects not fully initialized');
        return;
      }

      const animate = () => {
        try {
          if (this.controls) {
            this.controls.update();
          }

          // 直接使用renderer进行渲染，不使用effect
          if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
          }

          this.animationFrameId = requestAnimationFrame(animate);
        } catch (error) {
          console.error('Animation error:', error);
          cancelAnimationFrame(this.animationFrameId);
        }
      };

      animate();
    },

    onWindowResize() {
      const container = this.$refs.modelContainer;
      const width = container.clientWidth;
      const height = container.clientHeight;

      if (this.camera && this.renderer) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
      }

      this.charts.forEach(chart => {
        if (chart) {
          chart.resize();
        }
      });
    },

    clearData() {
      this.receivedData = [];
    },

    isVirtualPort(portPath) {
      // 检查是否为虚拟串口
      // 常见的虚拟串口标识：
      // - 包含 "USB" 或 "COM"
      // - 包含 "Virtual" 或 "VCP"
      return /USB|Virtual|VCP/i.test(portPath);
    },

    onMouseClick(event) {
      try {
        // 检查是否有渲染器和相机
        if (!this.renderer || !this.camera) return;

        // 获取鼠标位置
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // 创建射线
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

        // 检测射线与模型的交点
        if (this.nodeList.length > 0) {
          const intersects = raycaster.intersectObjects(this.nodeList, false);
          if (intersects.length > 0) {
            const selectedObject = intersects[0].object;
            this.onNodeClick(selectedObject);
          }
        }
      } catch (error) {
        console.error('处理鼠标点击时出错:', error);
      }
    },

    refreshPorts() {
      console.log('刷新串口列表');
      this.initWebSocket();
    },

    // 添加高亮肌肉的方法
    highlightMuscle(muscleNames, duration = 3000, color = 0x33ee88) {
      muscleNames.forEach(muscleName => {
        // 查找对应的节点
        const node = this.nodeList.find(n => n.name === muscleName);
        if (node && node.material) {
          // 将十六进制颜色字符串转换为数值
          const colorValue = parseInt(color.replace('#', ''), 16);
          
          // 设置高亮颜色
          node.material.color.setHex(colorValue);
          
          // 清除之前的定时器（如果存在）
          if (this.highlightTimers[muscleName]) {
            clearTimeout(this.highlightTimers[muscleName]);
          }
          
          // 显示医学信息
          const info = this.medicalInfo[muscleName];
          if (info) {
            const infoDiv = document.getElementById('model-info');
            if (infoDiv) {
              infoDiv.innerHTML = `
                <h4 style="margin: 0 0 10px 0; color: #333;">${info.title}</h4>
                <p style="margin: 0 0 10px 0; color: #666;">${info.description}</p>
                <h5 style="margin: 10px 0 5px 0; color: #333;">主要功能：</h5>
                <ul style="margin: 0; padding-left: 20px;">
                  ${info.functions.map(f => `<li style="color: #666;">${f}</li>`).join('')}
                </ul>
              `;
              
              // 添加高亮动画效果
              infoDiv.style.animation = 'none';
              infoDiv.offsetHeight; // 触发重绘
              infoDiv.style.animation = 'highlight-pulse 1s ease';
            }
          }
          
          // 设置新的定时器来恢复颜色和清除信息
          this.highlightTimers[muscleName] = setTimeout(() => {
            node.material.color.setHex(0xffffff);
            
            // 恢复默认信息显示
            const infoDiv = document.getElementById('model-info');
            if (infoDiv) {
              infoDiv.innerHTML = '<p>请点击模型查看详细信息</p>';
            }
          }, duration);
        }
      });
    },
  }
}
</script>

<style scoped>
.test-container {
  width: 100%;
  height: calc(100vh - 66px);
  display: flex;
  background: #f5f5f5;
}

.waveform-section {
  flex: 1;
  height: 100%;
  padding: 20px;
  border-right: 1px solid #ddd;
  background: white;
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
}

.control-panel {
  margin-bottom: 20px;
}

.control-panel h2 {
  width: 100%;
  /* text-align: right;  标题靠右对齐 */
  padding-right: 10px;  /* 标题右侧内边距 */
  margin-left: 130px;
  margin-bottom: 20px;
  color: #333;
  font-size: 1.5em;
}

.serial-controls {
  display: flex;
  width: 500px;
  gap: 10px;
  margin-bottom: 20px;
}
.serial-controls select {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-right: 10px;
  width: 240px;
  background-color: white;
  font-size: 14px;
  color: #333;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 16px;
  padding-right: 32px;
}

.serial-controls button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  transition: all 0.3s ease;
}

.serial-controls button.connected {
  background-color: #e15959;
  color: white;
}

.serial-controls button.disconnected {
  background-color: #4fafbc;
  color: white;
}

.serial-controls button:hover {
  opacity: 0.8;
  transform: translateY(-1px);
}

.serial-controls button:active {
  transform: translateY(1px);
}

.serial-controls select {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-right: 10px;
  min-width: 150px;
}

.channel-controls {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
}

.channel-group {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
  width: 100%;
}

.channel-item {
  flex: 1;
  min-width: 100px;
  max-width: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #f8f9fa;
  padding: 5px;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.channel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.channel-name {
  font-weight: bold;
  font-size: 0.9em;
  margin-left: 10px;
}

.channel-color {
  width: 15px;
  height: 15px;
  border-radius: 4px;
  margin-left: 2px;
}

.charts-container {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 10px;
  overflow: hidden;
}

.chart-item {
  height: 120px;
  border: 1px solid #eee;
  border-radius: 4px;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.model-section {
  flex: 1;
  height: 100%;
  position: relative;
  padding: 20px;
  background: white;
}

.model-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.model-container {
  flex: 1;
  width: 100%;
  min-height: 400px;
  background: #f8f9fa;
  border-radius: 8px;
  margin: 20px 0;
  position: relative;
  overflow: hidden;
}

.model-container canvas {
  width: 100% !important;
  height: 100% !important;
}

h2 {
  margin-top: 0;
  color: #333;
  font-size: 1.5em;
  margin-bottom: 20px;
}

/* 移除原有的数据显示相关样式 */
.data-display,
.data-header,
.data-content,
.data-line {
  display: none;
}

.model-controls {
  margin-top: 20px;
  text-align: left;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
  width: 100%;
}

.model-controls p {
  margin-bottom: 10px;
  font-weight: bold;
}

.model-controls ul {
  list-style-type: none;
  padding: 0;
}

.model-controls li {
  margin: 8px 0;
  color: #666;
}

.preview-image {
  max-width: 100%;
  max-height: 400px; /* 限制图片最大高度 */
  height: auto;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-top: 20px;
  object-fit: contain;
}

.refresh-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  background-color: #3d545d;
  color: white;
  transition: all 0.3s ease;
}

.refresh-btn:hover {
  opacity: 0.8;
  transform: translateY(-1px);
}

.refresh-btn:active {
  transform: translateY(1px);
}

@keyframes highlight-pulse {
  0% {
    background-color: #f8f9fa;
  }
  50% {
    background-color: #e3f2fd;
  }
  100% {
    background-color: #f8f9fa;
  }
}

.back-home {
  position: absolute;
  top: 35px;
  left: 40px;
  display: flex;
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
</style>
