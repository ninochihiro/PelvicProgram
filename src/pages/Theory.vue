<template>
  <div class="home">
    <router-link to="/" class="back-home">
      <i class="fas fa-arrow-left"></i>
      返回首页
    </router-link>
    <!-- 这个div将作为3D场景的容器 -->
    <div ref="container"></div>
  </div>
</template>

<script>
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { shallowRef } from 'vue';

export default {
  name: 'Home',
  data() {
    return {
       // 使用 shallowRef 来存储 Three.js 对象
       scene: shallowRef(null),
      camera: shallowRef(null),
      renderer: shallowRef(null),
      effect: shallowRef(null),
      controls: shallowRef(null),
      nodeList: [],
      selectedNode: null,
      initialY: 0,
      modelGroup: null,
      categories: {},
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
      }
    }
  },
  mounted() {
    // 在组件挂载后初始化3D场景
    this.initScene();
    this.initControlPanel();
    this.loadModel();
    this.animate();

    // 添加窗口调整监听器
    window.addEventListener('resize', this.onWindowResize);
  },
  beforeUnmount() {
    // 组件销毁前清理
    window.removeEventListener('resize', this.onWindowResize);
    // 停止动画循环
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  },
  methods: {
    initScene() {
      // 创建场景
      this.scene = new THREE.Scene();

      // 创建相机
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.camera = new THREE.PerspectiveCamera(30, width / height, 1, 3000);
      this.camera.position.set(292, 223, 185);
      this.camera.lookAt(0, 0, 0);

      // 创建渲染器
      this.renderer = new THREE.WebGLRenderer({
        antialias: true
      });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.setClearColor(0xffffff, 1);
      
      // 启用阴影
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      // 将渲染器的canvas添加到DOM
      this.$refs.container.appendChild(this.renderer.domElement);

      // 创建OutlineEffect
      this.effect = new OutlineEffect(this.renderer, {
        defaultThickness: 0.002,
        defaultColor: new THREE.Color(0x888888),
        defaultAlpha: 0.3
      });

      // 创建控制器
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);

      // 修改平面材质
      const planeGeometry = new THREE.PlaneGeometry(200, 200);
      const planeMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xcccccc,  // 改为浅灰色
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide  // 添加这行，使平面双面可见
      });
      const plane = new THREE.Mesh(planeGeometry, planeMaterial);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = -230;  // 调整平面位置
      plane.receiveShadow = true;
      this.scene.add(plane);

      // 调整光源
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); // 增加光源强度
      directionalLight.position.set(200, 300, 200); // 调整光源位置
      directionalLight.castShadow = true;
      directionalLight.shadow.mapSize.width = 2048;  // 增加阴影分辨率
      directionalLight.shadow.mapSize.height = 2048;
      directionalLight.shadow.camera.near = 1;
      directionalLight.shadow.camera.far = 1000;
      directionalLight.shadow.camera.left = -100;
      directionalLight.shadow.camera.right = 100;
      directionalLight.shadow.camera.top = 100;
      directionalLight.shadow.camera.bottom = -100;
      this.scene.add(directionalLight);

      // 调整环境光
      const ambient = new THREE.AmbientLight(0xffffff, 0.3); // 降低环境光强度
      this.scene.add(ambient);

      // 添加坐标轴
      const axesHelper = new THREE.AxesHelper(100);
      this.scene.add(axesHelper);
    },

    initControlPanel() {
      const controlPanel = document.createElement('div');
      controlPanel.style.cssText = `
        position: absolute;
        top: 10px;
        right: -10px;
        background: rgba(255, 255, 255, 0.8);
        padding: 10px;
        border-radius: 5px;
        max-height: 100vh;
        overflow-y: auto;
        z-index: 100;
        min-width: 100px;
      `;
      this.$refs.container.appendChild(controlPanel);
      this.controlPanel = controlPanel;

      // 只保留骨头和肌肉两个分类
      this.categories = {
        bones: {
          name: '骨骼',
          container: this.createCategory('骨骼')
        },
        muscles: {
          name: '肌肉',
          container: this.createCategory('肌肉')
        }
      };
    },

    createCategory(name) {
      const category = document.createElement('div');
      category.style.cssText = `
        margin-bottom: 15px;
      `;

      const title = document.createElement('div');
      title.textContent = name;
      title.style.cssText = `
        font-weight: bold;
        padding: 5px;
        background: rgba(147, 207, 237, 0.95);
        border-radius: 3px;
        margin-bottom: 5px;
      `;

      category.appendChild(title);
      this.controlPanel.appendChild(category);
      return category;
    },

    // 修改分类逻辑
    categorizeNode(nodeName) {
      // 检查首字母是否大写
      if (nodeName[0] === nodeName[0].toUpperCase()) {
        return 'bones';  // 首字母大写归类为骨头
      } else {
        return 'muscles';  // 首字母小写归类为肌肉
      }
    },

    // 节点重命名规则
    renameNode(nodeName) {
      // 这里定义节点重命名规则，根据实际需求调整
      const nameMap = {
        'pubococcygeus_R': '耻骨尾骨肌_右',
        'pubococcygeus_L': '耻骨尾骨肌_左',
        'puborectalis_R': '耻骨直肠肌_右',
        'puborectalis_L': '耻骨直肠肌_左',
        'iliococcygeus_R': '髂尾肌_右',
        'iliococcygeus_L': '髂尾肌_左',
        'ischiococcygeus_R': '尾骨肌_右',
        'ischiococcygeus_L': '尾骨肌_左',
        'internus_R': '闭孔内肌_右',
        'internus_L': '闭孔内肌_左',
        'piriformis_R': '梨状肌_右',
        'piriformis_L': '梨状肌_左',
        'Sacrum': '骶骨',
        'Femur_R': '股骨_右',
        'Femur_L': '股骨_左',
        'Ilium_R': '髂骨_右',
        'Ilium_L': '髂骨_左',
        'Ischium_R': '坐骨_右',
        'Ischium_L': '坐骨_左',
        'Pubis_R': '耻骨_右',
        'Pubis_L': '耻骨_左',
        'Vertebra': '椎骨',
        // 添加更多映射...
      };
      return nameMap[nodeName] || nodeName;
    },

    loadModel() {
      const loader = new GLTFLoader();
      const model = new THREE.Group();

      loader.load('/model/pelvicTest.gltf', (gltf) => {
        console.log('gltf', gltf);
        
        // 保存模型的初始Y位置
        this.initialY = gltf.scene.position.y;
        
        gltf.scene.traverse((node) => {
          if (node.isMesh) {
            this.nodeList.push(node);
            this.createNodeButton(node);
            // 设置模型投射阴影
            node.castShadow = true;
          }
        });
        model.add(gltf.scene);
        
        // 保存模型引用以便在动画中使用
        this.modelGroup = gltf.scene;
      });

      this.scene.add(model);
    },

    createNodeButton(node) {
      const button = document.createElement('button');
      const displayName = this.renameNode(node.name);
      button.textContent = displayName;
      button.style.cssText = `
        display: block;
        margin: 5px 0;
        padding: 5px 10px;
        width: 100%;
        text-align: left;
        background: #ffffff;
        border: 1px solid #cccccc;
        border-radius: 3px;
        cursor: pointer;
        font-size: 0.9em;
      `;

      button.onclick = () => this.handleNodeClick(node, button);

      // 将按钮添加到对应的分类容器中
      const category = this.categorizeNode(node.name);
      this.categories[category].container.appendChild(button);
    },

    handleNodeClick(node, button) {
      // 重置所有节点的材质
      this.nodeList.forEach(n => {
        if (n.originalMaterial) {
          n.material = n.originalMaterial;
        }
        // 停止所有正在进行的闪烁动画
        if (n.glowAnimation) {
          clearInterval(n.glowAnimation);
          n.glowAnimation = null;
        }
      });

      // 高亮选中的节点
      if (this.selectedNode !== node) {
        if (!node.originalMaterial) {
          node.originalMaterial = node.material.clone();
        }

        // 创建发光材质
        const glowMaterial = node.material.clone();
        glowMaterial.emissive = new THREE.Color(0x00ffff); // 蓝色
        node.material = glowMaterial;

        // 创建闪烁动画
        let intensity = 0;
        let increasing = true;
        node.glowAnimation = setInterval(() => {
          if (increasing) {
            intensity += 0.07;
            if (intensity >= 1) {
              increasing = false;
            }
          } else {
            intensity -= 0.07;
            if (intensity <= 0) {
              increasing = true;
            }
          }
          glowMaterial.emissiveIntensity = intensity;
        }, 50);

        this.selectedNode = node;

        // 更新按钮样式
        this.controlPanel.querySelectorAll('button').forEach(btn => {
          btn.style.background = '#ffffff';
        });
        button.style.background = '#aefaf7';

        // 显示医学信息面板
        this.createInfoPanel(node.name);
      } else {
        this.selectedNode = null;
        button.style.background = '#ffffff';
        if (this.currentInfoPanel) {
          document.body.removeChild(this.currentInfoPanel);
          this.currentInfoPanel = null;
        }
      }
    },

    animate() {
      this.animationFrameId = requestAnimationFrame(this.animate);
      
      if (this.modelGroup) {
        const time = Date.now() * 0.001;
        const amplitude = 0.5;
        const frequency = 1;
        this.modelGroup.position.y = this.initialY + Math.sin(time * frequency) * amplitude;
      }

      // 修改渲染方式
      // 先用普通渲染器渲染一次以显示阴影
      this.renderer.render(this.scene, this.camera);
      // 然后用 OutlineEffect 渲染描边
      this.effect.render(this.scene, this.camera);
    },

    onWindowResize() {
      const width = window.innerWidth;
      const height = window.innerHeight;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    },

    beforeDestroy() {
      this.nodeList.forEach(node => {
        if (node.glowAnimation) {
          clearInterval(node.glowAnimation);
        }
      });
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
      }
      window.removeEventListener('resize', this.onWindowResize);
    },

    createInfoPanel(nodeName) {
      // 如果已存在面板，先移除
      if (this.currentInfoPanel) {
        document.body.removeChild(this.currentInfoPanel);
      }

      const info = this.medicalInfo[nodeName] || {
        title: nodeName,
        description: '暂无详细信息',
        functions: []
      };

      const panel = document.createElement('div');
      panel.style.cssText = `
        position: absolute;
        top: 20px;
        left: 320px;
        background: rgba(255, 255, 255, 0.95);
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
        max-width: 300px;
        z-index: 1000;
        font-family: Arial, sans-serif;
        animation: fadeIn 0.3s ease-in-out;
      `;

      const closeButton = document.createElement('button');
      closeButton.innerHTML = '×';
      closeButton.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        border: none;
        background: none;
        font-size: 20px;
        cursor: pointer;
        color: #666;
        padding: 0 5px;
      `;
      closeButton.onclick = () => {
        document.body.removeChild(panel);
        this.currentInfoPanel = null;
      };

      const content = document.createElement('div');
      content.innerHTML = `
        <h3 style="margin: 0 0 10px 0; color: #333; font-size: 18px;">${info.title}</h3>
        <p style="margin: 0 0 10px 0; color: #666; line-height: 1.5;">${info.description}</p>
        ${info.functions.length ? `
          <h4 style="margin: 10px 0 5px 0; color: #333; font-size: 14px;">主要功能：</h4>
          <ul style="margin: 0; padding-left: 20px; color: #666;">
            ${info.functions.map(f => `<li style="margin: 5px 0;">${f}</li>`).join('')}
          </ul>
        ` : ''}
      `;

      panel.appendChild(closeButton);
      panel.appendChild(content);
      document.body.appendChild(panel);
      this.currentInfoPanel = panel;

      // 添加拖动功能
      let isDragging = false;
      let currentX;
      let currentY;
      let initialX;
      let initialY;

      panel.addEventListener('mousedown', (e) => {
        if (e.target === closeButton) return;
        isDragging = true;
        initialX = e.clientX - panel.offsetLeft;
        initialY = e.clientY - panel.offsetTop;
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        panel.style.left = `${currentX}px`;
        panel.style.top = `${currentY}px`;
      });

      document.addEventListener('mouseup', () => {
        isDragging = false;
      });
    },

    beforeDestroy() {
      if (this.connectionPoint) {
        document.body.removeChild(this.connectionPoint);
      }
      if (this.connectionLine) {
        document.body.removeChild(this.connectionLine);
      }
      if (this.currentInfoPanel) {
        document.body.removeChild(this.currentInfoPanel);
      }
      this.nodeList.forEach(node => {
        if (node.glowAnimation) {
          clearInterval(node.glowAnimation);
        }
      });
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
      }
      window.removeEventListener('resize', this.onWindowResize);
    }
  }
}
</script> 

<style scoped>
.home {
  width: 100%;
  height: calc(100vh - 66px);
  position: relative;
}
.back-home {
  position: absolute;
  top: 10px;
  left: 20px;
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
<style>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.8; }
  100% { transform: scale(1); opacity: 1; }
}
</style> 
