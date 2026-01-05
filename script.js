import * as THREE from 'three';

class PRNG {
    constructor(seed) {
        this.seed = this.hash(seed);
    }
    hash(str) {
        let h = 0xdeadbeef;
        str = str.toString();
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 2654435761);
            h = ((h ^ h >>> 16) * 2246822507) >>> 0;
        }
        return h;
    }
    next() {
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        return this.seed / 4294967296;
    }
    range(min, max) {
        return min + this.next() * (max - min);
    }
}

const CONSTANTS = {
    gravity: -25,
    bounce: 0.7,
    friction: 0.99,
    ballRadius: 0.5,
    laneWidth: 10,
    chunkHeight: 12
};

let scene, camera, renderer;
let ball;
let obstacles = [];
let chunks = [];
let particles = [];
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let animationId;
let lastTime = 0;
const timeStep = 1 / 60;
let accumulator = 0;

let state = {
    velocity: new THREE.Vector3(0, 0, 0),
    position: new THREE.Vector3(0, 5, 0),
    active: false,
    seed: 12345,
    theme: 'neon',
    difficulty: 5
};

const UI = {
    layer: document.getElementById('ui-layer'),
    seed: document.getElementById('seed-input'),
    diff: document.getElementById('diff-slider'),
    theme: document.getElementById('theme-select'),
    status: document.getElementById('status-text'),
    btnRandom: document.getElementById('btn-randomize'),
    btnReset: document.getElementById('btn-reset'),
    btnRecord: document.getElementById('btn-record')
};

function init() {
    scene = new THREE.Scene();
    
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 20;
    camera = new THREE.OrthographicCamera(
        frustumSize * aspect / -2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        frustumSize / -2,
        1,
        1000
    );
    
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    setupLights();
    setupEvents();
    
    generateLevel();
    animate(0);
}

function setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -15;
    dirLight.shadow.camera.right = 15;
    dirLight.shadow.camera.top = 15;
    dirLight.shadow.camera.bottom = -15;
    scene.add(dirLight);
}

function getThemeColors(theme) {
    switch(theme) {
        case 'pastel':
            return { bg: 0xffeebb, ball: 0xff6b6b, obs: 0x4ecdc4, accent: 0xffffff };
        case 'monochrome':
            return { bg: 0x111111, ball: 0xffffff, obs: 0x333333, accent: 0x666666 };
        case 'neon':
        default:
            return { bg: 0x050505, ball: 0xff00ff, obs: 0x00ffff, accent: 0x111111 };
    }
}

