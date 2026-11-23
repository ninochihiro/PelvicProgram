<template>
    <div class="test-container">
         <!-- 添加返回按钮 -->
    <router-link to="/" class="back-home">
      <i class="fas fa-arrow-left"></i>
      返回首页
    </router-link>
    <!-- 左侧模型显示 -->
      <div class="left-section">
        <div class="model-container">
          <div class="model-header">
            <h2>盆底肌肉仿真模型</h2>
          </div>
          <div ref="modelView" class="model-view"></div>
        </div>
      </div>
      <div class="right-section">
        <div class="model-header">
            <h2>常规训练</h2>
          </div>
        <div class="serial-controls">
          <select v-model="selectedPortPath" @change="handlePortChange">
            <option :value="null">选择串口</option>
            <option v-for="port in availablePorts" 
                    :key="port.path" 
                    :value="port.path">
              {{ port.friendlyName || port.path }}
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
        <div class="channel-names">
          <div v-for="(name, i) in channelNames" 
               :key="i" 
               class="channel-name"
               :style="{ backgroundColor: channelColors[i], color: 'white' }">
            {{ name }}
          </div>
        </div>
        <div class="medical-info">
          <h3>{{ currentHighlightedMuscle ? currentHighlightedMuscle.name : '等待触诊' }}</h3>
          <div class="info-content">
            <p><strong>解剖位置：</strong>{{ currentHighlightedMuscle ? currentHighlightedMuscle.location : '请点击相关痛点位置并查看界面响应的解剖位置' }}</p>
            <p><strong>主要功能：</strong>{{ currentHighlightedMuscle ? currentHighlightedMuscle.function : '请点击相关痛点位置并查看该区域的主要功能' }}</p>
            <p><strong>常见问题：</strong>{{ currentHighlightedMuscle ? currentHighlightedMuscle.commonIssues : '请点击相关痛点位置并查看该区域常见的健康问题' }}</p>
            <p><strong>治疗建议：</strong>{{ currentHighlightedMuscle ? currentHighlightedMuscle.treatment : '请点击相关痛点位置并查看该区域常见的治疗建议' }}</p>
          </div>
        </div>
      </div>
    </div>
  </template>
  
  <script>
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { shallowRef } from 'vue';
import { createSerialSocket } from '../utils/serialSocket';
  
  export default {
    name: 'Intensive',
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
        
        // 添加缺失的数据属性
        receivedData: [],          // 用于存储接收到的数据
        maxLogLines: 100,         // 最大日志行数
        dataBuffer: Array(4).fill().map(() => []),  // 为4个通道创建数据缓冲区
        maxDataPoints: 100,       // 每个通道的最大数据点数
        charts: [],               // 存储图表实例
        chartOptions: [],         // 存储图表配置
        highlightTimers: {},      // 存储高亮定时器
        
       // 通道对应的肌肉名称映射
      channelMuscleMap: {
        0: ['piriformis_L'],         // 左侧梨状肌
        1: ['ischiococcygeus_L'],    // 左侧坐骨尾骨肌
        2: ['iliococcygeus_L'],      // 左侧髂尾肌
        3: ['internus_L'],           // 左侧闭孔内肌
        4: ['puborectalis_L'],       // 左侧耻骨直肠肌
        5: ['pubococcygeus_L'],      // 左侧耻骨尾骨肌
        6: ['Ischium_L'],            // 左侧坐骨棘
        7: ['Coccyx'],               // 尾骨
        8: ['piriformis_R'],         // 右侧梨状肌
        9: ['ischiococcygeus_R'],    // 右侧坐骨尾骨肌
        10: ['iliococcygeus_R'],     // 右侧髂尾肌
        11: ['internus_R'],          // 右侧闭孔内肌
        12: ['puborectalis_R'],      // 右侧耻骨直肠肌
        13: ['pubococcygeus_R'],     // 右侧耻骨尾骨肌
        14: ['Ischium_R']            // 右侧坐骨棘
      },
        
        currentHighlightedMuscle: null,
        channelNames: [
        '左侧梨状肌', 
        '左侧坐骨尾骨肌', 
        '左侧髂尾肌', 
        '左侧闭孔内肌',
        '左侧耻骨直肠肌',
        '左侧耻骨尾骨肌',
        '左侧坐骨棘',
        '尾骨',
        '右侧梨状肌',
        '右侧坐骨尾骨肌',
        '右侧髂尾肌',
        '右侧闭孔内肌',
        '右侧耻骨直肠肌',
        '右侧耻骨尾骨肌',
        '右侧坐骨棘'
      ],
      channelColors: [
        '#0000ff', '#ff0000', '#009900', '#ff9900', '#cc00cc', 
        '#00cccc', '#cc6600', '#0066cc', '#000088', '#880000', 
        '#006600', '#996600', '#660066', '#006666', '#664400'
      ],
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
          title: '坐骨尾肌（右）',
          description: '坐骨尾肌是一对小而扁平的肌肉，位于盆腔后外侧。',
          functions: ['稳定尾骨', '支持盆底后部', '协助盆底功能']
        },
        'ischiococcygeus_L': {
          title: '坐骨尾肌（左）',
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
        displayMode: 'normal',
        transparency: 0.5,
        highlightColor: '#ff0000',
        highlightIntensity: 1.0,
        highlightDuration: 3000,
        samplingRate: 1000,
        channelCount: 4
      }
    },
   
    async mounted() {
      try {
        console.log('组件挂载，初始化...');
        
        // 等待 DOM 渲染完成
        await this.$nextTick();
        
        // 初始化场景
        await this.initScene();
        
        // 加载模型
        await this.loadModel();
        
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
      try {
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

        // 清理Three.js资源
        if (this.renderer) {
          this.renderer.dispose();
          if (this.renderer.domElement && this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
          }
        }

        // 清理场景中的对象
        if (this.scene) {
          this.scene.traverse((object) => {
            if (object.geometry) {
              object.geometry.dispose();
            }
            if (object.material) {
              if (Array.isArray(object.material)) {
                object.material.forEach(material => material.dispose());
              } else {
                object.material.dispose();
              }
            }
          });
        }

        // 清理控制器
        if (this.controls) {
          this.controls.dispose();
        }

        console.log('组件资源清理完成');
      } catch (error) {
        console.error('组件清理时出错:', error);
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
                  // 首先尝试解析为数据消息
                  const message = JSON.parse(event.data);
                  console.log('收到WebSocket消息:', message);

                  if (message.type === 'data') {
                    const values = message.data.split(',').map(Number);
                    console.log('解析后的数值数组:', values);
                    if (values && values.length >= 15) {
                      for (let i = 0; i < 16; i++) {
                        if(!isNaN(values[i])){
                          if (values[i] < 4000) {
                            // 获取对应的肌肉名称
                            const muscleNames = this.channelMuscleMap[i];
                            if (muscleNames) {
                              this.highlightMuscle(muscleNames);
                            }
                          }
                        } else {
                          console.warn(`通道 ${i + 1} 数据无效:`, values[i]);
                        }
                      }
                    } else {
                      console.warn('数据长度不足或无效:', values);
                    }
                  } else {
                    // 处理控制消息
                    switch (message.type) {
                      case 'ports-list':
                        this.availablePorts = message.ports;
                        console.log('可用串口列表:', this.availablePorts);
                        break;
                      
                      case 'connect-success':
                        this.isConnected = true;
                        console.log('串口连接成功');
                        break;
                      
                      case 'disconnect-success':
                        this.isConnected = false;
                        console.log('串口断开连接');
                        break;
                      
                      case 'error':
                        console.error('串口错误:', message.error);
                        alert('串口错误: ' + message.error);
                        break;
                        
                      default:
                        console.log('未知消息类型:', message.type);
                    }
                  }
                } catch (error) {
                  console.error('处理 WebSocket 消息失败:', error, '原始消息:', event.data);
                }
              };

              this.ws.onerror = (error) => {
                  console.error('WebSocket 错误:', error);
              };

              this.ws.onclose = () => {
                  console.log('WebSocket 连接关闭');
                  this.isConnected = false;
                  // 3秒后尝试重连
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
     

      async initScene() {
        try {
          // 1. 获取容器并检查
          const container = this.$refs.modelView;
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
          this.camera.position.set(150, 20, 200); // 将相机放在z轴正方向
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
          loader.load('./model/pelvicTest.gltf', (gltf) => {
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
                modelGroup.position.set(0, 20, 0);
                modelGroup.scale.set(0.9, 0.9, 0.9);
                
                // 添加到场景
                if (this.scene) {
                  this.scene.add(modelGroup);
                  this.modelGroup = modelGroup;
                  console.log('模型已添加到场景');

                  // 调整相机和控制器
                  if (this.camera) {
                    this.camera.position.set(420, 100, 0);
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

          // 更新医学信息显示
          const info = this.medicalInfo[node.name];
          if (info) {
            this.currentHighlightedMuscle = {
              name: info.title,
              location: info.description,
              function: info.functions.join('、'),
              commonIssues: '暂无数据',
              treatment: '暂无数据'
            };
          } else {
            this.currentHighlightedMuscle = null;
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

      onMouseClick(event) {
        try {
          // 检查是否有渲染器和相机
          if (!this.renderer || !this.camera) {
            console.warn('渲染器或相机未初始化');
            return;
          }

          // 检查nodeList是否已初始化
          if (!this.nodeList || this.nodeList.length === 0) {
            console.warn('节点列表为空，模型可能尚未加载完成');
            return;
          }

          // 检查点击事件是否发生在渲染器的DOM元素上
          const canvas = this.renderer.domElement;
          if (!canvas.contains(event.target)) {
            return; // 如果点击不在canvas上，直接返回
          }

          // 获取鼠标位置
          const rect = canvas.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

          // 创建射线
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

          // 检测射线与模型的交点
          const intersects = raycaster.intersectObjects(this.nodeList, false);
          console.log('射线检测结果:', intersects.length ? '有交点' : '无交点');

          if (intersects.length > 0) {
            const selectedObject = intersects[0].object;
            console.log('选中的对象:', selectedObject.name);
            this.onNodeClick(selectedObject);
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
      highlightMuscle(muscleNames, duration = 7000) {
        // 清除之前的高亮定时器
        Object.values(this.highlightTimers).forEach(timer => clearTimeout(timer));
        this.highlightTimers = {};

        // 重置所有节点的颜色
        this.nodeList.forEach(node => {
          if (node.material) {
            node.material.color.setHex(0xffffff);
          }
        });

        // 高亮指定的肌肉
        muscleNames.forEach(muscleName => {
          const node = this.nodeList.find(n => n.name === muscleName);
          if (node && node.material) {
            // 找到对应的通道索引
            let channelIndex = -1;
            for (let i = 0; i < Object.keys(this.channelMuscleMap).length; i++) {
              if (this.channelMuscleMap[i].includes(muscleName)) {
                channelIndex = i;
                break;
              }
            }

            // 使用对应通道的颜色
            if (channelIndex !== -1) {
              node.material.color.setStyle(this.channelColors[channelIndex]);
            }
            
            // 更新医学信息显示
            const info = this.medicalInfo[muscleName];
            if (info) {
              this.currentHighlightedMuscle = {
                name: info.title,
                location: info.description,
                function: info.functions.join('、'),
                commonIssues: '暂无数据',
                treatment: '暂无数据'
              };
            }
            
            // 设置定时器恢复原始颜色和清除信息
            const timer = setTimeout(() => {
              if (node.material) {
                node.material.color.setHex(0xffffff);
              }
              // 清除医学信息显示
              this.currentHighlightedMuscle = null;
            }, duration);
            
            this.highlightTimers[muscleName] = timer;
          }
        });
      },
    }
  }
  </script>
  
  <style scoped>
  .test-container {
    display: flex;
    width: 100vw;
    height: 100vh;
    background: #f0f2f5;
    overflow: hidden;
  }
  
  .left-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px;
    background: #fff;
    border-right: 1px solid #e8e8e8;
    height: 100vh;
    overflow: hidden;
  }
  
  .right-section {
    flex: 1;
    padding: 20px;
    background: #fff;
    height: 100vh;
    overflow-y: auto;
  }
  
  .model-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    height: calc(100vh - 40px);
    overflow: hidden;
  }
  
  .model-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    border: 1px solid #e9ecef;
  }
  
  .model-view {
    flex: 1;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
  }
  
  .medical-info {
    background: #fff;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    margin-bottom: 20px;
  }
  
  .medical-info h3 {
    color: #2c3e50;
    margin-bottom: 15px;
    font-size: 1.4em;
  }
  
  .info-content {
    color: #34495e;
    line-height: 1.6;
  }
  
  .info-content p {
    margin-bottom: 12px;
  }
  
  .info-content strong {
    color: #2c3e50;
    font-weight: 600;
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
  
  .model-header {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 15px;
    margin-bottom: 20px;
  }
  
  .model-header h2 {
    color: #316ba4;
    margin: 0;
    font-size: 1.8em;
    text-align: center;
  }

  /* .left-section .model-header {
    border-bottom: 2px solid #e8e8e8;
  }

  .right-section .model-header {
    border-bottom: 2px solid #e8e8e8;
  } */

  .model-description {
    color: #463737;
    margin: 0;
    line-height: 1.5;
  }
  
  .model-usage {
    margin-top: 20px;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    border: 1px solid #e9ecef;
  }
  
  .model-usage p {
    color: #2c3e50;
    margin: 0 0 10px 0;
    font-weight: 600;
  }
  
  .model-usage ul {
    list-style-type: none;
    padding: 0;
    margin: 0;
  }
  
  .model-usage li {
    color: #666;
    margin-bottom: 8px;
    padding-left: 20px;
    position: relative;
  }
  
  .model-usage li:before {
    content: "•";
    color: #4fafbc;
    position: absolute;
    left: 0;
    font-weight: bold;
  }
  .back-home {
  position: absolute;
  top: 60px;
  left: 60px;
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
.serial-controls {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
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
  width: 200px;
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
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
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
.channel-names {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.channel-name {
  padding: 5px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
  </style>
