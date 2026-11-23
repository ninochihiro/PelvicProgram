<template>
    <div class="test-container">
    <!-- 修改自定义弹窗组件 -->
    <div class="custom-popup" v-if="showPopup">
      <div class="popup-content">
        <p>{{ popupMessage }}</p>
      </div>
    </div>
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
          <h2>强化训练</h2>
      </div>
      <!-- 添加串口控制面板 -->
        <div class="serial-controls">
        <select v-model="selectedPortPath" :disabled="isQuizStarted">
          <option value="">请选择串口</option>
          <option v-for="port in availablePorts" :key="port.path" :value="port.path">
            {{ port.path }}
            </option>
          </select>
        <button 
          class="refresh-btn" 
          @click="refreshPorts"
          :class="{ 'disabled': isQuizStarted }"
          :disabled="isQuizStarted"
        >
          刷新串口
          </button>
          <button 
          :class="[isConnected ? 'connected' : 'disconnected', { 'disabled': isQuizStarted }]"
            @click="toggleConnection"
          :disabled="isQuizStarted"
        >
          {{ isConnected ? '断开连接' : '连接串口' }}
          </button>
        </div>
      
      <div class="quiz-container">
        <div class="quiz-content" v-if="!isQuizStarted && !isQuizCompleted">
          <div class="quiz-intro">
            <h3>强化训练说明</h3>
            <p>本次训练将针对之前未完成的肌肉进行强化练习：</p>
            <div class="incomplete-muscles">
              <h4>待练习的肌肉：</h4>
              <ul>
                <li v-for="(question, index) in questions" :key="index">
                  {{ question.text }}
                </li>
              </ul>
          </div>
            <p class="training-rule">训练规则：依次将以上未完成的肌肉痛点位置进行触诊，每个肌肉将练习到正确为止。</p>
            <div class="connection-status" v-if="isConnected">
              <p class="success-message">串口连接成功，请点击开始练习</p>
        </div>
            <div class="connection-status" v-else>
              <p class="warning-message">请先连接串口再开始练习</p>
            </div>
            <button class="start-btn" 
                    @click="startQuiz" 
                    :disabled="!isConnected"
                    :class="{ 'disabled': !isConnected }">
              开始练习
            </button>
          </div>
        </div>

        <div class="quiz-content" v-else-if="!isQuizCompleted">
          <div class="current-question">
            <h3>当前练习肌肉</h3>
            <p class="question-text">{{ currentQuestion.text }}</p>
            <p class="instruction-text">请触摸该肌肉的痛点位置，直到正确触摸为止</p>
          </div>

          <div class="question-feedback" v-if="showFeedback">
            <p :class="lastAnswerCorrect ? 'correct' : 'incorrect'">
              {{ lastAnswerCorrect ? '触摸正确！即将进入下一个肌肉的练习' : '触摸错误！请继续尝试' }}
            </p>
          </div>

          <!-- 添加待练习肌肉列表 -->
          <div class="incomplete-muscles">
            <h4>待练习的肌肉：</h4>
            <ul>
              <li v-for="(question, index) in questions" 
                  :key="index"
                  :class="{ 
                    'current-muscle': index === currentQuestionIndex,
                    'completed-muscle': question.completed 
                  }">
                {{ question.text }}
                <span v-if="question.completed" class="check-mark">✓</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="quiz-results" v-if="isQuizCompleted">
          <h3>强化训练完成！</h3>
          <p>恭喜你完成了所有肌肉的练习</p>
          <div class="result-buttons">
            <button class="restart-btn" @click="restartQuiz">重新练习</button>
            <router-link to="/score" class="back-to-score">
              返回考核
            </router-link>
          </div>
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
      
      // 练习相关数据
      isQuizStarted: false,
      isQuizCompleted: false,
      currentQuestionIndex: 0,
      totalQuestions: 0,
      showFeedback: false,
      lastAnswerCorrect: false,
      questions: [], // 将从Score.vue接收的未完成题目存储在这里
      
      // 添加医学信息对象
      medicalInfo: {
        'piriformis_L': { title: '左侧梨状肌' },
        'ischiococcygeus_L': { title: '左侧坐骨尾骨肌' },
        'iliococcygeus_L': { title: '左侧髂尾肌' },
        'internus_L': { title: '左侧闭孔内肌' },
        'puborectalis_L': { title: '左侧耻骨直肠肌' },
        'pubococcygeus_L': { title: '左侧耻骨尾骨肌' },
        'Ischium_L': { title: '左侧坐骨棘' },
        'Coccyx': { title: '尾骨' },
        'piriformis_R': { title: '右侧梨状肌' },
        'ischiococcygeus_R': { title: '右侧坐骨尾骨肌' },
        'iliococcygeus_R': { title: '右侧髂尾肌' },
        'internus_R': { title: '右侧闭孔内肌' },
        'puborectalis_R': { title: '右侧耻骨直肠肌' },
        'pubococcygeus_R': { title: '右侧耻骨尾骨肌' },
        'Ischium_R': { title: '右侧坐骨棘' }
      },
        
        ws: null,
        availablePorts: [],
      selectedPortPath: null,
        isConnected: false,
      
      // 添加缺失的数据属性
      receivedData: [],          // 用于存储接收到的数据
      maxLogLines: 100,         // 最大日志行数
      dataBuffer: Array(16).fill().map(() => []),  // 为16个通道创建数据缓冲区
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
      
      // 添加弹窗相关的数据
      showPopup: false,
      popupMessage: '',
      // 添加暂停状态标志
      isPaused: false,
      isProcessingTouch: false, // 添加新的状态标志
    }
  },
  
  computed: {
    currentQuestion() {
      return this.questions[this.currentQuestionIndex] || {};
      }
    },
   
    async mounted() {
      try {
      // 1. 初始化场景
        await this.initScene();
        
      // 2. 加载模型
        await this.loadModel();
        
      // 3. 开始动画循环
        this.animate();
        
      // 4. 初始化WebSocket连接
        await this.initWebSocket();
        
      // 5. 从路由参数获取未完成的题目
      const incompleteQuestions = this.$route.query.incompleteQuestions;
      if (incompleteQuestions) {
        try {
          const parsedQuestions = JSON.parse(decodeURIComponent(incompleteQuestions));
          console.log('接收到的未完成题目:', parsedQuestions);
          
          // 初始化题目数据
          this.questions = parsedQuestions.map(q => ({
            ...q,
            id: q.id || Math.random().toString(36).substr(2, 9),
            completed: false,
            timeSpent: 0,
            startTime: null
          }));
          
          this.totalQuestions = this.questions.length;
          console.log('初始化完成，题目数量:', this.totalQuestions);
        } catch (error) {
          console.error('解析未完成题目失败:', error);
          alert('加载未完成题目失败，请重新开始');
          this.$router.push('/score');
        }
      } else {
        console.log('没有未完成的题目');
        alert('没有未完成的题目，请先进行考核训练');
        this.$router.push('/score');
      }
      
      // 6. 添加窗口大小变化监听
        window.addEventListener('resize', this.onWindowResize);

      } catch (error) {
      console.error('组件挂载时出错:', error);
      }
    },

  beforeUnmount() {
    // 清理资源
        if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
        }
        if (this.ws) {
          this.ws.close();
        }
    window.removeEventListener('resize', this.onWindowResize);
  },
  
  methods: {
    startQuiz() {
      this.isQuizStarted = true;
      this.isQuizCompleted = false;
      this.currentQuestionIndex = 0;
      this.showFeedback = false;
      
      // 重置所有题目的状态
      this.questions.forEach(q => {
        q.completed = false;
      });
    },

    restartQuiz() {
      this.isQuizStarted = false;
      this.isQuizCompleted = false;
      this.currentQuestionIndex = 0;
      this.questions.forEach(q => q.completed = false);
      this.showFeedback = false;
      this.startQuiz();
    },

    moveToNextQuestion() {
      // 标记当前题目为已完成
      this.questions[this.currentQuestionIndex].completed = true;
      
      // 检查是否所有题目都已完成
      const allCompleted = this.questions.every(q => q.completed);
      
      if (allCompleted) {
        this.completeQuiz();
      } else {
        // 移动到下一个未完成的题目
        let nextIndex = this.currentQuestionIndex + 1;
        while (nextIndex < this.totalQuestions && this.questions[nextIndex].completed) {
          nextIndex++;
        }
        
        // 如果找到了下一个未完成的题目
        if (nextIndex < this.totalQuestions) {
          this.currentQuestionIndex = nextIndex;
        } else {
          // 如果找不到未完成的题目，完成训练
          this.completeQuiz();
        }
      }
      
      this.showFeedback = false;
    },

    completeQuiz() {
      this.isQuizCompleted = true;
      this.isQuizStarted = false;
    },

    handleCorrectTouch(question) {
      // 如果正在处理触摸事件，则忽略新的触摸
      if (this.isProcessingTouch) {
        return;
      }
      
      // 设置正在处理标志
      this.isProcessingTouch = true;
      
      // 显示正确反馈
      this.showFeedback = true;
      this.lastAnswerCorrect = true;
      
      // 高亮显示正确的肌肉
      const color = this.channelColors[question.targetChannel];
      this.highlightMuscle(question.targetMuscles, 3000, color);
      
      // 2秒后移动到下一题
      setTimeout(() => {
        this.showFeedback = false;
        this.moveToNextQuestion();
        // 重置处理标志
        this.isProcessingTouch = false;
      }, 2000);
    },

    handleIncorrectTouch(wrongMuscleNames) {
      // 显示错误反馈
      this.showFeedback = true;
      this.lastAnswerCorrect = false;
      
      // 高亮显示错误的肌肉
      if (wrongMuscleNames.length > 0) {
        const color = this.channelColors[this.currentQuestion.targetChannel];
        this.highlightMuscle(wrongMuscleNames, 3000, color);
        
        // 显示自定义弹窗提示
        const muscleInfo = this.medicalInfo[wrongMuscleNames[0]];
        if (muscleInfo) {
          this.popupMessage = `您当前触摸的是${muscleInfo.title}的痛点位置，请重新触摸${this.medicalInfo[this.currentQuestion.targetMuscles[0]].title}的痛点位置`;
          this.showPopup = true;
          
          // 3秒后自动关闭弹窗
          setTimeout(() => {
            this.showPopup = false;
          }, 3000);
        }
      }
    },

    // WebSocket message handler
    handleWebSocketMessage(event) {
      try {
        const message = JSON.parse(event.data);
        console.log('收到WebSocket消息:', message);

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

          case 'data':
            const values = message.data.split(',').map(Number);
            console.log('解析后的数值数组:', values);
            if (values && values.length >= 15) {
              for (let i = 0; i < 16; i++) {
                if(!isNaN(values[i])){
                  if (values[i] < 4000) {
                    // 获取对应的肌肉名称
                    const muscleNames = this.channelMuscleMap[i];
                    if (muscleNames) {
                      // 如果正在进行强化训练
                      if (this.isQuizStarted && !this.isQuizCompleted && !this.isProcessingTouch) {
                        // 检查是否是当前问题要求的肌肉
                        const isCorrectMuscle = this.currentQuestion.targetMuscles.some(target => 
                          muscleNames.includes(target)
                        );
                        
                        // 检查当前题目是否已完成
                        const isCurrentQuestionCompleted = this.questions[this.currentQuestionIndex].completed;
                        
                        if (!isCurrentQuestionCompleted) {
                          if (isCorrectMuscle) {
                            // 处理正确触摸
                            this.handleCorrectTouch(this.currentQuestion);
                          } else {
                            // 处理错误触摸
                            this.handleIncorrectTouch(muscleNames);
                          }
                        }
                      } else if (!this.isQuizStarted) {
                        // 如果不在训练模式，只高亮显示
                        this.highlightMuscle(muscleNames);
                      }
                    }
                  }
                } else {
                  console.warn(`通道 ${i + 1} 数据无效:`, values[i]);
                }
              }
            } else {
              console.warn('数据长度不足或无效:', values);
            }
            break;
            
          default:
            console.log('未知消息类型:', message.type);
        }
      } catch (error) {
        console.error('处理 WebSocket 消息失败:', error, '原始消息:', event.data);
      }
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

    animate() {
      if (!this.scene || !this.camera || !this.renderer || !this.controls) {
        console.warn('场景、相机、渲染器或控制器未初始化');
        return;
      }

      try {
        // 更新控制器
        this.controls.update();
        
        // 渲染场景
        this.renderer.render(this.scene, this.camera);
        
        // 继续动画循环
        this.animationFrameId = requestAnimationFrame(this.animate.bind(this));
        } catch (error) {
        console.error('动画循环中出错:', error);
        cancelAnimationFrame(this.animationFrameId);
      }
    },

    onNodeClick(node) {
      if (!node) return;
      
      console.log('点击了节点:', node.name);
      this.selectedNode = node;
      
      // 在这里可以添加点击节点后的其他逻辑
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
    onWindowResize() {
      if (!this.camera || !this.renderer) return;

      const container = this.$refs.modelView;
      const width = container.clientWidth;
      const height = container.clientHeight;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    },

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

        this.ws.onmessage = this.handleWebSocketMessage;

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

    highlightMuscle(muscleNames, duration = 3000, color = '#ff0000') {
      // 清除之前的高亮定时器
      Object.values(this.highlightTimers).forEach(timer => clearTimeout(timer));
      this.highlightTimers = {};

      // 重置所有节点的颜色为白色
      this.nodeList.forEach(node => {
        if (node.material) {
          node.material.color.set(0xffffff);
        }
      });

      // 高亮指定的肌肉
      muscleNames.forEach(muscleName => {
        const node = this.nodeList.find(n => n.name === muscleName);
        if (node && node.material) {
          // 使用 THREE.Color 来设置颜色
          const highlightColor = new THREE.Color(color);
          node.material.color.copy(highlightColor);
          
          // 设置定时器恢复原始颜色
          const timer = setTimeout(() => {
            if (node.material) {
              node.material.color.set(0xffffff);
            }
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

.serial-controls button.connected.disabled {
background-color: #cccccc;
cursor: not-allowed;
}

.serial-controls button.disconnected {
  background-color: #4fafbc;
  color: white;
}

.serial-controls button.disconnected.disabled {
background-color: #cccccc;
cursor: not-allowed;
}

.serial-controls button:hover:not(.disabled) {
  opacity: 0.8;
  transform: translateY(-1px);
}

.serial-controls button:active:not(.disabled) {
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

.refresh-btn.disabled {
background-color: #cccccc;
cursor: not-allowed;
}

.refresh-btn:hover:not(.disabled) {
  opacity: 0.8;
  transform: translateY(-1px);
}

.refresh-btn:active:not(.disabled) {
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

.quiz-container {
padding: 20px;
background: white;
border-radius: 8px;
box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.quiz-header {
display: flex;
justify-content: space-between;
align-items: center;
margin-bottom: 20px;
padding-bottom: 10px;
border-bottom: 2px solid #e8e8e8;
}

.score-display {
font-size: 1.2em;
font-weight: bold;
color: #316ba4;
}

.timer {
font-size: 1.2em;
font-weight: bold;
color: #e15959;
}

.quiz-intro {
text-align: center;
padding: 20px;
}

.quiz-intro h3 {
color: #316ba4;
margin-bottom: 20px;
}

.quiz-intro p {
color: #666;
margin-bottom: 15px;
line-height: 1.6;
}

.quiz-intro p {
color: #666;
margin-bottom: 15px;
line-height: 1.6;
}

.start-btn, .restart-btn {
background-color: #4fafbc;
color: white;
border: none;
padding: 12px 24px;
border-radius: 4px;
font-size: 1.1em;
cursor: pointer;
transition: all 0.3s ease;
}

.start-btn:hover, .restart-btn:hover {
background-color: #3d9da9;
transform: translateY(-2px);
}

.current-question {
text-align: center;
margin-bottom: 20px;
}

.current-question h3 {
color: #316ba4;
margin-bottom: 15px;
}

.question-text {
font-size: 1.2em;
color: #333;
margin-bottom: 20px;
}

.question-feedback {
text-align: center;
margin: 20px 0;
}

.question-feedback p {
font-size: 1.2em;
font-weight: bold;
padding: 10px;
border-radius: 4px;
}

.question-feedback .correct {
color: #4caf50;
background-color: rgba(76, 175, 80, 0.1);
}

.question-feedback .incorrect {
color: #f44336;
background-color: rgba(244, 67, 54, 0.1);
}

.quiz-results {
text-align: center;
padding: 20px;
}

.quiz-results h3 {
color: #316ba4;
margin-bottom: 15px;
}

.quiz-results p {
font-size: 1.2em;
color: #333;
margin-bottom: 20px;
}

.final-score {
font-size: 1.2em;
font-weight: bold;
color: #316ba4;
}

.score-table {
margin: 20px 0;
background: #f8f9fa;
border-radius: 8px;
padding: 15px;
box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.score-table-header {
display: grid;
grid-template-columns: 2fr 1fr 1fr;
gap: 10px;
padding: 10px;
background: #e8e8e8;
border-radius: 4px;
font-weight: bold;
color: #333;
}

.score-table-row {
display: grid;
grid-template-columns: 2fr 1fr 1fr;
gap: 10px;
padding: 10px;
border-bottom: 1px solid #e8e8e8;
}

.score-table-row:last-child {
border-bottom: none;
}

.success {
color: #4caf50;
font-weight: bold;
}

.fail {
color: #f44336;
font-weight: bold;
}

.final-score {
font-size: 1.4em;
font-weight: bold;
color: #316ba4;
margin: 20px 0;
text-align: center;
}

.connection-status {
  margin: 20px 0;
  padding: 15px;
  border-radius: 8px;
  text-align: center;
}

.success-message {
  color: #4fafbc;
  font-size: 1.1em;
  font-weight: bold;
}

.warning-message {
  color: #e15959;
  font-size: 1.1em;
  font-weight: bold;
}

.start-btn.disabled {
  background-color: #cccccc;
  cursor: not-allowed;
  transform: none;
}

.start-btn.disabled:hover {
  background-color: #cccccc;
  transform: none;
}

/* 添加自定义弹窗样式 */
.custom-popup {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.popup-content {
  background-color: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  max-width: 400px;
  width: 90%;
  text-align: center;
}

.popup-content p {
  margin: 0;
  color: #333;
  font-size: 1.1em;
  line-height: 1.5;
}

.result-buttons {
  display: flex;
  gap: 20px;
  justify-content: center;
  margin-top: 20px;
}

.intensive-btn {
  background-color: #e15959;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 4px;
  font-size: 1.1em;
  cursor: pointer;
  transition: all 0.3s ease;
  text-decoration: none;
  display: inline-block;
}

.intensive-btn:hover {
  background-color: #d14a4a;
  transform: translateY(-2px);
}

.incomplete-muscles {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 15px;
  margin: 15px 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.incomplete-muscles h4 {
  color: #316ba4;
  margin-bottom: 10px;
}

.incomplete-muscles ul {
  list-style-type: none;
  padding: 0;
  margin: 0;
}

.incomplete-muscles li {
  padding: 12px;
  border-bottom: 1px solid #e8e8e8;
  color: #666;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.3s ease;
}

.incomplete-muscles li:last-child {
  border-bottom: none;
}

.current-muscle {
  background-color: #e3f2fd;
  color: #316ba4;
  font-weight: bold;
  border-radius: 4px;
}

.completed-muscle {
  color: #4caf50;
  background-color: rgba(76, 175, 80, 0.1);
}

.check-mark {
  color: #4caf50;
  font-weight: bold;
  font-size: 1.2em;
}

.training-rule {
  color: #e15959;
  font-weight: bold;
  margin: 15px 0;
  padding: 10px;
  background: rgba(225, 89, 89, 0.1);
  border-radius: 4px;
}

.instruction-text {
  color: #666;
  margin-top: 10px;
  font-style: italic;
}

.back-to-score {
  background-color: #316ba4;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 4px;
  font-size: 1.1em;
  cursor: pointer;
  transition: all 0.3s ease;
  text-decoration: none;
  display: inline-block;
}

.back-to-score:hover {
  background-color: #245a8f;
  transform: translateY(-2px);
}
  </style>