function generateLevel() {
    state.active = false;
    
    while(scene.children.length > 0){ 
        scene.remove(scene.children[0]); 
    }
    obstacles = [];
    particles = [];
    chunks = [];

    setupLights();

    const colors = getThemeColors(state.theme);
    scene.background = new THREE.Color(colors.bg);
    scene.fog = new THREE.Fog(colors.bg, 10, 40);

    const ballGeo = new THREE.SphereGeometry(CONSTANTS.ballRadius, 32, 32);
    const ballMat = new THREE.MeshStandardMaterial({ 
        color: colors.ball,
        roughness: 0.1,
        metalness: 0.2,
        emissive: colors.ball,
        emissiveIntensity: 0.2
    });
    ball = new THREE.Mesh(ballGeo, ballMat);
    ball.castShadow = true;
    scene.add(ball);

    state.position.set(0, 10, 0);
    state.velocity.set(0, 0, 0);
    ball.position.copy(state.position);

    const rng = new PRNG(state.seed);
    let yPos = 5;

    for (let i = 0; i < 50; i++) {
        const type = Math.floor(rng.next() * 3);
        const gap = rng.range(-2, 2);
        
        const mat = new THREE.MeshStandardMaterial({ 
            color: colors.obs,
            roughness: 0.2,
            metalness: 0.5
        });

        if (type === 0) {
            const w1 = 4 + gap;
            const w2 = 4 - gap;
            createBox(new THREE.Vector3(-3 - (4-w1)/2, yPos, 0), new THREE.Vector3(w1, 1, 4), mat);
            createBox(new THREE.Vector3(3 + (4-w2)/2, yPos, 0), new THREE.Vector3(w2, 1, 4), mat);
        } else if (type === 1) {
            const rot = rng.range(-0.5, 0.5);
            const box = createBox(new THREE.Vector3(0, yPos, 0), new THREE.Vector3(6, 0.5, 4), mat);
            box.rotation.z = rot;
            box.userData.isRotated = true;
        } else {
            const xOff = rng.range(-2, 2);
            createBox(new THREE.Vector3(xOff, yPos, 0), new THREE.Vector3(2, 2, 2), mat, true); // Bumper
        }

        yPos -= (CONSTANTS.chunkHeight - (state.difficulty * 0.5));
    }

    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({ color: colors.bg, roughness: 1 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = yPos - 10;
    scene.add(floor);

    state.active = true;
}

function createBox(pos, size, mat, isBumper = false) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.userData = { size: size, isBumper: isBumper };
    scene.add(mesh);
    obstacles.push(mesh);
    return mesh;
}

function createParticle(pos, color) {
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mat = new THREE.MeshBasicMaterial({ color: color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.userData = {
        vel: new THREE.Vector3((Math.random()-0.5), Math.random(), (Math.random()-0.5))
    };
    scene.add(mesh);
    particles.push(mesh);
}

function physicsStep() {
    if (!state.active) return;

    state.velocity.y += CONSTANTS.gravity * timeStep;
    
    let nextPos = state.position.clone().add(state.velocity.clone().multiplyScalar(timeStep));
    
    let collided = false;

    for (const obs of obstacles) {
        const box = new THREE.Box3().setFromObject(obs);
        const sphere = new THREE.Sphere(nextPos, CONSTANTS.ballRadius);

        if (box.intersectsSphere(sphere)) {
            const closest = new THREE.Vector3();
            box.clampPoint(sphere.center, closest);
            
            const normal = sphere.center.clone().sub(closest).normalize();
            
            if (obs.userData.isBumper) {
                state.velocity.reflect(normal).multiplyScalar(1.5);
                createParticle(closest, 0xffffff);
            } else {
                state.velocity.reflect(normal).multiplyScalar(CONSTANTS.bounce);
                
                if (normal.y > 0.5) {
                    const friction = new THREE.Vector3(-state.velocity.x * 0.1, 0, -state.velocity.z * 0.1);
                    state.velocity.add(friction);
                }
            }
            
            nextPos = state.position.clone();
            collided = true;
            break;
        }
    }

    if (!collided) {
        state.position.copy(nextPos);
    }
    
    ball.position.copy(state.position);
    ball.rotation.x += state.velocity.z * timeStep;
    ball.rotation.z -= state.velocity.x * timeStep;
}

function updateCamera() {
    const targetY = state.position.y;
    const currentY = camera.position.y;
    const smoothY = THREE.MathUtils.lerp(currentY, targetY - 5, 0.1);
    
    camera.position.set(20, smoothY + 20, 20);
    camera.lookAt(0, smoothY, 0);
}

function animate(time) {
    requestAnimationFrame(animate);

    const delta = time - lastTime;
    lastTime = time;
    accumulator += Math.min(delta / 1000, 0.1);

    while (accumulator > timeStep) {
        physicsStep();
        accumulator -= timeStep;
    }

    updateCamera();
    
    particles.forEach((p, i) => {
        p.position.add(p.userData.vel.clone().multiplyScalar(0.1));
        p.userData.vel.y -= 0.05;
        p.scale.multiplyScalar(0.9);
        if(p.scale.x < 0.1) {
            scene.remove(p);
            particles.splice(i, 1);
        }
    });

    renderer.render(scene, camera);
}

function setupEvents() {
    window.addEventListener('resize', () => {
        const aspect = window.innerWidth / window.innerHeight;
        const frustumSize = 20;
        camera.left = frustumSize * aspect / -2;
        camera.right = frustumSize * aspect / 2;
        camera.top = frustumSize / 2;
        camera.bottom = frustumSize / -2;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    UI.btnRandom.addEventListener('click', () => {
        UI.seed.value = Math.floor(Math.random() * 99999);
    });

    UI.btnReset.addEventListener('click', () => {
        state.seed = parseInt(UI.seed.value);
        state.difficulty = parseInt(UI.diff.value);
        state.theme = UI.theme.value;
        generateLevel();
    });

    UI.btnRecord.addEventListener('click', toggleRecording);
}

async function toggleRecording() {
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        UI.btnRecord.textContent = "Processing...";
        UI.btnRecord.classList.remove('recording');
        UI.layer.classList.remove('hidden');
    } else {
        const stream = document.querySelector('canvas').captureStream(60);
        const options = { mimeType: 'video/webm;codecs=vp9' };
        
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm;codecs=vp8';
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'video/mp4'; 
                if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                    options.mimeType = ''; 
                }
            }
        }

        try {
            mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
            alert('Recording not supported on this browser/device config.');
            return;
        }

        recordedChunks = [];
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        
        mediaRecorder.onstop = saveVideo;

        mediaRecorder.start();
        isRecording = true;
        UI.btnRecord.textContent = "Stop Recording";
        UI.btnRecord.classList.add('recording');
        
        state.seed = parseInt(UI.seed.value); 
        generateLevel(); 
        
        UI.layer.classList.add('hidden');
        setTimeout(() => UI.layer.classList.remove('hidden'), 2000); 
    }
}

function saveVideo() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bouncey_${state.seed}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    UI.btnRecord.textContent = "Record (Short)";
}

window.addEventListener('load', init);

